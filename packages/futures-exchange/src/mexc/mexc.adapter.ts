import type {
  AccountState,
  ContractInfo,
  ContractCacheOptions,
  FuturesPosition,
  MarginMode,
  OrderSide,
  OrderType,
  SymbolRegistry
} from "@mm/futures-core";
import {
  ContractCache,
  InvalidStepError,
  InvalidTickError,
  SymbolUnknownError,
  TradingNotAllowedError,
  clampQty,
  deriveStepSize,
  deriveTickSize,
  enforceLeverageBounds,
  roundPriceToTick,
  roundQtyToStep,
  validatePrice,
  validateQty
} from "@mm/futures-core";
import type { FuturesExchange, PlaceOrderRequest } from "../futures-exchange.interface.js";
import { MexcInvalidParamsError, MexcMaintenanceError } from "./mexc.errors.js";
import { MexcAccountApi } from "./mexc.account.api.js";
import { MexcMarketApi } from "./mexc.market.api.js";
import { MexcRestClient } from "./mexc.rest.js";
import { createDefaultMexcCapabilities, MexcTradingApi } from "./mexc.trading.api.js";
import type {
  MexcAdapterConfig,
  MexcCapabilities,
  MexcContractDetail,
  MexcContractInfo,
  MexcFillEvent,
  MexcOrderEvent,
  MexcOrderResponse,
  MexcPlaceOrderRequest,
  MexcPositionEvent,
  MexcPositionRaw,
  MexcWsPayload
} from "./mexc.types.js";
import { MexcPrivateWsApi } from "./mexc.ws.private.js";
import { MexcPublicWsApi } from "./mexc.ws.public.js";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCanonicalFallbackSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function toPositionSide(raw: unknown): "long" | "short" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "1" || value === "long" || value.includes("long")) return "long";
  return "short";
}

function toMarginMode(raw: unknown): MarginMode | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "1" || value === "isolated") return "isolated";
  if (value === "2" || value === "cross") return "cross";
  return undefined;
}

function mergeCapabilities(input?: Partial<MexcCapabilities>): MexcCapabilities {
  return {
    ...createDefaultMexcCapabilities(),
    ...(input ?? {})
  };
}

function toMexcOrderType(type: OrderType): number {
  return type === "market" ? 5 : 1;
}

function toMexcOrderSide(side: OrderSide, reduceOnly: boolean): number {
  if (side === "buy") {
    return reduceOnly ? 4 : 1;
  }
  return reduceOnly ? 2 : 3;
}

function toMexcOpenType(mode: MarginMode): number {
  return mode === "isolated" ? 1 : 2;
}

function mapPosition(raw: MexcPositionRaw): FuturesPosition {
  const size = toNumber(raw.holdVol) ?? toNumber(raw.positionVol) ?? 0;

  return {
    symbol: toCanonicalFallbackSymbol(String(raw.symbol ?? "")),
    side: toPositionSide(raw.positionType),
    size,
    entryPrice:
      toNumber(raw.openAvgPrice) ?? toNumber(raw.holdAvgPrice) ?? toNumber(raw.avgPrice) ?? 0,
    markPrice: toNumber(raw.fairPrice) ?? undefined,
    unrealizedPnl: toNumber(raw.unrealizedPnl) ?? undefined
  };
}

function pickOrderId(response: MexcOrderResponse): string | null {
  const candidates = [response.orderId, response.order_id, response.externalOid];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function toContractInfo(detail: MexcContractDetail): MexcContractInfo {
  const mexcSymbol = String(detail.symbol ?? "").trim().toUpperCase();
  const canonicalSymbol = toCanonicalFallbackSymbol(mexcSymbol);

  return {
    canonicalSymbol,
    mexcSymbol,
    baseAsset: detail.baseCoin,
    quoteAsset: detail.quoteCoin,
    minVol: toNumber(detail.minVol),
    maxVol: toNumber(detail.maxVol),
    tickSize: toNumber(detail.priceUnit),
    stepSize: toNumber(detail.volUnit),
    priceScale: toNumber(detail.priceScale),
    volScale: toNumber(detail.volScale),
    priceUnit: toNumber(detail.priceUnit),
    volUnit: toNumber(detail.volUnit),
    contractSize: toNumber(detail.contractSize),
    minLeverage: toNumber(detail.minLeverage),
    maxLeverage: toNumber(detail.maxLeverage),
    apiAllowed: detail.apiAllowed !== false,
    makerFeeRate: toNumber(detail.makerFeeRate),
    takerFeeRate: toNumber(detail.takerFeeRate),
    updatedAt: new Date().toISOString(),
    raw: detail
  };
}

export class MexcFuturesAdapter implements FuturesExchange {
  readonly capabilities: MexcCapabilities;

  readonly rest: MexcRestClient;
  readonly marketApi: MexcMarketApi;
  readonly accountApi: MexcAccountApi;
  readonly tradingApi: MexcTradingApi;

  private readonly publicWs: MexcPublicWsApi;
  private readonly privateWs: MexcPrivateWsApi | null;
  private readonly contractCache: ContractCache;

  constructor(private readonly config: MexcAdapterConfig = {}) {
    this.capabilities = mergeCapabilities(config.capabilities);

    this.rest = new MexcRestClient(config);
    this.marketApi = new MexcMarketApi(this.rest);
    this.accountApi = new MexcAccountApi(this.rest);
    this.tradingApi = new MexcTradingApi(this.rest, this.capabilities);

    this.publicWs = new MexcPublicWsApi(config);
    this.privateWs = config.apiKey && config.apiSecret ? new MexcPrivateWsApi(config) : null;

    const cacheOptions: ContractCacheOptions = {
      ttlSeconds: Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300"),
      loader: async () => {
        const raw = await this.marketApi.getContractDetail();
        const details = Array.isArray(raw) ? raw : [raw];
        return details.filter((row): row is MexcContractDetail => Boolean(row && row.symbol)).map(toContractInfo);
      }
    };

    this.contractCache = new ContractCache(cacheOptions);
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "/api/v1/contract/detail",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `contract cache warmup failed: ${String(error)}`
      });
    });
  }

  async getAccountState(): Promise<AccountState> {
    const [assets, positionModeRaw] = await Promise.all([
      this.accountApi.getAssets(),
      this.accountApi.getPositionMode().catch(() => ({ positionMode: undefined }))
    ]);

    const totalEquity = assets.reduce((sum, asset) => {
      const value = toNumber(asset.equity) ?? toNumber(asset.cashBalance) ?? 0;
      return sum + value;
    }, 0);

    const availableMargin = assets.reduce((sum, asset) => {
      const value = toNumber(asset.availableBalance) ?? 0;
      return sum + value;
    }, 0);

    return {
      equity: totalEquity,
      availableMargin,
      marginMode: toMarginMode(positionModeRaw.positionMode)
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    const rows = await this.accountApi.getOpenPositions();
    return rows
      .map((row) => mapPosition(row))
      .filter((position) => position.symbol.length > 0 && position.size > 0);
  }

  async getContractInfo(symbol: string): Promise<ContractInfo | null> {
    return this.contractCache.getByCanonical(symbol);
  }

  async listContractInfo(): Promise<ContractInfo[]> {
    await this.contractCache.refresh(false);
    return this.contractCache.snapshot();
  }

  getSymbolRegistry(): SymbolRegistry {
    return this.contractCache.getSymbolRegistry();
  }

  toCanonicalSymbol(symbol: string): string | null {
    return this.contractCache.getSymbolRegistry().toCanonicalSymbol(symbol);
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    await this.contractCache.refresh(false);
    const mexc = this.contractCache.getSymbolRegistry().toMexcSymbol(symbol);
    if (!mexc) throw new SymbolUnknownError(symbol);
    return mexc;
  }

  async setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void> {
    const contract = await this.requireContract(symbol);
    enforceLeverageBounds(leverage, contract);
    await this.accountApi.changeLeverage(contract.mexcSymbol, leverage, toMexcOpenType(marginMode));
  }

  async placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string }> {
    const contract = await this.requireTradeableContract(req.symbol);

    const stepSize = deriveStepSize(contract);
    if (!stepSize) {
      throw new InvalidStepError(contract.canonicalSymbol, `Missing step size for ${contract.canonicalSymbol}`);
    }

    let qty = roundQtyToStep(req.qty, stepSize, "down");
    qty = clampQty(qty, contract.minVol, contract.maxVol);

    const qtyValidation = validateQty(qty, stepSize, contract.minVol, contract.maxVol, contract.canonicalSymbol);
    if (!qtyValidation.ok) throw qtyValidation.error;

    let normalizedPrice: number | undefined;
    if (req.type === "limit") {
      if (!Number.isFinite(req.price) || (req.price ?? 0) <= 0) {
        throw new MexcInvalidParamsError("Limit order requires a positive price", {
          endpoint: "/api/v1/private/order/submit",
          method: "POST"
        });
      }

      const tickSize = deriveTickSize(contract);
      if (!tickSize) {
        throw new InvalidTickError(contract.canonicalSymbol, `Missing tick size for ${contract.canonicalSymbol}`);
      }

      normalizedPrice = roundPriceToTick(req.price as number, tickSize, "nearest");
      const priceValidation = validatePrice(normalizedPrice, tickSize, contract.canonicalSymbol);
      if (!priceValidation.ok) throw priceValidation.error;
    }

    const payload: MexcPlaceOrderRequest = {
      symbol: contract.mexcSymbol,
      vol: qty,
      side: toMexcOrderSide(req.side, Boolean(req.reduceOnly)),
      type: toMexcOrderType(req.type),
      openType: 2,
      reduceOnly: req.reduceOnly,
      price: normalizedPrice
    };

    const result = await this.tradingApi.submitOrder(payload);
    const orderId = pickOrderId(result);
    if (!orderId) {
      throw new MexcInvalidParamsError("MEXC did not return order id", {
        endpoint: "/api/v1/private/order/submit",
        method: "POST"
      });
    }

    return { orderId };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.tradingApi.cancelOrder(orderId);
  }

  async subscribeTicker(symbol: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeTicker(await this.toExchangeSymbol(symbol));
  }

  async subscribeDepth(symbol: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeDepth(await this.toExchangeSymbol(symbol));
  }

  async subscribeKline(symbol: string, interval: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeKline(await this.toExchangeSymbol(symbol), interval);
  }

  onTicker(callback: (payload: MexcWsPayload) => void): () => void {
    return this.publicWs.onTicker((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onDepth(callback: (payload: MexcWsPayload) => void): () => void {
    return this.publicWs.onDepth((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onKline(callback: (payload: MexcWsPayload) => void): () => void {
    return this.publicWs.onKline((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onFill(callback: (event: MexcFillEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();

    return ws.onFill((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? toCanonicalFallbackSymbol(event.symbol)
      });
    });
  }

  onPositionUpdate(callback: (event: MexcPositionEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();

    return ws.onPositionUpdate((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? toCanonicalFallbackSymbol(event.symbol)
      });
    });
  }

  onOrderUpdate(callback: (event: MexcOrderEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();

    return ws.onOrderUpdate((event) => {
      callback({
        ...event,
        symbol: event.symbol
          ? this.toCanonicalSymbol(event.symbol) ?? toCanonicalFallbackSymbol(event.symbol)
          : undefined
      });
    });
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
    await this.publicWs.disconnect();
    if (this.privateWs) {
      await this.privateWs.disconnect();
    }
  }

  private normalizeWsPayloadSymbol(payload: MexcWsPayload): MexcWsPayload {
    if (typeof payload.symbol !== "string") return payload;
    const canonical = this.toCanonicalSymbol(payload.symbol) ?? toCanonicalFallbackSymbol(payload.symbol);
    return {
      ...payload,
      symbol: canonical
    };
  }

  private async requireContract(symbol: string): Promise<ContractInfo> {
    const contract = await this.contractCache.getByCanonical(symbol);
    if (!contract) throw new SymbolUnknownError(symbol);
    return contract;
  }

  private async requireTradeableContract(symbol: string): Promise<ContractInfo> {
    const contract = await this.requireContract(symbol);
    if (!contract.apiAllowed) {
      throw new TradingNotAllowedError(
        contract.canonicalSymbol,
        `Trading disabled by exchange for ${contract.mexcSymbol} (apiAllowed=false)`
      );
    }
    return contract;
  }

  private requirePrivateWs(): MexcPrivateWsApi {
    if (!this.privateWs) {
      throw new MexcMaintenanceError("MEXC private websocket requires apiKey/apiSecret", {
        endpoint: "ws://private",
        method: "GET"
      });
    }
    return this.privateWs;
  }
}
