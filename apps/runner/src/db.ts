import { prisma } from "@mm/db";
import type { TradeIntent } from "@mm/futures-core";
import { decryptSecret } from "./secret-crypto.js";

const db = prisma as any;
const PAPER_EXCHANGE = "paper";
const PAPER_MARKET_DATA_ACCOUNT_KEY_PREFIX = "paper.marketDataAccount:";
const PAPER_STATE_KEY_PREFIX = "paper.state:";
const DEFAULT_PAPER_BALANCE_USD = Math.max(
  0,
  Number(process.env.PAPER_TRADING_START_BALANCE_USD ?? "10000")
);

export type BotStatusValue = "running" | "stopped" | "error";

export type ActiveFuturesBot = {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  exchange: string;
  exchangeAccountId: string;
  strategyKey: string;
  marginMode: "isolated" | "cross";
  leverage: number;
  paramsJson: Record<string, unknown>;
  tickMs: number;
  credentials: {
    apiKey: string;
    apiSecret: string;
    passphrase: string | null;
  };
  marketData: {
    exchange: string;
    exchangeAccountId: string;
    credentials: {
      apiKey: string;
      apiSecret: string;
      passphrase: string | null;
    };
  };
};

export type BotRuntimeCircuitBreakerState = {
  consecutiveErrors: number;
  errorWindowStartAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

export type PredictionGateState = {
  id: string;
  exchange: string;
  accountId: string;
  userId: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  signal: "up" | "down" | "neutral";
  expectedMovePct?: number | null;
  confidence: number;
  tags: string[];
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  tsUpdated: Date;
};

export type BotTradeState = {
  botId: string;
  symbol: string;
  lastPredictionHash: string | null;
  lastSignal: "up" | "down" | "neutral" | null;
  lastSignalTs: Date | null;
  lastTradeTs: Date | null;
  dailyTradeCount: number;
  dailyResetUtc: Date;
  openSide: "long" | "short" | null;
  openQty: number | null;
  openEntryPrice: number | null;
  openTs: Date | null;
};

export type BotTradeHistoryCloseOutcome =
  | "tp_hit"
  | "sl_hit"
  | "signal_exit"
  | "manual_exit"
  | "time_stop"
  | "unknown";

export type OpenBotTradeHistoryEntry = {
  id: string;
  side: "long" | "short";
  tpPrice: number | null;
  slPrice: number | null;
};

export type RiskEventType =
  | "KILL_SWITCH_BLOCK"
  | "CIRCUIT_BREAKER_TRIPPED"
  | "BOT_ERROR"
  | "PREDICTION_GATE_BLOCK"
  | "PREDICTION_GATE_ALLOW"
  | "PREDICTION_GATE_FAIL_OPEN"
  | "PREDICTION_COPIER_DECISION"
  | "PREDICTION_COPIER_TRADE"
  | "prediction_source_resolved"
  | "prediction_source_missing"
  | "legacy_source_fallback";

type RunnerPaperPosition = {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  openedAt: string;
  updatedAt: string;
};

type RunnerPaperOrder = {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  price: number;
  reduceOnly: boolean;
  triggerPrice?: number | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  status: "open" | "filled" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type RunnerPaperState = {
  balanceUsd: number;
  realizedPnlUsd: number;
  nextOrderSeq: number;
  positions: RunnerPaperPosition[];
  orders: RunnerPaperOrder[];
  updatedAt: string;
};

function normalizeSymbol(value: string): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function normalizeStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickNumber(snapshot: Record<string, unknown> | null, keys: string[]): number | null {
  if (!snapshot) return null;
  const readPathValue = (obj: Record<string, unknown>, key: string): unknown => {
    if (!key.includes(".")) return obj[key];
    let cursor: unknown = obj;
    for (const part of key.split(".")) {
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
  };

  for (const key of keys) {
    const parsed = Number(readPathValue(snapshot, key));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeUtcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function normalizeExchange(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function getPaperMarketDataSettingKey(exchangeAccountId: string): string {
  return `${PAPER_MARKET_DATA_ACCOUNT_KEY_PREFIX}${exchangeAccountId}`;
}

function getPaperStateKey(exchangeAccountId: string): string {
  return `${PAPER_STATE_KEY_PREFIX}${exchangeAccountId}`;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeCredentials(row: {
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
}) {
  return {
    apiKey: decryptSecret(row.apiKeyEnc),
    apiSecret: decryptSecret(row.apiSecretEnc),
    passphrase: row.passphraseEnc ? decryptSecret(row.passphraseEnc) : null
  };
}

async function resolvePaperMarketDataAccountId(exchangeAccountId: string): Promise<string | null> {
  const row = await db.globalSetting.findUnique({
    where: {
      key: getPaperMarketDataSettingKey(exchangeAccountId)
    },
    select: {
      value: true
    }
  });

  if (typeof row?.value === "string" && row.value.trim()) {
    return row.value.trim();
  }

  if (row?.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    const record = row.value as Record<string, unknown>;
    const candidate = record.exchangeAccountId ?? record.accountId ?? record.id;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function coercePaperState(value: unknown): RunnerPaperState {
  const record = asRecord(value) ?? {};
  const positionsRaw = Array.isArray(record.positions) ? record.positions : [];
  const ordersRaw = Array.isArray(record.orders) ? record.orders : [];

  const positions: RunnerPaperPosition[] = [];
  for (const row of positionsRaw) {
    const item = asRecord(row);
    const symbol = normalizeSymbol(String(item?.symbol ?? ""));
    const sideRaw = String(item?.side ?? "").trim().toLowerCase();
    const side: "long" | "short" | null = sideRaw === "long" || sideRaw === "short" ? sideRaw : null;
    const qty = Math.abs(toNumber(item?.qty) ?? 0);
    const entryPrice = toNumber(item?.entryPrice) ?? 0;
    if (!symbol || !side || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      continue;
    }
    positions.push({
      symbol,
      side,
      qty,
      entryPrice,
      takeProfitPrice: toNumber(item?.takeProfitPrice),
      stopLossPrice: toNumber(item?.stopLossPrice),
      openedAt: typeof item?.openedAt === "string" ? item.openedAt : new Date().toISOString(),
      updatedAt: typeof item?.updatedAt === "string" ? item.updatedAt : new Date().toISOString()
    });
  }

  const orders: RunnerPaperOrder[] = [];
  for (const row of ordersRaw) {
    const item = asRecord(row);
    const orderId = String(item?.orderId ?? "").trim();
    const symbol = normalizeSymbol(String(item?.symbol ?? ""));
    const sideRaw = String(item?.side ?? "").trim().toLowerCase();
    const side: "buy" | "sell" | null = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : null;
    const typeRaw = String(item?.type ?? "").trim().toLowerCase();
    const type: "market" | "limit" = typeRaw === "limit" ? "limit" : "market";
    const qty = Math.abs(toNumber(item?.qty) ?? 0);
    const price = toNumber(item?.price) ?? 0;
    const statusRaw = String(item?.status ?? "").trim().toLowerCase();
    const status: "open" | "filled" | "cancelled" =
      statusRaw === "open" || statusRaw === "cancelled" ? statusRaw : "filled";
    if (!orderId || !symbol || !side || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    orders.push({
      orderId,
      symbol,
      side,
      type,
      qty,
      price,
      reduceOnly: Boolean(item?.reduceOnly),
      triggerPrice: toNumber(item?.triggerPrice),
      takeProfitPrice: toNumber(item?.takeProfitPrice),
      stopLossPrice: toNumber(item?.stopLossPrice),
      status,
      createdAt: typeof item?.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item?.updatedAt === "string" ? item.updatedAt : new Date().toISOString()
    });
  }

  return {
    balanceUsd: Math.max(0, toNumber(record.balanceUsd) ?? DEFAULT_PAPER_BALANCE_USD),
    realizedPnlUsd: toNumber(record.realizedPnlUsd) ?? 0,
    nextOrderSeq: Math.max(1, Math.trunc(toNumber(record.nextOrderSeq) ?? 1)),
    positions,
    orders: orders.slice(0, 200),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
  };
}

async function getPaperState(exchangeAccountId: string): Promise<RunnerPaperState> {
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

async function savePaperState(exchangeAccountId: string, state: RunnerPaperState): Promise<RunnerPaperState> {
  const payload: RunnerPaperState = {
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

function toPaperOrderId(exchangeAccountId: string, seq: number): string {
  return `paper_${exchangeAccountId}_${String(seq).padStart(8, "0")}`;
}

function replacePaperPosition(
  state: RunnerPaperState,
  symbol: string,
  nextPosition: RunnerPaperPosition | null
) {
  state.positions = state.positions.filter((row) => row.symbol !== symbol);
  if (nextPosition) state.positions.push(nextPosition);
}

export async function listPaperPositionsForRunner(params: {
  exchangeAccountId: string;
  symbol?: string;
}): Promise<Array<{
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
}>> {
  const state = await getPaperState(params.exchangeAccountId);
  const normalizedSymbol = params.symbol ? normalizeSymbol(params.symbol) : null;
  return state.positions
    .filter((row) => (normalizedSymbol ? row.symbol === normalizedSymbol : true))
    .map((row) => ({
      symbol: row.symbol,
      side: row.side,
      size: row.qty,
      entryPrice: row.entryPrice,
      markPrice: null
    }));
}

export async function placePaperPositionForRunner(params: {
  exchangeAccountId: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  fillPrice: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
}): Promise<{ orderId: string }> {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) throw new Error("paper_symbol_required");
  const qty = Math.abs(Number(params.qty));
  const fillPrice = Number(params.fillPrice);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("paper_qty_invalid");
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) throw new Error("paper_fill_price_invalid");

  const state = await getPaperState(params.exchangeAccountId);
  const nowIso = new Date().toISOString();
  const existing = state.positions.find((row) => row.symbol === symbol) ?? null;
  let nextPosition: RunnerPaperPosition | null = null;

  if (!existing) {
    nextPosition = {
      symbol,
      side: params.side,
      qty,
      entryPrice: fillPrice,
      takeProfitPrice: toNumber(params.takeProfitPrice),
      stopLossPrice: toNumber(params.stopLossPrice),
      openedAt: nowIso,
      updatedAt: nowIso
    };
  } else if (existing.side === params.side) {
    const nextQty = existing.qty + qty;
    const nextEntry = ((existing.entryPrice * existing.qty) + (fillPrice * qty)) / nextQty;
    nextPosition = {
      ...existing,
      qty: Number(nextQty.toFixed(8)),
      entryPrice: Number(nextEntry.toFixed(8)),
      takeProfitPrice:
        params.takeProfitPrice !== undefined ? toNumber(params.takeProfitPrice) : existing.takeProfitPrice,
      stopLossPrice:
        params.stopLossPrice !== undefined ? toNumber(params.stopLossPrice) : existing.stopLossPrice,
      updatedAt: nowIso
    };
  } else if (existing.qty > qty) {
    nextPosition = {
      ...existing,
      qty: Number((existing.qty - qty).toFixed(8)),
      updatedAt: nowIso
    };
  } else if (existing.qty < qty) {
    nextPosition = {
      symbol,
      side: params.side,
      qty: Number((qty - existing.qty).toFixed(8)),
      entryPrice: fillPrice,
      takeProfitPrice: toNumber(params.takeProfitPrice),
      stopLossPrice: toNumber(params.stopLossPrice),
      openedAt: nowIso,
      updatedAt: nowIso
    };
  }

  replacePaperPosition(state, symbol, nextPosition);
  const orderId = toPaperOrderId(params.exchangeAccountId, state.nextOrderSeq);
  state.nextOrderSeq += 1;
  const filledOrder: RunnerPaperOrder = {
    orderId,
    symbol,
    side: params.side === "long" ? "buy" : "sell",
    type: "market",
    qty,
    price: Number(fillPrice.toFixed(8)),
    reduceOnly: Boolean(existing && existing.side !== params.side),
    triggerPrice: null,
    takeProfitPrice: toNumber(params.takeProfitPrice),
    stopLossPrice: toNumber(params.stopLossPrice),
    status: "filled",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.orders = [filledOrder, ...state.orders].slice(0, 200);
  await savePaperState(params.exchangeAccountId, state);
  return { orderId };
}

export async function closePaperPositionForRunner(params: {
  exchangeAccountId: string;
  symbol: string;
  side?: "long" | "short";
  fillPrice?: number | null;
}): Promise<{ orderId: string | null; closedQty: number }> {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) throw new Error("paper_symbol_required");
  const fillPrice = Number(params.fillPrice);
  const state = await getPaperState(params.exchangeAccountId);
  const position = state.positions.find(
    (row) => row.symbol === symbol && (!params.side || row.side === params.side)
  );
  if (!position) return { orderId: null, closedQty: 0 };

  replacePaperPosition(state, symbol, null);
  const orderId = toPaperOrderId(params.exchangeAccountId, state.nextOrderSeq);
  state.nextOrderSeq += 1;
  const safePrice = Number.isFinite(fillPrice) && fillPrice > 0
    ? fillPrice
    : position.entryPrice;
  const nowIso = new Date().toISOString();
  const filledOrder: RunnerPaperOrder = {
    orderId,
    symbol,
    side: position.side === "long" ? "sell" : "buy",
    type: "market",
    qty: position.qty,
    price: Number(safePrice.toFixed(8)),
    reduceOnly: true,
    triggerPrice: null,
    takeProfitPrice: position.takeProfitPrice,
    stopLossPrice: position.stopLossPrice,
    status: "filled",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.orders = [filledOrder, ...state.orders].slice(0, 200);
  await savePaperState(params.exchangeAccountId, state);
  return { orderId, closedQty: position.qty };
}

async function resolveMarketDataForBot(bot: any): Promise<{
  exchange: string;
  exchangeAccountId: string;
  credentials: {
    apiKey: string;
    apiSecret: string;
    passphrase: string | null;
  };
}> {
  const exchange = normalizeExchange(bot.exchange);
  if (exchange !== PAPER_EXCHANGE) {
    return {
      exchange,
      exchangeAccountId: String(bot.exchangeAccount?.id ?? bot.exchangeAccountId ?? ""),
      credentials: decodeCredentials(bot.exchangeAccount)
    };
  }

  const paperAccountId = String(bot.exchangeAccount?.id ?? bot.exchangeAccountId ?? "");
  const linkedId = await resolvePaperMarketDataAccountId(paperAccountId);
  if (!linkedId) {
    throw new Error("paper_market_data_account_missing");
  }

  const linked = await db.exchangeAccount.findFirst({
    where: {
      id: linkedId,
      userId: bot.userId
    },
    select: {
      id: true,
      exchange: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true
    }
  });
  if (!linked) {
    throw new Error("paper_market_data_account_not_found");
  }
  const linkedExchange = normalizeExchange(linked.exchange);
  if (linkedExchange === PAPER_EXCHANGE) {
    throw new Error("paper_market_data_account_invalid");
  }

  return {
    exchange: linkedExchange,
    exchangeAccountId: linked.id,
    credentials: decodeCredentials(linked)
  };
}

async function mapRowToActiveBot(bot: any): Promise<ActiveFuturesBot> {
  const executionCredentials = decodeCredentials(bot.exchangeAccount);
  const marketData = await resolveMarketDataForBot(bot);
  return {
    id: bot.id,
    userId: bot.userId,
    name: bot.name,
    symbol: bot.symbol,
    exchange: bot.exchange,
    exchangeAccountId: bot.exchangeAccountId,
    strategyKey: bot.futuresConfig.strategyKey,
    marginMode: bot.futuresConfig.marginMode,
    leverage: bot.futuresConfig.leverage,
    paramsJson: (bot.futuresConfig.paramsJson ?? {}) as Record<string, unknown>,
    tickMs: bot.futuresConfig?.tickMs ?? 1000,
    credentials: executionCredentials,
    marketData
  };
}

function canExecuteRow(bot: any): boolean {
  return Boolean(bot && bot.userId && bot.exchangeAccountId && bot.futuresConfig && bot.exchangeAccount);
}

export async function getBotStatus(botId: string): Promise<BotStatusValue | null> {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    select: { status: true }
  });
  if (!bot) return null;
  return bot.status as BotStatusValue;
}

export async function getBotRuntimeCircuitBreakerState(
  botId: string
): Promise<BotRuntimeCircuitBreakerState> {
  const runtime = await db.botRuntime.findUnique({
    where: { botId },
    select: {
      consecutiveErrors: true,
      errorWindowStartAt: true,
      lastErrorAt: true,
      lastErrorMessage: true
    }
  });

  return {
    consecutiveErrors: Number(runtime?.consecutiveErrors ?? 0),
    errorWindowStartAt: runtime?.errorWindowStartAt ?? null,
    lastErrorAt: runtime?.lastErrorAt ?? null,
    lastErrorMessage: runtime?.lastErrorMessage ?? null
  };
}

export async function loadBotForExecution(botId: string): Promise<ActiveFuturesBot | null> {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    include: {
      futuresConfig: {
        select: {
          strategyKey: true,
          marginMode: true,
          leverage: true,
          tickMs: true,
          paramsJson: true
        }
      },
      exchangeAccount: {
        select: {
          id: true,
          apiKeyEnc: true,
          apiSecretEnc: true,
          passphraseEnc: true
        }
      }
    }
  });

  if (!bot || !canExecuteRow(bot)) return null;
  try {
    return await mapRowToActiveBot(bot);
  } catch {
    return null;
  }
}

export async function loadActiveFuturesBots(): Promise<ActiveFuturesBot[]> {
  const bots = await db.bot.findMany({
    where: {
      status: "running",
      userId: { not: null },
      exchangeAccountId: { not: null },
      futuresConfig: { isNot: null }
    },
    include: {
      futuresConfig: {
        select: {
          strategyKey: true,
          marginMode: true,
          leverage: true,
          tickMs: true,
          paramsJson: true
        }
      },
      exchangeAccount: {
        select: {
          id: true,
          apiKeyEnc: true,
          apiSecretEnc: true,
          passphraseEnc: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const out: ActiveFuturesBot[] = [];
  for (const bot of (bots as any[]).filter(canExecuteRow)) {
    try {
      out.push(await mapRowToActiveBot(bot));
    } catch {
      // Skip bots with incomplete or invalid market-data mapping.
    }
  }
  return out;
}

export async function loadLatestPredictionStateForGate(params: {
  userId: string;
  exchange: string;
  exchangeAccountId: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
}): Promise<PredictionGateState | null> {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) return null;

  const exchangeVariants = Array.from(
    new Set([
      params.exchange,
      params.exchange.toLowerCase(),
      params.exchange.toUpperCase()
    ].map((entry) => entry.trim()).filter(Boolean))
  );

  const row = await db.predictionState.findFirst({
    where: {
      userId: params.userId,
      accountId: params.exchangeAccountId,
      symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      ...(exchangeVariants.length > 0 ? { exchange: { in: exchangeVariants } } : {})
    },
    orderBy: [{ tsUpdated: "desc" }],
    select: {
      id: true,
      exchange: true,
      accountId: true,
      userId: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      tags: true,
      featuresSnapshot: true,
      tsUpdated: true
    }
  });

  return mapPredictionStateRowToGateState(row);
}

function mapPredictionStateRowToGateState(row: any): PredictionGateState | null {
  if (!row) return null;
  const signalRaw = String(row.signal ?? "").trim().toLowerCase();
  const signal: PredictionGateState["signal"] =
    signalRaw === "up" || signalRaw === "down" ? signalRaw : "neutral";
  const marketTypeRaw = String(row.marketType ?? "").trim().toLowerCase();
  const marketType: PredictionGateState["marketType"] =
    marketTypeRaw === "spot" ? "spot" : "perp";
  const timeframeRaw = String(row.timeframe ?? "").trim();
  if (
    timeframeRaw !== "5m" &&
    timeframeRaw !== "15m" &&
    timeframeRaw !== "1h" &&
    timeframeRaw !== "4h" &&
    timeframeRaw !== "1d"
  ) {
    return null;
  }

  const snapshot = asRecord(row.featuresSnapshot);
  const entryPriceRaw = pickNumber(snapshot, [
    "suggestedEntryPrice",
    "entryPrice",
    "entry",
    "tracking.entryPrice",
    "levels.entryPrice"
  ]);
  const stopLossPriceRaw = pickNumber(snapshot, [
    "suggestedStopLoss",
    "stopLoss",
    "stopLossPrice",
    "slPrice",
    "sl",
    "tracking.stopLossPrice",
    "tracking.stopLoss",
    "levels.stopLossPrice",
    "levels.stopLoss"
  ]);
  const takeProfitPriceRaw = pickNumber(snapshot, [
    "suggestedTakeProfit",
    "takeProfit",
    "takeProfitPrice",
    "tpPrice",
    "tp",
    "tracking.takeProfitPrice",
    "tracking.takeProfit",
    "levels.takeProfitPrice",
    "levels.takeProfit"
  ]);
  const entryPrice = entryPriceRaw !== null && entryPriceRaw > 0 ? entryPriceRaw : null;
  const stopLossPrice = stopLossPriceRaw !== null && stopLossPriceRaw > 0 ? stopLossPriceRaw : null;
  const takeProfitPrice = takeProfitPriceRaw !== null && takeProfitPriceRaw > 0 ? takeProfitPriceRaw : null;

  return {
    id: row.id,
    exchange: String(row.exchange ?? ""),
    accountId: String(row.accountId ?? ""),
    userId: String(row.userId ?? ""),
    symbol: normalizeSymbol(String(row.symbol ?? "")),
    marketType,
    timeframe: timeframeRaw,
    signal,
    expectedMovePct: Number.isFinite(Number(row.expectedMovePct)) ? Number(row.expectedMovePct) : null,
    confidence: Number(row.confidence ?? 0),
    tags: normalizeStringArray(row.tags, 10),
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    tsUpdated: row.tsUpdated
  };
}

export async function loadPredictionStateByIdForGate(params: {
  userId: string;
  exchangeAccountId: string;
  stateId: string;
}): Promise<PredictionGateState | null> {
  const stateId = String(params.stateId ?? "").trim();
  if (!stateId) return null;
  const row = await db.predictionState.findFirst({
    where: {
      id: stateId,
      userId: params.userId,
      accountId: params.exchangeAccountId
    },
    select: {
      id: true,
      exchange: true,
      accountId: true,
      userId: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      tags: true,
      featuresSnapshot: true,
      tsUpdated: true
    }
  });
  return mapPredictionStateRowToGateState(row);
}

function mapBotTradeStateRow(row: any): BotTradeState {
  const signalRaw = String(row?.lastSignal ?? "").trim().toLowerCase();
  const openSideRaw = String(row?.openSide ?? "").trim().toLowerCase();
  return {
    botId: String(row?.botId ?? ""),
    symbol: normalizeSymbol(String(row?.symbol ?? "")),
    lastPredictionHash:
      typeof row?.lastPredictionHash === "string" && row.lastPredictionHash.trim().length > 0
        ? row.lastPredictionHash.trim()
        : null,
    lastSignal: signalRaw === "up" || signalRaw === "down" || signalRaw === "neutral" ? signalRaw : null,
    lastSignalTs: row?.lastSignalTs instanceof Date ? row.lastSignalTs : null,
    lastTradeTs: row?.lastTradeTs instanceof Date ? row.lastTradeTs : null,
    dailyTradeCount: Number(row?.dailyTradeCount ?? 0) || 0,
    dailyResetUtc: row?.dailyResetUtc instanceof Date ? row.dailyResetUtc : normalizeUtcDayStart(new Date()),
    openSide: openSideRaw === "long" || openSideRaw === "short" ? openSideRaw : null,
    openQty: Number.isFinite(Number(row?.openQty)) ? Number(row.openQty) : null,
    openEntryPrice: Number.isFinite(Number(row?.openEntryPrice)) ? Number(row.openEntryPrice) : null,
    openTs: row?.openTs instanceof Date ? row.openTs : null
  };
}

export async function loadBotTradeState(params: {
  botId: string;
  symbol: string;
  now?: Date;
}): Promise<BotTradeState> {
  const symbol = normalizeSymbol(params.symbol);
  const now = params.now ?? new Date();
  const dayStart = normalizeUtcDayStart(now);

  let row = await db.botTradeState.findUnique({
    where: {
      botId_symbol: {
        botId: params.botId,
        symbol
      }
    }
  });

  if (!row) {
    row = await db.botTradeState.create({
      data: {
        botId: params.botId,
        symbol,
        dailyResetUtc: dayStart
      }
    });
    return mapBotTradeStateRow(row);
  }

  const currentDayStart = normalizeUtcDayStart(row.dailyResetUtc instanceof Date ? row.dailyResetUtc : dayStart);
  if (currentDayStart.getTime() === dayStart.getTime()) {
    return mapBotTradeStateRow(row);
  }

  row = await db.botTradeState.update({
    where: {
      botId_symbol: {
        botId: params.botId,
        symbol
      }
    },
    data: {
      dailyTradeCount: 0,
      dailyResetUtc: dayStart
    }
  });

  return mapBotTradeStateRow(row);
}

export async function upsertBotTradeState(params: {
  botId: string;
  symbol: string;
  lastPredictionHash?: string | null;
  lastSignal?: "up" | "down" | "neutral" | null;
  lastSignalTs?: Date | null;
  lastTradeTs?: Date | null;
  dailyTradeCount?: number;
  dailyResetUtc?: Date;
  openSide?: "long" | "short" | null;
  openQty?: number | null;
  openEntryPrice?: number | null;
  openTs?: Date | null;
}) {
  const symbol = normalizeSymbol(params.symbol);
  const dayStart = normalizeUtcDayStart(params.dailyResetUtc ?? new Date());

  const updateData: any = {};
  const createData: any = {
    botId: params.botId,
    symbol,
    dailyResetUtc: dayStart
  };

  if ("lastPredictionHash" in params) {
    updateData.lastPredictionHash = params.lastPredictionHash ?? null;
    createData.lastPredictionHash = params.lastPredictionHash ?? null;
  }
  if ("lastSignal" in params) {
    updateData.lastSignal = params.lastSignal ?? null;
    createData.lastSignal = params.lastSignal ?? null;
  }
  if ("lastSignalTs" in params) {
    updateData.lastSignalTs = params.lastSignalTs ?? null;
    createData.lastSignalTs = params.lastSignalTs ?? null;
  }
  if ("lastTradeTs" in params) {
    updateData.lastTradeTs = params.lastTradeTs ?? null;
    createData.lastTradeTs = params.lastTradeTs ?? null;
  }
  if ("dailyTradeCount" in params) {
    updateData.dailyTradeCount = Math.max(0, Math.trunc(Number(params.dailyTradeCount ?? 0)));
    createData.dailyTradeCount = Math.max(0, Math.trunc(Number(params.dailyTradeCount ?? 0)));
  }
  if ("dailyResetUtc" in params) {
    updateData.dailyResetUtc = dayStart;
    createData.dailyResetUtc = dayStart;
  }
  if ("openSide" in params) {
    updateData.openSide = params.openSide ?? null;
    createData.openSide = params.openSide ?? null;
  }
  if ("openQty" in params) {
    updateData.openQty = params.openQty ?? null;
    createData.openQty = params.openQty ?? null;
  }
  if ("openEntryPrice" in params) {
    updateData.openEntryPrice = params.openEntryPrice ?? null;
    createData.openEntryPrice = params.openEntryPrice ?? null;
  }
  if ("openTs" in params) {
    updateData.openTs = params.openTs ?? null;
    createData.openTs = params.openTs ?? null;
  }

  await db.botTradeState.upsert({
    where: {
      botId_symbol: {
        botId: params.botId,
        symbol
      }
    },
    update: updateData,
    create: createData
  });
}

export async function createBotTradeHistoryEntry(params: {
  botId: string;
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  marketType?: string;
  side: "long" | "short";
  entryTs: Date;
  entryPrice: number;
  entryQty: number;
  entryNotionalUsd: number;
  tpPrice?: number | null;
  slPrice?: number | null;
  entryOrderId?: string | null;
  predictionStateId?: string | null;
  predictionHash?: string | null;
  predictionSignal?: "up" | "down" | "neutral" | null;
  predictionConfidence?: number | null;
  predictionTags?: string[] | null;
}) {
  const symbol = normalizeSymbol(params.symbol);
  return db.botTradeHistory.create({
    data: {
      botId: params.botId,
      userId: params.userId,
      exchangeAccountId: params.exchangeAccountId,
      symbol,
      marketType: params.marketType ?? "perp",
      side: params.side,
      status: "open",
      entryTs: params.entryTs,
      entryPrice: params.entryPrice,
      entryQty: params.entryQty,
      entryNotionalUsd: params.entryNotionalUsd,
      tpPrice: params.tpPrice ?? null,
      slPrice: params.slPrice ?? null,
      entryOrderId: params.entryOrderId ?? null,
      predictionStateId: params.predictionStateId ?? null,
      predictionHash: params.predictionHash ?? null,
      predictionSignal: params.predictionSignal ?? null,
      predictionConfidence: params.predictionConfidence ?? null,
      predictionTagsJson: Array.isArray(params.predictionTags) ? params.predictionTags.slice(0, 20) : null
    }
  });
}

export async function countOpenBotTradeHistoryEntries(params: {
  botId: string;
  symbol?: string;
}): Promise<number> {
  const where: any = {
    botId: params.botId,
    status: "open"
  };
  if (params.symbol) {
    where.symbol = normalizeSymbol(params.symbol);
  }
  const count = await db.botTradeHistory.count({ where });
  return Number(count ?? 0) || 0;
}

export async function loadLatestOpenBotTradeHistoryEntry(params: {
  botId: string;
  symbol: string;
}): Promise<OpenBotTradeHistoryEntry | null> {
  const symbol = normalizeSymbol(params.symbol);
  const row = await db.botTradeHistory.findFirst({
    where: {
      botId: params.botId,
      symbol,
      status: "open"
    },
    orderBy: [{ entryTs: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      side: true,
      tpPrice: true,
      slPrice: true
    }
  });
  if (!row) return null;

  const sideRaw = String(row.side ?? "").trim().toLowerCase();
  const side: "long" | "short" = sideRaw === "short" ? "short" : "long";
  const tpPrice = Number.isFinite(Number(row.tpPrice)) ? Number(row.tpPrice) : null;
  const slPrice = Number.isFinite(Number(row.slPrice)) ? Number(row.slPrice) : null;

  return {
    id: String(row.id),
    side,
    tpPrice,
    slPrice
  };
}

export async function closeOpenBotTradeHistoryEntries(params: {
  botId: string;
  symbol: string;
  exitTs: Date;
  exitPrice?: number | null;
  outcome: BotTradeHistoryCloseOutcome;
  exitReason?: string | null;
  exitOrderId?: string | null;
}): Promise<{ closedCount: number; realizedPnlUsd: number | null }> {
  const symbol = normalizeSymbol(params.symbol);
  const openTrades = await db.botTradeHistory.findMany({
    where: {
      botId: params.botId,
      symbol,
      status: "open"
    },
    orderBy: [{ entryTs: "asc" }, { createdAt: "asc" }]
  });

  if (!Array.isArray(openTrades) || openTrades.length === 0) {
    return {
      closedCount: 0,
      realizedPnlUsd: null
    };
  }

  const exitPrice = Number.isFinite(Number(params.exitPrice)) ? Number(params.exitPrice) : null;
  let realizedPnlUsdTotal = 0;
  let hasRealized = false;

  await db.$transaction(
    openTrades.map((openTrade: any) => {
      const qty = Math.abs(Number(openTrade.entryQty ?? 0));
      const entryPrice = Number(openTrade.entryPrice ?? 0);
      const entryNotionalUsd = Number(openTrade.entryNotionalUsd ?? 0);
      const side = String(openTrade.side ?? "").trim().toLowerCase();

      const exitNotionalUsd =
        exitPrice !== null && Number.isFinite(qty) && qty > 0
          ? Number((exitPrice * qty).toFixed(8))
          : null;

      const realizedPnlUsd =
        exitPrice !== null &&
        Number.isFinite(entryPrice) &&
        entryPrice > 0 &&
        Number.isFinite(qty) &&
        qty > 0
          ? Number((
              side === "long"
                ? (exitPrice - entryPrice) * qty
                : (entryPrice - exitPrice) * qty
            ).toFixed(4))
          : null;

      if (realizedPnlUsd !== null) {
        realizedPnlUsdTotal += realizedPnlUsd;
        hasRealized = true;
      }

      const realizedPnlPct =
        realizedPnlUsd !== null && Number.isFinite(entryNotionalUsd) && entryNotionalUsd > 0
          ? Number(((realizedPnlUsd / entryNotionalUsd) * 100).toFixed(6))
          : null;

      return db.botTradeHistory.update({
        where: { id: openTrade.id },
        data: {
          status: "closed",
          exitTs: params.exitTs,
          exitPrice,
          exitNotionalUsd,
          realizedPnlUsd,
          realizedPnlPct,
          outcome: params.outcome,
          exitReason: params.exitReason ?? null,
          exitOrderId: params.exitOrderId ?? null
        }
      });
    })
  );

  return {
    closedCount: openTrades.length,
    realizedPnlUsd: hasRealized ? Number(realizedPnlUsdTotal.toFixed(4)) : null
  };
}

export async function closeLatestOpenBotTradeHistory(params: {
  botId: string;
  symbol: string;
  exitTs: Date;
  exitPrice?: number | null;
  exitNotionalUsd?: number | null;
  realizedPnlUsd?: number | null;
  realizedPnlPct?: number | null;
  outcome: BotTradeHistoryCloseOutcome;
  exitReason?: string | null;
  exitOrderId?: string | null;
}) {
  const symbol = normalizeSymbol(params.symbol);
  const openTrade = await db.botTradeHistory.findFirst({
    where: {
      botId: params.botId,
      symbol,
      status: "open"
    },
    orderBy: [{ entryTs: "desc" }, { createdAt: "desc" }]
  });

  if (!openTrade) return null;

  const exitPrice = Number.isFinite(Number(params.exitPrice)) ? Number(params.exitPrice) : null;
  const exitNotionalUsd =
    Number.isFinite(Number(params.exitNotionalUsd))
      ? Number(params.exitNotionalUsd)
      : exitPrice !== null && Number.isFinite(Number(openTrade.entryQty))
        ? Number((exitPrice * Number(openTrade.entryQty)).toFixed(8))
        : null;
  const realizedPnlUsd =
    Number.isFinite(Number(params.realizedPnlUsd))
      ? Number(params.realizedPnlUsd)
      : null;
  const realizedPnlPct =
    Number.isFinite(Number(params.realizedPnlPct))
      ? Number(params.realizedPnlPct)
      : (() => {
          if (realizedPnlUsd === null) return null;
          const base = Number(openTrade.entryNotionalUsd);
          if (!Number.isFinite(base) || base <= 0) return null;
          return Number(((realizedPnlUsd / base) * 100).toFixed(6));
        })();

  return db.botTradeHistory.update({
    where: { id: openTrade.id },
    data: {
      status: "closed",
      exitTs: params.exitTs,
      exitPrice,
      exitNotionalUsd,
      realizedPnlUsd,
      realizedPnlPct,
      outcome: params.outcome,
      exitReason: params.exitReason ?? null,
      exitOrderId: params.exitOrderId ?? null
    }
  });
}

export async function getBotDailyTradeCount(params: {
  botId: string;
  now?: Date;
}): Promise<number> {
  const dayStart = normalizeUtcDayStart(params.now ?? new Date());
  const result = await db.botTradeState.aggregate({
    where: {
      botId: params.botId,
      dailyResetUtc: dayStart
    },
    _sum: {
      dailyTradeCount: true
    }
  });
  return Number(result?._sum?.dailyTradeCount ?? 0) || 0;
}

export async function upsertBotRuntime(params: {
  botId: string;
  status: BotStatusValue;
  reason?: string | null;
  workerId?: string | null;
  lastHeartbeatAt?: Date | null;
  lastTickAt?: Date | null;
  stateJson?: Record<string, unknown> | null;
  lastError?: string | null;
  consecutiveErrors?: number;
  errorWindowStartAt?: Date | null;
  lastErrorAt?: Date | null;
  lastErrorMessage?: string | null;
}) {
  const updateData: any = {
    status: params.status,
    updatedAt: new Date()
  };

  const createData: any = {
    botId: params.botId,
    status: params.status
  };

  if ("reason" in params) {
    updateData.reason = params.reason ?? null;
    createData.reason = params.reason ?? null;
  }
  if ("workerId" in params) {
    updateData.workerId = params.workerId ?? null;
    createData.workerId = params.workerId ?? null;
  }
  if ("lastHeartbeatAt" in params) {
    updateData.lastHeartbeatAt = params.lastHeartbeatAt ?? null;
    createData.lastHeartbeatAt = params.lastHeartbeatAt ?? null;
  }
  if ("lastTickAt" in params) {
    updateData.lastTickAt = params.lastTickAt ?? null;
    createData.lastTickAt = params.lastTickAt ?? null;
  }
  if ("stateJson" in params) {
    updateData.stateJson = params.stateJson ?? null;
    createData.stateJson = params.stateJson ?? null;
  }
  if ("lastError" in params) {
    updateData.lastError = params.lastError ?? null;
    createData.lastError = params.lastError ?? null;
  }
  if ("consecutiveErrors" in params) {
    updateData.consecutiveErrors = params.consecutiveErrors ?? 0;
    createData.consecutiveErrors = params.consecutiveErrors ?? 0;
  }
  if ("errorWindowStartAt" in params) {
    updateData.errorWindowStartAt = params.errorWindowStartAt ?? null;
    createData.errorWindowStartAt = params.errorWindowStartAt ?? null;
  }
  if ("lastErrorAt" in params) {
    updateData.lastErrorAt = params.lastErrorAt ?? null;
    createData.lastErrorAt = params.lastErrorAt ?? null;
  }
  if ("lastErrorMessage" in params) {
    updateData.lastErrorMessage = params.lastErrorMessage ?? null;
    createData.lastErrorMessage = params.lastErrorMessage ?? null;
  }

  try {
    await db.botRuntime.upsert({
      where: { botId: params.botId },
      update: updateData,
      create: createData
    });
  } catch (error) {
    const code = (error as any)?.code;
    const constraint = String((error as any)?.meta?.constraint ?? "");
    if (code === "P2003" && constraint === "BotRuntime_botId_fkey") {
      // Ignore stale queue events for bots that were deleted meanwhile.
      return;
    }
    throw error;
  }
}

export async function writeBotTick(params: {
  botId: string;
  status: "running" | "error";
  reason: string | null;
  intent: TradeIntent;
  workerId?: string | null;
}) {
  const now = new Date();
  await upsertBotRuntime({
    botId: params.botId,
    status: params.status,
    reason: params.reason,
    workerId: params.workerId ?? null,
    lastHeartbeatAt: now,
    lastTickAt: now,
    stateJson: {
      intentType: params.intent.type
    },
    ...(params.status === "error" ? { lastError: params.reason } : {})
  });
}

export async function writeRiskEvent(params: {
  botId: string;
  type: RiskEventType;
  message?: string | null;
  meta?: Record<string, unknown> | null;
}) {
  try {
    await db.riskEvent.create({
      data: {
        botId: params.botId,
        type: params.type,
        message: params.message ?? null,
        meta: params.meta ?? null
      }
    });
  } catch (error) {
    const code = (error as any)?.code;
    const constraint = String((error as any)?.meta?.constraint ?? "");
    if (code === "P2003" && constraint === "RiskEvent_botId_fkey") {
      // Ignore stale queue events for bots that were deleted meanwhile.
      return;
    }
    throw error;
  }
}

export async function markExchangeAccountUsed(exchangeAccountId: string) {
  await db.exchangeAccount.update({
    where: { id: exchangeAccountId },
    data: { lastUsedAt: new Date() }
  });
}

export async function markBotAsError(botId: string, reason: string) {
  try {
    await db.bot.update({
      where: { id: botId },
      data: {
        status: "error",
        lastError: reason
      }
    });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "P2025") {
      // Bot was deleted after job dispatch.
      return;
    }
    throw error;
  }
}

export async function markRunnerHeartbeat(params: {
  botsRunning: number;
  botsErrored: number;
}) {
  await db.runnerStatus.upsert({
    where: { id: "main" },
    update: {
      lastTickAt: new Date(),
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: process.env.VERSION ?? null
    },
    create: {
      id: "main",
      lastTickAt: new Date(),
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: process.env.VERSION ?? null
    }
  });
}

export async function getRunnerBotCounters(): Promise<{ botsRunning: number; botsErrored: number }> {
  const [botsRunning, botsErrored] = await Promise.all([
    db.bot.count({ where: { status: "running" } }),
    db.bot.count({ where: { status: "error" } })
  ]);

  return { botsRunning, botsErrored };
}
