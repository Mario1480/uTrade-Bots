import type { Balance, MidPrice, MyTrade, Order, Quote } from "@mm/core";
import type { ExchangeWithCapabilities } from "../exchange.interface.js";
import type { ExchangeCapabilities } from "../exchange.interface.js";
import { createDefaultCcxtCapabilities } from "./ccxt.capabilities.js";
import { CcxtSpotError, mapCcxtError } from "./ccxt.errors.js";
import { fromCcxtSymbol, mapCcxtStatus, toCcxtSymbol } from "./ccxt.mapper.js";
import * as ccxt from "ccxt";

type CcxtClientConfig = {
  exchangeId: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  enableRateLimit?: boolean;
  timeoutMs?: number;
  options?: Record<string, unknown>;
};

type CcxtMarketMap = Record<string, Record<string, unknown>>;

type CcxtExchangeLike = {
  readonly id: string;
  readonly has: Record<string, unknown>;
  readonly markets?: CcxtMarketMap;
  loadMarkets(): Promise<CcxtMarketMap>;
  fetchTicker(symbol: string): Promise<Record<string, unknown>>;
  fetchBalance(): Promise<Record<string, unknown>>;
  fetchOpenOrders(symbol?: string): Promise<Array<Record<string, unknown>>>;
  createOrder(
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price?: number,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  cancelOrder(id: string, symbol?: string): Promise<unknown>;
  cancelAllOrders?(symbol?: string): Promise<unknown>;
  fetchMyTrades(
    symbol?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>>;
  fetchTrades(symbol: string, since?: number, limit?: number): Promise<Array<Record<string, unknown>>>;
  fetchOrderBook(symbol: string, limit?: number): Promise<Record<string, unknown>>;
  fetchOHLCV(
    symbol: string,
    timeframe?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>
  ): Promise<Array<unknown>>;
};

type CcxtMarketSnapshot = {
  symbol: string;
  active: boolean;
  base: string | null;
  quote: string | null;
  precisionPrice: number | null;
  precisionAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  spot: boolean | null;
  perp: boolean | null;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestampMs(value: unknown): number {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? Math.trunc(parsed) : Date.now();
}

function resolveExchangeCtor(exchangeId: string): new (params: Record<string, unknown>) => CcxtExchangeLike {
  const key = String(exchangeId ?? "").trim().toLowerCase();
  const ccxtMap = ccxt as unknown as Record<string, unknown>;
  const direct = ccxtMap[key];
  if (typeof direct === "function") {
    return direct as new (params: Record<string, unknown>) => CcxtExchangeLike;
  }
  const fallback = (ccxtMap.default as Record<string, unknown> | undefined)?.[key];
  if (typeof fallback === "function") {
    return fallback as new (params: Record<string, unknown>) => CcxtExchangeLike;
  }
  throw new CcxtSpotError(`ccxt_exchange_not_supported:${key}`, "ccxt_exchange_not_supported", 400);
}

function mapOrder(row: Record<string, unknown>): Order {
  const symbol = String(row.symbol ?? "").trim();
  let canonical = symbol;
  try {
    canonical = fromCcxtSymbol(symbol);
  } catch {
    canonical = symbol;
  }
  const amount = toNumber(row.amount) ?? toNumber(row.remaining) ?? 0;
  return {
    id: String(row.id ?? row.orderId ?? "").trim(),
    symbol: canonical,
    side: String(row.side ?? "buy").toLowerCase() === "sell" ? "sell" : "buy",
    price: toNumber(row.price) ?? toNumber(row.average) ?? 0,
    qty: amount,
    status: mapCcxtStatus(row.status),
    clientOrderId: row.clientOrderId ? String(row.clientOrderId) : undefined
  };
}

export class CcxtSpotClient implements ExchangeWithCapabilities {
  readonly exchangeId: string;
  private readonly exchange: CcxtExchangeLike;
  private marketsLoaded = false;

  constructor(config: CcxtClientConfig) {
    this.exchangeId = String(config.exchangeId ?? "").trim().toLowerCase();
    if (!this.exchangeId) {
      throw new CcxtSpotError("ccxt_exchange_id_required", "ccxt_exchange_id_required", 400);
    }

    const ExchangeCtor = resolveExchangeCtor(this.exchangeId);
    this.exchange = new ExchangeCtor({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      password: config.apiPassphrase,
      enableRateLimit: config.enableRateLimit ?? true,
      timeout: config.timeoutMs ?? 12_000,
      options: config.options ?? {}
    });
  }

  getCapabilities(): ExchangeCapabilities {
    return createDefaultCcxtCapabilities(this.exchange.has ?? {});
  }

  private async ensureMarketsLoaded(): Promise<void> {
    if (this.marketsLoaded) return;
    try {
      await this.exchange.loadMarkets();
      this.marketsLoaded = true;
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async listMarkets(): Promise<CcxtMarketSnapshot[]> {
    await this.ensureMarketsLoaded();
    const map = this.exchange.markets ?? {};
    const rows: CcxtMarketSnapshot[] = [];
    for (const row of Object.values(map)) {
      const limits = (row.limits ?? {}) as Record<string, unknown>;
      const amount = (limits.amount ?? {}) as Record<string, unknown>;
      const precision = (row.precision ?? {}) as Record<string, unknown>;
      const spotFlag = typeof row.spot === "boolean" ? row.spot : null;
      const contractFlag = typeof row.contract === "boolean" ? row.contract : null;
      const swapFlag = typeof row.swap === "boolean" ? row.swap : null;
      const futureFlag = typeof row.future === "boolean" ? row.future : null;
      const type = String(row.type ?? "").trim().toLowerCase();
      const isPerp = contractFlag === true || swapFlag === true || futureFlag === true || type === "swap" || type === "future";
      const isSpot = spotFlag === true || type === "spot" || (!isPerp && spotFlag !== false);
      if (!isSpot) continue;

      rows.push({
        symbol: String(row.symbol ?? row.id ?? ""),
        active: typeof row.active === "boolean" ? row.active : true,
        base: row.base ? String(row.base).toUpperCase() : null,
        quote: row.quote ? String(row.quote).toUpperCase() : null,
        precisionPrice: toNumber(precision.price),
        precisionAmount: toNumber(precision.amount),
        minAmount: toNumber(amount.min),
        maxAmount: toNumber(amount.max),
        spot: isSpot,
        perp: isPerp
      });
    }
    return rows;
  }

  async getMidPrice(symbol: string): Promise<MidPrice> {
    try {
      const ccxtSymbol = toCcxtSymbol(symbol);
      const ticker = await this.exchange.fetchTicker(ccxtSymbol);
      const bid = toNumber(ticker.bid);
      const ask = toNumber(ticker.ask);
      const last = toNumber(ticker.last) ?? toNumber(ticker.close);
      const mid = bid !== null && ask !== null ? (bid + ask) / 2 : (last ?? 0);
      return {
        mid,
        bid: bid ?? undefined,
        ask: ask ?? undefined,
        last: last ?? undefined,
        ts: toTimestampMs(ticker.timestamp)
      };
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async fetchTicker(symbol: string): Promise<Record<string, unknown>> {
    try {
      const ccxtSymbol = toCcxtSymbol(symbol);
      return await this.exchange.fetchTicker(ccxtSymbol);
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async fetchOrderBook(symbol: string, limit = 50): Promise<Record<string, unknown>> {
    try {
      const ccxtSymbol = toCcxtSymbol(symbol);
      return await this.exchange.fetchOrderBook(ccxtSymbol, Math.max(1, Math.min(200, Math.trunc(limit))));
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async fetchTrades(symbol: string, limit = 60): Promise<Array<Record<string, unknown>>> {
    try {
      const ccxtSymbol = toCcxtSymbol(symbol);
      return await this.exchange.fetchTrades(ccxtSymbol, undefined, Math.max(1, Math.min(200, Math.trunc(limit))));
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async fetchOHLCV(symbol: string, timeframe: string, limit = 400): Promise<Array<unknown>> {
    try {
      const ccxtSymbol = toCcxtSymbol(symbol);
      return await this.exchange.fetchOHLCV(
        ccxtSymbol,
        timeframe,
        undefined,
        Math.max(20, Math.min(1000, Math.trunc(limit)))
      );
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async fetchBalanceRaw(): Promise<Record<string, unknown>> {
    try {
      return await this.exchange.fetchBalance();
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async getBalances(): Promise<Balance[]> {
    const snapshot = await this.fetchBalanceRaw();
    const freeMap = (snapshot.free ?? {}) as Record<string, unknown>;
    const usedMap = (snapshot.used ?? {}) as Record<string, unknown>;
    const totalMap = (snapshot.total ?? {}) as Record<string, unknown>;
    const assets = new Set<string>([
      ...Object.keys(freeMap),
      ...Object.keys(usedMap),
      ...Object.keys(totalMap)
    ]);
    const out: Balance[] = [];
    for (const asset of assets) {
      const free = toNumber(freeMap[asset]) ?? 0;
      const locked = toNumber(usedMap[asset]) ?? 0;
      const total = toNumber(totalMap[asset]);
      if (free === 0 && locked === 0 && (total === null || total === 0)) continue;
      out.push({
        asset: asset.toUpperCase(),
        free,
        locked
      });
    }
    return out;
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    try {
      const rows = await this.exchange.fetchOpenOrders(toCcxtSymbol(symbol));
      return rows.map((row) => mapOrder(row));
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async fetchOpenOrdersRaw(symbol?: string): Promise<Array<Record<string, unknown>>> {
    try {
      return await this.exchange.fetchOpenOrders(symbol ? toCcxtSymbol(symbol) : undefined);
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async placeOrder(q: Quote): Promise<Order> {
    try {
      const symbol = toCcxtSymbol(q.symbol);
      const params: Record<string, unknown> = {};
      if (q.postOnly) params.postOnly = true;
      if (q.clientOrderId) params.clientOrderId = q.clientOrderId;
      if (q.quoteQty !== undefined && q.type === "market" && q.side === "buy") {
        params.cost = q.quoteQty;
      }

      const row = await this.exchange.createOrder(
        symbol,
        q.type,
        q.side,
        q.qty,
        q.price,
        params
      );
      return mapOrder(row);
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    try {
      await this.exchange.cancelOrder(orderId, toCcxtSymbol(symbol));
    } catch (error) {
      throw mapCcxtError(error);
    }
  }

  async cancelAll(symbol?: string, side?: "buy" | "sell"): Promise<void> {
    try {
      if (typeof this.exchange.cancelAllOrders === "function") {
        await this.exchange.cancelAllOrders(symbol ? toCcxtSymbol(symbol) : undefined);
        return;
      }
      if (!symbol) {
        throw new CcxtSpotError("ccxt_cancel_all_requires_symbol", "ccxt_cancel_all_requires_symbol", 400);
      }
      const open = await this.fetchOpenOrdersRaw(symbol);
      for (const row of open) {
        const rowId = String(row.id ?? row.orderId ?? "").trim();
        if (!rowId) continue;
        const rowSide = String(row.side ?? "").toLowerCase();
        if (side && rowSide && rowSide !== side) continue;
        await this.cancelOrder(symbol, rowId);
      }
    } catch (error) {
      if (error instanceof CcxtSpotError) throw error;
      throw mapCcxtError(error);
    }
  }

  async getMyTrades(symbol: string, params?: { startTimeMs?: number; limit?: number }): Promise<MyTrade[]> {
    try {
      const rows = await this.exchange.fetchMyTrades(
        toCcxtSymbol(symbol),
        params?.startTimeMs,
        params?.limit
      );
      return rows.map((row) => ({
        id: String(row.id ?? row.tradeId ?? "").trim(),
        orderId: row.order ? String(row.order) : undefined,
        clientOrderId: row.clientOrderId ? String(row.clientOrderId) : undefined,
        side: String(row.side ?? "buy").toLowerCase() === "sell" ? "sell" : "buy",
        price: toNumber(row.price) ?? 0,
        qty: toNumber(row.amount) ?? 0,
        notional: toNumber(row.cost) ?? 0,
        timestamp: toTimestampMs(row.timestamp)
      }));
    } catch (error) {
      throw mapCcxtError(error);
    }
  }
}
