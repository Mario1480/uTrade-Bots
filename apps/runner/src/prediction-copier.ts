import crypto from "node:crypto";
import type { TradeIntent } from "@mm/futures-core";
import { isGlobalTradingEnabled } from "@mm/futures-engine";
import { BitgetFuturesAdapter, HyperliquidFuturesAdapter } from "@mm/futures-exchange";
import type {
  ActiveFuturesBot,
  BotTradeHistoryCloseOutcome,
  BotTradeState,
  PredictionGateState
} from "./db.js";
import {
  closePaperPositionForRunner,
  closeOpenBotTradeHistoryEntries,
  countOpenBotTradeHistoryEntries,
  createBotTradeHistoryEntry,
  getBotDailyTradeCount,
  listPaperPositionsForRunner,
  loadBotTradeState,
  loadLatestOpenBotTradeHistoryEntry,
  loadLatestPredictionStateForGate,
  loadPredictionStateByIdForGate,
  placePaperPositionForRunner,
  upsertBotTradeState,
  writeRiskEvent
} from "./db.js";
import { log } from "./logger.js";

export type PredictionCopierTimeframe = "5m" | "15m" | "1h" | "4h";
export type PredictionCopierSignal = "up" | "down" | "neutral";
export type PredictionCopierSide = "long" | "short";

export type PredictionCopierConfig = {
  botType: "prediction_copier";
  exchange: "bitget" | "hyperliquid" | "paper";
  accountId: string;
  sourceStateId: string | null;
  sourceSnapshot: {
    stateId?: string;
    symbol?: string;
    timeframe?: string;
    signalMode?: string;
    strategyRef?: string | null;
  } | null;
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
    stopLossPct: number | null;
    takeProfitPct: number | null;
    timeStopMin: number | null;
  };
  filters: {
    blockTags: string[];
    newsRiskBlockEnabled: boolean;
    requireTags: string[] | null;
    allowSignals: PredictionCopierSignal[];
    minExpectedMovePct: number | null;
  };
  execution: {
    orderType: "market" | "limit";
    limitOffsetBps: number;
    reduceOnlyOnExit: boolean;
  };
  exit: {
    onSignalFlip: boolean;
    onConfidenceDrop: boolean;
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
  openTradeCount: number;
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

export function resolvePredictionCopierLeverage(botLeverage: number): number {
  return Math.max(1, Math.trunc(botLeverage));
}

type AnyObject = Record<string, unknown>;

type NormalizedPosition = {
  symbol: string;
  side: PredictionCopierSide;
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
};

type SupportedFuturesAdapter = BitgetFuturesAdapter | HyperliquidFuturesAdapter;

const adapterCache = new Map<string, SupportedFuturesAdapter>();
const DEFAULT_PAPER_EQUITY_USD = Math.max(
  0,
  Number(process.env.PAPER_TRADING_START_BALANCE_USD ?? "10000")
);

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

function normalizeExecutionExchange(value: unknown): "bitget" | "hyperliquid" | "paper" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "hyperliquid") return "hyperliquid";
  return normalized === "paper" ? "paper" : "bitget";
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
  const exitRaw = root.exit && typeof root.exit === "object" && !Array.isArray(root.exit)
    ? (root.exit as AnyObject)
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
  const timeStopMin = toNumber(riskRaw.timeStopMin);

  const config: PredictionCopierConfig = {
    botType: "prediction_copier",
    exchange: normalizeExecutionExchange(root.exchange ?? bot.exchange),
    accountId: bot.exchangeAccountId,
    sourceStateId:
      typeof root.sourceStateId === "string" && root.sourceStateId.trim().length > 0
        ? root.sourceStateId.trim()
        : null,
    sourceSnapshot:
      root.sourceSnapshot && typeof root.sourceSnapshot === "object" && !Array.isArray(root.sourceSnapshot)
        ? (root.sourceSnapshot as PredictionCopierConfig["sourceSnapshot"])
        : null,
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
      stopLossPct: toNumber(riskRaw.stopLossPct),
      takeProfitPct: toNumber(riskRaw.takeProfitPct),
      timeStopMin: timeStopMin !== null && timeStopMin > 0 ? timeStopMin : null
    },
    filters: {
      blockTags: normalizeStringArray(filtersRaw.blockTags, 20).length > 0
        ? normalizeStringArray(filtersRaw.blockTags, 20)
        : ["data_gap", "low_liquidity"],
      newsRiskBlockEnabled: toBoolean(filtersRaw.newsRiskBlockEnabled, false),
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
    },
    exit: {
      onSignalFlip: toBoolean(exitRaw.onSignalFlip, false),
      onConfidenceDrop: toBoolean(exitRaw.onConfidenceDrop, false)
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
  const blocked = config.filters.blockTags.find((tag) => {
    if (tag === "news_risk" && !config.filters.newsRiskBlockEnabled) return false;
    return tags.includes(tag);
  });
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
    openTradeCount,
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
    return { action: "skip", reason: tagError };
  }

  if (openPosition && config.risk.timeStopMin !== null && config.risk.timeStopMin > 0 && state.openTs instanceof Date) {
    const maxAgeMs = config.risk.timeStopMin * 60_000;
    if (now.getTime() - state.openTs.getTime() >= maxAgeMs) {
      return { action: "exit", reason: "time_stop", side: openPosition.side };
    }
  }

  if (openPosition) {
    if (confidence < config.minConfidence) {
      if (config.exit.onConfidenceDrop) {
        return { action: "exit", reason: "confidence_below_min", side: openPosition.side };
      }
      return { action: "skip", reason: "confidence_below_min" };
    }
    if (signal === "neutral") {
      return { action: "skip", reason: "signal_neutral" };
    }
    if (openPosition.side === "long" && signal === "down") {
      if (config.exit.onSignalFlip) {
        return { action: "exit", reason: "signal_flip", side: "long" };
      }
      return { action: "skip", reason: "signal_flip" };
    }
    if (openPosition.side === "short" && signal === "up") {
      if (config.exit.onSignalFlip) {
        return { action: "exit", reason: "signal_flip", side: "short" };
      }
      return { action: "skip", reason: "signal_flip" };
    }
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
    if (openTradeCount >= config.risk.maxOpenPositions) {
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
    return { action: "enter", reason: "scale_in_aligned_position", side: openPosition.side };
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

export function computePredictionCopierCandidateNotionalUsd(params: {
  config: PredictionCopierConfig;
  accountEquity: number;
  leverage: number;
}): number {
  const baseNotionalUsd = computeSizingNotionalUsd(params.config, params.accountEquity);
  if (!Number.isFinite(baseNotionalUsd) || baseNotionalUsd <= 0) return 0;
  const effectiveLeverage = resolvePredictionCopierLeverage(params.leverage);
  return Number((baseNotionalUsd * effectiveLeverage).toFixed(8));
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

export function resolveEntryTpSlPrices(params: {
  side: PredictionCopierSide;
  referencePrice: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  predictionStopLossPrice?: number | null;
  predictionTakeProfitPrice?: number | null;
}): { stopLossPrice?: number; takeProfitPrice?: number } {
  const fromConfig = computeTpSlPrices({
    side: params.side,
    referencePrice: params.referencePrice,
    stopLossPct: params.stopLossPct,
    takeProfitPct: params.takeProfitPct
  });

  const stopLossPriceRaw = fromConfig.stopLossPrice ?? toNumber(params.predictionStopLossPrice);
  const takeProfitPriceRaw = fromConfig.takeProfitPrice ?? toNumber(params.predictionTakeProfitPrice);
  const referencePrice = Number(params.referencePrice);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return {};

  const out: { stopLossPrice?: number; takeProfitPrice?: number } = {};
  if (
    Number.isFinite(Number(stopLossPriceRaw)) &&
    Number(stopLossPriceRaw) > 0 &&
    (
      (params.side === "long" && Number(stopLossPriceRaw) < referencePrice) ||
      (params.side === "short" && Number(stopLossPriceRaw) > referencePrice)
    )
  ) {
    out.stopLossPrice = Number(Number(stopLossPriceRaw).toFixed(6));
  }
  if (
    Number.isFinite(Number(takeProfitPriceRaw)) &&
    Number(takeProfitPriceRaw) > 0 &&
    (
      (params.side === "long" && Number(takeProfitPriceRaw) > referencePrice) ||
      (params.side === "short" && Number(takeProfitPriceRaw) < referencePrice)
    )
  ) {
    out.takeProfitPrice = Number(Number(takeProfitPriceRaw).toFixed(6));
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

function computeRealizedPnlPctFromPrices(params: {
  side: PredictionCopierSide;
  entryPrice: number | null;
  exitPrice: number | null;
}): number | null {
  const entry = Number(params.entryPrice);
  const exit = Number(params.exitPrice);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(exit) || exit <= 0) return null;
  const pct = params.side === "long"
    ? ((exit / entry) - 1) * 100
    : ((entry / exit) - 1) * 100;
  return Number(pct.toFixed(6));
}

function mapExitOutcome(reason: string): BotTradeHistoryCloseOutcome {
  const normalized = String(reason ?? "").trim().toLowerCase();
  if (normalized === "time_stop") return "time_stop";
  if (
    normalized === "signal_flip" ||
    normalized === "signal_neutral" ||
    normalized === "confidence_below_min" ||
    normalized.startsWith("blocked_tag:") ||
    normalized.startsWith("missing_required_tags:") ||
    normalized === "expected_move_below_min"
  ) {
    return "signal_exit";
  }
  return "unknown";
}

export function inferExternalCloseOutcome(params: {
  side: PredictionCopierSide | null;
  markPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
}): { outcome: BotTradeHistoryCloseOutcome; reason: string } {
  const side = params.side;
  const markPrice = toNumber(params.markPrice);
  const tpPrice = toNumber(params.tpPrice);
  const slPrice = toNumber(params.slPrice);

  if (!side || markPrice === null || markPrice <= 0) {
    return { outcome: "unknown", reason: "position_closed_external" };
  }

  if (side === "long") {
    // Conservative order: if both levels were crossed intra-tick, prefer SL classification.
    if (slPrice !== null && slPrice > 0 && markPrice <= slPrice) {
      return { outcome: "sl_hit", reason: "sl_hit_external" };
    }
    if (tpPrice !== null && tpPrice > 0 && markPrice >= tpPrice) {
      return { outcome: "tp_hit", reason: "tp_hit_external" };
    }
    return { outcome: "unknown", reason: "position_closed_external" };
  }

  if (slPrice !== null && slPrice > 0 && markPrice >= slPrice) {
    return { outcome: "sl_hit", reason: "sl_hit_external" };
  }
  if (tpPrice !== null && tpPrice > 0 && markPrice <= tpPrice) {
    return { outcome: "tp_hit", reason: "tp_hit_external" };
  }
  return { outcome: "unknown", reason: "position_closed_external" };
}

function getOrCreateAdapter(bot: ActiveFuturesBot): SupportedFuturesAdapter {
  const cacheKey = `${bot.id}:${bot.marketData.exchangeAccountId}`;
  const cached = adapterCache.get(cacheKey);
  if (cached) return cached;

  const marketDataExchange = String(bot.marketData.exchange ?? "").trim().toLowerCase();

  const adapter: SupportedFuturesAdapter =
    marketDataExchange === "hyperliquid"
      ? new HyperliquidFuturesAdapter({
          apiKey: bot.marketData.credentials.apiKey,
          apiSecret: bot.marketData.credentials.apiSecret,
          apiPassphrase: bot.marketData.credentials.passphrase ?? undefined,
          restBaseUrl: process.env.HYPERLIQUID_REST_BASE_URL,
          marginCoin: process.env.HYPERLIQUID_MARGIN_COIN ?? "USDC"
        })
      : new BitgetFuturesAdapter({
          apiKey: bot.marketData.credentials.apiKey,
          apiSecret: bot.marketData.credentials.apiSecret,
          apiPassphrase: bot.marketData.credentials.passphrase ?? undefined,
          productType: (process.env.BITGET_PRODUCT_TYPE as any) ?? "USDT-FUTURES",
          marginCoin: process.env.BITGET_MARGIN_COIN ?? "USDT"
        });
  adapterCache.set(cacheKey, adapter);
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
  const executionExchange = String(bot.exchange ?? "").trim().toLowerCase();
  const marketDataExchange = String(bot.marketData.exchange ?? "").trim().toLowerCase();

  const executionSupported =
    executionExchange === "bitget" || executionExchange === "hyperliquid" || executionExchange === "paper";
  const marketDataSupported = marketDataExchange === "bitget" || marketDataExchange === "hyperliquid";
  if (!executionSupported || !marketDataSupported) {
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

  const tradeState = await loadBotTradeState({ botId: bot.id, symbol, now });
  const sourceMode: "source_state_id" | "legacy_fallback" =
    config.sourceStateId ? "source_state_id" : "legacy_fallback";
  const prediction = config.sourceStateId
    ? await loadPredictionStateByIdForGate({
        userId: bot.userId,
        exchangeAccountId: bot.exchangeAccountId,
        stateId: config.sourceStateId
      })
    : await loadLatestPredictionStateForGate({
        userId: bot.userId,
        exchange: bot.exchange,
        exchangeAccountId: bot.exchangeAccountId,
        symbol,
        marketType: "perp",
        timeframe: config.timeframe
      });

  if (config.sourceStateId && !prediction) {
    await writeRiskEvent({
      botId: bot.id,
      type: "prediction_source_missing",
      message: "sourceStateId not found or not accessible",
      meta: {
        sourceStateId: config.sourceStateId
      }
    });
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_source_missing",
      gate: {
        applied: true,
        allow: false,
        reason: "prediction_source_missing",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  if (prediction && normalizeSymbol(prediction.symbol) !== symbol) {
    await writeRiskEvent({
      botId: bot.id,
      type: "prediction_source_missing",
      message: "prediction source symbol mismatch",
      meta: {
        sourceStateId: config.sourceStateId,
        botSymbol: symbol,
        sourceSymbol: normalizeSymbol(prediction.symbol)
      }
    });
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_source_symbol_mismatch",
      gate: {
        applied: true,
        allow: false,
        reason: "prediction_source_symbol_mismatch",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  if (prediction && prediction.timeframe !== config.timeframe) {
    return {
      outcome: "blocked",
      intent: { type: "none" },
      reason: "prediction_source_timeframe_mismatch",
      gate: {
        applied: true,
        allow: false,
        reason: "prediction_source_timeframe_mismatch",
        sizeMultiplier: 1,
        timeframe: config.timeframe
      }
    };
  }

  let accountState: { equity: number };
  let positions: Array<{
    symbol: string;
    side: string;
    size: number;
    entryPrice?: number | null;
    markPrice?: number | null;
  }>;

  if (executionExchange === "paper") {
    let markPrice: number | null = null;
    try {
      const exchangeSymbol = await adapter.toExchangeSymbol(symbol);
      const ticker = await adapter.marketApi.getTicker(exchangeSymbol, adapter.productType);
      markPrice = parseTickerPrice(ticker);
    } catch {
      markPrice = null;
    }
    const paperPositions = await listPaperPositionsForRunner({
      exchangeAccountId: bot.exchangeAccountId
    });
    positions = paperPositions.map((row) => ({
      symbol: row.symbol,
      side: row.side,
      size: Number(row.size ?? 0),
      entryPrice: row.entryPrice ?? null,
      markPrice: row.symbol === symbol ? (markPrice ?? row.entryPrice ?? null) : (row.entryPrice ?? null)
    }));
    let equity = DEFAULT_PAPER_EQUITY_USD;
    for (const row of positions) {
      const qty = Number(row.size ?? 0);
      const entry = Number(row.entryPrice ?? 0);
      const mark = Number(row.markPrice ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!Number.isFinite(entry) || entry <= 0) continue;
      if (!Number.isFinite(mark) || mark <= 0) continue;
      const unrealized = row.side === "long"
        ? (mark - entry) * qty
        : (entry - mark) * qty;
      if (!Number.isFinite(unrealized)) continue;
      equity += unrealized;
    }
    accountState = { equity };
  } else {
    const [liveAccountState, livePositions] = await Promise.all([
      adapter.getAccountState(),
      adapter.getPositions()
    ]);
    accountState = { equity: Number(liveAccountState.equity ?? 0) };
    positions = livePositions.map((row) => ({
      symbol: row.symbol,
      side: row.side,
      size: Number(row.size ?? 0),
      entryPrice: row.entryPrice,
      markPrice: row.markPrice
    }));
  }

  const predictionHash = prediction ? buildPredictionHash(prediction) : null;
  if (prediction && predictionHash && predictionHash !== tradeState.lastPredictionHash) {
    const sourceEventType = config.sourceStateId ? "prediction_source_resolved" : "legacy_source_fallback";
    await writeRiskEvent({
      botId: bot.id,
      type: sourceEventType,
      message: sourceMode,
      meta: {
        sourceStateId: config.sourceStateId,
        predictionStateId: prediction.id,
        predictionHash,
        timeframe: prediction.timeframe,
        symbol: prediction.symbol
      }
    });
  }

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

  const leverage = resolvePredictionCopierLeverage(bot.leverage);
  const desiredNotionalUsd = computePredictionCopierCandidateNotionalUsd({
    config,
    accountEquity: Number(accountState.equity ?? 0),
    leverage
  });
  const candidateNotionalUsd = Number.isFinite(desiredNotionalUsd) && desiredNotionalUsd > 0
    ? desiredNotionalUsd
    : null;

  const [dailyTradeCount, openTradeCountFromHistory] = await Promise.all([
    getBotDailyTradeCount({ botId: bot.id, now }),
    countOpenBotTradeHistoryEntries({ botId: bot.id, symbol })
  ]);
  let openTradeCountRaw = openTradeCountFromHistory;

  if (!openPosition && openTradeCountRaw > 0) {
    try {
      const latestOpenHistory = await loadLatestOpenBotTradeHistoryEntry({
        botId: bot.id,
        symbol
      });
      const inferredClose = inferExternalCloseOutcome({
        side: latestOpenHistory?.side ?? tradeState.openSide ?? null,
        markPrice,
        tpPrice: latestOpenHistory?.tpPrice ?? null,
        slPrice: latestOpenHistory?.slPrice ?? null
      });
      const closedHistory = await closeOpenBotTradeHistoryEntries({
        botId: bot.id,
        symbol,
        exitTs: now,
        exitPrice: markPrice,
        outcome: inferredClose.outcome,
        exitReason: inferredClose.reason
      });
      if (closedHistory.closedCount > 0) {
        openTradeCountRaw = 0;
        await upsertBotTradeState({
          botId: bot.id,
          symbol,
          dailyResetUtc: tradeState.dailyResetUtc,
          dailyTradeCount: tradeState.dailyTradeCount,
          lastTradeTs: now,
          openSide: null,
          openQty: null,
          openEntryPrice: null,
          openTs: null
        });
        await writeRiskEvent({
          botId: bot.id,
          type: "PREDICTION_COPIER_TRADE",
          message: "external_close_reconciled",
          meta: {
            symbol,
            closedCount: closedHistory.closedCount,
            outcome: inferredClose.outcome,
            reason: inferredClose.reason,
            exitPrice: Number.isFinite(Number(markPrice)) ? Number(markPrice) : null
          }
        });
      }
    } catch (error) {
      await writeRiskEvent({
        botId: bot.id,
        type: "PREDICTION_COPIER_TRADE",
        message: "external_close_reconcile_failed",
        meta: {
          symbol,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  const openTradeCount = Math.max(openTradeCountRaw, openPosition ? 1 : 0);

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
    openTradeCount,
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
      sourceMode,
      sourceStateId: config.sourceStateId ?? null,
      predictionStateId: prediction?.id ?? null,
      dailyTradeCount,
      openTradeCount,
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
    const entryPriceForPnl =
      Number.isFinite(Number(tradeState.openEntryPrice))
        ? Number(tradeState.openEntryPrice)
        : Number.isFinite(Number(openPosition.entryPrice))
          ? Number(openPosition.entryPrice)
          : null;
    const exitPriceForPnl =
      Number.isFinite(Number(markPrice))
        ? Number(markPrice)
        : Number.isFinite(Number(openPosition.markPrice))
          ? Number(openPosition.markPrice)
          : Number.isFinite(Number(openPosition.entryPrice))
            ? Number(openPosition.entryPrice)
            : null;
    const realizedPnlUsd =
      entryPriceForPnl && exitPriceForPnl
        ? Number((
            openPosition.side === "long"
              ? (exitPriceForPnl - entryPriceForPnl) * openPosition.size
              : (entryPriceForPnl - exitPriceForPnl) * openPosition.size
          ).toFixed(4))
        : null;
    const realizedPnlPct = computeRealizedPnlPctFromPrices({
      side: openPosition.side,
      entryPrice: entryPriceForPnl,
      exitPrice: exitPriceForPnl
    });
    const placed = executionExchange === "paper"
      ? await closePaperPositionForRunner({
          exchangeAccountId: bot.exchangeAccountId,
          symbol,
          side: openPosition.side,
          fillPrice: exitPriceForPnl
            ?? markPrice
            ?? openPosition.markPrice
            ?? openPosition.entryPrice
            ?? null
        }).then((row) => ({ orderId: row.orderId ?? `paper_${bot.id}_${Date.now()}` }))
      : await adapter.placeOrder({
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
      dailyTradeCount,
      lastTradeTs: now,
      lastPredictionHash: predictionHash,
      lastSignal: prediction ? normalizePredictionSignal(prediction.signal) : null,
      lastSignalTs: prediction?.tsUpdated ?? null,
      openSide: null,
      openQty: null,
      openEntryPrice: null,
      openTs: null
    });

    try {
      const closedHistory = await closeOpenBotTradeHistoryEntries({
        botId: bot.id,
        symbol,
        exitTs: now,
        exitPrice: exitPriceForPnl,
        outcome: mapExitOutcome(decision.reason),
        exitReason: decision.reason,
        exitOrderId: placed.orderId
      });
      if (closedHistory.closedCount === 0) {
        await writeRiskEvent({
          botId: bot.id,
          type: "PREDICTION_COPIER_TRADE",
          message: "orphan_exit",
          meta: {
            symbol,
            reason: decision.reason,
            orderId: placed.orderId
          }
        });
      }
    } catch (error) {
      await writeRiskEvent({
        botId: bot.id,
        type: "PREDICTION_COPIER_TRADE",
        message: "history_close_failed",
        meta: {
          symbol,
          reason: decision.reason,
          orderId: placed.orderId,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }

    await writeRiskEvent({
      botId: bot.id,
      type: "PREDICTION_COPIER_TRADE",
      message: `exit:${decision.reason}`,
      meta: {
        orderId: placed.orderId,
        symbol,
        side: openPosition.side,
        qty: openPosition.size,
        entryPrice: entryPriceForPnl,
        exitPrice: exitPriceForPnl,
        realizedPnlUsd,
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

  if (executionExchange !== "paper") {
    await adapter.setLeverage(symbol, leverage, bot.marginMode);
  }

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

  const tpSl = resolveEntryTpSlPrices({
    side: decision.side,
    referencePrice: markPrice,
    stopLossPct: config.risk.stopLossPct,
    takeProfitPct: config.risk.takeProfitPct,
    predictionStopLossPrice: prediction?.stopLossPrice ?? null,
    predictionTakeProfitPrice: prediction?.takeProfitPrice ?? null
  });

  const placed = executionExchange === "paper"
    ? await placePaperPositionForRunner({
        exchangeAccountId: bot.exchangeAccountId,
        symbol,
        side: decision.side,
        qty,
        fillPrice: markPrice,
        takeProfitPrice: tpSl.takeProfitPrice ?? null,
        stopLossPrice: tpSl.stopLossPrice ?? null
      })
    : await adapter.placeOrder({
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
    openQty: openPosition ? Number((openPosition.size + qty).toFixed(8)) : qty,
    openEntryPrice: openPosition && Number.isFinite(Number(openPosition.entryPrice)) && Number(openPosition.entryPrice) > 0
      ? Number(((
        (Number(openPosition.entryPrice) * openPosition.size) +
        (markPrice * qty)
      ) / Math.max(Number((openPosition.size + qty).toFixed(8)), 1e-8)).toFixed(8))
      : markPrice,
    openTs: openPosition ? (tradeState.openTs ?? now) : now
  });

  try {
    await createBotTradeHistoryEntry({
      botId: bot.id,
      userId: bot.userId,
      exchangeAccountId: bot.exchangeAccountId,
      symbol,
      marketType: "perp",
      side: decision.side,
      entryTs: now,
      entryPrice: markPrice,
      entryQty: qty,
      entryNotionalUsd: Number((qty * markPrice).toFixed(8)),
      tpPrice: tpSl.takeProfitPrice ?? null,
      slPrice: tpSl.stopLossPrice ?? null,
      entryOrderId: placed.orderId,
      predictionStateId: prediction?.id ?? null,
      predictionHash,
      predictionSignal: prediction ? normalizePredictionSignal(prediction.signal) : null,
      predictionConfidence: prediction ? confidenceToPct(prediction.confidence) : null,
      predictionTags: prediction?.tags ?? []
    });
  } catch (error) {
    await writeRiskEvent({
      botId: bot.id,
      type: "PREDICTION_COPIER_TRADE",
      message: "history_entry_failed",
      meta: {
        symbol,
        side: decision.side,
        orderId: placed.orderId,
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }

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
