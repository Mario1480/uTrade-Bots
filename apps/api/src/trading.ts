import { prisma } from "@mm/db";
import { BitgetFuturesAdapter, HyperliquidFuturesAdapter } from "@mm/futures-exchange";
import { decryptSecret } from "./secret-crypto.js";

type DbClient = typeof prisma;

const db = prisma as DbClient as any;
const PAPER_EXCHANGE = "paper";
const PAPER_MARKET_DATA_ACCOUNT_KEY_PREFIX = "paper.marketDataAccount:";
const PAPER_STATE_KEY_PREFIX = "paper.state:";
const DEFAULT_PAPER_BALANCE_USD = Math.max(
  0,
  Number(process.env.PAPER_TRADING_START_BALANCE_USD ?? "10000")
);

export type TradingAccount = {
  id: string;
  userId: string;
  exchange: string;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
  marketDataExchangeAccountId: string | null;
};

export type TradingSettings = {
  exchangeAccountId: string | null;
  symbol: string | null;
  timeframe: string | null;
  marginMode: "isolated" | "cross" | null;
  chartPreferences: TradingChartPreferences;
};

export type TradingSettingsPatch = Omit<Partial<TradingSettings>, "chartPreferences"> & {
  chartPreferences?: unknown;
};

export type TradingChartIndicatorToggles = {
  ema5: boolean;
  ema13: boolean;
  ema50: boolean;
  ema200: boolean;
  ema800: boolean;
  emaCloud50: boolean;
  vwapSession: boolean;
  dailyOpen: boolean;
  smcStructure: boolean;
  volumeOverlay: boolean;
  pvsraVector: boolean;
};

export type TradingChartPreferences = {
  indicatorToggles: TradingChartIndicatorToggles;
  showUpMarkers: boolean;
  showDownMarkers: boolean;
};

export const DEFAULT_TRADING_CHART_INDICATOR_TOGGLES: TradingChartIndicatorToggles = {
  ema5: false,
  ema13: false,
  ema50: true,
  ema200: true,
  ema800: false,
  emaCloud50: false,
  vwapSession: false,
  dailyOpen: false,
  smcStructure: false,
  volumeOverlay: false,
  pvsraVector: false
};

export const DEFAULT_TRADING_CHART_PREFERENCES: TradingChartPreferences = {
  indicatorToggles: DEFAULT_TRADING_CHART_INDICATOR_TOGGLES,
  showUpMarkers: false,
  showDownMarkers: false
};

export type NormalizedOrder = {
  orderId: string;
  symbol: string;
  side: string | null;
  type: string | null;
  status: string | null;
  price: number | null;
  qty: number | null;
  triggerPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  reduceOnly: boolean | null;
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
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
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

type PaperPositionState = {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  openedAt: string;
  updatedAt: string;
};

type PaperOrderState = {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  price: number;
  reduceOnly: boolean;
  triggerPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  status: "open" | "filled" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type PaperState = {
  balanceUsd: number;
  realizedPnlUsd: number;
  nextOrderSeq: number;
  positions: PaperPositionState[];
  orders: PaperOrderState[];
  updatedAt: string;
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

function getPaperMarketDataKey(exchangeAccountId: string): string {
  return `${PAPER_MARKET_DATA_ACCOUNT_KEY_PREFIX}${exchangeAccountId}`;
}

function getPaperStateKey(exchangeAccountId: string): string {
  return `${PAPER_STATE_KEY_PREFIX}${exchangeAccountId}`;
}

function isPaperExchange(exchange: string): boolean {
  return exchange.trim().toLowerCase() === PAPER_EXCHANGE;
}

function coercePaperState(value: unknown): PaperState {
  const record = toRecord(value);
  const balanceUsd = Math.max(0, toNumber(record?.balanceUsd) ?? DEFAULT_PAPER_BALANCE_USD);
  const realizedPnlUsd = toNumber(record?.realizedPnlUsd) ?? 0;
  const nextOrderSeq = Math.max(1, Math.trunc(toNumber(record?.nextOrderSeq) ?? 1));
  const updatedAt = typeof record?.updatedAt === "string" ? record.updatedAt : new Date().toISOString();

  const positionsRaw = Array.isArray(record?.positions) ? record.positions : [];
  const positions: PaperPositionState[] = [];
  for (const row of positionsRaw) {
    const pos = toRecord(row);
    const symbol = normalizeCanonicalSymbol(getString(pos, ["symbol"]) ?? "");
    const sideRaw = getString(pos, ["side"])?.toLowerCase();
    const side: "long" | "short" | null = sideRaw === "long" || sideRaw === "short" ? sideRaw : null;
    const qty = Math.abs(toNumber(pos?.qty) ?? 0);
    const entryPrice = toNumber(pos?.entryPrice) ?? 0;
    if (!symbol || !side || qty <= 0 || entryPrice <= 0) continue;
    positions.push({
      symbol,
      side,
      qty,
      entryPrice,
      takeProfitPrice: toNumber(pos?.takeProfitPrice),
      stopLossPrice: toNumber(pos?.stopLossPrice),
      openedAt: typeof pos?.openedAt === "string" ? pos.openedAt : new Date().toISOString(),
      updatedAt: typeof pos?.updatedAt === "string" ? pos.updatedAt : new Date().toISOString()
    });
  }

  const ordersRaw = Array.isArray(record?.orders) ? record.orders : [];
  const orders: PaperOrderState[] = [];
  for (const row of ordersRaw) {
    const order = toRecord(row);
    const orderId = getString(order, ["orderId"]) ?? "";
    const symbol = normalizeCanonicalSymbol(getString(order, ["symbol"]) ?? "");
    const sideRaw = getString(order, ["side"])?.toLowerCase();
    const side: "buy" | "sell" | null = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : null;
    const typeRaw = getString(order, ["type"])?.toLowerCase();
    const type: "market" | "limit" | null = typeRaw === "market" || typeRaw === "limit" ? typeRaw : null;
    const qty = Math.abs(toNumber(order?.qty) ?? 0);
    const price = toNumber(order?.price) ?? 0;
    if (!orderId || !symbol || !side || !type || qty <= 0 || price <= 0) continue;
    orders.push({
      orderId,
      symbol,
      side,
      type,
      qty,
      price,
      reduceOnly: Boolean(order?.reduceOnly),
      triggerPrice: toNumber(order?.triggerPrice),
      takeProfitPrice: toNumber(order?.takeProfitPrice),
      stopLossPrice: toNumber(order?.stopLossPrice),
      status:
        getString(order, ["status"]) === "open" || getString(order, ["status"]) === "cancelled"
          ? (getString(order, ["status"]) as "open" | "cancelled")
          : "filled",
      createdAt: typeof order?.createdAt === "string" ? order.createdAt : new Date().toISOString(),
      updatedAt: typeof order?.updatedAt === "string" ? order.updatedAt : new Date().toISOString()
    });
  }

  return {
    balanceUsd,
    realizedPnlUsd,
    nextOrderSeq,
    positions,
    orders: orders.slice(0, 200),
    updatedAt
  };
}

async function getPaperState(exchangeAccountId: string): Promise<PaperState> {
  const row = await db.globalSetting.findUnique({
    where: {
      key: getPaperStateKey(exchangeAccountId)
    },
    select: {
      value: true
    }
  });
  return coercePaperState(row?.value);
}

async function savePaperState(exchangeAccountId: string, state: PaperState): Promise<PaperState> {
  const payload: PaperState = {
    ...state,
    orders: state.orders.slice(0, 200),
    updatedAt: new Date().toISOString()
  };
  await db.globalSetting.upsert({
    where: {
      key: getPaperStateKey(exchangeAccountId)
    },
    update: {
      value: payload
    },
    create: {
      key: getPaperStateKey(exchangeAccountId),
      value: payload
    }
  });
  return payload;
}

async function readPaperMarketDataAccountId(exchangeAccountId: string): Promise<string | null> {
  const row = await db.globalSetting.findUnique({
    where: { key: getPaperMarketDataKey(exchangeAccountId) },
    select: { value: true }
  });

  if (typeof row?.value === "string" && row.value.trim()) {
    return row.value.trim();
  }
  const record = toRecord(row?.value);
  const value = getString(record, ["exchangeAccountId", "accountId", "id"]);
  return value?.trim() || null;
}

export async function setPaperMarketDataAccountId(
  exchangeAccountId: string,
  marketDataExchangeAccountId: string
): Promise<void> {
  await db.globalSetting.upsert({
    where: {
      key: getPaperMarketDataKey(exchangeAccountId)
    },
    update: {
      value: {
        exchangeAccountId: marketDataExchangeAccountId
      }
    },
    create: {
      key: getPaperMarketDataKey(exchangeAccountId),
      value: {
        exchangeAccountId: marketDataExchangeAccountId
      }
    }
  });
}

export async function clearPaperMarketDataAccountId(exchangeAccountId: string): Promise<void> {
  await db.globalSetting.deleteMany({
    where: {
      key: getPaperMarketDataKey(exchangeAccountId)
    }
  });
}

export async function clearPaperState(exchangeAccountId: string): Promise<void> {
  await db.globalSetting.deleteMany({
    where: {
      key: getPaperStateKey(exchangeAccountId)
    }
  });
}

export async function listPaperMarketDataAccountIds(
  exchangeAccountIds: string[]
): Promise<Record<string, string | null>> {
  if (exchangeAccountIds.length === 0) return {};
  const keys = exchangeAccountIds.map((id) => getPaperMarketDataKey(id));
  const rows = await db.globalSetting.findMany({
    where: {
      key: { in: keys }
    },
    select: {
      key: true,
      value: true
    }
  });

  const out: Record<string, string | null> = {};
  for (const id of exchangeAccountIds) out[id] = null;

  for (const row of rows) {
    const accountId = row.key.slice(PAPER_MARKET_DATA_ACCOUNT_KEY_PREFIX.length);
    if (!accountId) continue;
    if (typeof row.value === "string") {
      out[accountId] = row.value.trim() || null;
      continue;
    }
    const record = toRecord(row.value);
    out[accountId] = getString(record, ["exchangeAccountId", "accountId", "id"]);
  }
  return out;
}

export function isPaperTradingAccount(account: TradingAccount): boolean {
  return isPaperExchange(account.exchange);
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

function normalizeIndicatorToggles(value: unknown): TradingChartIndicatorToggles {
  const record = toRecord(value) ?? {};
  return {
    ema5: typeof record.ema5 === "boolean" ? record.ema5 : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.ema5,
    ema13: typeof record.ema13 === "boolean" ? record.ema13 : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.ema13,
    ema50: typeof record.ema50 === "boolean" ? record.ema50 : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.ema50,
    ema200: typeof record.ema200 === "boolean" ? record.ema200 : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.ema200,
    ema800: typeof record.ema800 === "boolean" ? record.ema800 : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.ema800,
    emaCloud50:
      typeof record.emaCloud50 === "boolean"
        ? record.emaCloud50
        : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.emaCloud50,
    vwapSession:
      typeof record.vwapSession === "boolean"
        ? record.vwapSession
        : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.vwapSession,
    dailyOpen:
      typeof record.dailyOpen === "boolean"
        ? record.dailyOpen
        : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.dailyOpen,
    smcStructure:
      typeof record.smcStructure === "boolean"
        ? record.smcStructure
        : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.smcStructure,
    volumeOverlay:
      typeof record.volumeOverlay === "boolean"
        ? record.volumeOverlay
        : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.volumeOverlay,
    pvsraVector:
      typeof record.pvsraVector === "boolean"
        ? record.pvsraVector
        : DEFAULT_TRADING_CHART_INDICATOR_TOGGLES.pvsraVector
  };
}

function normalizeChartPreferences(value: unknown): TradingChartPreferences {
  const record = toRecord(value) ?? {};
  return {
    indicatorToggles: normalizeIndicatorToggles(record.indicatorToggles),
    showUpMarkers:
      typeof record.showUpMarkers === "boolean"
        ? record.showUpMarkers
        : DEFAULT_TRADING_CHART_PREFERENCES.showUpMarkers,
    showDownMarkers:
      typeof record.showDownMarkers === "boolean"
        ? record.showDownMarkers
        : DEFAULT_TRADING_CHART_PREFERENCES.showDownMarkers
  };
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
  const chartPreferences = normalizeChartPreferences(payload.chartPreferences);

  return {
    exchangeAccountId,
    symbol,
    timeframe,
    marginMode,
    chartPreferences
  };
}

export async function saveTradingSettings(
  userId: string,
  input: TradingSettingsPatch
): Promise<TradingSettings> {
  const current = await getTradingSettings(userId);
  const incomingChartRecord = toRecord(input.chartPreferences);
  const incomingIndicatorRecord = toRecord(incomingChartRecord?.indicatorToggles);
  const mergedChart = input.chartPreferences === undefined
    ? current.chartPreferences
    : normalizeChartPreferences({
        ...current.chartPreferences,
        ...incomingChartRecord,
        indicatorToggles: {
          ...current.chartPreferences.indicatorToggles,
          ...incomingIndicatorRecord
        }
      });

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
          : null,
    chartPreferences: mergedChart
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
  if (exchange !== "bitget" && exchange !== "hyperliquid" && !isPaperExchange(exchange)) {
    throw new ManualTradingError(`exchange_not_supported:${exchange}`, 400, "exchange_not_supported");
  }

  if (isPaperExchange(exchange)) {
    const marketDataExchangeAccountId = await readPaperMarketDataAccountId(account.id);
    return {
      id: account.id,
      userId: account.userId,
      exchange,
      label: account.label,
      apiKey: "",
      apiSecret: "",
      passphrase: null,
      marketDataExchangeAccountId
    };
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
    passphrase,
    marketDataExchangeAccountId: null
  };
}

export async function resolveMarketDataTradingAccount(
  userId: string,
  exchangeAccountId?: string | null
): Promise<{ selectedAccount: TradingAccount; marketDataAccount: TradingAccount }> {
  const selectedAccount = await resolveTradingAccount(userId, exchangeAccountId);
  if (!isPaperExchange(selectedAccount.exchange)) {
    return {
      selectedAccount,
      marketDataAccount: selectedAccount
    };
  }

  const linkedId = selectedAccount.marketDataExchangeAccountId;
  if (!linkedId) {
    throw new ManualTradingError(
      "paper_market_data_account_missing",
      400,
      "paper_market_data_account_missing"
    );
  }

  const marketDataAccount = await resolveTradingAccount(userId, linkedId);
  if (isPaperExchange(marketDataAccount.exchange)) {
    throw new ManualTradingError(
      "paper_market_data_account_invalid",
      400,
      "paper_market_data_account_invalid"
    );
  }

  return {
    selectedAccount,
    marketDataAccount
  };
}

export function createBitgetAdapter(account: TradingAccount): BitgetFuturesAdapter {
  if (isPaperExchange(account.exchange)) {
    throw new ManualTradingError(
      "paper_account_requires_market_data_resolution",
      400,
      "paper_account_requires_market_data_resolution"
    );
  }
  if (account.exchange === "hyperliquid") {
    return new HyperliquidFuturesAdapter({
      apiKey: account.apiKey,
      apiSecret: account.apiSecret,
      apiPassphrase: account.passphrase ?? undefined,
      restBaseUrl: process.env.HYPERLIQUID_REST_BASE_URL,
      productType: "USDT-FUTURES",
      marginCoin: process.env.HYPERLIQUID_MARGIN_COIN ?? "USDC"
    }) as unknown as BitgetFuturesAdapter;
  }
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
  let planRowsRaw: unknown = [];
  try {
    planRowsRaw = await adapter.tradeApi.getPendingPlanOrders({
      productType: adapter.productType,
      symbol: exchangeSymbol,
      pageSize: 100
    });
  } catch {
    planRowsRaw = [];
  }
  const rows = toOrderRows(rowsRaw);
  const planRows = toOrderRows(planRowsRaw);
  const mapped = rows.map((row) => {
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
      triggerPrice: toNumber(row.triggerPrice ?? row.triggerPx),
      takeProfitPrice: toNumber(
        row.presetStopSurplusPrice ??
        row.stopSurplusTriggerPrice ??
        row.stopSurplusExecutePrice ??
        row.takeProfitPrice ??
        row.tp
      ),
      stopLossPrice: toNumber(
        row.presetStopLossPrice ??
        row.stopLossTriggerPrice ??
        row.stopLossExecutePrice ??
        row.stopLossPrice ??
        row.sl
      ),
      reduceOnly:
        typeof row.reduceOnly === "boolean"
          ? row.reduceOnly
          : getString(row, ["reduceOnly"])?.toLowerCase() === "yes"
            ? true
            : getString(row, ["reduceOnly"])?.toLowerCase() === "no"
              ? false
              : null,
      createdAt: toIsoFromMs(row.cTime ?? row.createTime ?? row.uTime),
      raw: row
    };
  }).filter((item) => item.orderId.length > 0);
  const mappedPlans = planRows.map((row) => {
    const rawSymbol = String(row.symbol ?? row.instId ?? "");
    const canonicalSymbol =
      (rawSymbol && adapter.toCanonicalSymbol(rawSymbol)) ??
      normalizeCanonicalSymbol(rawSymbol);
    return {
      orderId: String(row.orderId ?? row.planOrderId ?? row.clientOid ?? ""),
      symbol: canonicalSymbol,
      side: row.side ? String(row.side) : null,
      type: row.planType ? String(row.planType) : "plan",
      status: row.planStatus ? String(row.planStatus) : row.status ? String(row.status) : null,
      price: toNumber(row.price ?? row.executePrice),
      qty: toNumber(row.size ?? row.qty),
      triggerPrice: toNumber(row.triggerPrice ?? row.triggerPx),
      takeProfitPrice: toNumber(row.stopSurplusExecutePrice ?? row.presetStopSurplusPrice),
      stopLossPrice: toNumber(row.stopLossExecutePrice ?? row.presetStopLossPrice),
      reduceOnly:
        typeof row.reduceOnly === "boolean"
          ? row.reduceOnly
          : getString(row, ["reduceOnly"])?.toLowerCase() === "yes"
            ? true
            : getString(row, ["reduceOnly"])?.toLowerCase() === "no"
              ? false
              : null,
      createdAt: toIsoFromMs(row.cTime ?? row.createTime ?? row.uTime),
      raw: row
    } satisfies NormalizedOrder;
  }).filter((item) => item.orderId.length > 0);

  const seen = new Set<string>();
  const out: NormalizedOrder[] = [];
  for (const item of [...mapped, ...mappedPlans]) {
    if (seen.has(item.orderId)) continue;
    seen.add(item.orderId);
    out.push(item);
  }
  return out;
}

export async function listPositions(
  adapter: BitgetFuturesAdapter,
  symbol?: string
): Promise<NormalizedPosition[]> {
  const rows = await adapter.positionApi.getAllPositions({
    productType: adapter.productType,
    marginCoin: adapter.marginCoin
  });
  const normalizedSymbol = symbol ? normalizeCanonicalSymbol(symbol) : null;

  return rows
    .map((row) => {
      const parsedSymbol = normalizeCanonicalSymbol(String(row.symbol ?? ""));
      const side = String(row.holdSide ?? "").toLowerCase().includes("long") ? "long" : "short";
      const size = Math.abs(toNumber(row.total) ?? 0);
      return {
        symbol: parsedSymbol,
        side,
        size,
        entryPrice: toNumber(row.avgOpenPrice),
        markPrice: toNumber(row.markPrice),
        unrealizedPnl: toNumber(row.unrealizedPL),
        takeProfitPrice: toNumber((row as unknown as Record<string, unknown>)?.presetStopSurplusPrice),
        stopLossPrice: toNumber((row as unknown as Record<string, unknown>)?.presetStopLossPrice)
      } satisfies NormalizedPosition;
    })
    .filter((row) => row.symbol.length > 0 && row.size > 0)
    .filter((row) => (normalizedSymbol ? row.symbol === normalizedSymbol : true));
}

function signedQty(position: PaperPositionState): number {
  return position.side === "long" ? Math.abs(position.qty) : -Math.abs(position.qty);
}

function pushPaperOrder(state: PaperState, order: PaperOrderState): void {
  state.orders = [order, ...state.orders].slice(0, 200);
}

function toPaperOrderId(exchangeAccountId: string, seq: number): string {
  return `paper_${exchangeAccountId}_${String(seq).padStart(8, "0")}`;
}

async function fetchTickerPrice(adapter: BitgetFuturesAdapter, symbol: string): Promise<number> {
  const exchangeSymbol = await adapter.toExchangeSymbol(symbol);
  const ticker = await adapter.marketApi.getTicker(exchangeSymbol, adapter.productType);
  const row = toRecord(Array.isArray(ticker) ? ticker[0] : ticker);
  const price =
    getNumber(row, ["markPrice", "lastPr", "last", "price", "close", "indexPrice"]) ??
    getNumber(toRecord((row as any)?.data), ["markPrice", "lastPr", "last", "price", "close", "indexPrice"]);
  if (!price || !Number.isFinite(price) || price <= 0) {
    throw new ManualTradingError("paper_price_unavailable", 422, "paper_price_unavailable");
  }
  return price;
}

async function fetchMarkPriceMap(
  adapter: BitgetFuturesAdapter,
  symbols: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const symbol of symbols) {
    try {
      out.set(symbol, await fetchTickerPrice(adapter, symbol));
    } catch {
      // Keep partial mark-price coverage.
    }
  }
  return out;
}

function isLimitOrderMarketable(
  side: "buy" | "sell",
  limitPrice: number,
  marketPrice: number
): boolean {
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) return false;
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) return false;
  if (side === "buy") return marketPrice <= limitPrice;
  return marketPrice >= limitPrice;
}

async function reconcilePaperState(
  exchangeAccountId: string,
  adapter: BitgetFuturesAdapter,
  seedState?: PaperState
): Promise<PaperState> {
  const state = seedState ?? (await getPaperState(exchangeAccountId));
  const symbols = new Set<string>();
  for (const row of state.orders) {
    if (row.status === "open") symbols.add(row.symbol);
  }
  for (const row of state.positions) {
    symbols.add(row.symbol);
  }

  if (symbols.size === 0) return state;

  const markPrices = await fetchMarkPriceMap(adapter, Array.from(symbols));
  if (markPrices.size === 0) return state;

  let changed = false;
  const nowIso = new Date().toISOString();

  for (const order of state.orders) {
    if (order.status !== "open") continue;
    const markPrice = markPrices.get(order.symbol);
    if (!markPrice) continue;
    if (!isLimitOrderMarketable(order.side, order.price, markPrice)) continue;

    const fill = applyPaperFill({
      state,
      symbol: order.symbol,
      qty: order.qty,
      side: order.side,
      reduceOnly: order.reduceOnly,
      fillPrice: order.price
    });
    if (fill.filledQty <= 0) continue;

    changed = true;
    state.realizedPnlUsd = Number((state.realizedPnlUsd + fill.realizedPnlUsd).toFixed(8));
    state.balanceUsd = Number((state.balanceUsd + fill.realizedPnlUsd).toFixed(8));
    replacePosition(state, order.symbol, fill.nextPosition);
    order.qty = fill.filledQty;
    order.status = "filled";
    order.updatedAt = nowIso;
  }

  for (const position of state.positions.slice()) {
    const markPrice = markPrices.get(position.symbol);
    if (!markPrice || !Number.isFinite(markPrice)) continue;

    const tp = position.takeProfitPrice;
    const sl = position.stopLossPrice;
    let triggerPrice: number | null = null;
    if (position.side === "long") {
      if (tp !== null && markPrice >= tp) triggerPrice = tp;
      if (triggerPrice === null && sl !== null && markPrice <= sl) triggerPrice = sl;
    } else {
      if (tp !== null && markPrice <= tp) triggerPrice = tp;
      if (triggerPrice === null && sl !== null && markPrice >= sl) triggerPrice = sl;
    }
    if (triggerPrice === null) continue;

    const fill = applyPaperFill({
      state,
      symbol: position.symbol,
      qty: position.qty,
      side: position.side === "long" ? "sell" : "buy",
      reduceOnly: true,
      fillPrice: markPrice
    });
    if (fill.filledQty <= 0) continue;

    changed = true;
    state.realizedPnlUsd = Number((state.realizedPnlUsd + fill.realizedPnlUsd).toFixed(8));
    state.balanceUsd = Number((state.balanceUsd + fill.realizedPnlUsd).toFixed(8));
    replacePosition(state, position.symbol, fill.nextPosition);
    const orderId = toPaperOrderId(exchangeAccountId, state.nextOrderSeq);
    state.nextOrderSeq += 1;
    pushPaperOrder(state, {
      orderId,
      symbol: position.symbol,
      side: position.side === "long" ? "sell" : "buy",
      type: "market",
      qty: fill.filledQty,
      price: Number(markPrice.toFixed(8)),
      reduceOnly: true,
      triggerPrice,
      takeProfitPrice: tp,
      stopLossPrice: sl,
      status: "filled",
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }

  if (changed) {
    return savePaperState(exchangeAccountId, state);
  }
  return state;
}

export async function listPaperOpenOrders(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  symbol?: string
): Promise<NormalizedOrder[]> {
  const normalizedSymbol = symbol ? normalizeCanonicalSymbol(symbol) : null;
  const state = await reconcilePaperState(account.id, adapter);
  return state.orders
    .filter((row) => row.status === "open")
    .filter((row) => (normalizedSymbol ? row.symbol === normalizedSymbol : true))
    .map((row) => ({
      orderId: row.orderId,
      symbol: row.symbol,
      side: row.side,
      type: row.type,
      status: row.status,
      price: row.price,
      qty: row.qty,
      triggerPrice: row.triggerPrice,
      takeProfitPrice: row.takeProfitPrice,
      stopLossPrice: row.stopLossPrice,
      reduceOnly: row.reduceOnly,
      createdAt: row.createdAt,
      raw: row
    }));
}

export async function listPaperPositions(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  symbol?: string
): Promise<NormalizedPosition[]> {
  const state = await reconcilePaperState(account.id, adapter);
  const normalizedSymbol = symbol ? normalizeCanonicalSymbol(symbol) : null;
  const positions = normalizedSymbol
    ? state.positions.filter((row) => row.symbol === normalizedSymbol)
    : state.positions.slice();
  const markPrices = await fetchMarkPriceMap(adapter, positions.map((row) => row.symbol));

  return positions.map((row) => {
    const markPrice = markPrices.get(row.symbol) ?? null;
    const unrealizedPnl =
      markPrice === null
        ? null
        : row.side === "long"
          ? (markPrice - row.entryPrice) * row.qty
          : (row.entryPrice - markPrice) * row.qty;
    return {
      symbol: row.symbol,
      side: row.side,
      size: row.qty,
      entryPrice: row.entryPrice,
      markPrice,
      unrealizedPnl,
      takeProfitPrice: row.takeProfitPrice,
      stopLossPrice: row.stopLossPrice
    };
  });
}

export async function getPaperAccountState(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter
): Promise<{ equity: number; availableMargin: number; marginMode: "cross" }> {
  const state = await reconcilePaperState(account.id, adapter);
  const markPrices = await fetchMarkPriceMap(adapter, state.positions.map((row) => row.symbol));
  const positions = state.positions.map((row) => {
    const markPrice = markPrices.get(row.symbol) ?? null;
    const unrealizedPnl =
      markPrice === null
        ? 0
        : row.side === "long"
          ? (markPrice - row.entryPrice) * row.qty
          : (row.entryPrice - markPrice) * row.qty;
    return unrealizedPnl;
  });
  const unrealized = positions.reduce((acc, value) => acc + (Number(value) || 0), 0);
  const equity = Number((state.balanceUsd + unrealized).toFixed(6));
  return {
    equity,
    availableMargin: equity,
    marginMode: "cross"
  };
}

function positionBySymbol(state: PaperState, symbol: string): PaperPositionState | null {
  return state.positions.find((row) => row.symbol === symbol) ?? null;
}

function replacePosition(state: PaperState, symbol: string, next: PaperPositionState | null): void {
  state.positions = state.positions.filter((row) => row.symbol !== symbol);
  if (next) state.positions.push(next);
}

function applyPaperFill(params: {
  state: PaperState;
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  reduceOnly: boolean;
  fillPrice: number;
}): { filledQty: number; realizedPnlUsd: number; nextPosition: PaperPositionState | null } {
  const current = positionBySymbol(params.state, params.symbol);
  const currentSigned = current ? signedQty(current) : 0;
  let deltaSigned = params.side === "buy" ? Math.abs(params.qty) : -Math.abs(params.qty);
  if (params.reduceOnly) {
    if (currentSigned === 0 || Math.sign(currentSigned) === Math.sign(deltaSigned)) {
      return {
        filledQty: 0,
        realizedPnlUsd: 0,
        nextPosition: current
      };
    }
    const maxReduce = Math.abs(currentSigned);
    deltaSigned = Math.sign(deltaSigned) * Math.min(Math.abs(deltaSigned), maxReduce);
  }

  const nextSigned = currentSigned + deltaSigned;
  let realizedPnlUsd = 0;

  if (current && currentSigned !== 0 && Math.sign(currentSigned) !== Math.sign(deltaSigned)) {
    const closedQty = Math.min(Math.abs(currentSigned), Math.abs(deltaSigned));
    const pnlPerUnit =
      current.side === "long"
        ? params.fillPrice - current.entryPrice
        : current.entryPrice - params.fillPrice;
    realizedPnlUsd = closedQty * pnlPerUnit;
  }

  if (nextSigned === 0) {
    return {
      filledQty: Math.abs(deltaSigned),
      realizedPnlUsd,
      nextPosition: null
    };
  }

  const nextSide: "long" | "short" = nextSigned > 0 ? "long" : "short";
  const nextQty = Math.abs(nextSigned);
  let nextEntryPrice = params.fillPrice;
  const nowIso = new Date().toISOString();

  if (current && Math.sign(currentSigned) === Math.sign(nextSigned)) {
    if (Math.abs(deltaSigned) > 0 && Math.sign(currentSigned) === Math.sign(deltaSigned)) {
      const weightedNotional = current.entryPrice * Math.abs(currentSigned) + params.fillPrice * Math.abs(deltaSigned);
      nextEntryPrice = weightedNotional / (Math.abs(currentSigned) + Math.abs(deltaSigned));
    } else {
      nextEntryPrice = current.entryPrice;
    }
  }

  return {
    filledQty: Math.abs(deltaSigned),
    realizedPnlUsd,
    nextPosition: {
      symbol: params.symbol,
      side: nextSide,
      qty: nextQty,
      entryPrice: Number(nextEntryPrice.toFixed(8)),
      takeProfitPrice: current?.takeProfitPrice ?? null,
      stopLossPrice: current?.stopLossPrice ?? null,
      openedAt: current?.openedAt ?? nowIso,
      updatedAt: nowIso
    }
  };
}

export async function placePaperOrder(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  input: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
    triggerPrice?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    reduceOnly?: boolean;
  }
): Promise<{ orderId: string }> {
  const symbol = normalizeCanonicalSymbol(input.symbol);
  if (!symbol) throw new ManualTradingError("symbol_required", 400, "symbol_required");
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
  }

  const state = await reconcilePaperState(account.id, adapter, await getPaperState(account.id));
  const marketPrice = await fetchTickerPrice(adapter, symbol);
  const limitPrice = input.type === "limit" && Number.isFinite(Number(input.price)) && Number(input.price) > 0
    ? Number(input.price)
    : null;
  const fillPrice = limitPrice ?? marketPrice;

  const orderId = toPaperOrderId(account.id, state.nextOrderSeq);
  state.nextOrderSeq += 1;
  const nowIso = new Date().toISOString();

  if (input.type === "limit" && limitPrice !== null && !isLimitOrderMarketable(input.side, limitPrice, marketPrice)) {
    pushPaperOrder(state, {
      orderId,
      symbol,
      side: input.side,
      type: input.type,
      qty,
      price: Number(limitPrice.toFixed(8)),
      reduceOnly: Boolean(input.reduceOnly),
      triggerPrice: Number.isFinite(Number(input.triggerPrice)) ? Number(input.triggerPrice) : null,
      takeProfitPrice: Number.isFinite(Number(input.takeProfitPrice)) ? Number(input.takeProfitPrice) : null,
      stopLossPrice: Number.isFinite(Number(input.stopLossPrice)) ? Number(input.stopLossPrice) : null,
      status: "open",
      createdAt: nowIso,
      updatedAt: nowIso
    });
    await savePaperState(account.id, state);
    return { orderId };
  }

  const fill = applyPaperFill({
    state,
    symbol,
    qty,
    side: input.side,
    reduceOnly: Boolean(input.reduceOnly),
    fillPrice
  });

  if (fill.filledQty <= 0) {
    throw new ManualTradingError("paper_reduce_only_rejected", 409, "paper_reduce_only_rejected");
  }

  state.realizedPnlUsd = Number((state.realizedPnlUsd + fill.realizedPnlUsd).toFixed(8));
  state.balanceUsd = Number((state.balanceUsd + fill.realizedPnlUsd).toFixed(8));
  if (fill.nextPosition && !input.reduceOnly) {
    fill.nextPosition.takeProfitPrice =
      Number.isFinite(Number(input.takeProfitPrice)) ? Number(input.takeProfitPrice) : fill.nextPosition.takeProfitPrice;
    fill.nextPosition.stopLossPrice =
      Number.isFinite(Number(input.stopLossPrice)) ? Number(input.stopLossPrice) : fill.nextPosition.stopLossPrice;
  }
  replacePosition(state, symbol, fill.nextPosition);
  pushPaperOrder(state, {
    orderId,
    symbol,
    side: input.side,
    type: input.type,
    qty: fill.filledQty,
    price: Number(fillPrice.toFixed(8)),
    reduceOnly: Boolean(input.reduceOnly),
    triggerPrice: Number.isFinite(Number(input.triggerPrice)) ? Number(input.triggerPrice) : null,
    takeProfitPrice: Number.isFinite(Number(input.takeProfitPrice)) ? Number(input.takeProfitPrice) : null,
    stopLossPrice: Number.isFinite(Number(input.stopLossPrice)) ? Number(input.stopLossPrice) : null,
    status: "filled",
    createdAt: nowIso,
    updatedAt: nowIso
  });

  await savePaperState(account.id, state);
  return { orderId };
}

export async function closePaperPosition(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  symbol: string,
  side?: "long" | "short"
): Promise<string[]> {
  const normalized = normalizeCanonicalSymbol(symbol);
  if (!normalized) return [];
  const state = await getPaperState(account.id);
  const current = positionBySymbol(state, normalized);
  if (!current) return [];
  if (side && current.side !== side) return [];

  const placed = await placePaperOrder(account, adapter, {
    symbol: normalized,
    side: current.side === "long" ? "sell" : "buy",
    type: "market",
    qty: current.qty,
    reduceOnly: true
  });
  return [placed.orderId];
}

export async function setPaperPositionTpSl(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  input: {
    symbol: string;
    side?: "long" | "short";
    takeProfitPrice?: number | null;
    stopLossPrice?: number | null;
  }
): Promise<{ updated: boolean }> {
  const symbol = normalizeCanonicalSymbol(input.symbol);
  if (!symbol) throw new ManualTradingError("symbol_required", 400, "symbol_required");
  const state = await reconcilePaperState(account.id, adapter, await getPaperState(account.id));
  const position = state.positions.find(
    (row) => row.symbol === symbol && (!input.side || row.side === input.side)
  );
  if (!position) {
    throw new ManualTradingError("position_not_found", 404, "position_not_found");
  }
  if (input.takeProfitPrice !== undefined) {
    position.takeProfitPrice = input.takeProfitPrice === null ? null : Number(input.takeProfitPrice);
  }
  if (input.stopLossPrice !== undefined) {
    position.stopLossPrice = input.stopLossPrice === null ? null : Number(input.stopLossPrice);
  }
  position.updatedAt = new Date().toISOString();
  await savePaperState(account.id, state);
  return { updated: true };
}

export async function editPaperOrder(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  input: {
    orderId: string;
    symbol?: string;
    price?: number;
    qty?: number;
    triggerPrice?: number | null;
    takeProfitPrice?: number | null;
    stopLossPrice?: number | null;
  }
): Promise<{ orderId: string }> {
  const state = await reconcilePaperState(account.id, adapter, await getPaperState(account.id));
  const normalizedSymbol = input.symbol ? normalizeCanonicalSymbol(input.symbol) : null;
  const row = state.orders.find(
    (order) =>
      order.orderId === input.orderId &&
      order.status === "open" &&
      (!normalizedSymbol || order.symbol === normalizedSymbol)
  );
  if (!row) {
    throw new ManualTradingError("order_not_found", 404, "order_not_found");
  }
  if (input.price !== undefined) {
    if (!Number.isFinite(input.price) || input.price <= 0) {
      throw new ManualTradingError("invalid_price", 400, "invalid_price");
    }
    row.price = Number(input.price);
  }
  if (input.qty !== undefined) {
    if (!Number.isFinite(input.qty) || input.qty <= 0) {
      throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
    }
    row.qty = Number(input.qty);
  }
  if (input.triggerPrice !== undefined) {
    row.triggerPrice = input.triggerPrice === null ? null : Number(input.triggerPrice);
  }
  if (input.takeProfitPrice !== undefined) {
    row.takeProfitPrice = input.takeProfitPrice === null ? null : Number(input.takeProfitPrice);
  }
  if (input.stopLossPrice !== undefined) {
    row.stopLossPrice = input.stopLossPrice === null ? null : Number(input.stopLossPrice);
  }
  row.updatedAt = new Date().toISOString();
  await savePaperState(account.id, state);
  return { orderId: row.orderId };
}

export async function cancelPaperOrder(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  orderId: string,
  symbol?: string
): Promise<{ ok: boolean }> {
  const state = await reconcilePaperState(account.id, adapter, await getPaperState(account.id));
  const normalizedSymbol = symbol ? normalizeCanonicalSymbol(symbol) : null;
  const row = state.orders.find(
    (order) =>
      order.orderId === orderId &&
      order.status === "open" &&
      (!normalizedSymbol || order.symbol === normalizedSymbol)
  );
  if (!row) return { ok: true };
  row.status = "cancelled";
  row.updatedAt = new Date().toISOString();
  await savePaperState(account.id, state);
  return { ok: true };
}

export async function cancelAllPaperOrders(
  account: TradingAccount,
  adapter: BitgetFuturesAdapter,
  symbol?: string
): Promise<{ requested: number; cancelled: number; failed: number }> {
  const state = await reconcilePaperState(account.id, adapter, await getPaperState(account.id));
  const normalizedSymbol = symbol ? normalizeCanonicalSymbol(symbol) : null;
  const targets = state.orders.filter(
    (order) => order.status === "open" && (!normalizedSymbol || order.symbol === normalizedSymbol)
  );
  for (const row of targets) {
    row.status = "cancelled";
    row.updatedAt = new Date().toISOString();
  }
  if (targets.length > 0) {
    await savePaperState(account.id, state);
  }
  return {
    requested: targets.length,
    cancelled: targets.length,
    failed: 0
  };
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

export async function editOpenOrder(
  adapter: BitgetFuturesAdapter,
  input: {
    symbol: string;
    orderId: string;
    price?: number;
    qty?: number;
    takeProfitPrice?: number | null;
    stopLossPrice?: number | null;
  }
): Promise<{ orderId: string }> {
  const normalizedSymbol = normalizeCanonicalSymbol(input.symbol);
  if (!normalizedSymbol) {
    throw new ManualTradingError("symbol_required", 400, "symbol_required");
  }
  if (!input.orderId?.trim()) {
    throw new ManualTradingError("order_id_required", 400, "order_id_required");
  }
  if (
    input.price === undefined &&
    input.qty === undefined &&
    input.takeProfitPrice === undefined &&
    input.stopLossPrice === undefined
  ) {
    throw new ManualTradingError("no_edit_fields", 400, "no_edit_fields");
  }
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price <= 0)) {
    throw new ManualTradingError("invalid_price", 400, "invalid_price");
  }
  if (input.qty !== undefined && (!Number.isFinite(input.qty) || input.qty <= 0)) {
    throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
  }

  const exchangeSymbol = await adapter.toExchangeSymbol(normalizedSymbol);
  const almostEqual = (a: number, b: number) => {
    const tolerance = Math.max(1e-8, Math.abs(a) * 1e-8, Math.abs(b) * 1e-8);
    return Math.abs(a - b) <= tolerance;
  };

  let nextPrice = input.price;
  let nextQty = input.qty;
  let nextTakeProfit = input.takeProfitPrice;
  let nextStopLoss = input.stopLossPrice;
  const tpExplicit = input.takeProfitPrice !== undefined;
  const slExplicit = input.stopLossPrice !== undefined;
  let currentPrice: number | null = null;
  let currentQty: number | null = null;
  let currentTakeProfit: number | null = null;
  let currentStopLoss: number | null = null;
  let currentSide: "buy" | "sell" | null = null;
  let currentOrderType: "limit" | "market" | null = null;
  let currentReduceOnly = false;
  let currentMarginMode: "isolated" | "cross" = "cross";

  try {
    const detailRaw = await adapter.tradeApi.getOrderDetail({
      symbol: exchangeSymbol,
      orderId: input.orderId
    });
    const detail = toRecord(detailRaw);
    currentPrice = getNumber(detail, ["price", "orderPrice", "limitPrice"]);
    currentQty = getNumber(detail, ["size", "baseVolume", "qty"]);
    currentTakeProfit = getNumber(detail, [
      "presetStopSurplusPrice",
      "takeProfitPrice",
      "stopSurplusTriggerPrice",
      "stopSurplusExecutePrice"
    ]);
    currentStopLoss = getNumber(detail, [
      "presetStopLossPrice",
      "stopLossPrice",
      "stopLossTriggerPrice",
      "stopLossExecutePrice"
    ]);
    const sideRaw = getString(detail, ["side", "orderSide", "tradeSide"])?.toLowerCase() ?? "";
    if (sideRaw.includes("buy")) currentSide = "buy";
    if (sideRaw.includes("sell")) currentSide = "sell";
    const typeRaw = getString(detail, ["orderType", "type"])?.toLowerCase() ?? "";
    if (typeRaw === "limit" || typeRaw === "market") {
      currentOrderType = typeRaw;
    }
    const reduceOnlyRaw = String(detail?.reduceOnly ?? detail?.reduceOnlyFlag ?? "").toLowerCase();
    currentReduceOnly = reduceOnlyRaw === "yes" || reduceOnlyRaw === "true" || reduceOnlyRaw === "1";
    const marginModeRaw = getString(detail, ["marginMode", "marginType"])?.toLowerCase() ?? "";
    currentMarginMode = marginModeRaw.includes("isolated") ? "isolated" : "cross";

    if (nextPrice !== undefined && currentPrice !== null && almostEqual(nextPrice, currentPrice)) {
      nextPrice = undefined;
    }
    if (nextQty !== undefined && currentQty !== null && almostEqual(nextQty, currentQty)) {
      nextQty = undefined;
    }
    // Keep TP/SL explicit when provided by caller; they may need to be re-sent
    // on price/size edits to avoid Bitget dropping preset values.
  } catch {
    // If detail lookup fails, keep original payload and let exchange validate.
  }

  // Enrich current order snapshot from pending orders (detail endpoint may omit TP/SL fields).
  try {
    const pendingRaw = await adapter.tradeApi.getPendingOrders({
      productType: adapter.productType,
      symbol: exchangeSymbol,
      pageSize: 100
    });
    const pendingRows = toOrderRows(pendingRaw);
    const pending = pendingRows.find((row) => String(row.orderId ?? "").trim() === input.orderId);
    if (pending) {
      if (currentPrice === null) {
        currentPrice = getNumber(pending, ["price", "orderPrice", "limitPrice"]);
      }
      if (currentQty === null) {
        currentQty = getNumber(pending, ["size", "baseVolume", "qty"]);
      }
      if (nextTakeProfit === undefined && currentTakeProfit === null) {
        currentTakeProfit = getNumber(pending, [
          "presetStopSurplusPrice",
          "takeProfitPrice",
          "stopSurplusTriggerPrice",
          "stopSurplusExecutePrice",
          "tp"
        ]);
      }
      if (nextStopLoss === undefined && currentStopLoss === null) {
        currentStopLoss = getNumber(pending, [
          "presetStopLossPrice",
          "stopLossPrice",
          "stopLossTriggerPrice",
          "stopLossExecutePrice",
          "sl"
        ]);
      }
      if (currentSide === null) {
        const rowSide = getString(pending, ["side", "orderSide", "tradeSide"])?.toLowerCase() ?? "";
        if (rowSide.includes("buy")) currentSide = "buy";
        if (rowSide.includes("sell")) currentSide = "sell";
      }
      if (currentOrderType === null) {
        const rowType = getString(pending, ["orderType", "type"])?.toLowerCase() ?? "";
        if (rowType === "limit" || rowType === "market") {
          currentOrderType = rowType;
        }
      }
      const rowReduceOnly = String(pending?.reduceOnly ?? pending?.reduceOnlyFlag ?? "").toLowerCase();
      if (rowReduceOnly) {
        currentReduceOnly =
          rowReduceOnly === "yes" || rowReduceOnly === "true" || rowReduceOnly === "1";
      }
      const rowMarginMode = getString(pending, ["marginMode", "marginType"])?.toLowerCase() ?? "";
      if (rowMarginMode) {
        currentMarginMode = rowMarginMode.includes("isolated") ? "isolated" : "cross";
      }
    }
  } catch {
    // Keep best-effort values from detail lookup.
  }

  const modifiesPriceOrSize = nextPrice !== undefined || nextQty !== undefined;
  const tpChanged =
    nextTakeProfit !== undefined &&
    (
      (nextTakeProfit === null && currentTakeProfit !== null) ||
      (nextTakeProfit !== null &&
        (currentTakeProfit === null || !almostEqual(nextTakeProfit, currentTakeProfit)))
    );
  const slChanged =
    nextStopLoss !== undefined &&
    (
      (nextStopLoss === null && currentStopLoss !== null) ||
      (nextStopLoss !== null &&
        (currentStopLoss === null || !almostEqual(nextStopLoss, currentStopLoss)))
    );

  if (!modifiesPriceOrSize && !tpChanged && !slChanged) {
    throw new ManualTradingError("no_edit_fields", 400, "no_edit_fields");
  }

  // Bitget requires price and size together when modifying either one.
  if (modifiesPriceOrSize) {
    if (nextPrice === undefined) {
      if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
        throw new ManualTradingError("invalid_price", 400, "invalid_price");
      }
      nextPrice = currentPrice;
    }
    if (nextQty === undefined) {
      if (currentQty === null || !Number.isFinite(currentQty) || currentQty <= 0) {
        throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
      }
      nextQty = currentQty;
    }
    // Bitget may clear preset TP/SL when modifying price/size unless sent explicitly.
    // Preserve existing TP/SL for price/qty edits unless caller explicitly cleared them.
    if (!tpExplicit && nextTakeProfit === undefined && currentTakeProfit !== null) {
      nextTakeProfit = currentTakeProfit;
    }
    if (!slExplicit && nextStopLoss === undefined && currentStopLoss !== null) {
      nextStopLoss = currentStopLoss;
    }

    // For price/size edits we replace the order instead of modify-order because
    // Bitget may drop preset TP/SL on modify-order in unilateral mode.
    if (currentSide === null || currentOrderType !== "limit") {
      throw new ManualTradingError("order_replace_context_missing", 400, "order_replace_context_missing");
    }
    await adapter.cancelOrder(input.orderId);
    const replacement = await adapter.placeOrder({
      symbol: normalizedSymbol,
      side: currentSide,
      type: currentOrderType,
      qty: nextQty!,
      price: nextPrice!,
      takeProfitPrice:
        nextTakeProfit === undefined || nextTakeProfit === null ? undefined : nextTakeProfit,
      stopLossPrice:
        nextStopLoss === undefined || nextStopLoss === null ? undefined : nextStopLoss,
      reduceOnly: currentReduceOnly,
      marginMode: currentMarginMode
    });
    return { orderId: replacement.orderId };
  }

  const buildModifyPayload = (newClientOid?: string) => ({
    symbol: exchangeSymbol,
    productType: adapter.productType,
    orderId: input.orderId,
    newClientOid,
    newSize: nextQty !== undefined ? String(nextQty) : undefined,
    newPrice: nextPrice !== undefined ? String(nextPrice) : undefined,
    newPresetStopSurplusPrice:
      nextTakeProfit === undefined
        ? undefined
        : nextTakeProfit === null
          ? ""
          : String(nextTakeProfit),
    newPresetStopLossPrice:
      nextStopLoss === undefined
        ? undefined
        : nextStopLoss === null
          ? ""
          : String(nextStopLoss)
  });

  const updated = await adapter.tradeApi.modifyOrder(buildModifyPayload()).then(() => ({ orderId: input.orderId })).catch(async (error) => {
    let activeError = error;
    const firstText = String(activeError ?? "").toLowerCase();
    const firstCode = String((activeError as any)?.options?.code ?? "");
    const needsNewClientOid =
      firstCode === "45115" ||
      firstText.includes("newclientoid") ||
      firstText.includes("please pass in newclientoid");
    const modifiesPriceOrSize = nextPrice !== undefined || nextQty !== undefined;

    if (needsNewClientOid && modifiesPriceOrSize) {
      try {
        const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        await adapter.tradeApi.modifyOrder(buildModifyPayload(`edit_${suffix}`));
        return { orderId: input.orderId };
      } catch (retryError) {
        activeError = retryError;
      }
    }

    const text = String(activeError ?? "").toLowerCase();
    const code = String((activeError as any)?.options?.code ?? "");
    const onlyTpSlEdit =
      nextPrice === undefined &&
      nextQty === undefined &&
      (nextTakeProfit !== undefined || nextStopLoss !== undefined);
    const isUnchangedError =
      code === "40923" ||
      text.includes("order size and price have not changed");
    if (!onlyTpSlEdit || !isUnchangedError) {
      throw activeError;
    }
    if (currentSide === null || currentOrderType !== "limit" || currentQty === null || currentPrice === null) {
      throw error;
    }

    // Bitget may reject TP/SL-only modify-order updates. Replace the limit order with updated presets.
    const replacementTakeProfit = nextTakeProfit === undefined ? currentTakeProfit : nextTakeProfit;
    const replacementStopLoss = nextStopLoss === undefined ? currentStopLoss : nextStopLoss;
    await adapter.cancelOrder(input.orderId);
    return adapter.placeOrder({
      symbol: normalizedSymbol,
      side: currentSide,
      type: currentOrderType,
      qty: currentQty,
      price: currentPrice,
      takeProfitPrice: replacementTakeProfit ?? undefined,
      stopLossPrice: replacementStopLoss ?? undefined,
      reduceOnly: currentReduceOnly,
      marginMode: currentMarginMode
    });
  });
  return updated;
}

function toPlanKind(value: unknown): "tp" | "sl" | null {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("profit")) return "tp";
  if (text.includes("loss")) return "sl";
  return null;
}

export async function setPositionTpSl(
  adapter: BitgetFuturesAdapter,
  input: {
    symbol: string;
    side?: "long" | "short";
    takeProfitPrice?: number | null;
    stopLossPrice?: number | null;
  }
): Promise<{ ok: true }> {
  const normalizedSymbol = normalizeCanonicalSymbol(input.symbol);
  if (!normalizedSymbol) {
    throw new ManualTradingError("symbol_required", 400, "symbol_required");
  }
  const exchangeSymbol = await adapter.toExchangeSymbol(normalizedSymbol);
  const side =
    input.side ??
    (await listPositions(adapter, normalizedSymbol))[0]?.side;
  if (side !== "long" && side !== "short") {
    throw new ManualTradingError("position_side_required", 400, "position_side_required");
  }
  if (input.takeProfitPrice !== undefined && input.takeProfitPrice !== null && input.takeProfitPrice <= 0) {
    throw new ManualTradingError("invalid_take_profit", 400, "invalid_take_profit");
  }
  if (input.stopLossPrice !== undefined && input.stopLossPrice !== null && input.stopLossPrice <= 0) {
    throw new ManualTradingError("invalid_stop_loss", 400, "invalid_stop_loss");
  }

  const pendingRaw = await adapter.tradeApi.getPendingPlanOrders({
    productType: adapter.productType,
    symbol: exchangeSymbol,
    pageSize: 100
  });
  const pendingRows = toOrderRows(pendingRaw);
  const holdSide = side;
  const cancelKinds = new Set<"tp" | "sl">();
  if (input.takeProfitPrice !== undefined) cancelKinds.add("tp");
  if (input.stopLossPrice !== undefined) cancelKinds.add("sl");

  if (cancelKinds.size > 0) {
    await Promise.allSettled(
      pendingRows.map(async (row) => {
        const rowSide = String(row.holdSide ?? row.posSide ?? "").toLowerCase();
        if (rowSide && rowSide !== holdSide) return;
        const kind = toPlanKind(row.planType ?? row.stopType ?? row.triggerType);
        if (!kind || !cancelKinds.has(kind)) return;
        const orderId = String(row.orderId ?? row.planOrderId ?? "").trim();
        if (!orderId) return;
        await adapter.tradeApi.cancelPlanOrder({
          symbol: exchangeSymbol,
          orderId,
          productType: adapter.productType
        });
      })
    );
  }

  if (input.takeProfitPrice !== undefined && input.takeProfitPrice !== null) {
    await adapter.tradeApi.placePositionTpSl({
      symbol: exchangeSymbol,
      productType: adapter.productType,
      marginCoin: adapter.marginCoin,
      holdSide,
      planType: "profit_plan",
      triggerPrice: String(input.takeProfitPrice)
    });
  }
  if (input.stopLossPrice !== undefined && input.stopLossPrice !== null) {
    await adapter.tradeApi.placePositionTpSl({
      symbol: exchangeSymbol,
      productType: adapter.productType,
      marginCoin: adapter.marginCoin,
      holdSide,
      planType: "loss_plan",
      triggerPrice: String(input.stopLossPrice)
    });
  }
  return { ok: true };
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
    openOrders.map(async (order) => {
      const raw = toRecord(order.raw);
      const isPlan =
        (order.type ?? "").toLowerCase().includes("plan") ||
        typeof raw?.planType === "string" ||
        typeof raw?.planOrderId === "string";
      if (isPlan) {
        await adapter.tradeApi.cancelPlanOrder({
          symbol: await adapter.toExchangeSymbol(order.symbol),
          orderId: order.orderId,
          productType: adapter.productType
        });
        return;
      }
      await adapter.tradeApi.cancelOrder({
        symbol: await adapter.toExchangeSymbol(order.symbol),
        orderId: order.orderId,
        productType: adapter.productType
      });
    })
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
    const qty = getNumber(record, ["size", "qty", "q", "vol", "sz", "amount"]);
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

  const levels = Array.isArray(record.levels) ? record.levels : null;
  const bids = parseBookLevels(record.bids ?? record.bid ?? record.b ?? levels?.[0]);
  const asks = parseBookLevels(record.asks ?? record.ask ?? record.a ?? levels?.[1]);
  const ts = getNumber(record, ["ts", "timestamp", "uTime", "time", "t"]);

  return { bids, asks, ts };
}

export function normalizeTickerPayload(payload: unknown): NormalizedTicker {
  const record = toRecord(payload);
  const symbolRaw = getString(record, ["instId", "symbol"]);

  return {
    symbol: normalizeCanonicalSymbol(symbolRaw ?? ""),
    last: getNumber(record, ["lastPr", "last", "price", "close"]),
    mark: getNumber(record, ["markPrice", "mark", "indexPrice", "markPx", "midPx", "oraclePx"]),
    bid: getNumber(record, ["bidPr", "bidPrice", "bid", "bestBid"]),
    ask: getNumber(record, ["askPr", "askPrice", "ask", "bestAsk"]),
    ts: getNumber(record, ["ts", "timestamp", "time", "t"])
  };
}

export function normalizeTradesPayload(payload: unknown): NormalizedTrade[] {
  if (!Array.isArray(payload)) {
    const record = toRecord(payload);
    if (!record) return [];
    if (Array.isArray(record.data)) return normalizeTradesPayload(record.data);
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
    ts: getNumber(record, ["ts", "timestamp", "cTime", "time", "t"]),
    price: getNumber(record, ["price", "px", "fillPrice"]),
    qty: getNumber(record, ["size", "qty", "q", "fillSize", "sz", "amount"]),
    side: getString(record, ["side", "fillSide", "tradeSide", "dir"])?.toLowerCase() ?? null
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
