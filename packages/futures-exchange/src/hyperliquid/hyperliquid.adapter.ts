import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  MarginMode
} from "@mm/futures-core";
import { SymbolUnknownError, TradingNotAllowedError, enforceLeverageBounds } from "@mm/futures-core";
import { Hyperliquid } from "hyperliquid";
import type { FuturesExchange, PlaceOrderRequest } from "../futures-exchange.interface.js";
import {
  HYPERLIQUID_DEFAULT_MARGIN_COIN,
  HYPERLIQUID_DEFAULT_PRODUCT_TYPE,
  HYPERLIQUID_ZERO_ADDRESS
} from "./hyperliquid.constants.js";
import { HyperliquidAccountApi } from "./hyperliquid.account.api.js";
import { HyperliquidContractCache } from "./hyperliquid.contract-cache.js";
import { HyperliquidMarketApi } from "./hyperliquid.market.api.js";
import { HyperliquidPositionApi } from "./hyperliquid.position.api.js";
import { HyperliquidTradeApi } from "./hyperliquid.trade.api.js";
import {
  coinToCanonicalSymbol,
  fromHyperliquidSymbol,
  parseCoinFromAnySymbol,
  toHyperliquidSymbol,
  toInternalPerpSymbol
} from "./hyperliquid.symbols.js";
import type {
  HyperliquidAdapterConfig,
  HyperliquidContractInfo,
  HyperliquidOrderRaw,
  HyperliquidProductType
} from "./hyperliquid.types.js";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEvmAddress(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return null;
  return text;
}

function mapMarginMode(mode: MarginMode): "isolated" | "crossed" {
  return mode === "isolated" ? "isolated" : "crossed";
}

function toPositionSide(raw: unknown): "long" | "short" {
  return String(raw ?? "").toLowerCase().includes("long") ? "long" : "short";
}

function mapPosition(row: {
  symbol?: string;
  holdSide?: string;
  total?: string;
  avgOpenPrice?: string;
  markPrice?: string;
  unrealizedPL?: string;
}): FuturesPosition {
  const coin = parseCoinFromAnySymbol(String(row.symbol ?? ""));
  return {
    symbol: coinToCanonicalSymbol(coin),
    side: toPositionSide(row.holdSide),
    size: toNumber(row.total) ?? 0,
    entryPrice: toNumber(row.avgOpenPrice) ?? 0,
    markPrice: toNumber(row.markPrice) ?? undefined,
    unrealizedPnl: toNumber(row.unrealizedPL) ?? undefined
  };
}

function normalizeQty(qty: number, stepSize: number | null | undefined): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (!stepSize || !Number.isFinite(stepSize) || stepSize <= 0) return qty;
  const steps = Math.floor(qty / stepSize);
  return Number((steps * stepSize).toFixed(12));
}

function parseOrderId(row: { orderId?: string; clientOid?: string }): string | null {
  const orderId = String(row.orderId ?? "").trim();
  if (orderId) return orderId;
  const clientOid = String(row.clientOid ?? "").trim();
  return clientOid || null;
}

export class HyperliquidFuturesAdapter implements FuturesExchange {
  readonly sdk: Hyperliquid;
  readonly marketApi: HyperliquidMarketApi;
  readonly accountApi: HyperliquidAccountApi;
  readonly positionApi: HyperliquidPositionApi;
  readonly tradeApi: HyperliquidTradeApi;
  readonly contractCache: HyperliquidContractCache;

  readonly productType: HyperliquidProductType;
  readonly marginCoin: string;
  readonly defaultPositionMode: "one-way" | "hedge";

  private readonly userAddress: string;
  private readonly hasSigning: boolean;
  private readonly orderSymbolIndex = new Map<string, string>();

  private readonly tickerSymbols = new Set<string>();
  private readonly depthSymbols = new Set<string>();
  private readonly tradeSymbols = new Set<string>();

  private readonly tickerCallbacks = new Set<(payload: any) => void>();
  private readonly depthCallbacks = new Set<(payload: any) => void>();
  private readonly tradeCallbacks = new Set<(payload: any) => void>();
  private readonly fillCallbacks = new Set<(payload: any) => void>();
  private readonly orderCallbacks = new Set<(payload: any) => void>();
  private readonly positionCallbacks = new Set<(payload: any) => void>();

  private marketPollTimer: NodeJS.Timeout | null = null;
  private marketPollRunning = false;
  private privatePollTimer: NodeJS.Timeout | null = null;
  private privatePollRunning = false;
  private readonly seenFillKeys = new Set<string>();

  constructor(private readonly config: HyperliquidAdapterConfig = {}) {
    this.productType = config.productType ?? HYPERLIQUID_DEFAULT_PRODUCT_TYPE;
    this.marginCoin = config.marginCoin ?? HYPERLIQUID_DEFAULT_MARGIN_COIN;
    this.defaultPositionMode = config.defaultPositionMode ?? "one-way";

    const walletAddress = normalizeEvmAddress(config.apiKey);
    const vaultAddress = normalizeEvmAddress(config.apiPassphrase);
    this.userAddress = vaultAddress ?? walletAddress ?? HYPERLIQUID_ZERO_ADDRESS;
    this.hasSigning = String(config.apiSecret ?? "").trim().length > 0;

    this.sdk = new Hyperliquid({
      enableWs: false,
      privateKey: config.apiSecret,
      walletAddress: walletAddress ?? this.userAddress,
      vaultAddress: vaultAddress ?? undefined,
      testnet:
        String(config.restBaseUrl ?? "").toLowerCase().includes("testnet") ||
        String(process.env.HYPERLIQUID_TESTNET ?? "").trim() === "1",
      disableAssetMapRefresh: false
    });

    this.marketApi = new HyperliquidMarketApi(this.sdk);
    this.accountApi = new HyperliquidAccountApi(this.sdk, this.userAddress);
    this.positionApi = new HyperliquidPositionApi(this.sdk, this.userAddress);
    this.tradeApi = new HyperliquidTradeApi(this.sdk, this.userAddress, this.hasSigning);

    this.contractCache = new HyperliquidContractCache(this.marketApi, {
      ttlSeconds: Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300")
    });
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "hyperliquid/metaAndAssetCtxs",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `hyperliquid contract warmup failed: ${String(error)}`
      });
    });
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
    const registry = this.contractCache.getSymbolRegistry();
    return fromHyperliquidSymbol(symbol, registry) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(symbol));
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    await this.contractCache.refresh(false);
    const registry = this.contractCache.getSymbolRegistry();
    const exchangeSymbol = toHyperliquidSymbol(symbol, registry);
    if (exchangeSymbol) return exchangeSymbol;

    const coin = parseCoinFromAnySymbol(symbol);
    const internal = toInternalPerpSymbol(coin);
    const fallback = toHyperliquidSymbol(internal, registry);
    if (fallback) return fallback;

    throw new SymbolUnknownError(symbol);
  }

  async setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void> {
    const contract = await this.requireTradeableContract(symbol);
    enforceLeverageBounds(leverage, contract);

    await this.accountApi.setMarginMode({
      symbol: contract.mexcSymbol,
      marginMode: mapMarginMode(marginMode),
      marginCoin: this.marginCoin,
      productType: this.productType
    });

    await this.accountApi.setLeverage({
      symbol: contract.mexcSymbol,
      leverage,
      marginCoin: this.marginCoin,
      productType: this.productType
    });
  }

  async placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string }> {
    const contract = await this.requireTradeableContract(req.symbol);

    const qty = normalizeQty(Number(req.qty), contract.stepSize);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`hyperliquid_invalid_qty:${String(req.qty)}`);
    }

    const placed = await this.tradeApi.placeOrder({
      symbol: contract.mexcSymbol,
      productType: this.productType,
      marginCoin: this.marginCoin,
      marginMode: mapMarginMode(req.marginMode ?? "cross"),
      side: req.side,
      orderType: req.type,
      size: String(qty),
      price: req.price !== undefined ? String(req.price) : undefined,
      presetStopSurplusPrice:
        req.takeProfitPrice !== undefined ? String(req.takeProfitPrice) : undefined,
      presetStopLossPrice:
        req.stopLossPrice !== undefined ? String(req.stopLossPrice) : undefined,
      force: req.type === "limit" ? "gtc" : "ioc",
      reduceOnly: req.reduceOnly ? "YES" : "NO"
    });

    const orderId = parseOrderId(placed);
    if (!orderId) {
      throw new Error("hyperliquid_place_order_missing_order_id");
    }

    this.orderSymbolIndex.set(orderId, contract.mexcSymbol);
    return { orderId };
  }

  async cancelOrder(orderId: string): Promise<void> {
    let symbol = this.orderSymbolIndex.get(orderId) ?? null;

    if (!symbol) {
      const pending = await this.tradeApi.getPendingOrders({
        productType: this.productType,
        pageSize: 100
      });
      const matched = pending.find((item) => String(item.orderId ?? "") === orderId);
      symbol = String(matched?.symbol ?? "").trim() || null;
    }

    if (!symbol) {
      throw new Error(`hyperliquid_symbol_resolution_failed:${orderId}`);
    }

    await this.tradeApi.cancelOrder({
      symbol,
      orderId,
      productType: this.productType
    });
  }

  async subscribeTicker(symbol: string): Promise<void> {
    this.tickerSymbols.add(await this.toExchangeSymbol(symbol));
    this.ensureMarketPoller();
  }

  async subscribeDepth(symbol: string): Promise<void> {
    this.depthSymbols.add(await this.toExchangeSymbol(symbol));
    this.ensureMarketPoller();
  }

  async subscribeTrades(symbol: string): Promise<void> {
    this.tradeSymbols.add(await this.toExchangeSymbol(symbol));
    this.ensureMarketPoller();
  }

  onTicker(callback: (payload: any) => void): () => void {
    this.tickerCallbacks.add(callback);
    return () => {
      this.tickerCallbacks.delete(callback);
    };
  }

  onDepth(callback: (payload: any) => void): () => void {
    this.depthCallbacks.add(callback);
    return () => {
      this.depthCallbacks.delete(callback);
    };
  }

  onTrades(callback: (payload: any) => void): () => void {
    this.tradeCallbacks.add(callback);
    return () => {
      this.tradeCallbacks.delete(callback);
    };
  }

  onFill(callback: (event: any) => void): () => void {
    this.fillCallbacks.add(callback);
    this.ensurePrivatePoller();
    return () => {
      this.fillCallbacks.delete(callback);
    };
  }

  onPositionUpdate(callback: (event: any) => void): () => void {
    this.positionCallbacks.add(callback);
    this.ensurePrivatePoller();
    return () => {
      this.positionCallbacks.delete(callback);
    };
  }

  onOrderUpdate(callback: (event: any) => void): () => void {
    this.orderCallbacks.add(callback);
    this.ensurePrivatePoller();
    return () => {
      this.orderCallbacks.delete(callback);
    };
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
    if (this.marketPollTimer) {
      clearInterval(this.marketPollTimer);
      this.marketPollTimer = null;
    }
    if (this.privatePollTimer) {
      clearInterval(this.privatePollTimer);
      this.privatePollTimer = null;
    }

    this.tickerSymbols.clear();
    this.depthSymbols.clear();
    this.tradeSymbols.clear();

    this.tickerCallbacks.clear();
    this.depthCallbacks.clear();
    this.tradeCallbacks.clear();
    this.fillCallbacks.clear();
    this.orderCallbacks.clear();
    this.positionCallbacks.clear();
    this.seenFillKeys.clear();
  }

  private ensureMarketPoller(): void {
    if (this.marketPollTimer) return;
    const intervalMs = Math.max(1_000, Number(process.env.HYPERLIQUID_MARKET_POLL_MS ?? "2000"));

    this.marketPollTimer = setInterval(() => {
      void this.runMarketPoll();
    }, intervalMs);

    void this.runMarketPoll();
  }

  private async runMarketPoll(): Promise<void> {
    if (this.marketPollRunning) return;
    this.marketPollRunning = true;

    try {
      if (this.tickerCallbacks.size > 0) {
        for (const symbol of this.tickerSymbols) {
          try {
            const ticker = await this.marketApi.getTicker(symbol, this.productType);
            const payload = {
              data: [ticker]
            };
            for (const cb of this.tickerCallbacks) cb(payload);
          } catch {
            // keep polling resilient per symbol
          }
        }
      }

      if (this.depthCallbacks.size > 0) {
        for (const symbol of this.depthSymbols) {
          try {
            const depth = await this.marketApi.getDepth(symbol, 50, this.productType);
            const payload = {
              data: [depth]
            };
            for (const cb of this.depthCallbacks) cb(payload);
          } catch {
            // keep polling resilient per symbol
          }
        }
      }

      if (this.tradeCallbacks.size > 0) {
        for (const symbol of this.tradeSymbols) {
          try {
            const trades = await this.marketApi.getTrades(symbol, 60, this.productType);
            const payload = {
              data: Array.isArray(trades) ? trades : []
            };
            for (const cb of this.tradeCallbacks) cb(payload);
          } catch {
            // keep polling resilient per symbol
          }
        }
      }
    } finally {
      this.marketPollRunning = false;
    }
  }

  private ensurePrivatePoller(): void {
    if (this.privatePollTimer) return;
    const intervalMs = Math.max(2_000, Number(process.env.HYPERLIQUID_PRIVATE_POLL_MS ?? "5000"));

    this.privatePollTimer = setInterval(() => {
      void this.runPrivatePoll();
    }, intervalMs);

    void this.runPrivatePoll();
  }

  private async runPrivatePoll(): Promise<void> {
    if (this.privatePollRunning) return;
    this.privatePollRunning = true;

    try {
      if (this.fillCallbacks.size > 0) {
        try {
          const fills = await this.tradeApi.getFills({ limit: 50 });
          const rows = Array.isArray(fills) ? fills : [];
          for (const row of rows.slice().reverse()) {
            const record = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
            if (!record) continue;
            const key = `${String(record.tid ?? "")}:${String(record.hash ?? "")}`;
            if (!key || this.seenFillKeys.has(key)) continue;
            this.seenFillKeys.add(key);
            if (this.seenFillKeys.size > 500) {
              const oldest = this.seenFillKeys.values().next().value as string | undefined;
              if (oldest) this.seenFillKeys.delete(oldest);
            }

            const symbol = this.toCanonicalSymbol(String(record.coin ?? "")) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(String(record.coin ?? "")));
            const event = {
              orderId: String(record.oid ?? ""),
              symbol,
              side: String(record.side ?? "").toLowerCase().includes("b") ? "buy" : "sell",
              price: toNumber(record.px) ?? undefined,
              qty: toNumber(record.sz) ?? undefined,
              raw: row
            };
            for (const cb of this.fillCallbacks) cb(event);
          }
        } catch {
          // keep poller resilient
        }
      }

      if (this.orderCallbacks.size > 0) {
        try {
          const [openOrders, openPlans] = await Promise.all([
            this.tradeApi.getPendingOrders({ pageSize: 50 }),
            this.tradeApi.getPendingPlanOrders({ pageSize: 50 })
          ]);
          const rows = [...openOrders, ...openPlans];
          for (const row of rows) {
            const symbol = row.symbol ? this.toCanonicalSymbol(row.symbol) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(row.symbol)) : undefined;
            const event = {
              orderId: String(row.orderId ?? ""),
              symbol,
              status: row.status,
              raw: row
            };
            for (const cb of this.orderCallbacks) cb(event);
          }
        } catch {
          // keep poller resilient
        }
      }

      if (this.positionCallbacks.size > 0) {
        try {
          const positions = await this.getPositions();
          for (const row of positions) {
            const event = {
              symbol: row.symbol,
              side: row.side,
              size: row.size,
              raw: row
            };
            for (const cb of this.positionCallbacks) cb(event);
          }
        } catch {
          // keep poller resilient
        }
      }
    } finally {
      this.privatePollRunning = false;
    }
  }

  private async requireTradeableContract(symbol: string): Promise<HyperliquidContractInfo> {
    const contract = await this.contractCache.getByCanonical(symbol);
    if (!contract) throw new SymbolUnknownError(symbol);

    if (!contract.apiAllowed) {
      throw new TradingNotAllowedError(contract.canonicalSymbol, `Hyperliquid symbol ${contract.mexcSymbol} is not tradable`);
    }

    return contract;
  }
}
