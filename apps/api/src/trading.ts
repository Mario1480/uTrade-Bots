import { prisma } from "@mm/db";
import { BitgetFuturesAdapter } from "@mm/futures-exchange";
import { decryptSecret } from "./secret-crypto.js";

type DbClient = typeof prisma;

const db = prisma as DbClient as any;

export type TradingAccount = {
  id: string;
  userId: string;
  exchange: string;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
};

export type TradingSettings = {
  exchangeAccountId: string | null;
  symbol: string | null;
  timeframe: string | null;
  marginMode: "isolated" | "cross" | null;
};

export type NormalizedOrder = {
  orderId: string;
  symbol: string;
  side: string | null;
  type: string | null;
  status: string | null;
  price: number | null;
  qty: number | null;
  createdAt: string | null;
  raw: unknown;
};

export type NormalizedPosition = {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
};

export type NormalizedBookLevel = {
  price: number;
  qty: number;
};

export type NormalizedOrderBook = {
  bids: NormalizedBookLevel[];
  asks: NormalizedBookLevel[];
  ts: number | null;
};

export type NormalizedTicker = {
  symbol: string;
  last: number | null;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  ts: number | null;
};

export type NormalizedTrade = {
  symbol: string;
  price: number | null;
  qty: number | null;
  side: string | null;
  ts: number | null;
};

export class ManualTradingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "manual_trading_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ExchangeClient {
  getAccountState(): Promise<{ equity: number; availableMargin?: number }>;
  getPositions(symbol?: string): Promise<NormalizedPosition[]>;
  getOpenOrders(symbol?: string): Promise<NormalizedOrder[]>;
  placeOrder(input: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
    reduceOnly?: boolean;
  }): Promise<{ orderId: string }>;
  cancelOrder(orderId: string, symbol?: string): Promise<void>;
  cancelAll(symbol?: string): Promise<{ requested: number; cancelled: number; failed: number }>;
  closePosition(symbol: string, side?: "long" | "short"): Promise<string[]>;
  close(): Promise<void>;
}

export interface ExchangeStream {
  subscribeMarket(symbol: string): Promise<void>;
  onTicker(callback: (payload: unknown) => void): () => void;
  onDepth(callback: (payload: unknown) => void): () => void;
  onTrades(callback: (payload: unknown) => void): () => void;
  onOrderUpdate(callback: (payload: unknown) => void): () => void;
  onPositionUpdate(callback: (payload: unknown) => void): () => void;
  onFill(callback: (payload: unknown) => void): () => void;
}

export class BitgetExchangeBridge implements ExchangeClient, ExchangeStream {
  constructor(public readonly adapter: BitgetFuturesAdapter) {}

  async getAccountState() {
    return this.adapter.getAccountState();
  }

  async getPositions(symbol?: string) {
    return listPositions(this.adapter, symbol);
  }

  async getOpenOrders(symbol?: string) {
    return listOpenOrders(this.adapter, symbol);
  }

  async placeOrder(input: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
    reduceOnly?: boolean;
  }) {
    return this.adapter.placeOrder(input);
  }

  async cancelOrder(orderId: string, symbol?: string) {
    if (symbol) {
      await this.adapter.tradeApi.cancelOrder({
        symbol: await this.adapter.toExchangeSymbol(symbol),
        orderId,
        productType: this.adapter.productType
      });
      return;
    }
    await this.adapter.cancelOrder(orderId);
  }

  async cancelAll(symbol?: string) {
    return cancelAllOrders(this.adapter, symbol);
  }

  async closePosition(symbol: string, side?: "long" | "short") {
    return closePositionsMarket(this.adapter, symbol, side);
  }

  async subscribeMarket(symbol: string) {
    await Promise.all([
      this.adapter.subscribeTicker(symbol),
      this.adapter.subscribeDepth(symbol),
      (this.adapter as any).subscribeTrades(symbol)
    ]);
  }

  onTicker(callback: (payload: unknown) => void) {
    return this.adapter.onTicker(callback as any);
  }

  onDepth(callback: (payload: unknown) => void) {
    return this.adapter.onDepth(callback as any);
  }

  onTrades(callback: (payload: unknown) => void) {
    return (this.adapter as any).onTrades(callback as any);
  }

  onOrderUpdate(callback: (payload: unknown) => void) {
    return this.adapter.onOrderUpdate(callback as any);
  }

  onPositionUpdate(callback: (payload: unknown) => void) {
    return this.adapter.onPositionUpdate(callback as any);
  }

  onFill(callback: (payload: unknown) => void) {
    return this.adapter.onFill(callback as any);
  }

  async close() {
    await this.adapter.close();
  }
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoFromMs(value: unknown): string | null {
  const ms = toNumber(value);
  if (ms === null) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function getNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeCanonicalSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function toOrderRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row) => typeof row === "object" && row !== null) as Array<Record<string, unknown>>;
  }

  const record = toRecord(value);
  if (!record) return [];

  const candidates = [
    record.entrustedList,
    record.orderList,
    record.list,
    record.rows,
    record.data
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter((row) => typeof row === "object" && row !== null) as Array<Record<string, unknown>>;
  }

  return [];
}

function getGlobalSettingsKey(userId: string): string {
  return `trade_settings:${userId}`;
}

export async function getTradingSettings(userId: string): Promise<TradingSettings> {
  const setting = await db.globalSetting.findUnique({
    where: {
      key: getGlobalSettingsKey(userId)
    }
  });

  const payload = toRecord(setting?.value) ?? {};

  const exchangeAccountId = typeof payload.exchangeAccountId === "string" && payload.exchangeAccountId.trim()
    ? payload.exchangeAccountId
    : null;
  const symbol = typeof payload.symbol === "string" && payload.symbol.trim()
    ? normalizeCanonicalSymbol(payload.symbol)
    : null;
  const timeframe = typeof payload.timeframe === "string" && payload.timeframe.trim()
    ? payload.timeframe
    : null;
  const marginMode =
    payload.marginMode === "isolated" || payload.marginMode === "cross"
      ? payload.marginMode
      : null;

  return {
    exchangeAccountId,
    symbol,
    timeframe,
    marginMode
  };
}

export async function saveTradingSettings(
  userId: string,
  input: Partial<TradingSettings>
): Promise<TradingSettings> {
  const current = await getTradingSettings(userId);

  const next: TradingSettings = {
    exchangeAccountId:
      input.exchangeAccountId === undefined
        ? current.exchangeAccountId
        : input.exchangeAccountId
          ? input.exchangeAccountId
          : null,
    symbol:
      input.symbol === undefined
        ? current.symbol
        : input.symbol
          ? normalizeCanonicalSymbol(input.symbol)
          : null,
    timeframe:
      input.timeframe === undefined
        ? current.timeframe
        : input.timeframe
          ? input.timeframe
          : null,
    marginMode:
      input.marginMode === undefined
        ? current.marginMode
        : input.marginMode === "isolated" || input.marginMode === "cross"
          ? input.marginMode
          : null
  };

  await db.globalSetting.upsert({
    where: {
      key: getGlobalSettingsKey(userId)
    },
    update: {
      value: next
    },
    create: {
      key: getGlobalSettingsKey(userId),
      value: next
    }
  });

  return next;
}

export async function resolveTradingAccount(userId: string, exchangeAccountId?: string | null): Promise<TradingAccount> {
  const where = exchangeAccountId
    ? { id: exchangeAccountId, userId }
    : { userId };

  const account = await db.exchangeAccount.findFirst({
    where,
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" }
    ],
    select: {
      id: true,
      userId: true,
      exchange: true,
      label: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true
    }
  });

  if (!account) {
    throw new ManualTradingError("exchange_account_not_found", 404, "exchange_account_not_found");
  }

  const exchange = String(account.exchange ?? "").toLowerCase();
  if (exchange !== "bitget") {
    throw new ManualTradingError(
      `exchange_not_supported:${exchange}`,
      400,
      "exchange_not_supported"
    );
  }

  let apiKey = "";
  let apiSecret = "";
  let passphrase: string | null = null;

  try {
    apiKey = decryptSecret(account.apiKeyEnc);
    apiSecret = decryptSecret(account.apiSecretEnc);
    passphrase = account.passphraseEnc ? decryptSecret(account.passphraseEnc) : null;
  } catch {
    throw new ManualTradingError(
      "exchange_secret_decrypt_failed",
      500,
      "exchange_secret_decrypt_failed"
    );
  }

  return {
    id: account.id,
    userId: account.userId,
    exchange,
    label: account.label,
    apiKey,
    apiSecret,
    passphrase
  };
}

export function createBitgetAdapter(account: TradingAccount): BitgetFuturesAdapter {
  return new BitgetFuturesAdapter({
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    apiPassphrase: account.passphrase ?? undefined,
    productType: (process.env.BITGET_PRODUCT_TYPE as any) ?? "USDT-FUTURES",
    marginCoin: process.env.BITGET_MARGIN_COIN ?? "USDT"
  });
}

export async function listSymbols(adapter: BitgetFuturesAdapter) {
  await adapter.contractCache.warmup();

  const items = adapter
    .contractCache
    .snapshot()
    .map((contract) => ({
      symbol: contract.canonicalSymbol,
      exchangeSymbol: contract.mexcSymbol,
      status: contract.symbolStatus,
      tradable: contract.apiAllowed,
      tickSize: contract.tickSize,
      stepSize: contract.stepSize,
      minQty: contract.minVol,
      maxQty: contract.maxVol,
      minLeverage: contract.minLeverage,
      maxLeverage: contract.maxLeverage,
      quoteAsset: contract.quoteAsset,
      baseAsset: contract.baseAsset
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const defaultSymbol =
    items.find((item) => item.tradable)?.symbol ??
    items[0]?.symbol ??
    null;

  return {
    items,
    defaultSymbol
  };
}

export async function listOpenOrders(
  adapter: BitgetFuturesAdapter,
  symbol?: string
): Promise<NormalizedOrder[]> {
  const exchangeSymbol = symbol ? await adapter.toExchangeSymbol(symbol) : undefined;
  const rowsRaw = await adapter.tradeApi.getPendingOrders({
    productType: adapter.productType,
    symbol: exchangeSymbol,
    pageSize: 100
  });
  const rows = toOrderRows(rowsRaw);

  return rows.map((row) => {
    const rawSymbol = String(row.symbol ?? row.instId ?? "");
    const canonicalSymbol =
      (rawSymbol && adapter.toCanonicalSymbol(rawSymbol)) ??
      normalizeCanonicalSymbol(rawSymbol);

    return {
      orderId: String(row.orderId ?? row.ordId ?? row.clientOid ?? ""),
      symbol: canonicalSymbol,
      side: row.side ? String(row.side) : null,
      type: row.orderType ? String(row.orderType) : row.orderTypeName ? String(row.orderTypeName) : null,
      status: row.status ? String(row.status) : row.state ? String(row.state) : null,
      price: toNumber(row.price ?? row.px),
      qty: toNumber(row.size ?? row.qty ?? row.baseVolume),
      createdAt: toIsoFromMs(row.cTime ?? row.createTime ?? row.uTime),
      raw: row
    };
  }).filter((item) => item.orderId.length > 0);
}

export async function listPositions(
  adapter: BitgetFuturesAdapter,
  symbol?: string
): Promise<NormalizedPosition[]> {
  const rows = await adapter.getPositions();
  const filtered = symbol
    ? rows.filter((row) => row.symbol === normalizeCanonicalSymbol(symbol))
    : rows;

  return filtered.map((row) => ({
    symbol: normalizeCanonicalSymbol(row.symbol),
    side: row.side,
    size: Number(row.size ?? 0),
    entryPrice: toNumber(row.entryPrice),
    markPrice: toNumber(row.markPrice),
    unrealizedPnl: toNumber(row.unrealizedPnl)
  }));
}

export async function closePositionsMarket(
  adapter: BitgetFuturesAdapter,
  symbol: string,
  side?: "long" | "short"
): Promise<string[]> {
  const positions = await listPositions(adapter, symbol);
  const targets = positions
    .filter((row) => row.size > 0)
    .filter((row) => (side ? row.side === side : true));

  if (targets.length === 0) {
    return [];
  }

  const orderIds: string[] = [];
  for (const position of targets) {
    const closeSide = position.side === "long" ? "sell" : "buy";
    const placed = await adapter.placeOrder({
      symbol: position.symbol,
      side: closeSide,
      type: "market",
      qty: position.size,
      reduceOnly: true
    });
    orderIds.push(placed.orderId);
  }

  return orderIds;
}

export async function cancelAllOrders(
  adapter: BitgetFuturesAdapter,
  symbol?: string
): Promise<{ requested: number; cancelled: number; failed: number }> {
  const openOrders = await listOpenOrders(adapter, symbol);

  if (openOrders.length === 0) {
    return {
      requested: 0,
      cancelled: 0,
      failed: 0
    };
  }

  const results = await Promise.allSettled(
    openOrders.map(async (order) =>
      adapter.tradeApi.cancelOrder({
        symbol: await adapter.toExchangeSymbol(order.symbol),
        orderId: order.orderId,
        productType: adapter.productType
      })
    )
  );

  const cancelled = results.filter((row) => row.status === "fulfilled").length;
  const failed = results.length - cancelled;

  return {
    requested: results.length,
    cancelled,
    failed
  };
}

function parseBookLevels(input: unknown): NormalizedBookLevel[] {
  if (!Array.isArray(input)) return [];

  const out: NormalizedBookLevel[] = [];
  for (const row of input) {
    if (Array.isArray(row)) {
      const price = toNumber(row[0]);
      const qty = toNumber(row[1]);
      if (price !== null && qty !== null) {
        out.push({ price, qty });
      }
      continue;
    }

    const record = toRecord(row);
    if (!record) continue;
    const price = getNumber(record, ["price", "p", "px"]);
    const qty = getNumber(record, ["size", "qty", "q", "vol"]);
    if (price !== null && qty !== null) {
      out.push({ price, qty });
    }
  }

  return out;
}

export function normalizeOrderBookPayload(payload: unknown): NormalizedOrderBook {
  const record = toRecord(payload);
  if (!record) {
    return { bids: [], asks: [], ts: null };
  }

  const bids = parseBookLevels(record.bids ?? record.bid ?? record.b);
  const asks = parseBookLevels(record.asks ?? record.ask ?? record.a);
  const ts = getNumber(record, ["ts", "timestamp", "uTime"]);

  return { bids, asks, ts };
}

export function normalizeTickerPayload(payload: unknown): NormalizedTicker {
  const record = toRecord(payload);
  const symbolRaw = getString(record, ["instId", "symbol"]);

  return {
    symbol: normalizeCanonicalSymbol(symbolRaw ?? ""),
    last: getNumber(record, ["lastPr", "last", "price", "close"]),
    mark: getNumber(record, ["markPrice", "mark", "indexPrice"]),
    bid: getNumber(record, ["bidPr", "bidPrice", "bid"]),
    ask: getNumber(record, ["askPr", "askPrice", "ask"]),
    ts: getNumber(record, ["ts", "timestamp"])
  };
}

export function normalizeTradesPayload(payload: unknown): NormalizedTrade[] {
  if (!Array.isArray(payload)) {
    const record = toRecord(payload);
    if (!record) return [];
    return [recordToTrade(record)];
  }

  const out: NormalizedTrade[] = [];
  for (const row of payload) {
    if (Array.isArray(row)) {
      out.push({
        symbol: "",
        ts: toNumber(row[0]),
        price: toNumber(row[1]),
        qty: toNumber(row[2]),
        side: row[3] ? String(row[3]).toLowerCase() : null
      });
      continue;
    }

    const record = toRecord(row);
    if (!record) continue;
    out.push(recordToTrade(record));
  }

  return out;
}

function recordToTrade(record: Record<string, unknown>): NormalizedTrade {
  const symbolRaw = getString(record, ["instId", "symbol"]);
  return {
    symbol: normalizeCanonicalSymbol(symbolRaw ?? ""),
    ts: getNumber(record, ["ts", "timestamp", "cTime"]),
    price: getNumber(record, ["price", "px", "fillPrice"]),
    qty: getNumber(record, ["size", "qty", "q", "fillSize"]),
    side: getString(record, ["side", "fillSide", "tradeSide"])?.toLowerCase() ?? null
  };
}

export function extractWsDataArray(payload: unknown): unknown[] {
  const record = toRecord(payload);
  if (!record) return [];
  const data = record.data;
  if (!Array.isArray(data)) return [];
  return data;
}

export function normalizeSymbolInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = normalizeCanonicalSymbol(value);
  return cleaned.length > 0 ? cleaned : null;
}
