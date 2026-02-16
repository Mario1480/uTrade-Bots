import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  MarginMode
} from "@mm/futures-core";
import { SymbolUnknownError, TradingNotAllowedError, enforceLeverageBounds } from "@mm/futures-core";
import type { FuturesExchange, PlaceOrderRequest } from "../futures-exchange.interface.js";
import {
  BITGET_DEFAULT_MARGIN_COIN,
  BITGET_DEFAULT_PRODUCT_TYPE,
  type BitgetProductType
} from "./bitget.constants.js";
import { BitgetAccountApi } from "./bitget.account.api.js";
import { BitgetContractCache } from "./bitget.contract-cache.js";
import { BitgetInvalidParamsError, BitgetSymbolStatusError } from "./bitget.errors.js";
import { BitgetMarketApi } from "./bitget.market.api.js";
import { BitgetPositionApi } from "./bitget.position.api.js";
import { BitgetRestClient } from "./bitget.rest.js";
import { normalizeOrderInput } from "./bitget.sizing.js";
import { fromBitgetSymbol, normalizeCanonicalSymbol, toBitgetSymbol } from "./bitget.symbols.js";
import { BitgetTradeApi } from "./bitget.trade.api.js";
import type {
  BitgetAdapterConfig,
  BitgetContractInfo,
  BitgetFillEvent,
  BitgetOrderEvent,
  BitgetPositionEvent,
  BitgetPositionRaw,
  BitgetWsPayload
} from "./bitget.types.js";
import { BitgetPrivateWsApi } from "./bitget.ws.private.js";
import { BitgetPublicWsApi } from "./bitget.ws.public.js";

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapMarginMode(mode: MarginMode): "isolated" | "crossed" {
  return mode === "isolated" ? "isolated" : "crossed";
}

function isMarginModeLockedError(error: unknown): boolean {
  const text = String(error ?? "").toLowerCase();
  return (
    text.includes("margin mode cannot be adjusted") ||
    text.includes("currently holding positions or orders")
  );
}

function toPositionSide(raw: unknown): "long" | "short" {
  return String(raw ?? "").toLowerCase().includes("long") ? "long" : "short";
}

function mapPosition(row: BitgetPositionRaw): FuturesPosition {
  const canonical = normalizeCanonicalSymbol(String(row.symbol ?? ""));
  return {
    symbol: canonical,
    side: toPositionSide(row.holdSide),
    size: toNumber(row.total) ?? 0,
    entryPrice: toNumber(row.avgOpenPrice) ?? 0,
    markPrice: toNumber(row.markPrice) ?? undefined,
    unrealizedPnl: toNumber(row.unrealizedPL) ?? undefined
  };
}

export class BitgetFuturesAdapter implements FuturesExchange {
  readonly rest: BitgetRestClient;
  readonly marketApi: BitgetMarketApi;
  readonly accountApi: BitgetAccountApi;
  readonly positionApi: BitgetPositionApi;
  readonly tradeApi: BitgetTradeApi;
  readonly contractCache: BitgetContractCache;

  readonly productType: BitgetProductType;
  readonly marginCoin: string;
  readonly defaultPositionMode: "one-way" | "hedge";

  private readonly publicWs: BitgetPublicWsApi;
  private readonly privateWs: BitgetPrivateWsApi | null;

  private readonly orderSymbolIndex = new Map<string, string>();
  private positionModeHint: { mode: "one-way" | "hedge"; ts: number } | null = null;

  constructor(private readonly config: BitgetAdapterConfig = {}) {
    this.productType = config.productType ?? BITGET_DEFAULT_PRODUCT_TYPE;
    this.marginCoin = config.marginCoin ?? BITGET_DEFAULT_MARGIN_COIN;
    this.defaultPositionMode = config.defaultPositionMode ?? "one-way";

    this.rest = new BitgetRestClient(config);
    this.marketApi = new BitgetMarketApi(this.rest);
    this.accountApi = new BitgetAccountApi(this.rest);
    this.positionApi = new BitgetPositionApi(this.rest);
    this.tradeApi = new BitgetTradeApi(this.rest);

    this.contractCache = new BitgetContractCache(this.marketApi, this.productType, {
      ttlSeconds: Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300")
    });
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "/api/v2/mix/market/contracts",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `bitget contract warmup failed: ${String(error)}`
      });
    });

    this.publicWs = new BitgetPublicWsApi(config, this.productType);

    this.privateWs =
      config.apiKey && config.apiSecret && config.apiPassphrase
        ? new BitgetPrivateWsApi(config, this.productType, () => this.reconcilePrivateState())
        : null;
  }

  async getAccountState(): Promise<AccountState> {
    const accounts = await this.accountApi.getAccounts(this.productType);
    const preferred =
      accounts.find((row) => String(row.marginCoin ?? "").toUpperCase() === this.marginCoin.toUpperCase()) ??
      accounts[0] ??
      null;

    return {
      equity: toNumber(preferred?.accountEquity) ?? 0,
      availableMargin: toNumber(preferred?.available) ?? toNumber(preferred?.crossAvailable) ?? undefined,
      marginMode: undefined
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    const rows = await this.positionApi.getAllPositions({
      productType: this.productType,
      marginCoin: this.marginCoin
    });

    return rows
      .map((row) => mapPosition(row))
      .filter((row) => row.symbol.length > 0 && row.size > 0);
  }

  async getContractInfo(symbol: string): Promise<ContractInfo | null> {
    return this.contractCache.getByCanonical(symbol);
  }

  toCanonicalSymbol(symbol: string): string | null {
    return fromBitgetSymbol(symbol, this.contractCache.getSymbolRegistry());
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    await this.contractCache.refresh(false);
    const exchangeSymbol = toBitgetSymbol(symbol, this.contractCache.getSymbolRegistry());
    if (!exchangeSymbol) throw new SymbolUnknownError(symbol);
    return exchangeSymbol;
  }

  async setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void> {
    const contract = await this.requireTradeableContract(symbol);
    enforceLeverageBounds(leverage, contract);

    try {
      await this.accountApi.setMarginMode({
        symbol: contract.mexcSymbol,
        marginMode: mapMarginMode(marginMode),
        marginCoin: this.marginCoin,
        productType: this.productType
      });
    } catch (error) {
      // Bitget rejects margin-mode changes while orders/positions are open.
      // Continue and still apply leverage + order placement.
      if (!isMarginModeLockedError(error)) throw error;
    }

    await this.accountApi.setLeverage({
      symbol: contract.mexcSymbol,
      leverage,
      marginCoin: this.marginCoin,
      productType: this.productType
    });
  }

  async placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string }> {
    const contract = await this.requireTradeableContract(req.symbol);

    const normalized = normalizeOrderInput({
      contract,
      qty: req.qty,
      price: req.price,
      type: req.type,
      roundingMode: "down"
    });
    const initialMode = await this.resolvePositionMode();
    const place = (mode: "one-way" | "hedge") =>
      this.tradeApi.placeOrder({
        symbol: contract.mexcSymbol,
        productType: this.productType,
        marginCoin: this.marginCoin,
        marginMode: mapMarginMode(req.marginMode ?? "cross"),
        side: req.side,
        tradeSide:
          mode === "hedge"
            ? req.reduceOnly
              ? "close"
              : "open"
            : undefined,
        orderType: req.type,
        size: String(normalized.qty),
        price: normalized.price !== undefined ? String(normalized.price) : undefined,
        presetStopSurplusPrice:
          req.takeProfitPrice !== undefined ? String(req.takeProfitPrice) : undefined,
        presetStopLossPrice:
          req.stopLossPrice !== undefined ? String(req.stopLossPrice) : undefined,
        force: req.type === "limit" ? "gtc" : "ioc",
        // Send reduceOnly only when true; open orders should omit it for max compatibility.
        reduceOnly: req.reduceOnly ? "YES" : undefined
      });

    let placed: { orderId?: string; clientOid?: string };
    try {
      placed = await place(initialMode);
    } catch (error) {
      if (!this.isPositionModeOrderTypeMismatch(error)) throw error;
      const fallbackMode: "one-way" | "hedge" = initialMode === "hedge" ? "one-way" : "hedge";
      this.positionModeHint = { mode: fallbackMode, ts: Date.now() };
      placed = await place(fallbackMode);
    }

    const orderId = placed.orderId?.trim();
    if (!orderId) {
      throw new BitgetInvalidParamsError("Bitget place-order did not return orderId", {
        endpoint: "/api/v2/mix/order/place-order",
        method: "POST"
      });
    }

    this.orderSymbolIndex.set(orderId, contract.mexcSymbol);
    return { orderId };
  }

  private async resolvePositionMode(): Promise<"one-way" | "hedge"> {
    const cacheMs = Number(process.env.BITGET_POSITION_MODE_CACHE_MS ?? "60000");
    if (
      this.positionModeHint &&
      Number.isFinite(cacheMs) &&
      cacheMs > 0 &&
      Date.now() - this.positionModeHint.ts < cacheMs
    ) {
      return this.positionModeHint.mode;
    }
    try {
      const modeRaw = await this.accountApi.getPositionMode(this.productType);
      const text = String(modeRaw?.posMode ?? "").toLowerCase();
      const mode: "one-way" | "hedge" = text.includes("hedge") ? "hedge" : "one-way";
      this.positionModeHint = { mode, ts: Date.now() };
      return mode;
    } catch {
      const mode = this.defaultPositionMode;
      this.positionModeHint = { mode, ts: Date.now() };
      return mode;
    }
  }

  private isPositionModeOrderTypeMismatch(error: unknown): boolean {
    const msg = String(error ?? "").toLowerCase();
    if (!msg.includes("order type")) return false;
    return (
      msg.includes("unilateral") ||
      msg.includes("one-way") ||
      msg.includes("hedge") ||
      msg.includes("position mode")
    );
  }

  async cancelOrder(orderId: string): Promise<void> {
    let symbol = this.orderSymbolIndex.get(orderId) ?? null;

    if (!symbol) {
      const pending = await this.tradeApi.getPendingOrders({
        productType: this.productType,
        pageSize: 100
      });
      const matched = pending.find((item) => String(item.orderId ?? "") === orderId);
      symbol = matched?.symbol ?? null;
    }

    if (!symbol) {
      throw new BitgetInvalidParamsError(`Unable to resolve symbol for orderId ${orderId}`, {
        endpoint: "/api/v2/mix/order/cancel-order",
        method: "POST"
      });
    }

    await this.tradeApi.cancelOrder({
      symbol,
      orderId,
      productType: this.productType
    });
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
    await this.publicWs.subscribeCandle(await this.toExchangeSymbol(symbol), interval);
  }

  async subscribeTrades(symbol: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeTrades(await this.toExchangeSymbol(symbol));
  }

  onTicker(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onTicker((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onDepth(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onDepth((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onKline(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onCandle("candle1m", (payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onTrades(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onTrades((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onFill(callback: (event: BitgetFillEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();
    void ws.subscribeFills();

    return ws.onFill((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? normalizeCanonicalSymbol(event.symbol)
      });
    });
  }

  onPositionUpdate(callback: (event: BitgetPositionEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();
    void ws.subscribePositions();

    return ws.onPositionUpdate((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? normalizeCanonicalSymbol(event.symbol)
      });
    });
  }

  onOrderUpdate(callback: (event: BitgetOrderEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();
    void ws.subscribeOrders();

    return ws.onOrderUpdate((event) => {
      callback({
        ...event,
        symbol: event.symbol
          ? this.toCanonicalSymbol(event.symbol) ?? normalizeCanonicalSymbol(event.symbol)
          : undefined
      });
    });
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
    await this.publicWs.disconnect();
    if (this.privateWs) await this.privateWs.disconnect();
  }

  private async reconcilePrivateState(): Promise<void> {
    const startedAt = Date.now();
    try {
      const [openOrders, positions, fills] = await Promise.allSettled([
        this.tradeApi.getPendingOrders({ productType: this.productType, pageSize: 100 }),
        this.positionApi.getAllPositions({ productType: this.productType, marginCoin: this.marginCoin }),
        this.tradeApi.getFills({ productType: this.productType, limit: 100 })
      ]);

      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "ws/private/reconcile",
        method: "GET",
        durationMs: Date.now() - startedAt,
        ok: true,
        message: JSON.stringify({
          openOrders: openOrders.status === "fulfilled" ? openOrders.value.length : "failed",
          positions: positions.status === "fulfilled" ? positions.value.length : "failed",
          fills: fills.status === "fulfilled" ? "ok" : "failed"
        })
      });
    } catch (error) {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "ws/private/reconcile",
        method: "GET",
        durationMs: Date.now() - startedAt,
        ok: false,
        message: String(error)
      });
    }
  }

  private normalizeWsPayloadSymbol(payload: BitgetWsPayload): BitgetWsPayload {
    const data = payload.data;
    if (!Array.isArray(data)) return payload;

    const normalized = data.map((row) => {
      if (!row || typeof row !== "object") return row;
      const symbol = (row as Record<string, unknown>).symbol ?? (row as Record<string, unknown>).instId;
      if (typeof symbol !== "string") return row;

      const canonical = this.toCanonicalSymbol(symbol) ?? normalizeCanonicalSymbol(symbol);
      return {
        ...row,
        symbol: canonical,
        instId: canonical
      };
    });

    return {
      ...payload,
      data: normalized
    };
  }

  private requirePrivateWs(): BitgetPrivateWsApi {
    if (!this.privateWs) {
      throw new BitgetInvalidParamsError(
        "Bitget private websocket requires apiKey/apiSecret/apiPassphrase",
        {
          endpoint: "wss://ws.bitget.com/v2/ws/private",
          method: "GET"
        }
      );
    }

    return this.privateWs;
  }

  private async requireTradeableContract(symbol: string): Promise<BitgetContractInfo> {
    const contract = await this.contractCache.getByCanonical(symbol);
    if (!contract) throw new SymbolUnknownError(symbol);

    if (!contract.apiAllowed) {
      throw new BitgetSymbolStatusError(
        `Bitget symbol ${contract.mexcSymbol} is not tradable: status=${contract.symbolStatus}`,
        {
          endpoint: "/api/v2/mix/market/contracts",
          method: "GET"
        }
      );
    }

    if (contract.symbolStatus !== "normal") {
      throw new TradingNotAllowedError(
        contract.canonicalSymbol,
        `Bitget symbol ${contract.mexcSymbol} blocked by symbolStatus=${contract.symbolStatus}`
      );
    }

    return contract;
  }
}
