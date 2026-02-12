import crypto from "node:crypto";
import type { TradeIntent } from "@mm/futures-core";
import { isGlobalTradingEnabled } from "@mm/futures-engine";
import { BitgetFuturesAdapter } from "@mm/futures-exchange";
import type { ActiveFuturesBot, BotTradeState, PredictionGateState } from "./db.js";
import {
  getBotDailyTradeCount,
  loadBotTradeState,
  loadLatestPredictionStateForGate,
  upsertBotTradeState,
  writeRiskEvent
} from "./db.js";
import { log } from "./logger.js";

export type PredictionCopierTimeframe = "5m" | "15m" | "1h" | "4h";
export type PredictionCopierSignal = "up" | "down" | "neutral";
export type PredictionCopierSide = "long" | "short";

export type PredictionCopierConfig = {
  botType: "prediction_copier";
  exchange: "bitget";
  accountId: string;
  marketType: "perp";
  symbols: string[];
  timeframe: PredictionCopierTimeframe;
  minConfidence: number;
  maxPredictionAgeSec: number;
  mode: "enter_exit";
  positionSizing: {
    type: "fixed_usd" | "equity_pct" | "risk_pct";
    value: number;
  };
  risk: {
    maxOpenPositions: number;
    maxDailyTrades: number;
    cooldownSecAfterTrade: number;
    maxNotionalPerSymbolUsd: number;
    maxTotalNotionalUsd: number;
    maxLeverage: number;
    stopLossPct: number | null;
    takeProfitPct: number | null;
    timeStopMin: number | null;
  };
  filters: {
    blockTags: string[];
    requireTags: string[] | null;
    allowSignals: PredictionCopierSignal[];
    minExpectedMovePct: number | null;
  };
  execution: {
    orderType: "market" | "limit";
    limitOffsetBps: number;
    reduceOnlyOnExit: boolean;
  };
};

export type PredictionCopierDecision =
  | { action: "skip"; reason: string }
  | { action: "enter"; reason: string; side: PredictionCopierSide }
  | { action: "exit"; reason: string; side: PredictionCopierSide };

export type PredictionCopierEvalInput = {
  config: PredictionCopierConfig;
  now: Date;
  prediction: PredictionGateState | null;
  predictionHash: string | null;
  state: BotTradeState;
  openPosition: { side: PredictionCopierSide; size: number; openTs: Date | null } | null;
  openPositionsCount: number;
  totalNotionalUsd: number;
  symbolNotionalUsd: number;
  candidateNotionalUsd: number | null;
  dailyTradeCount: number;
};

export type PredictionCopierTickResult = {
  outcome: "ok" | "blocked";
  intent: TradeIntent;
  reason: string;
  gate: {
    applied: boolean;
    allow: boolean;
    reason: string;
    sizeMultiplier: number;
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  };
};

type AnyObject = Record<string, unknown>;

type NormalizedPosition = {
  symbol: string;
  side: PredictionCopierSide;
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
};

const adapterCache = new Map<string, BitgetFuturesAdapter>();

function normalizeSymbol(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStringArray(value: unknown, limit = 50): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeSignalList(value: unknown): PredictionCopierSignal[] {
  const out: PredictionCopierSignal[] = [];
  for (const item of normalizeStringArray(value, 3)) {
    if (item === "up" || item === "down" || item === "neutral") {
      out.push(item);
    }
  }
  return out;
}

function normalizeTimeframe(value: unknown): PredictionCopierTimeframe {
  const normalized = String(value ?? "").trim();
  if (normalized === "5m" || normalized === "15m" || normalized === "1h" || normalized === "4h") {
    return normalized;
  }
  return "15m";
}

function toUtcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

function getRootConfig(paramsJson: Record<string, unknown>): AnyObject {
  const nested = paramsJson.predictionCopier;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as AnyObject;
  }
  return paramsJson;
}

export function readPredictionCopierConfig(bot: ActiveFuturesBot): PredictionCopierConfig {
  const root = getRootConfig(bot.paramsJson ?? {});
  const positionSizingRaw =
    root.positionSizing && typeof root.positionSizing === "object" && !Array.isArray(root.positionSizing)
      ? (root.positionSizing as AnyObject)
      : {};
  const riskRaw = root.risk && typeof root.risk === "object" && !Array.isArray(root.risk)
    ? (root.risk as AnyObject)
    : {};
  const filtersRaw = root.filters && typeof root.filters === "object" && !Array.isArray(root.filters)
    ? (root.filters as AnyObject)
    : {};
  const executionRaw =
    root.execution && typeof root.execution === "object" && !Array.isArray(root.execution)
      ? (root.execution as AnyObject)
      : {};

  const symbols = normalizeStringArray(root.symbols, 100)
    .map((item) => normalizeSymbol(item))
    .filter((item) => item.length > 0);

  const sizingTypeRaw = String(positionSizingRaw.type ?? "fixed_usd").trim().toLowerCase();
  const sizingType: PredictionCopierConfig["positionSizing"]["type"] =
    sizingTypeRaw === "equity_pct" || sizingTypeRaw === "risk_pct" ? sizingTypeRaw : "fixed_usd";

  const orderTypeRaw = String(executionRaw.orderType ?? "market").trim().toLowerCase();
  const orderType: PredictionCopierConfig["execution"]["orderType"] =
    orderTypeRaw === "limit" ? "limit" : "market";

  const allowSignals = normalizeSignalList(filtersRaw.allowSignals);

  const config: PredictionCopierConfig = {
    botType: "prediction_copier",
    exchange: "bitget",
    accountId: bot.exchangeAccountId,
    marketType: "perp",
    symbols: symbols.length > 0 ? symbols : [normalizeSymbol(bot.symbol)],
    timeframe: normalizeTimeframe(root.timeframe),
    minConfidence: clamp(toNumber(root.minConfidence) ?? 70, 0, 100),
    maxPredictionAgeSec: Math.max(30, Math.trunc(toNumber(root.maxPredictionAgeSec) ?? 600)),
    mode: "enter_exit",
    positionSizing: {
      type: sizingType,
      value: Math.max(0.01, toNumber(positionSizingRaw.value) ?? 100)
    },
    risk: {
      maxOpenPositions: Math.max(1, Math.trunc(toNumber(riskRaw.maxOpenPositions) ?? 3)),
      maxDailyTrades: Math.max(1, Math.trunc(toNumber(riskRaw.maxDailyTrades) ?? 20)),
      cooldownSecAfterTrade: Math.max(0, Math.trunc(toNumber(riskRaw.cooldownSecAfterTrade) ?? 120)),
      maxNotionalPerSymbolUsd: Math.max(1, toNumber(riskRaw.maxNotionalPerSymbolUsd) ?? 500),
      maxTotalNotionalUsd: Math.max(1, toNumber(riskRaw.maxTotalNotionalUsd) ?? 1500),
      maxLeverage: Math.max(1, Math.trunc(toNumber(riskRaw.maxLeverage) ?? 3)),
      stopLossPct: toNumber(riskRaw.stopLossPct),
      takeProfitPct: toNumber(riskRaw.takeProfitPct),
      timeStopMin: toNumber(riskRaw.timeStopMin)
    },
    filters: {
      blockTags: normalizeStringArray(filtersRaw.blockTags, 20).length > 0
        ? normalizeStringArray(filtersRaw.blockTags, 20)
        : ["news_risk", "data_gap", "low_liquidity"],
      requireTags: normalizeStringArray(filtersRaw.requireTags, 20).length > 0
        ? normalizeStringArray(filtersRaw.requireTags, 20)
        : null,
      allowSignals: allowSignals.length > 0 ? allowSignals : ["up", "down"],
      minExpectedMovePct: toNumber(filtersRaw.minExpectedMovePct)
    },
    execution: {
      orderType,
      limitOffsetBps: clamp(toNumber(executionRaw.limitOffsetBps) ?? 2, 0, 100),
      reduceOnlyOnExit: toBoolean(executionRaw.reduceOnlyOnExit, true)
    }
  };

  if (config.risk.maxTotalNotionalUsd < config.risk.maxNotionalPerSymbolUsd) {
    config.risk.maxTotalNotionalUsd = config.risk.maxNotionalPerSymbolUsd;
  }

  return config;
}

function normalizePredictionSignal(value: string | null | undefined): PredictionCopierSignal {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "up" || normalized === "down") return normalized;
  return "neutral";
}

function confidenceToPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value <= 1 ? value * 100 : value, 0, 100);
}

export function buildPredictionHash(prediction: PredictionGateState): string {
  const signal = normalizePredictionSignal(prediction.signal);
  const confidence = Math.round(confidenceToPct(prediction.confidence));
  const expectedMove = prediction.expectedMovePct === null ? "null" : Number(prediction.expectedMovePct).toFixed(4);
  const tags = normalizeStringArray(prediction.tags, 20).sort().join(",");
  const ts = prediction.tsUpdated.toISOString();
  const seed = `${signal}|${confidence}|${expectedMove}|${tags}|${ts}`;
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function evaluateTagFilters(config: PredictionCopierConfig, prediction: PredictionGateState): string | null {
  const tags = normalizeStringArray(prediction.tags, 20);
  const blocked = config.filters.blockTags.find((tag) => tags.includes(tag));
  if (blocked) return `blocked_tag:${blocked}`;

  if (config.filters.requireTags && config.filters.requireTags.length > 0) {
    const missing = config.filters.requireTags.filter((tag) => !tags.includes(tag));
    if (missing.length > 0) return `missing_required_tags:${missing.join(",")}`;
  }

  if (config.filters.minExpectedMovePct !== null) {
    const expected = Math.abs(Number(prediction.expectedMovePct ?? 0));
    if (!Number.isFinite(expected) || expected < config.filters.minExpectedMovePct) {
      return "expected_move_below_min";
    }
  }

  return null;
}

export function evaluatePredictionCopierDecision(input: PredictionCopierEvalInput): PredictionCopierDecision {
  const {
    config,
    now,
    prediction,
    predictionHash,
    state,
    openPosition,
    openPositionsCount,
    totalNotionalUsd,
    symbolNotionalUsd,
    candidateNotionalUsd,
    dailyTradeCount
  } = input;

  if (!prediction) return { action: "skip", reason: "missing_prediction_state" };

  const predictionAgeMs = now.getTime() - prediction.tsUpdated.getTime();
  if (!Number.isFinite(predictionAgeMs) || predictionAgeMs > config.maxPredictionAgeSec * 1000) {
    return { action: "skip", reason: "stale_prediction_state" };
  }

  const confidence = confidenceToPct(prediction.confidence);
  const signal = normalizePredictionSignal(prediction.signal);

  const tagError = evaluateTagFilters(config, prediction);
  if (tagError) {
    return openPosition ? { action: "exit", reason: tagError, side: openPosition.side } : { action: "skip", reason: tagError };
  }

  if (openPosition && config.risk.timeStopMin !== null && state.openTs instanceof Date) {
    const maxAgeMs = Math.max(1, config.risk.timeStopMin) * 60_000;
    if (now.getTime() - state.openTs.getTime() >= maxAgeMs) {
      return { action: "exit", reason: "time_stop", side: openPosition.side };
    }
  }

  if (openPosition) {
    if (confidence < config.minConfidence) {
      return { action: "exit", reason: "confidence_below_min", side: openPosition.side };
    }
    if (signal === "neutral") {
      return { action: "exit", reason: "signal_neutral", side: openPosition.side };
    }
    if (openPosition.side === "long" && signal === "down") {
      return { action: "exit", reason: "signal_flip", side: "long" };
    }
    if (openPosition.side === "short" && signal === "up") {
      return { action: "exit", reason: "signal_flip", side: "short" };
    }
    return { action: "skip", reason: "position_aligned" };
  }

  if (confidence < config.minConfidence) return { action: "skip", reason: "confidence_below_min" };
  if (signal === "neutral") return { action: "skip", reason: "neutral_signal" };
  if (!config.filters.allowSignals.includes(signal)) return { action: "skip", reason: "signal_not_allowed" };

  if (predictionHash && state.lastPredictionHash && predictionHash === state.lastPredictionHash) {
    return { action: "skip", reason: "duplicate_prediction_hash" };
  }

  if (state.lastTradeTs instanceof Date && config.risk.cooldownSecAfterTrade > 0) {
    const cooldownMs = config.risk.cooldownSecAfterTrade * 1000;
    if (now.getTime() - state.lastTradeTs.getTime() < cooldownMs) {
      return { action: "skip", reason: "cooldown_active" };
    }
  }

  if (dailyTradeCount >= config.risk.maxDailyTrades) {
    return { action: "skip", reason: "daily_trade_cap_reached" };
  }

  if (openPositionsCount >= config.risk.maxOpenPositions) {
    return { action: "skip", reason: "max_open_positions_reached" };
  }

  if (candidateNotionalUsd === null || candidateNotionalUsd <= 0) {
    return { action: "skip", reason: "sizing_unavailable" };
  }

  if (symbolNotionalUsd + candidateNotionalUsd > config.risk.maxNotionalPerSymbolUsd) {
    return { action: "skip", reason: "symbol_notional_cap_reached" };
  }

  if (totalNotionalUsd + candidateNotionalUsd > config.risk.maxTotalNotionalUsd) {
    return { action: "skip", reason: "total_notional_cap_reached" };
  }

  return {
    action: "enter",
    reason: "entry_allowed",
    side: signal === "up" ? "long" : "short"
  };
}

function parseTickerPrice(payload: unknown): number | null {
  const row = Array.isArray(payload) ? payload[0] ?? null : payload;
  if (!row || typeof row !== "object") return null;
  const record = row as AnyObject;
  const candidates = [record.markPrice, record.lastPr, record.last, record.price, record.close, record.indexPrice];
  for (const candidate of candidates) {
    const parsed = toNumber(candidate);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function computeSizingNotionalUsd(config: PredictionCopierConfig, accountEquity: number): number {
  if (config.positionSizing.type === "fixed_usd") {
    return config.positionSizing.value;
  }

  const equity = Math.max(0, Number(accountEquity) || 0);
  const pct = Math.max(0, config.positionSizing.value) / 100;

  if (config.positionSizing.type === "equity_pct") {
    return equity * pct;
  }

  const riskUsd = equity * pct;
  if (config.risk.stopLossPct && config.risk.stopLossPct > 0) {
    return riskUsd / (config.risk.stopLossPct / 100);
  }
  return riskUsd;
}

function toCanonicalPositionSide(raw: string | null | undefined): PredictionCopierSide {
  return String(raw ?? "").toLowerCase().includes("long") ? "long" : "short";
}

function summarizePositions(positions: Array<{ symbol: string; side: string; size: number; markPrice?: number; entryPrice?: number }>) {
  const bySymbol = new Map<string, number>();
  let totalNotionalUsd = 0;

  for (const row of positions) {
    const symbol = normalizeSymbol(row.symbol);
    const size = Math.abs(Number(row.size ?? 0));
    if (!symbol || !Number.isFinite(size) || size <= 0) continue;
    const px = Number(row.markPrice ?? row.entryPrice ?? 0);
    const notional = Number.isFinite(px) && px > 0 ? size * px : 0;
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + notional);
    totalNotionalUsd += notional;
  }

  return {
    openPositionsCount: bySymbol.size,
    totalNotionalUsd,
    bySymbol
  };
}

function computeTpSlPrices(params: {
  side: PredictionCopierSide;
  referencePrice: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
}): { stopLossPrice?: number; takeProfitPrice?: number } {
  const { side, referencePrice, stopLossPct, takeProfitPct } = params;
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return {};

  const out: { stopLossPrice?: number; takeProfitPrice?: number } = {};

  if (stopLossPct !== null && stopLossPct > 0) {
    const ratio = stopLossPct / 100;
    out.stopLossPrice = side === "long"
      ? Number((referencePrice * (1 - ratio)).toFixed(6))
      : Number((referencePrice * (1 + ratio)).toFixed(6));
  }

  if (takeProfitPct !== null && takeProfitPct > 0) {
    const ratio = takeProfitPct / 100;
    out.takeProfitPrice = side === "long"
      ? Number((referencePrice * (1 + ratio)).toFixed(6))
      : Number((referencePrice * (1 - ratio)).toFixed(6));
  }

  return out;
}

function buildLimitEntryPrice(side: PredictionCopierSide, markPrice: number, offsetBps: number): number {
  const ratio = Math.max(0, offsetBps) / 10_000;
  const raw = side === "long"
    ? markPrice * (1 + ratio)
    : markPrice * (1 - ratio);
  return Number(raw.toFixed(6));
}

function getOrCreateAdapter(bot: ActiveFuturesBot): BitgetFuturesAdapter {
  const cached = adapterCache.get(bot.id);
  if (cached) return cached;

  const adapter = new BitgetFuturesAdapter({
    apiKey: bot.credentials.apiKey,
    apiSecret: bot.credentials.apiSecret,
    apiPassphrase: bot.credentials.passphrase ?? undefined,
    productType: (process.env.BITGET_PRODUCT_TYPE as any) ?? "USDT-FUTURES",
    marginCoin: process.env.BITGET_MARGIN_COIN ?? "USDT"
  });
  adapterCache.set(bot.id, adapter);
  return adapter;
}

async function syncOpenPositionInState(botId: string, symbol: string, state: BotTradeState, openPosition: NormalizedPosition | null) {
  const now = new Date();
  await upsertBotTradeState({
    botId,
    symbol,
    dailyResetUtc: state.dailyResetUtc,
    dailyTradeCount: state.dailyTradeCount,
    openSide: openPosition ? openPosition.side : null,
    openQty: openPosition ? openPosition.size : null,
    openEntryPrice: openPosition ? openPosition.entryPrice : null,
    openTs: openPosition ? state.openTs ?? now : null
  });
}

export async function runPredictionCopierTick(
  bot: ActiveFuturesBot,
  workerId?: string
): Promise<PredictionCopierTickResult> {
  const symbol = normalizeSymbol(bot.symbol);
  const now = new Date();
  const config = readPredictionCopierConfig(bot);

  if (bot.exchange.toLowerCase() !== "bitget" || config.exchange !== "bitget") {
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_copier_exchange_not_supported",
      gate: {
        applied: true,
        allow: false,
        reason: "prediction_copier_exchange_not_supported",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  if (!config.symbols.includes(symbol)) {
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_copier_symbol_not_enabled",
      gate: {
        applied: true,
        allow: false,
        reason: "prediction_copier_symbol_not_enabled",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  const adapter = getOrCreateAdapter(bot);
  await adapter.contractCache.refresh(false);

  const [prediction, accountState, positions, tradeState] = await Promise.all([
    loadLatestPredictionStateForGate({
      userId: bot.userId,
      exchange: bot.exchange,
      exchangeAccountId: bot.exchangeAccountId,
      symbol,
      marketType: "perp",
      timeframe: config.timeframe
    }),
    adapter.getAccountState(),
    adapter.getPositions(),
    loadBotTradeState({ botId: bot.id, symbol, now })
  ]);

  const predictionHash = prediction ? buildPredictionHash(prediction) : null;

  const normalizedPositions: NormalizedPosition[] = positions.map((row) => ({
    symbol: normalizeSymbol(row.symbol),
    side: toCanonicalPositionSide(row.side),
    size: Math.abs(Number(row.size ?? 0)),
    entryPrice: toNumber(row.entryPrice),
    markPrice: toNumber(row.markPrice)
  })).filter((row) => row.symbol.length > 0 && row.size > 0);

  const positionSummary = summarizePositions(
    normalizedPositions.map((row) => ({
      symbol: row.symbol,
      side: row.side,
      size: row.size,
      markPrice: row.markPrice ?? undefined,
      entryPrice: row.entryPrice ?? undefined
    }))
  );

  const symbolPositions = normalizedPositions
    .filter((row) => row.symbol === symbol)
    .sort((a, b) => b.size - a.size);
  const openPosition = symbolPositions[0] ?? null;

  let markPrice = openPosition?.markPrice ?? openPosition?.entryPrice ?? null;
  if (markPrice === null || markPrice <= 0) {
    const exchangeSymbol = await adapter.toExchangeSymbol(symbol);
    const ticker = await adapter.marketApi.getTicker(exchangeSymbol, adapter.productType);
    markPrice = parseTickerPrice(ticker);
  }

  const desiredNotionalUsd = computeSizingNotionalUsd(config, Number(accountState.equity ?? 0));
  const candidateNotionalUsd = Number.isFinite(desiredNotionalUsd) && desiredNotionalUsd > 0
    ? desiredNotionalUsd
    : null;

  const dailyTradeCount = await getBotDailyTradeCount({ botId: bot.id, now });

  const decision = evaluatePredictionCopierDecision({
    config,
    now,
    prediction,
    predictionHash,
    state: tradeState,
    openPosition: openPosition
      ? {
          side: openPosition.side,
          size: openPosition.size,
          openTs: tradeState.openTs
        }
      : null,
    openPositionsCount: positionSummary.openPositionsCount,
    totalNotionalUsd: positionSummary.totalNotionalUsd,
    symbolNotionalUsd: positionSummary.bySymbol.get(symbol) ?? 0,
    candidateNotionalUsd,
    dailyTradeCount
  });

  await writeRiskEvent({
    botId: bot.id,
    type: "PREDICTION_COPIER_DECISION",
    message: decision.reason,
    meta: {
      workerId: workerId ?? null,
      symbol,
      timeframe: config.timeframe,
      action: decision.action,
      signal: prediction?.signal ?? null,
      confidence: prediction ? Number(prediction.confidence) : null,
      tags: prediction?.tags ?? [],
      predictionUpdatedAt: prediction?.tsUpdated?.toISOString?.() ?? null,
      predictionHash,
      dailyTradeCount,
      openPositionsCount: positionSummary.openPositionsCount,
      totalNotionalUsd: Number(positionSummary.totalNotionalUsd.toFixed(4))
    }
  });

  if (decision.action === "skip") {
    await syncOpenPositionInState(bot.id, symbol, tradeState, openPosition);
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: `prediction_copier_skip:${decision.reason}`,
      gate: {
        applied: true,
        allow: false,
        reason: decision.reason,
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  if (!isGlobalTradingEnabled()) {
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_copier_kill_switch",
      gate: {
        applied: true,
        allow: false,
        reason: "kill_switch",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  if (decision.action === "exit") {
    if (!openPosition || openPosition.size <= 0) {
      return {
        outcome: "blocked",
        intent: { type: "none" },
        reason: "prediction_copier_exit_no_position",
        gate: {
          applied: true,
          allow: false,
          reason: "exit_no_position",
          sizeMultiplier: 1,
          timeframe: config.timeframe
        }
      };
    }

    const orderSide = openPosition.side === "long" ? "sell" : "buy";
    const placed = await adapter.placeOrder({
      symbol,
      side: orderSide,
      type: "market",
      qty: openPosition.size,
      reduceOnly: config.execution.reduceOnlyOnExit
    });

    await upsertBotTradeState({
      botId: bot.id,
      symbol,
      dailyResetUtc: toUtcDayStart(now),
      dailyTradeCount: dailyTradeCount + 1,
      lastTradeTs: now,
      lastPredictionHash: predictionHash,
      lastSignal: prediction ? normalizePredictionSignal(prediction.signal) : null,
      lastSignalTs: prediction?.tsUpdated ?? null,
      openSide: null,
      openQty: null,
      openEntryPrice: null,
      openTs: null
    });

    await writeRiskEvent({
      botId: bot.id,
      type: "PREDICTION_COPIER_TRADE",
      message: `exit:${decision.reason}`,
      meta: {
        orderId: placed.orderId,
        symbol,
        side: openPosition.side,
        qty: openPosition.size,
        reason: decision.reason
      }
    });

    return {
      outcome: "ok",
      intent: {
        type: "close",
        symbol,
        reason: decision.reason,
        order: {
          type: "market",
          qty: openPosition.size,
          reduceOnly: true
        }
      },
      reason: `prediction_copier_exit:${decision.reason}`,
      gate: {
        applied: true,
        allow: true,
        reason: decision.reason,
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  if (!markPrice || markPrice <= 0 || !candidateNotionalUsd || candidateNotionalUsd <= 0) {
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_copier_entry_missing_price_or_size",
      gate: {
        applied: true,
        allow: false,
        reason: "entry_missing_price_or_size",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  const leverage = Math.max(1, Math.min(bot.leverage, config.risk.maxLeverage));
  await adapter.setLeverage(symbol, leverage, bot.marginMode);

  const qty = Number((candidateNotionalUsd / markPrice).toFixed(8));
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_copier_entry_invalid_qty",
      gate: {
        applied: true,
        allow: false,
        reason: "entry_invalid_qty",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  const orderSide = decision.side === "long" ? "buy" : "sell";
  const limitPrice =
    config.execution.orderType === "limit"
      ? buildLimitEntryPrice(decision.side, markPrice, config.execution.limitOffsetBps)
      : undefined;

  const tpSl = computeTpSlPrices({
    side: decision.side,
    referencePrice: markPrice,
    stopLossPct: config.risk.stopLossPct,
    takeProfitPct: config.risk.takeProfitPct
  });

  const placed = await adapter.placeOrder({
    symbol,
    side: orderSide,
    type: config.execution.orderType,
    qty,
    price: limitPrice,
    ...tpSl
  });

  await upsertBotTradeState({
    botId: bot.id,
    symbol,
    dailyResetUtc: toUtcDayStart(now),
    dailyTradeCount: dailyTradeCount + 1,
    lastTradeTs: now,
    lastPredictionHash: predictionHash,
    lastSignal: prediction ? normalizePredictionSignal(prediction.signal) : null,
    lastSignalTs: prediction?.tsUpdated ?? null,
    openSide: decision.side,
    openQty: qty,
    openEntryPrice: markPrice,
    openTs: now
  });

  await writeRiskEvent({
    botId: bot.id,
    type: "PREDICTION_COPIER_TRADE",
    message: `enter:${decision.side}`,
    meta: {
      orderId: placed.orderId,
      symbol,
      side: decision.side,
      qty,
      notionalUsd: candidateNotionalUsd,
      markPrice,
      orderType: config.execution.orderType,
      limitPrice: limitPrice ?? null,
      reason: decision.reason
    }
  });

  log.info(
    {
      botId: bot.id,
      symbol,
      side: decision.side,
      qty,
      notionalUsd: Number(candidateNotionalUsd.toFixed(4)),
      markPrice,
      predictionHash
    },
    "prediction copier entry executed"
  );

  return {
    outcome: "ok",
    intent: {
      type: "open",
      symbol,
      side: decision.side,
      order: {
        type: config.execution.orderType,
        qty,
        price: limitPrice,
        leverage,
        marginMode: bot.marginMode,
        reduceOnly: false,
        desiredNotionalUsd: candidateNotionalUsd
      }
    },
    reason: `prediction_copier_enter:${decision.side}`,
    gate: {
      applied: true,
      allow: true,
      reason: decision.reason,
      sizeMultiplier: 1,
      timeframe: config.timeframe
    }
  };
}
