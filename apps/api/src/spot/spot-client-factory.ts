import { CcxtSpotClient, CcxtSpotError, precisionToStep, toApiSymbol } from "@mm/exchange";
import { logger } from "../logger.js";
import type { NormalizedOrder, TradingAccount } from "../trading.js";
import { ManualTradingError } from "../trading.js";
import { BitgetSpotClient } from "./bitget-spot.client.js";
import { normalizeSpotSymbol, selectSpotSummary, splitCanonicalSymbol } from "./bitget-spot.mapper.js";

export type SpotClient = {
  listSymbols(): Promise<Array<{
    symbol: string;
    exchangeSymbol: string;
    status: string;
    tradable: boolean;
    tickSize: number | null;
    stepSize: number | null;
    minQty: number | null;
    maxQty: number | null;
    quoteAsset: string | null;
    baseAsset: string | null;
  }>>;
  getCandles(params: {
    symbol: string;
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    limit: number;
  }): Promise<unknown>;
  getTicker(symbol: string): Promise<{
    symbol: string;
    last: number | null;
    mark: number | null;
    bid: number | null;
    ask: number | null;
    ts: number | null;
  }>;
  getDepth(
    symbol: string,
    limit?: number
  ): Promise<{ asks: Array<[string | number, string | number]>; bids: Array<[string | number, string | number]>; ts?: string | number }>;
  getTrades(symbol: string, limit?: number): Promise<Array<{
    symbol: string;
    price: number | null;
    qty: number | null;
    side: string | null;
    ts: number | null;
  }>>;
  getBalances(): Promise<Array<{
    coin?: string;
    asset?: string;
    available?: string | number;
    frozen?: string | number;
    locked?: string | number;
    lock?: string | number;
  }>>;
  getSummary(preferredCurrency?: string): Promise<{ equity: number | null; available: number | null; currency: string }>;
  getOpenOrders(symbol?: string): Promise<NormalizedOrder[]>;
  placeOrder(input: { symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }): Promise<{ orderId: string }>;
  editOrder(input: { symbol: string; orderId: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }): Promise<{ orderId: string }>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  cancelAll(symbol?: string): Promise<{ requested: number; cancelled: number; failed: number }>;
  getLastPrice(symbol: string): Promise<number | null>;
  getBackendTag(): "native" | "ccxt";
};

type SpotBackend = "native" | "ccxt";

type CreateSpotClientOptions = {
  endpoint?: string;
  forceBackend?: SpotBackend;
};

const CEX_SPOT_DEFAULT_BACKEND: SpotBackend =
  String(process.env.CEX_SPOT_DEFAULT_BACKEND ?? "native").trim().toLowerCase() === "ccxt"
    ? "ccxt"
    : "native";

const CEX_SPOT_WRITE_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.CEX_SPOT_WRITE_ENABLED ?? "0").trim().toLowerCase()
);

function parseBackendOverrides(raw: string | undefined): Record<string, SpotBackend> {
  const out: Record<string, SpotBackend> = {};
  for (const part of String(raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [exchangeRaw, backendRaw] = trimmed.split(":");
    const exchange = String(exchangeRaw ?? "").trim().toLowerCase();
    const backend = String(backendRaw ?? "").trim().toLowerCase();
    if (!exchange) continue;
    if (backend === "ccxt") out[exchange] = "ccxt";
    if (backend === "native") out[exchange] = "native";
  }
  return out;
}

function parseWriteOverrides(raw: string | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const part of String(raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [exchangeRaw, valueRaw] = trimmed.split(":");
    const exchange = String(exchangeRaw ?? "").trim().toLowerCase();
    const normalized = String(valueRaw ?? "").trim().toLowerCase();
    if (!exchange) continue;
    out[exchange] = ["1", "true", "on", "yes"].includes(normalized);
  }
  return out;
}

const CEX_SPOT_BACKEND_OVERRIDES = parseBackendOverrides(process.env.CEX_SPOT_BACKEND_OVERRIDES);
const CEX_SPOT_WRITE_OVERRIDES = parseWriteOverrides(process.env.CEX_SPOT_WRITE_OVERRIDES);

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveBackend(exchange: string, forced?: SpotBackend): SpotBackend {
  if (forced) return forced;
  const normalized = String(exchange ?? "").trim().toLowerCase();
  return CEX_SPOT_BACKEND_OVERRIDES[normalized] ?? CEX_SPOT_DEFAULT_BACKEND;
}

function resolveWriteEnabled(exchange: string): boolean {
  const normalized = String(exchange ?? "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CEX_SPOT_WRITE_OVERRIDES, normalized)) {
    return Boolean(CEX_SPOT_WRITE_OVERRIDES[normalized]);
  }
  return CEX_SPOT_WRITE_ENABLED;
}

function toManualSpotError(error: unknown): ManualTradingError {
  if (error instanceof ManualTradingError) return error;
  if (error instanceof CcxtSpotError) {
    return new ManualTradingError(`CCXT spot request failed: ${error.message}`, error.status, error.code);
  }
  if (error instanceof Error) {
    return new ManualTradingError(`spot_request_failed: ${error.message}`, 400, "spot_request_failed");
  }
  return new ManualTradingError("spot_request_failed", 400, "spot_request_failed");
}

function toCanonicalSymbol(symbol: string): string {
  const normalized = normalizeSpotSymbol(symbol);
  const pair = splitCanonicalSymbol(normalized);
  if (pair.baseAsset && pair.quoteAsset) {
    return `${pair.baseAsset}/${pair.quoteAsset}`;
  }
  if (symbol.includes("/")) return symbol.toUpperCase();
  return normalized;
}

class CcxtSpotBridge implements SpotClient {
  constructor(private readonly client: CcxtSpotClient) {}

  getBackendTag(): "native" | "ccxt" {
    return "ccxt";
  }

  async listSymbols() {
    try {
      const markets = await this.client.listMarkets();
      return markets
        .map((row) => {
          const canonical = toApiSymbol(row.symbol);
          const status = row.active ? "online" : "offline";
          return {
            symbol: canonical,
            exchangeSymbol: row.symbol,
            status,
            tradable: row.active,
            tickSize: precisionToStep(row.precisionPrice),
            stepSize: precisionToStep(row.precisionAmount),
            minQty: row.minAmount,
            maxQty: row.maxAmount,
            quoteAsset: row.quote,
            baseAsset: row.base
          };
        })
        .filter((row) => Boolean(row.symbol))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async getCandles(params: {
    symbol: string;
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    limit: number;
  }): Promise<unknown> {
    try {
      return this.client.fetchOHLCV(toCanonicalSymbol(params.symbol), params.timeframe, params.limit);
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async getTicker(symbol: string) {
    try {
      const canonical = toCanonicalSymbol(symbol);
      const row = await this.client.fetchTicker(canonical);
      const last = toNumber(row.last) ?? toNumber(row.close);
      return {
        symbol: normalizeSpotSymbol(symbol),
        last,
        mark: last,
        bid: toNumber(row.bid),
        ask: toNumber(row.ask),
        ts: toNumber(row.timestamp)
      };
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async getDepth(symbol: string, limit = 50) {
    try {
      const row = await this.client.fetchOrderBook(toCanonicalSymbol(symbol), limit);
      const asks = Array.isArray(row.asks) ? row.asks : [];
      const bids = Array.isArray(row.bids) ? row.bids : [];
      return {
        asks: asks
          .filter((level) => Array.isArray(level) && level.length >= 2)
          .map((level) => [level[0] as string | number, level[1] as string | number] as [string | number, string | number]),
        bids: bids
          .filter((level) => Array.isArray(level) && level.length >= 2)
          .map((level) => [level[0] as string | number, level[1] as string | number] as [string | number, string | number]),
        ts: toNumber(row.timestamp ?? row.nonce) ?? undefined
      };
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async getTrades(symbol: string, limit = 60) {
    try {
      const rows = await this.client.fetchTrades(toCanonicalSymbol(symbol), limit);
      return rows.map((row) => ({
        symbol: normalizeSpotSymbol(String(row.symbol ?? symbol)),
        price: toNumber(row.price),
        qty: toNumber(row.amount),
        side: row.side ? String(row.side).toLowerCase() : null,
        ts: toNumber(row.timestamp)
      }));
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async getBalances() {
    try {
      const rows = await this.client.getBalances();
      return rows.map((row) => ({
        coin: String(row.asset ?? "").toUpperCase(),
        asset: String(row.asset ?? "").toUpperCase(),
        available: row.free,
        frozen: row.locked ?? 0,
        locked: row.locked ?? 0,
        lock: row.locked ?? 0
      }));
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async getSummary(preferredCurrency = "USDT") {
    const balances = await this.getBalances();
    return selectSpotSummary(
      balances.map((row) => ({
        coin: String(row.coin ?? row.asset ?? "").toUpperCase(),
        available: String(row.available ?? "0"),
        frozen: String(row.frozen ?? row.locked ?? row.lock ?? "0")
      })),
      preferredCurrency
    );
  }

  async getOpenOrders(symbol?: string): Promise<NormalizedOrder[]> {
    try {
      const rows = await this.client.fetchOpenOrdersRaw(symbol ? toCanonicalSymbol(symbol) : undefined);
      const out: NormalizedOrder[] = [];
      for (const row of rows) {
        const orderId = String(row.id ?? row.orderId ?? "").trim();
        if (!orderId) continue;
        const rowSymbol = String(row.symbol ?? symbol ?? "").trim();
        const mappedSymbol = rowSymbol ? normalizeSpotSymbol(toApiSymbol(rowSymbol)) : normalizeSpotSymbol(symbol ?? "");
        if (!mappedSymbol) continue;
        out.push({
          orderId,
          symbol: mappedSymbol,
          side: row.side ? String(row.side).toLowerCase() : null,
          type: row.type ? String(row.type).toLowerCase() : null,
          status: row.status ? String(row.status).toLowerCase() : "open",
          price: toNumber(row.price),
          qty: toNumber(row.remaining ?? row.amount),
          triggerPrice: null,
          takeProfitPrice: null,
          stopLossPrice: null,
          reduceOnly: false,
          createdAt: row.timestamp ? new Date(Number(row.timestamp)).toISOString() : null,
          raw: row
        });
      }
      return out;
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async placeOrder(input: { symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }): Promise<{ orderId: string }> {
    try {
      const placed = await this.client.placeOrder({
        symbol: toCanonicalSymbol(input.symbol),
        side: input.side,
        type: input.type,
        qty: input.qty,
        price: input.price
      });
      return { orderId: placed.id };
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async editOrder(input: { symbol: string; orderId: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }): Promise<{ orderId: string }> {
    await this.cancelOrder(input.symbol, input.orderId);
    return this.placeOrder(input);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    try {
      await this.client.cancelOrder(toCanonicalSymbol(symbol), orderId);
    } catch (error) {
      throw toManualSpotError(error);
    }
  }

  async cancelAll(symbol?: string): Promise<{ requested: number; cancelled: number; failed: number }> {
    const before = await this.getOpenOrders(symbol);
    await this.client.cancelAll(symbol ? toCanonicalSymbol(symbol) : undefined);
    const after = await this.getOpenOrders(symbol);
    const cancelled = Math.max(0, before.length - after.length);
    return {
      requested: before.length,
      cancelled,
      failed: before.length - cancelled
    };
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const ticker = await this.getTicker(symbol);
    return toNumber(ticker.last) ?? toNumber(ticker.mark);
  }
}

class GuardedSpotClient implements SpotClient {
  constructor(
    private readonly delegate: SpotClient,
    private readonly exchange: string,
    private readonly writeEnabled: boolean
  ) {}

  getBackendTag(): "native" | "ccxt" {
    return this.delegate.getBackendTag();
  }

  private assertWriteEnabled() {
    if (this.writeEnabled) return;
    throw new ManualTradingError(
      `spot_write_disabled:${this.exchange}`,
      400,
      "spot_write_disabled"
    );
  }

  listSymbols() { return this.delegate.listSymbols(); }
  getCandles(params: { symbol: string; timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d"; limit: number; }) { return this.delegate.getCandles(params); }
  getTicker(symbol: string) { return this.delegate.getTicker(symbol); }
  getDepth(symbol: string, limit?: number) { return this.delegate.getDepth(symbol, limit); }
  getTrades(symbol: string, limit?: number) { return this.delegate.getTrades(symbol, limit); }
  getBalances() { return this.delegate.getBalances(); }
  getSummary(preferredCurrency?: string) { return this.delegate.getSummary(preferredCurrency); }
  getOpenOrders(symbol?: string) { return this.delegate.getOpenOrders(symbol); }
  getLastPrice(symbol: string) { return this.delegate.getLastPrice(symbol); }

  async placeOrder(input: { symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }) {
    this.assertWriteEnabled();
    return this.delegate.placeOrder(input);
  }

  async editOrder(input: { symbol: string; orderId: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }) {
    this.assertWriteEnabled();
    return this.delegate.editOrder(input);
  }

  async cancelOrder(symbol: string, orderId: string) {
    this.assertWriteEnabled();
    return this.delegate.cancelOrder(symbol, orderId);
  }

  async cancelAll(symbol?: string) {
    this.assertWriteEnabled();
    return this.delegate.cancelAll(symbol);
  }
}

class NativeBitgetSpotBridge implements SpotClient {
  constructor(private readonly delegate: BitgetSpotClient) {}

  getBackendTag(): "native" | "ccxt" {
    return "native";
  }

  listSymbols() {
    return this.delegate.listSymbols();
  }

  getCandles(params: { symbol: string; timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d"; limit: number; }) {
    return this.delegate.getCandles(params);
  }

  getTicker(symbol: string) {
    return this.delegate.getTicker(symbol);
  }

  async getDepth(symbol: string, limit?: number) {
    const row = await this.delegate.getDepth(symbol, limit);
    return {
      asks: Array.isArray(row.asks)
        ? row.asks.map((level) => [level[0], level[1]] as [string | number, string | number])
        : [],
      bids: Array.isArray(row.bids)
        ? row.bids.map((level) => [level[0], level[1]] as [string | number, string | number])
        : [],
      ts: row.ts
    };
  }

  getTrades(symbol: string, limit?: number) {
    return this.delegate.getTrades(symbol, limit);
  }

  getBalances() {
    return this.delegate.getBalances();
  }

  getSummary(preferredCurrency?: string) {
    return this.delegate.getSummary(preferredCurrency);
  }

  getOpenOrders(symbol?: string) {
    return this.delegate.getOpenOrders(symbol);
  }

  placeOrder(input: { symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }) {
    return this.delegate.placeOrder(input);
  }

  editOrder(input: { symbol: string; orderId: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number; price?: number }) {
    return this.delegate.editOrder(input);
  }

  cancelOrder(symbol: string, orderId: string) {
    return this.delegate.cancelOrder(symbol, orderId);
  }

  cancelAll(symbol?: string) {
    return this.delegate.cancelAll(symbol);
  }

  getLastPrice(symbol: string) {
    return this.delegate.getLastPrice(symbol);
  }
}

function createNativeBitgetSpotClient(account: TradingAccount): SpotClient {
  const passphrase = account.passphrase?.trim();
  if (!passphrase) {
    throw new ManualTradingError(
      "bitget_passphrase_required",
      400,
      "bitget_passphrase_required"
    );
  }
  const delegate = new BitgetSpotClient({
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    apiPassphrase: passphrase
  });
  return new NativeBitgetSpotBridge(delegate);
}

function createCcxtBackend(account: TradingAccount): SpotClient {
  const ccxtClient = new CcxtSpotClient({
    exchangeId: account.exchange,
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    apiPassphrase: account.passphrase ?? undefined
  });
  return new CcxtSpotBridge(ccxtClient);
}

export function createSpotClient(account: TradingAccount, options: CreateSpotClientOptions = {}): SpotClient {
  const exchange = String(account.exchange ?? "").trim().toLowerCase();
  const backend = resolveBackend(exchange, options.forceBackend);
  const writeEnabled = resolveWriteEnabled(exchange);

  const emitSelection = (selected: SpotBackend, fallbackUsed: boolean) => {
    logger.info("spot_client_backend_selected", {
      exchange,
      backend: selected,
      fallbackUsed,
      endpoint: options.endpoint ?? null,
      writeEnabled
    });
  };

  try {
    if (backend === "ccxt") {
      const client = createCcxtBackend(account);
      emitSelection("ccxt", false);
      return new GuardedSpotClient(client, exchange, writeEnabled);
    }
    if (exchange !== "bitget") {
      throw new ManualTradingError(
        `spot_native_backend_not_supported:${exchange}`,
        400,
        "spot_native_backend_not_supported"
      );
    }
    const client = createNativeBitgetSpotClient(account);
    emitSelection("native", false);
    return new GuardedSpotClient(client, exchange, writeEnabled);
  } catch (error) {
    if (backend === "ccxt" && exchange === "bitget") {
      logger.warn("spot_client_backend_fallback_native", {
        exchange,
        endpoint: options.endpoint ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
      const client = createNativeBitgetSpotClient(account);
      emitSelection("native", true);
      return new GuardedSpotClient(client, exchange, writeEnabled);
    }
    throw toManualSpotError(error);
  }
}
