import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import { prisma } from "@mm/db";
import { BitgetFuturesAdapter } from "@mm/futures-exchange";
import {
  createSession,
  destroySession,
  getUserFromLocals,
  hashPassword,
  requireAuth,
  verifyPassword
} from "./auth.js";
import { decryptSecret, encryptSecret } from "./secret-crypto.js";
import {
  enforceBotStartLicense,
  getStubEntitlements,
  isLicenseEnforcementEnabled,
  isLicenseStubEnabled
} from "./license.js";
import {
  closeOrchestration,
  cancelBotRun,
  enqueueBotRun,
  getQueueMetrics,
  getRuntimeOrchestrationMode
} from "./orchestration.js";
import { ExchangeSyncError, syncExchangeAccount } from "./exchange-sync.js";
import {
  ManualTradingError,
  cancelAllOrders,
  closePositionsMarket,
  createBitgetAdapter,
  extractWsDataArray,
  getTradingSettings,
  listOpenOrders,
  listPositions,
  listSymbols,
  normalizeOrderBookPayload,
  normalizeSymbolInput,
  normalizeTickerPayload,
  normalizeTradesPayload,
  resolveTradingAccount,
  saveTradingSettings
} from "./trading.js";
import { generateAndPersistPrediction } from "./ai/predictionPipeline.js";

const db = prisma as any;

const app = express();
app.set("trust proxy", 1);

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (origins.includes("http://localhost:3000") && !origins.includes("http://127.0.0.1:3000")) {
  origins.push("http://127.0.0.1:3000");
}
if (origins.includes("http://127.0.0.1:3000") && !origins.includes("http://localhost:3000")) {
  origins.push("http://localhost:3000");
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origins.includes("*") || origins.includes(origin)) return callback(null, true);
      return callback(new Error("not_allowed_by_cors"));
    },
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json());

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const exchangeCreateSchema = z.object({
  exchange: z.string().trim().min(1),
  label: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  apiSecret: z.string().trim().min(1),
  passphrase: z.string().trim().optional()
}).superRefine((value, ctx) => {
  if (value.exchange.toLowerCase() === "bitget" && !value.passphrase) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["passphrase"],
      message: "passphrase is required for bitget"
    });
  }
});

const botCreateSchema = z.object({
  name: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  exchangeAccountId: z.string().trim().min(1),
  strategyKey: z.string().trim().min(1).default("dummy"),
  marginMode: z.enum(["isolated", "cross"]).default("isolated"),
  leverage: z.number().int().min(1).max(125).default(1),
  tickMs: z.number().int().min(100).max(60_000).default(1000),
  paramsJson: z.record(z.any()).default({})
});

const tradingSettingsSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).nullable().optional(),
  symbol: z.string().trim().min(1).nullable().optional(),
  timeframe: z.string().trim().min(1).nullable().optional()
});

const alertsSettingsSchema = z.object({
  telegramBotToken: z.string().trim().nullable().optional(),
  telegramChatId: z.string().trim().nullable().optional()
}).superRefine((value, ctx) => {
  const token = typeof value.telegramBotToken === "string" ? value.telegramBotToken.trim() : "";
  const chatId = typeof value.telegramChatId === "string" ? value.telegramChatId.trim() : "";
  if ((token && !chatId) || (!token && chatId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "telegramBotToken and telegramChatId must both be set or both be empty"
    });
  }
});

const placeOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  type: z.enum(["market", "limit"]),
  side: z.enum(["long", "short"]),
  qty: z.number().positive(),
  price: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  stopLossPrice: z.number().positive().optional(),
  reduceOnly: z.boolean().optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  marginMode: z.enum(["isolated", "cross"]).optional()
}).superRefine((value, ctx) => {
  if (value.type === "limit" && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["price"],
      message: "price is required for limit orders"
    });
  }
});

const adjustLeverageSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  leverage: z.number().int().min(1).max(125),
  marginMode: z.enum(["isolated", "cross"]).default("cross")
});

const cancelOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1),
  symbol: z.string().trim().min(1).optional()
});

const closePositionSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  side: z.enum(["long", "short"]).optional()
});

const predictionGenerateSchema = z.object({
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  tsCreated: z.string().datetime().optional(),
  prediction: z.object({
    signal: z.enum(["up", "down", "neutral"]),
    expectedMovePct: z.number(),
    confidence: z.number()
  }),
  featureSnapshot: z.record(z.any()),
  botId: z.string().trim().min(1).optional(),
  modelVersionBase: z.string().trim().min(1).optional()
});

const predictionGenerateAutoSchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  directionPreference: z.enum(["long", "short", "either"]).default("either"),
  confidenceTargetPct: z.number().min(0).max(100).default(55),
  leverage: z.number().int().min(1).max(125).optional(),
  autoSchedule: z.boolean().default(true),
  modelVersionBase: z.string().trim().min(1).optional()
});

const predictionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const predictionClearOldSchema = z.object({
  olderThanDays: z.coerce.number().int().min(1).max(3650).default(30),
  keepRunningTemplates: z.boolean().default(true)
});

const predictionDeleteManySchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(500)
});

const predictionPauseSchema = z.object({
  paused: z.boolean().default(true)
});

const predictionIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type PredictionSignal = "up" | "down" | "neutral";
type DirectionPreference = "long" | "short" | "either";

const PREDICTION_TIMEFRAMES = new Set<PredictionTimeframe>(["5m", "15m", "1h", "4h", "1d"]);
const PREDICTION_MARKET_TYPES = new Set<PredictionMarketType>(["spot", "perp"]);
const PREDICTION_SIGNALS = new Set<PredictionSignal>(["up", "down", "neutral"]);

type DashboardConnectionStatus = "connected" | "degraded" | "disconnected";

type ExchangeAccountOverview = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  status: DashboardConnectionStatus;
  lastSyncAt: string | null;
  spotBudget: { total?: number | null; available?: number | null } | null;
  futuresBudget: { equity?: number | null; availableMargin?: number | null } | null;
  pnlTodayUsd: number | null;
  lastSyncError: { at: string | null; message: string | null } | null;
  bots: { running: number; stopped: number; error: number };
  alerts: { hasErrors: boolean; message?: string | null };
};

const DASHBOARD_CONNECTED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_CONNECTED_SECONDS ?? "120") * 1000;
const DASHBOARD_DEGRADED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_DEGRADED_SECONDS ?? "600") * 1000;
const EXCHANGE_AUTO_SYNC_INTERVAL_MS =
  Math.max(15, Number(process.env.EXCHANGE_AUTO_SYNC_INTERVAL_SECONDS ?? "60")) * 1000;
const EXCHANGE_AUTO_SYNC_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.EXCHANGE_AUTO_SYNC_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_AUTO_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_AUTO_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_AUTO_POLL_MS =
  Math.max(30, Number(process.env.PREDICTION_AUTO_POLL_SECONDS ?? "60")) * 1000;
const PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT =
  Math.max(10, Number(process.env.PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT ?? "300"));
const PREDICTION_AUTO_MAX_RUNS_PER_CYCLE =
  Math.max(1, Number(process.env.PREDICTION_AUTO_MAX_RUNS_PER_CYCLE ?? "25"));
const PREDICTION_OUTCOME_HORIZON_BARS =
  Math.max(2, Number(process.env.PREDICTION_OUTCOME_HORIZON_BARS ?? "12"));
const PREDICTION_OUTCOME_EVAL_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_OUTCOME_EVAL_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_OUTCOME_EVAL_POLL_MS =
  Math.max(30, Number(process.env.PREDICTION_OUTCOME_EVAL_POLL_SECONDS ?? "60")) * 1000;
const PREDICTION_OUTCOME_EVAL_BATCH_SIZE =
  Math.max(5, Number(process.env.PREDICTION_OUTCOME_EVAL_BATCH_SIZE ?? "50"));

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function pickNumber(snapshot: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = Number(snapshot[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizePredictionTimeframe(value: unknown): PredictionTimeframe {
  if (typeof value === "string" && PREDICTION_TIMEFRAMES.has(value as PredictionTimeframe)) {
    return value as PredictionTimeframe;
  }
  return "15m";
}

function normalizePredictionMarketType(value: unknown): PredictionMarketType {
  if (typeof value === "string" && PREDICTION_MARKET_TYPES.has(value as PredictionMarketType)) {
    return value as PredictionMarketType;
  }
  return "perp";
}

function normalizePredictionSignal(value: unknown): PredictionSignal {
  if (typeof value === "string" && PREDICTION_SIGNALS.has(value as PredictionSignal)) {
    return value as PredictionSignal;
  }
  return "neutral";
}

function derivePredictionKeyDrivers(snapshot: Record<string, unknown>) {
  const preferred = [
    "rsi",
    "emaSpread",
    "emaFast",
    "emaSlow",
    "macd",
    "atrPct",
    "volatility",
    "spreadBps",
    "liquidityScore",
    "fundingRate",
    "newsRisk"
  ];

  const out: Array<{ name: string; value: unknown }> = [];
  for (const key of preferred) {
    if (!(key in snapshot)) continue;
    out.push({ name: key, value: snapshot[key] });
    if (out.length >= 5) return out;
  }

  const fallbackKeys = Object.keys(snapshot).sort().slice(0, 5);
  for (const key of fallbackKeys) {
    out.push({ name: key, value: snapshot[key] });
  }
  return out.slice(0, 5);
}

function deriveSuggestedEntry(snapshot: Record<string, unknown>) {
  const rawType = String(
    snapshot.suggestedEntryType ??
      snapshot.entryType ??
      snapshot.orderType ??
      ""
  )
    .trim()
    .toLowerCase();

  const entryPrice = pickNumber(snapshot, [
    "suggestedEntryPrice",
    "entryPrice",
    "limitPrice",
    "entry"
  ]);

  const inferredType = rawType === "limit" || entryPrice !== null ? "limit" : "market";
  if (inferredType === "limit") {
    return {
      type: "limit" as const,
      price: entryPrice ?? undefined
    };
  }
  return { type: "market" as const };
}

function derivePositionSizeHint(snapshot: Record<string, unknown>) {
  const raw = snapshot.positionSizeHint;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const modeValue = String((raw as any).mode ?? "").trim().toLowerCase();
    const value = Number((raw as any).value);
    if ((modeValue === "percent_balance" || modeValue === "fixed_quote") && Number.isFinite(value) && value > 0) {
      return {
        mode: modeValue as "percent_balance" | "fixed_quote",
        value
      };
    }
  }

  const percentValue = pickNumber(snapshot, ["positionSizePercent", "sizePercent", "balancePercent"]);
  if (percentValue !== null && percentValue > 0) {
    return {
      mode: "percent_balance" as const,
      value: percentValue
    };
  }

  const quoteValue = pickNumber(snapshot, ["positionSizeQuote", "sizeQuote", "sizeUsdt"]);
  if (quoteValue !== null && quoteValue > 0) {
    return {
      mode: "fixed_quote" as const,
      value: quoteValue
    };
  }

  return null;
}

function derivePredictionTrackingFromSnapshot(
  snapshot: Record<string, unknown>,
  timeframe: PredictionTimeframe
): {
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  horizonMs: number | null;
} {
  const entryPrice = pickNumber(snapshot, ["suggestedEntryPrice", "entryPrice", "entry"]);
  const stopLossPrice = pickNumber(snapshot, ["suggestedStopLoss", "stopLoss", "slPrice", "sl"]);
  const takeProfitPrice = pickNumber(snapshot, ["suggestedTakeProfit", "takeProfit", "tpPrice", "tp"]);
  const customHorizonMs = pickNumber(snapshot, ["horizonMs", "predictionHorizonMs"]);
  const horizonMs = customHorizonMs !== null
    ? Math.max(60_000, Math.trunc(customHorizonMs))
    : timeframeToIntervalMs(timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;

  return {
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    horizonMs
  };
}

type CandleBar = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

function toRecordSafe(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBitgetCandles(value: unknown): CandleBar[] {
  if (!Array.isArray(value)) return [];
  const out: CandleBar[] = [];

  for (const row of value) {
    if (Array.isArray(row)) {
      const ts = asNumber(row[0]);
      const open = asNumber(row[1]);
      const high = asNumber(row[2]);
      const low = asNumber(row[3]);
      const close = asNumber(row[4]);
      const volume = asNumber(row[5]);
      if (open === null || high === null || low === null || close === null) continue;
      out.push({ ts, open, high, low, close, volume });
      continue;
    }

    const rec = toRecordSafe(row);
    if (!rec) continue;
    const open = asNumber(rec.open ?? rec.o);
    const high = asNumber(rec.high ?? rec.h);
    const low = asNumber(rec.low ?? rec.l);
    const close = asNumber(rec.close ?? rec.c);
    if (open === null || high === null || low === null || close === null) continue;
    out.push({
      ts: asNumber(rec.ts ?? rec.time ?? rec.timestamp),
      open,
      high,
      low,
      close,
      volume: asNumber(rec.volume ?? rec.v)
    });
  }

  out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return out;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    const delta = next - prev;
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function timeframeToBitgetGranularity(timeframe: PredictionTimeframe): string {
  if (timeframe === "1h") return "1H";
  if (timeframe === "4h") return "4H";
  if (timeframe === "1d") return "1D";
  return timeframe;
}

function timeframeToIntervalMs(timeframe: PredictionTimeframe): number {
  if (timeframe === "5m") return 5 * 60 * 1000;
  if (timeframe === "15m") return 15 * 60 * 1000;
  if (timeframe === "1h") return 60 * 60 * 1000;
  if (timeframe === "4h") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

type PredictionQualityContext = {
  sampleSize: number;
  winRatePct: number | null;
  avgOutcomePnlPct: number | null;
  tpCount: number;
  slCount: number;
  expiredCount: number;
};

async function getPredictionQualityContext(
  userId: string,
  symbol: string,
  timeframe: PredictionTimeframe,
  marketType: PredictionMarketType
): Promise<PredictionQualityContext> {
  const rows = await db.prediction.findMany({
    where: {
      userId,
      symbol,
      timeframe,
      marketType,
      outcomeStatus: "closed"
    },
    orderBy: { tsCreated: "desc" },
    take: 100,
    select: {
      outcomeResult: true,
      outcomePnlPct: true
    }
  });

  let tpCount = 0;
  let slCount = 0;
  let expiredCount = 0;
  let pnlSum = 0;
  let pnlCount = 0;

  for (const row of rows) {
    const result = typeof row.outcomeResult === "string" ? row.outcomeResult : "";
    if (result === "tp_hit") tpCount += 1;
    else if (result === "sl_hit") slCount += 1;
    else if (result === "expired") expiredCount += 1;

    const pnl = Number(row.outcomePnlPct);
    if (Number.isFinite(pnl)) {
      pnlSum += pnl;
      pnlCount += 1;
    }
  }

  const sampleSize = rows.length;
  const winRatePct = sampleSize > 0 ? Number(((tpCount / sampleSize) * 100).toFixed(2)) : null;
  const avgOutcomePnlPct = pnlCount > 0 ? Number((pnlSum / pnlCount).toFixed(4)) : null;

  return {
    sampleSize,
    winRatePct,
    avgOutcomePnlPct,
    tpCount,
    slCount,
    expiredCount
  };
}

function deriveSignalFromScore(
  score: number,
  threshold: number,
  directionPreference: DirectionPreference
): PredictionSignal {
  let adjustedScore = score;
  if (directionPreference === "long") adjustedScore = Math.max(0, adjustedScore);
  if (directionPreference === "short") adjustedScore = Math.min(0, adjustedScore);

  if (adjustedScore > threshold) return "up";
  if (adjustedScore < -threshold) return "down";
  return "neutral";
}

function inferPredictionFromMarket(params: {
  closes: number[];
  highs: number[];
  lows: number[];
  referencePrice: number;
  timeframe: PredictionTimeframe;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  leverage?: number;
  marketType: PredictionMarketType;
  exchangeAccountId: string;
  exchange: string;
}): {
  prediction: { signal: PredictionSignal; expectedMovePct: number; confidence: number };
  featureSnapshot: Record<string, unknown>;
  tracking: {
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    horizonMs: number;
  };
} {
  const closes = params.closes;
  const highs = params.highs;
  const lows = params.lows;
  const last = closes[closes.length - 1] ?? params.referencePrice;
  const prev5 = closes[Math.max(0, closes.length - 6)] ?? last;
  const momentum = prev5 > 0 ? (last - prev5) / prev5 : 0;

  const sma20 = average(closes.slice(-20));
  const emaSpread = sma20 > 0 ? (last - sma20) / sma20 : 0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (prev > 0 && next > 0) returns.push((next - prev) / prev);
  }
  const volatility = stddev(returns.slice(-30));
  const atrProxy = average(
    highs.slice(-20).map((high, idx) => {
      const low = lows.slice(-20)[idx] ?? high;
      if (last <= 0) return 0;
      return Math.abs(high - low) / last;
    })
  );

  const rawScore = emaSpread * 0.65 + momentum * 0.35;
  const threshold = 0.0008 + volatility * 0.25;
  let signal = deriveSignalFromScore(rawScore, threshold, params.directionPreference);

  const confidenceRaw = clamp(
    0.3 + (Math.abs(rawScore) / Math.max(0.0004, threshold + volatility)) * 0.5,
    0.05,
    0.95
  );
  const targetConfidence = clamp(params.confidenceTargetPct / 100, 0, 1);
  const confidence = confidenceRaw >= targetConfidence ? confidenceRaw : Math.max(0.2, confidenceRaw * 0.85);

  if (confidenceRaw < targetConfidence) {
    signal = "neutral";
  }

  const expectedMovePct = clamp((Math.abs(momentum) + Math.max(volatility, atrProxy) * 1.2) * 100, 0.1, 6);
  const referencePrice = params.referencePrice > 0 ? params.referencePrice : last;
  const entryPrice = signal === "down"
    ? referencePrice * (1 + 0.0005)
    : referencePrice * (1 - 0.0005);
  const slMultiplier = Math.max(0.004, volatility * 1.7 + 0.0025);
  const tpMultiplier = Math.max(expectedMovePct / 100, volatility * 2.2 + 0.003);
  const suggestedStopLoss = signal === "down"
    ? referencePrice * (1 + slMultiplier)
    : referencePrice * (1 - slMultiplier);
  const suggestedTakeProfit = signal === "down"
    ? referencePrice * (1 - tpMultiplier)
    : referencePrice * (1 + tpMultiplier);

  const rsi = computeRsi(closes);
  const sizePercent = clamp(Math.round((confidence * 100) * 0.35), 10, 35);
  const horizonMs = timeframeToIntervalMs(params.timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;
  const tags: string[] = [];
  if (volatility >= 0.02) tags.push("high_vol");
  if (volatility <= 0.0075) tags.push("low_vol");
  if (signal === "up") tags.push("trend_up");
  if (signal === "down") tags.push("trend_down");
  if (signal === "neutral") tags.push("range_bound");
  if (atrProxy >= 0.015) tags.push("breakout_risk");

  return {
    prediction: {
      signal,
      expectedMovePct: Number(expectedMovePct.toFixed(2)),
      confidence: Number(confidence.toFixed(4))
    },
    featureSnapshot: {
      rsi: rsi !== null ? Number(rsi.toFixed(2)) : null,
      emaSpread: Number(emaSpread.toFixed(6)),
      momentum: Number(momentum.toFixed(6)),
      volatility: Number(volatility.toFixed(6)),
      atrPct: Number(atrProxy.toFixed(6)),
      suggestedEntryType: "limit",
      suggestedEntryPrice: Number(entryPrice.toFixed(2)),
      suggestedStopLoss: Number(suggestedStopLoss.toFixed(2)),
      suggestedTakeProfit: Number(suggestedTakeProfit.toFixed(2)),
      positionSizeHint: {
        mode: "percent_balance",
        value: sizePercent
      },
      requestedLeverage: params.marketType === "perp" ? params.leverage ?? 1 : null,
      directionPreference: params.directionPreference,
      confidenceTargetPct: params.confidenceTargetPct,
      prefillExchangeAccountId: params.exchangeAccountId,
      prefillExchange: params.exchange,
      tags
    },
    tracking: {
      entryPrice: Number(entryPrice.toFixed(2)),
      stopLossPrice: Number(suggestedStopLoss.toFixed(2)),
      takeProfitPrice: Number(suggestedTakeProfit.toFixed(2)),
      horizonMs
    }
  };
}

type PredictionGenerateAutoInput = z.infer<typeof predictionGenerateAutoSchema>;

function parseDirectionPreference(value: unknown): DirectionPreference {
  if (value === "long" || value === "short" || value === "either") return value;
  return "either";
}

async function generateAutoPredictionForUser(
  userId: string,
  payload: PredictionGenerateAutoInput
): Promise<{
  persisted: boolean;
  prediction: { signal: PredictionSignal; expectedMovePct: number; confidence: number };
  explanation: Awaited<ReturnType<typeof generateAndPersistPrediction>>["explanation"];
  modelVersion: string;
  predictionId: string | null;
  tsCreated: string;
}> {
  const account = await resolveTradingAccount(userId, payload.exchangeAccountId);
  const adapter = createBitgetAdapter(account);

  try {
    await adapter.contractCache.warmup();
    const canonicalSymbol = normalizeSymbolInput(payload.symbol);
    if (!canonicalSymbol) {
      throw new ManualTradingError("symbol_required", 400, "symbol_required");
    }

    const exchangeSymbol = await adapter.toExchangeSymbol(canonicalSymbol);
    const [tickerRaw, candlesRaw] = await Promise.all([
      adapter.marketApi.getTicker(exchangeSymbol, adapter.productType),
      adapter.marketApi.getCandles({
        symbol: exchangeSymbol,
        productType: adapter.productType,
        granularity: timeframeToBitgetGranularity(payload.timeframe),
        limit: 120
      })
    ]);

    const candles = parseBitgetCandles(candlesRaw);
    if (candles.length < 20) {
      throw new ManualTradingError(
        "Not enough candle data to generate prediction.",
        422,
        "insufficient_market_data"
      );
    }

    const closes = candles.map((row) => row.close);
    const highs = candles.map((row) => row.high);
    const lows = candles.map((row) => row.low);
    const ticker = normalizeTickerPayload(coerceFirstItem(tickerRaw));
    const referencePrice = ticker.mark ?? ticker.last ?? closes[closes.length - 1];
    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      throw new ManualTradingError(
        "Cannot determine reference price from market data.",
        422,
        "invalid_reference_price"
      );
    }

    const inferred = inferPredictionFromMarket({
      closes,
      highs,
      lows,
      referencePrice,
      timeframe: payload.timeframe,
      directionPreference: payload.directionPreference,
      confidenceTargetPct: payload.confidenceTargetPct,
      leverage: payload.leverage,
      marketType: payload.marketType,
      exchangeAccountId: payload.exchangeAccountId,
      exchange: account.exchange
    });

    const quality = await getPredictionQualityContext(
      userId,
      canonicalSymbol,
      payload.timeframe,
      payload.marketType
    );

    inferred.featureSnapshot.autoScheduleEnabled = payload.autoSchedule;
    inferred.featureSnapshot.qualityWinRatePct = quality.winRatePct;
    inferred.featureSnapshot.qualitySampleSize = quality.sampleSize;
    inferred.featureSnapshot.qualityAvgOutcomePnlPct = quality.avgOutcomePnlPct;
    inferred.featureSnapshot.qualityTpCount = quality.tpCount;
    inferred.featureSnapshot.qualitySlCount = quality.slCount;
    inferred.featureSnapshot.qualityExpiredCount = quality.expiredCount;

    const tsCreated = new Date().toISOString();
    const created = await generateAndPersistPrediction({
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: payload.timeframe,
      tsCreated,
      prediction: inferred.prediction,
      featureSnapshot: inferred.featureSnapshot,
      tracking: inferred.tracking,
      userId,
      botId: null,
      modelVersionBase: payload.modelVersionBase ?? "baseline-v1:auto-market-v1"
    });

    await notifyTradablePrediction({
      userId,
      exchange: account.exchange,
      exchangeAccountLabel: account.label,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: payload.timeframe,
      signal: inferred.prediction.signal,
      confidence: inferred.prediction.confidence,
      confidenceTargetPct: payload.confidenceTargetPct,
      expectedMovePct: inferred.prediction.expectedMovePct,
      predictionId: created.rowId,
      explanation: created.explanation.explanation,
      source: "auto"
    });

    return {
      persisted: created.persisted,
      prediction: inferred.prediction,
      explanation: created.explanation,
      modelVersion: created.modelVersion,
      predictionId: created.rowId,
      tsCreated
    };
  } finally {
    await adapter.close();
  }
}

function resolveLastSyncAt(runtime: {
  lastHeartbeatAt?: Date | null;
  lastTickAt?: Date | null;
  updatedAt?: Date | null;
} | null | undefined): Date | null {
  if (!runtime) return null;
  const values = [runtime.lastHeartbeatAt, runtime.lastTickAt, runtime.updatedAt]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime());
  return values[0] ?? null;
}

function computeConnectionStatus(
  lastSyncAt: Date | null,
  hasBotActivity: boolean
): DashboardConnectionStatus {
  if (!lastSyncAt) return hasBotActivity ? "disconnected" : "degraded";
  const ageMs = Date.now() - lastSyncAt.getTime();
  if (ageMs <= DASHBOARD_CONNECTED_WINDOW_MS) return "connected";
  if (ageMs <= DASHBOARD_DEGRADED_WINDOW_MS) return "degraded";
  return "disconnected";
}

function toSafeUser(user: { id: string; email: string }) {
  return { id: user.id, email: user.email };
}

function toSafeBot(bot: any) {
  return {
    id: bot.id,
    userId: bot.userId,
    exchangeAccountId: bot.exchangeAccountId ?? null,
    name: bot.name,
    exchange: bot.exchange,
    symbol: bot.symbol,
    status: bot.status,
    lastError: bot.lastError ?? null,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    exchangeAccount: bot.exchangeAccount
      ? {
          id: bot.exchangeAccount.id,
          exchange: bot.exchangeAccount.exchange,
          label: bot.exchangeAccount.label
        }
      : null,
    futuresConfig: bot.futuresConfig
      ? {
          strategyKey: bot.futuresConfig.strategyKey,
          marginMode: bot.futuresConfig.marginMode,
          leverage: bot.futuresConfig.leverage,
          tickMs: bot.futuresConfig.tickMs,
          paramsJson: bot.futuresConfig.paramsJson
        }
      : null,
    runtime: bot.runtime
      ? {
          status: bot.runtime.status,
          reason: bot.runtime.reason,
          updatedAt: bot.runtime.updatedAt,
          workerId: bot.runtime.workerId ?? null,
          lastHeartbeatAt: bot.runtime.lastHeartbeatAt ?? null,
          lastTickAt: bot.runtime.lastTickAt ?? null,
          lastError: bot.runtime.lastError ?? null,
          consecutiveErrors: bot.runtime.consecutiveErrors ?? 0,
          errorWindowStartAt: bot.runtime.errorWindowStartAt ?? null,
          lastErrorAt: bot.runtime.lastErrorAt ?? null,
          lastErrorMessage: bot.runtime.lastErrorMessage ?? null
        }
      : null
  };
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

type ExchangeAccountSecrets = {
  id: string;
  exchange: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
};

function normalizeSyncErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.slice(0, 500);
}

async function persistExchangeSyncSuccess(accountId: string, synced: Awaited<ReturnType<typeof syncExchangeAccount>>) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastUsedAt: synced.syncedAt,
      spotBudgetTotal: synced.spotBudget?.total ?? null,
      spotBudgetAvailable: synced.spotBudget?.available ?? null,
      futuresBudgetEquity: synced.futuresBudget.equity,
      futuresBudgetAvailableMargin: synced.futuresBudget.availableMargin,
      pnlTodayUsd: synced.pnlTodayUsd,
      lastSyncErrorAt: null,
      lastSyncErrorMessage: null
    }
  });
}

async function persistExchangeSyncFailure(accountId: string, errorMessage: string) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastSyncErrorAt: new Date(),
      lastSyncErrorMessage: normalizeSyncErrorMessage(errorMessage)
    }
  });
}

function decodeExchangeSecrets(account: ExchangeAccountSecrets): {
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
} {
  try {
    const apiKey = decryptSecret(account.apiKeyEnc);
    const apiSecret = decryptSecret(account.apiSecretEnc);
    const passphrase = account.passphraseEnc ? decryptSecret(account.passphraseEnc) : null;
    return { apiKey, apiSecret, passphrase };
  } catch {
    throw new ExchangeSyncError(
      "Failed to decrypt exchange credentials.",
      500,
      "exchange_secret_decrypt_failed"
    );
  }
}

async function executeExchangeSync(account: ExchangeAccountSecrets) {
  const secrets = decodeExchangeSecrets(account);
  return syncExchangeAccount({
    exchange: account.exchange,
    apiKey: secrets.apiKey,
    apiSecret: secrets.apiSecret,
    passphrase: secrets.passphrase
  });
}

let exchangeAutoSyncTimer: NodeJS.Timeout | null = null;
let exchangeAutoSyncRunning = false;

async function runExchangeAutoSyncCycle() {
  if (exchangeAutoSyncRunning) return;
  exchangeAutoSyncRunning = true;
  try {
    const accounts: ExchangeAccountSecrets[] = await db.exchangeAccount.findMany({
      where: { exchange: "bitget" },
      select: {
        id: true,
        exchange: true,
        apiKeyEnc: true,
        apiSecretEnc: true,
        passphraseEnc: true
      }
    });

    for (const account of accounts) {
      try {
        const synced = await executeExchangeSync(account);
        await persistExchangeSyncSuccess(account.id, synced);
      } catch (error) {
        const message =
          error instanceof ExchangeSyncError
            ? error.message
            : "Auto sync failed due to unexpected error.";
        await persistExchangeSyncFailure(account.id, message);
      }
    }
  } finally {
    exchangeAutoSyncRunning = false;
  }
}

function startExchangeAutoSyncScheduler() {
  if (!EXCHANGE_AUTO_SYNC_ENABLED) return;
  exchangeAutoSyncTimer = setInterval(() => {
    void runExchangeAutoSyncCycle();
  }, EXCHANGE_AUTO_SYNC_INTERVAL_MS);
  void runExchangeAutoSyncCycle();
}

function stopExchangeAutoSyncScheduler() {
  if (!exchangeAutoSyncTimer) return;
  clearInterval(exchangeAutoSyncTimer);
  exchangeAutoSyncTimer = null;
}

function isAutoScheduleEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(normalized);
  }
  return false;
}

function readConfidenceTarget(snapshot: Record<string, unknown>): number {
  const parsed = pickNumber(snapshot, ["confidenceTargetPct", "targetConfidencePct", "confidenceTarget"]);
  if (parsed === null) return 55;
  return clamp(parsed, 0, 100);
}

function readConfiguredConfidenceTarget(snapshot: Record<string, unknown>): number | null {
  const parsed = pickNumber(snapshot, ["confidenceTargetPct", "targetConfidencePct", "confidenceTarget"]);
  if (parsed === null) return null;
  return clamp(parsed, 0, 100);
}

function confidenceToPct(value: number): number {
  const normalized = value <= 1 ? value * 100 : value;
  return clamp(normalized, 0, 100);
}

function isTradableSignal(params: {
  signal: PredictionSignal;
  confidence: number;
  confidenceTargetPct: number;
}): boolean {
  if (params.signal !== "up" && params.signal !== "down") return false;
  if (!Number.isFinite(params.confidence)) return false;
  const confidencePct = confidenceToPct(params.confidence);
  return confidencePct >= clamp(params.confidenceTargetPct, 0, 100);
}

type TelegramConfig = {
  botToken: string;
  chatId: string;
};

function parseTelegramConfigValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveTelegramConfig(): Promise<TelegramConfig | null> {
  const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
  const envChatId = parseTelegramConfigValue(process.env.TELEGRAM_CHAT_ID);
  if (envToken && envChatId) {
    return { botToken: envToken, chatId: envChatId };
  }

  const config = await db.alertConfig.findUnique({
    where: { key: "default" },
    select: {
      telegramBotToken: true,
      telegramChatId: true
    }
  });

  const botToken = parseTelegramConfigValue(config?.telegramBotToken);
  const chatId = parseTelegramConfigValue(config?.telegramChatId);
  if (!botToken || !chatId) return null;

  return { botToken, chatId };
}

async function sendTelegramMessage(params: TelegramConfig & { text: string }): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${params.botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };
    if (!response.ok || payload.ok === false) {
      throw new Error(`telegram_api_failed:${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyTradablePrediction(params: {
  userId: string;
  exchange: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  confidence: number;
  confidenceTargetPct: number;
  expectedMovePct: number;
  predictionId: string | null;
  explanation?: string | null;
  source: "manual" | "auto";
}): Promise<void> {
  if (!isTradableSignal({
    signal: params.signal,
    confidence: params.confidence,
    confidenceTargetPct: params.confidenceTargetPct
  })) {
    return;
  }

  const config = await resolveTelegramConfig();
  if (!config) {
    return;
  }

  const confidencePct = confidenceToPct(params.confidence);
  const signalLabel = params.signal === "up" ? "LONG" : "SHORT";
  const explanation = typeof params.explanation === "string" ? params.explanation.trim() : "";
  const shortExplanation = explanation.length > 180 ? `${explanation.slice(0, 177)}...` : explanation;

  const lines = [
    "uTrade tradable signal",
    `${params.symbol} (${params.marketType}, ${params.timeframe})`,
    `Signal: ${signalLabel}`,
    `Confidence: ${confidencePct.toFixed(1)}% (target ${params.confidenceTargetPct.toFixed(0)}%)`,
    `Expected move: ${params.expectedMovePct.toFixed(2)}%`,
    `Exchange: ${params.exchange} / ${params.exchangeAccountLabel}`,
    `Source: ${params.source}`,
    params.predictionId ? `Prediction ID: ${params.predictionId}` : null,
    shortExplanation ? `Reason: ${shortExplanation}` : null
  ].filter((line): line is string => Boolean(line));

  try {
    await sendTelegramMessage({
      ...config,
      text: lines.join("\n")
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[telegram] prediction notification failed", {
      userId: params.userId,
      predictionId: params.predictionId ?? null,
      reason: String(error)
    });
  }
}

function readRequestedLeverage(snapshot: Record<string, unknown>): number | undefined {
  const parsed = pickNumber(snapshot, ["requestedLeverage", "leverage"]);
  if (parsed === null) return undefined;
  if (!Number.isFinite(parsed)) return undefined;
  const bounded = Math.max(1, Math.min(125, Math.trunc(parsed)));
  return bounded;
}

function computeSignalPnlPct(
  signal: PredictionSignal,
  entryPrice: number,
  price: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(price) || price <= 0) {
    return 0;
  }
  if (signal === "down") {
    return ((entryPrice - price) / entryPrice) * 100;
  }
  return ((price - entryPrice) / entryPrice) * 100;
}

type PredictionOutcomeEvaluation = {
  data: Record<string, unknown>;
  terminal: boolean;
};

function evaluatePredictionOutcomeFromCandles(params: {
  row: {
    signal: PredictionSignal;
    timeframe: PredictionTimeframe;
    tsCreated: Date;
    entryPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    horizonMs: number | null;
    featuresSnapshot: unknown;
  };
  candles: CandleBar[];
  nowMs: number;
}): PredictionOutcomeEvaluation | null {
  const row = params.row;
  const signal = row.signal;
  const snapshot = asRecord(row.featuresSnapshot);

  if (signal === "neutral") {
    return {
      terminal: true,
      data: {
        outcomeStatus: "closed",
        outcomeResult: "skipped",
        outcomeReason: "neutral_signal",
        outcomePnlPct: 0,
        maxFavorablePct: 0,
        maxAdversePct: 0,
        outcomeEvaluatedAt: new Date(),
        outcomeMeta: {
          evaluatedFrom: row.tsCreated.toISOString(),
          evaluatedTo: new Date(params.nowMs).toISOString(),
          barsScanned: 0
        }
      }
    };
  }

  const derived = derivePredictionTrackingFromSnapshot(snapshot, row.timeframe);
  const entryPrice = row.entryPrice ?? derived.entryPrice;
  const stopLossPrice = row.stopLossPrice ?? derived.stopLossPrice;
  const takeProfitPrice = row.takeProfitPrice ?? derived.takeProfitPrice;
  const horizonMs = row.horizonMs ?? derived.horizonMs ?? timeframeToIntervalMs(row.timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;

  if (!entryPrice || !stopLossPrice || !takeProfitPrice || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      terminal: true,
      data: {
        outcomeStatus: "closed",
        outcomeResult: "invalid",
        outcomeReason: "missing_tracking_prices",
        outcomeEvaluatedAt: new Date(),
        outcomeMeta: {
          hasEntryPrice: Boolean(entryPrice),
          hasStopLossPrice: Boolean(stopLossPrice),
          hasTakeProfitPrice: Boolean(takeProfitPrice)
        }
      }
    };
  }

  const expireAtMs = row.tsCreated.getTime() + Math.max(60_000, horizonMs);
  const evaluationEndMs = Math.min(params.nowMs, expireAtMs);

  const bars = params.candles
    .filter((bar) => bar.ts !== null)
    .filter((bar) => (bar.ts as number) >= row.tsCreated.getTime() && (bar.ts as number) <= evaluationEndMs);

  if (bars.length === 0) {
    if (params.nowMs >= expireAtMs) {
      return {
        terminal: true,
        data: {
          outcomeStatus: "closed",
          outcomeResult: "expired",
          outcomeReason: "horizon_elapsed_no_data",
          outcomeEvaluatedAt: new Date(),
          outcomeMeta: {
            evaluatedFrom: row.tsCreated.toISOString(),
            evaluatedTo: new Date(evaluationEndMs).toISOString(),
            barsScanned: 0
          }
        }
      };
    }
    return null;
  }

  let maxFavorablePct = Number.NEGATIVE_INFINITY;
  let maxAdversePct = Number.POSITIVE_INFINITY;

  for (const bar of bars) {
    const favorable =
      signal === "down"
        ? ((entryPrice - bar.low) / entryPrice) * 100
        : ((bar.high - entryPrice) / entryPrice) * 100;
    const adverse =
      signal === "down"
        ? ((entryPrice - bar.high) / entryPrice) * 100
        : ((bar.low - entryPrice) / entryPrice) * 100;

    maxFavorablePct = Math.max(maxFavorablePct, favorable);
    maxAdversePct = Math.min(maxAdversePct, adverse);

    const tpHit = signal === "down" ? bar.low <= takeProfitPrice : bar.high >= takeProfitPrice;
    const slHit = signal === "down" ? bar.high >= stopLossPrice : bar.low <= stopLossPrice;

    if (tpHit || slHit) {
      const conservativeSlFirst = tpHit && slHit;
      const result = conservativeSlFirst ? "sl_hit" : tpHit ? "tp_hit" : "sl_hit";
      const settledPrice = result === "tp_hit" ? takeProfitPrice : stopLossPrice;
      const pnl = computeSignalPnlPct(signal, entryPrice, settledPrice);
      return {
        terminal: true,
        data: {
          outcomeStatus: "closed",
          outcomeResult: result,
          outcomeReason: conservativeSlFirst ? "both_hit_same_bar_conservative_sl" : "price_touched_level",
          outcomePnlPct: Number(pnl.toFixed(4)),
          maxFavorablePct: Number(maxFavorablePct.toFixed(4)),
          maxAdversePct: Number(maxAdversePct.toFixed(4)),
          outcomeEvaluatedAt: new Date(),
          outcomeMeta: {
            entryPrice,
            takeProfitPrice,
            stopLossPrice,
            evaluatedFrom: row.tsCreated.toISOString(),
            evaluatedTo: new Date(evaluationEndMs).toISOString(),
            barsScanned: bars.length
          }
        }
      };
    }
  }

  const pending = params.nowMs < expireAtMs;
  const lastClose = bars[bars.length - 1]?.close;
  const expiredPnl =
    Number.isFinite(lastClose) && lastClose > 0
      ? Number(computeSignalPnlPct(signal, entryPrice, lastClose).toFixed(4))
      : null;

  return {
    terminal: !pending,
    data: {
      outcomeStatus: pending ? "pending" : "closed",
      outcomeResult: pending ? null : "expired",
      outcomeReason: pending ? "awaiting_levels" : "horizon_elapsed",
      outcomePnlPct: pending ? null : expiredPnl,
      maxFavorablePct: Number(maxFavorablePct.toFixed(4)),
      maxAdversePct: Number(maxAdversePct.toFixed(4)),
      outcomeEvaluatedAt: new Date(),
      outcomeMeta: {
        entryPrice,
        takeProfitPrice,
        stopLossPrice,
        evaluatedFrom: row.tsCreated.toISOString(),
        evaluatedTo: new Date(evaluationEndMs).toISOString(),
        barsScanned: bars.length,
        pending
      }
    }
  };
}

function readPrefillExchangeAccountId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.prefillExchangeAccountId !== "string") return null;
  const value = snapshot.prefillExchangeAccountId.trim();
  return value ? value : null;
}

function isAutoSchedulePaused(snapshot: Record<string, unknown>): boolean {
  const value = snapshot.autoSchedulePaused;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes", "paused"].includes(normalized);
  }
  return false;
}

function predictionTemplateKey(parts: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}): string {
  return `${parts.userId}:${parts.exchangeAccountId}:${parts.symbol}:${parts.marketType}:${parts.timeframe}`;
}

function withAutoScheduleFlag(
  featuresSnapshot: unknown,
  enabled: boolean
): Record<string, unknown> {
  const snapshot = asRecord(featuresSnapshot);
  return {
    ...snapshot,
    autoScheduleEnabled: enabled
  };
}

async function resolvePredictionTemplateScope(userId: string, predictionId: string): Promise<{
  rowId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string | null;
} | null> {
  const row = await db.prediction.findFirst({
    where: {
      id: predictionId,
      userId
    },
    select: {
      id: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      featuresSnapshot: true
    }
  });
  if (!row) return null;

  const snapshot = asRecord(row.featuresSnapshot);
  const symbol = normalizeSymbolInput(row.symbol);
  if (!symbol) return null;
  return {
    rowId: row.id,
    symbol,
    marketType: normalizePredictionMarketType(row.marketType),
    timeframe: normalizePredictionTimeframe(row.timeframe),
    exchangeAccountId: readPrefillExchangeAccountId(snapshot)
  };
}

async function findPredictionTemplateRowIds(userId: string, scope: {
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string | null;
}): Promise<string[]> {
  const rows = await db.prediction.findMany({
    where: {
      userId,
      symbol: scope.symbol,
      marketType: scope.marketType,
      timeframe: scope.timeframe
    },
    select: {
      id: true,
      featuresSnapshot: true
    }
  });

  return rows
    .filter((row: any) => {
      const snapshot = asRecord(row.featuresSnapshot);
      return readPrefillExchangeAccountId(snapshot) === scope.exchangeAccountId;
    })
    .map((row: any) => row.id);
}

let predictionAutoTimer: NodeJS.Timeout | null = null;
let predictionAutoRunning = false;
let predictionOutcomeEvalTimer: NodeJS.Timeout | null = null;
let predictionOutcomeEvalRunning = false;

async function runPredictionOutcomeEvalCycle() {
  if (!PREDICTION_OUTCOME_EVAL_ENABLED) return;
  if (predictionOutcomeEvalRunning) return;
  predictionOutcomeEvalRunning = true;

  try {
    const rows = await db.prediction.findMany({
      where: {
        userId: { not: null },
        outcomeStatus: "pending"
      },
      orderBy: [{ tsCreated: "asc" }],
      take: PREDICTION_OUTCOME_EVAL_BATCH_SIZE,
      select: {
        id: true,
        userId: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        signal: true,
        tsCreated: true,
        entryPrice: true,
        stopLossPrice: true,
        takeProfitPrice: true,
        horizonMs: true,
        featuresSnapshot: true
      }
    });

    if (rows.length === 0) return;

    const defaultAccountByUser = new Map<string, string | null>();
    const grouped = new Map<string, Array<any>>();

    for (const row of rows) {
      const userId = typeof row.userId === "string" ? row.userId : null;
      if (!userId) continue;

      const snapshot = asRecord(row.featuresSnapshot);
      let exchangeAccountId = readPrefillExchangeAccountId(snapshot);

      if (!exchangeAccountId) {
        if (!defaultAccountByUser.has(userId)) {
          const defaultAccount = await db.exchangeAccount.findFirst({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
          });
          defaultAccountByUser.set(userId, defaultAccount?.id ?? null);
        }
        exchangeAccountId = defaultAccountByUser.get(userId) ?? null;
      }

      if (!exchangeAccountId) {
        await db.prediction.update({
          where: { id: row.id },
          data: {
            outcomeStatus: "closed",
            outcomeResult: "invalid",
            outcomeReason: "missing_exchange_account",
            outcomeEvaluatedAt: new Date()
          }
        });
        continue;
      }

      const key = `${userId}:${exchangeAccountId}`;
      const list = grouped.get(key) ?? [];
      list.push({
        ...row,
        userId,
        exchangeAccountId
      });
      grouped.set(key, list);
    }

    const nowMs = Date.now();
    for (const [key, groupRows] of grouped.entries()) {
      const [userId, exchangeAccountId] = key.split(":");
      let adapter: BitgetFuturesAdapter | null = null;
      try {
        const account = await resolveTradingAccount(userId, exchangeAccountId);
        adapter = createBitgetAdapter(account);
        await adapter.contractCache.warmup();

        for (const row of groupRows) {
          const timeframe = normalizePredictionTimeframe(row.timeframe);
          const signal = normalizePredictionSignal(row.signal);
          const symbol = normalizeSymbolInput(row.symbol);
          if (!symbol) continue;

          const exchangeSymbol = await adapter.toExchangeSymbol(symbol);
          const horizonMs = row.horizonMs ?? timeframeToIntervalMs(timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;
          const endTime = Math.min(nowMs, row.tsCreated.getTime() + Math.max(60_000, horizonMs));
          const candlesRaw = await adapter.marketApi.getCandles({
            symbol: exchangeSymbol,
            productType: adapter.productType,
            granularity: timeframeToBitgetGranularity(timeframe),
            startTime: row.tsCreated.getTime(),
            endTime,
            limit: 500
          });
          const candles = parseBitgetCandles(candlesRaw);

          const evaluation = evaluatePredictionOutcomeFromCandles({
            row: {
              signal,
              timeframe,
              tsCreated: row.tsCreated,
              entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
              stopLossPrice: Number.isFinite(Number(row.stopLossPrice)) ? Number(row.stopLossPrice) : null,
              takeProfitPrice: Number.isFinite(Number(row.takeProfitPrice)) ? Number(row.takeProfitPrice) : null,
              horizonMs: Number.isFinite(Number(row.horizonMs)) ? Number(row.horizonMs) : null,
              featuresSnapshot: row.featuresSnapshot
            },
            candles,
            nowMs
          });

          if (!evaluation) continue;
          await db.prediction.update({
            where: { id: row.id },
            data: evaluation.data
          });
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:outcome] cycle group failed", { key, reason: String(error) });
      } finally {
        if (adapter) {
          await adapter.close();
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:outcome] scheduler cycle failed", String(error));
  } finally {
    predictionOutcomeEvalRunning = false;
  }
}

async function runPredictionAutoCycle() {
  if (!PREDICTION_AUTO_ENABLED) return;
  if (predictionAutoRunning) return;

  predictionAutoRunning = true;
  try {
    const rows = await db.prediction.findMany({
      where: {
        userId: { not: null }
      },
      orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
      take: PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT,
      select: {
        id: true,
        userId: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        tsCreated: true,
        featuresSnapshot: true
      }
    });

    const templates = new Map<string, ({
      userId: string;
      exchangeAccountId: string;
      symbol: string;
      marketType: PredictionMarketType;
      timeframe: PredictionTimeframe;
      directionPreference: DirectionPreference;
      confidenceTargetPct: number;
      leverage?: number;
      tsCreated: Date;
      modelVersionBase?: string;
    }) | null>();

    for (const row of rows) {
      const userId = typeof row.userId === "string" ? row.userId : null;
      if (!userId) continue;

      const snapshot = asRecord(row.featuresSnapshot);
      const exchangeAccountId = readPrefillExchangeAccountId(snapshot);
      if (!exchangeAccountId) continue;

      const symbol = normalizeSymbolInput(row.symbol);
      if (!symbol) continue;

      const timeframe = normalizePredictionTimeframe(row.timeframe);
      const marketType = normalizePredictionMarketType(row.marketType);
      const key = predictionTemplateKey({
        userId,
        exchangeAccountId,
        symbol,
        marketType,
        timeframe
      });
      if (templates.has(key)) continue;
      if (!isAutoScheduleEnabled(snapshot.autoScheduleEnabled)) {
        templates.set(key, null);
        continue;
      }
      if (isAutoSchedulePaused(snapshot)) {
        templates.set(key, null);
        continue;
      }

      templates.set(key, {
        userId,
        exchangeAccountId,
        symbol,
        marketType,
        timeframe,
        directionPreference: parseDirectionPreference(snapshot.directionPreference),
        confidenceTargetPct: readConfidenceTarget(snapshot),
        leverage: readRequestedLeverage(snapshot),
        tsCreated: row.tsCreated,
        modelVersionBase: typeof row.modelVersion === "string" ? row.modelVersion : undefined
      });
    }

    const now = Date.now();
    let executed = 0;
    for (const template of templates.values()) {
      if (!template) continue;
      if (executed >= PREDICTION_AUTO_MAX_RUNS_PER_CYCLE) break;
      const dueMs = timeframeToIntervalMs(template.timeframe);
      const ageMs = now - template.tsCreated.getTime();
      if (ageMs < dueMs) continue;

      try {
        await generateAutoPredictionForUser(template.userId, {
          exchangeAccountId: template.exchangeAccountId,
          symbol: template.symbol,
          marketType: template.marketType,
          timeframe: template.timeframe,
          directionPreference: template.directionPreference,
          confidenceTargetPct: template.confidenceTargetPct,
          leverage: template.marketType === "perp" ? template.leverage : undefined,
          autoSchedule: true,
          modelVersionBase: "baseline-v1:auto-market-v1:scheduler"
        });
        executed += 1;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:auto] generation failed", {
          userId: template.userId,
          exchangeAccountId: template.exchangeAccountId,
          symbol: template.symbol,
          timeframe: template.timeframe,
          reason: String(error)
        });
      }
    }

    if (executed > 0) {
      // eslint-disable-next-line no-console
      console.log(`[predictions:auto] generated ${executed} prediction(s)`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:auto] scheduler cycle failed", String(error));
  } finally {
    predictionAutoRunning = false;
  }
}

function startPredictionAutoScheduler() {
  if (!PREDICTION_AUTO_ENABLED) return;
  predictionAutoTimer = setInterval(() => {
    void runPredictionAutoCycle();
  }, PREDICTION_AUTO_POLL_MS);
  void runPredictionAutoCycle();
}

function stopPredictionAutoScheduler() {
  if (!predictionAutoTimer) return;
  clearInterval(predictionAutoTimer);
  predictionAutoTimer = null;
}

function startPredictionOutcomeEvalScheduler() {
  if (!PREDICTION_OUTCOME_EVAL_ENABLED) return;
  predictionOutcomeEvalTimer = setInterval(() => {
    void runPredictionOutcomeEvalCycle();
  }, PREDICTION_OUTCOME_EVAL_POLL_MS);
  void runPredictionOutcomeEvalCycle();
}

function stopPredictionOutcomeEvalScheduler() {
  if (!predictionOutcomeEvalTimer) return;
  clearInterval(predictionOutcomeEvalTimer);
  predictionOutcomeEvalTimer = null;
}

type WsAuthUser = {
  id: string;
  email: string;
};

type MarketWsContext = {
  adapter: BitgetFuturesAdapter;
  stop: () => Promise<void>;
};

function readCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const entries = header.split(";");
  for (const entry of entries) {
    const [rawName, ...rest] = entry.trim().split("=");
    if (rawName !== name) continue;
    const value = rest.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function authenticateWsUser(req: http.IncomingMessage): Promise<WsAuthUser | null> {
  const token = readCookieValue(req.headers.cookie, "mm_session");
  if (!token) return null;

  const session = await db.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  await db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() }
  });

  return {
    id: session.user.id,
    email: session.user.email
  };
}

function wsReject(socket: any, statusCode: number, reason: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function createMarketWsContext(
  userId: string,
  exchangeAccountId?: string | null
): Promise<{ accountId: string; ctx: MarketWsContext }> {
  const account = await resolveTradingAccount(userId, exchangeAccountId);
  const adapter = createBitgetAdapter(account);
  await adapter.contractCache.warmup();

  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await adapter.close();
  };

  return {
    accountId: account.id,
    ctx: {
      adapter,
      stop
    }
  };
}

function pickWsSymbol(
  preferred: string | null | undefined,
  contracts: Array<{ canonicalSymbol: string; apiAllowed: boolean }>
): string | null {
  const normalizedPreferred = normalizeSymbolInput(preferred);
  if (normalizedPreferred && contracts.some((row) => row.canonicalSymbol === normalizedPreferred)) {
    return normalizedPreferred;
  }
  return contracts.find((row) => row.apiAllowed)?.canonicalSymbol ?? contracts[0]?.canonicalSymbol ?? null;
}

function sendManualTradingError(res: express.Response, error: unknown) {
  if (error instanceof ManualTradingError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      message: error.message
    });
  }

  const unknown = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    options?: {
      status?: unknown;
      code?: unknown;
      message?: unknown;
    };
  };

  const rawStatus = Number(unknown?.status ?? unknown?.options?.status);
  const status = Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus < 600
    ? rawStatus
    : 500;

  const code =
    typeof unknown?.code === "string" && unknown.code.trim()
      ? unknown.code
      : typeof unknown?.options?.code === "string" && unknown.options.code.trim()
        ? unknown.options.code
        : "manual_trading_unexpected_error";

  const message =
    error instanceof Error
      ? error.message
      : typeof unknown?.options?.message === "string" && unknown.options.message.trim()
        ? unknown.options.message
        : "Unexpected manual trading failure.";

  // eslint-disable-next-line no-console
  console.error("[manual-trading]", message, { status, code });

  return res.status(status).json({
    error: code,
    message
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api" });
});

app.get("/system/settings", (_req, res) => {
  res.json({
    tradingEnabled: true,
    readOnlyMode: false,
    orchestrationMode: getRuntimeOrchestrationMode()
  });
});

app.get("/license/state", (_req, res) => {
  res.json({
    enforcement: isLicenseEnforcementEnabled() ? "on" : "off",
    stubEnabled: isLicenseStubEnabled() ? "on" : "off"
  });
});

app.get("/license-server-stub/entitlements", (req, res) => {
  if (!isLicenseStubEnabled()) {
    return res.status(404).json({ error: "stub_disabled" });
  }

  const userId = typeof req.query.userId === "string" ? req.query.userId : "";
  return res.json({
    userId,
    ...getStubEntitlements()
  });
});

app.get("/admin/queue/metrics", requireAuth, async (_req, res) => {
  try {
    const metrics = await getQueueMetrics();
    return res.json(metrics);
  } catch (error) {
    return res.status(503).json({
      error: "queue_unavailable",
      reason: String(error)
    });
  }
});

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email_already_exists" });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.user.create({
    data: {
      email,
      passwordHash
    },
    select: {
      id: true,
      email: true
    }
  });

  await createSession(res, user.id);
  return res.status(201).json({ user: toSafeUser(user) });
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });
  if (!user?.passwordHash) return res.status(401).json({ error: "invalid_credentials" });

  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordOk) return res.status(401).json({ error: "invalid_credentials" });

  await createSession(res, user.id);
  return res.json({ user: toSafeUser(user) });
});

app.post("/auth/logout", async (req, res) => {
  const token = req.cookies?.mm_session ?? null;
  await destroySession(res, token);
  return res.json({ ok: true });
});

app.get("/auth/me", requireAuth, async (_req, res) => {
  return res.json({ user: getUserFromLocals(res) });
});

app.get("/settings/alerts", requireAuth, async (_req, res) => {
  const config = await db.alertConfig.findUnique({
    where: { key: "default" },
    select: {
      telegramBotToken: true,
      telegramChatId: true
    }
  });

  return res.json({
    telegramBotToken: config?.telegramBotToken ?? null,
    telegramChatId: config?.telegramChatId ?? null
  });
});

app.put("/settings/alerts", requireAuth, async (req, res) => {
  const parsed = alertsSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const token = parseTelegramConfigValue(parsed.data.telegramBotToken);
  const chatId = parseTelegramConfigValue(parsed.data.telegramChatId);

  const updated = await db.alertConfig.upsert({
    where: { key: "default" },
    create: {
      key: "default",
      telegramBotToken: token,
      telegramChatId: chatId
    },
    update: {
      telegramBotToken: token,
      telegramChatId: chatId
    },
    select: {
      telegramBotToken: true,
      telegramChatId: true
    }
  });

  return res.json({
    telegramBotToken: updated.telegramBotToken ?? null,
    telegramChatId: updated.telegramChatId ?? null
  });
});

app.post("/alerts/test", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const config = await resolveTelegramConfig();
  if (!config) {
    return res.status(400).json({
      error: "telegram_not_configured",
      details: "Set telegramBotToken + telegramChatId in /settings/notifications"
    });
  }

  try {
    await sendTelegramMessage({
      ...config,
      text: [
        "uTrade Telegram test",
        `User: ${user.email}`,
        `Time: ${new Date().toISOString()}`
      ].join("\n")
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(502).json({
      error: "telegram_send_failed",
      details: String(error)
    });
  }
});

app.get("/api/trading/settings", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const settings = await getTradingSettings(user.id);
  return res.json(settings);
});

app.post("/api/trading/settings", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = tradingSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const settings = await saveTradingSettings(user.id, parsed.data);
  return res.json(settings);
});

app.post("/api/predictions/generate", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const tsCreated = payload.tsCreated ?? new Date().toISOString();
  const tracking = derivePredictionTrackingFromSnapshot(payload.featureSnapshot, payload.timeframe);

  const created = await generateAndPersistPrediction({
    symbol: payload.symbol,
    marketType: payload.marketType,
    timeframe: payload.timeframe,
    tsCreated,
    prediction: payload.prediction,
    featureSnapshot: payload.featureSnapshot,
    tracking,
    userId: user.id,
    botId: payload.botId ?? null,
    modelVersionBase: payload.modelVersionBase
  });

  await notifyTradablePrediction({
    userId: user.id,
    exchange:
      typeof payload.featureSnapshot.prefillExchange === "string" &&
      payload.featureSnapshot.prefillExchange.trim()
        ? payload.featureSnapshot.prefillExchange.trim().toLowerCase()
        : "bitget",
    exchangeAccountLabel:
      typeof payload.featureSnapshot.prefillExchangeAccountId === "string" &&
      payload.featureSnapshot.prefillExchangeAccountId.trim()
        ? payload.featureSnapshot.prefillExchangeAccountId.trim()
        : "n/a",
    symbol: payload.symbol,
    marketType: payload.marketType,
    timeframe: payload.timeframe,
    signal: payload.prediction.signal,
    confidence: payload.prediction.confidence,
    confidenceTargetPct: readConfidenceTarget(payload.featureSnapshot),
    expectedMovePct: payload.prediction.expectedMovePct,
    predictionId: created.rowId,
    explanation: created.explanation.explanation,
    source: "manual"
  });

  return res.status(created.persisted ? 201 : 202).json({
    persisted: created.persisted,
    prediction: {
      symbol: payload.symbol,
      marketType: payload.marketType,
      timeframe: payload.timeframe,
      tsCreated,
      ...payload.prediction
    },
    explanation: created.explanation,
    modelVersion: created.modelVersion,
    predictionId: created.rowId
  });
});

app.post("/api/predictions/generate-auto", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionGenerateAutoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const payload = parsed.data;

  try {
    const created = await generateAutoPredictionForUser(user.id, payload);
    return res.status(created.persisted ? 201 : 202).json({
      persisted: created.persisted,
      prediction: {
        symbol: normalizeSymbolInput(payload.symbol),
        marketType: payload.marketType,
        timeframe: payload.timeframe,
        tsCreated: created.tsCreated,
        ...created.prediction
      },
      directionPreference: payload.directionPreference,
      leverage: payload.leverage ?? null,
      autoSchedule: payload.autoSchedule,
      explanation: created.explanation,
      modelVersion: created.modelVersion,
      predictionId: created.predictionId
    });
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/predictions", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const rows = await db.prediction.findMany({
    where: { userId: user.id },
    orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
    take: parsed.data.limit
  });

  const botIds = rows
    .map((row: any) => (typeof row.botId === "string" && row.botId.trim() ? row.botId : null))
    .filter((value: string | null): value is string => Boolean(value));

  const [bots, exchangeAccounts] = await Promise.all([
    botIds.length > 0
      ? db.bot.findMany({
          where: {
            id: { in: botIds },
            userId: user.id
          },
          select: {
            id: true,
            exchange: true,
            exchangeAccountId: true
          }
        })
      : Promise.resolve([]),
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        exchange: true
      }
    })
  ]);

  const botMap = new Map<string, { exchange: string; exchangeAccountId: string | null }>();
  for (const bot of bots) {
    botMap.set(bot.id, {
      exchange: bot.exchange,
      exchangeAccountId: bot.exchangeAccountId ?? null
    });
  }

  const defaultAccount = exchangeAccounts[0] ?? null;
  const accountMap = new Map<string, { exchange: string }>();
  for (const account of exchangeAccounts) {
    accountMap.set(account.id, { exchange: account.exchange });
  }

  const items = rows.map((row: any) => {
    const linkedBot = typeof row.botId === "string" ? botMap.get(row.botId) : undefined;
    const snapshot = asRecord(row.featuresSnapshot);
    const requestedPrefillAccountId =
      typeof snapshot.prefillExchangeAccountId === "string"
        ? snapshot.prefillExchangeAccountId
        : null;
    const requestedPrefillExchange =
      typeof snapshot.prefillExchange === "string"
        ? snapshot.prefillExchange
        : null;

    const prefillAccountId =
      requestedPrefillAccountId && accountMap.has(requestedPrefillAccountId)
        ? requestedPrefillAccountId
        : null;

    const fallbackAccountId =
      prefillAccountId ??
      linkedBot?.exchangeAccountId ??
      defaultAccount?.id ??
      null;

    const accountExchange = fallbackAccountId ? accountMap.get(fallbackAccountId)?.exchange : null;
    const fallbackExchange =
      requestedPrefillExchange ??
      accountExchange ??
      linkedBot?.exchange ??
      defaultAccount?.exchange ??
      "bitget";

    return {
      id: row.id,
      symbol: row.symbol,
      marketType: normalizePredictionMarketType(row.marketType),
      timeframe: normalizePredictionTimeframe(row.timeframe),
      tsCreated: row.tsCreated.toISOString(),
      signal: normalizePredictionSignal(row.signal),
      expectedMovePct: row.expectedMovePct,
      confidence: row.confidence,
      explanation: typeof row.explanation === "string" ? row.explanation : "",
      tags: asStringArray(row.tags).slice(0, 10),
      entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
      stopLossPrice: Number.isFinite(Number(row.stopLossPrice)) ? Number(row.stopLossPrice) : null,
      takeProfitPrice: Number.isFinite(Number(row.takeProfitPrice)) ? Number(row.takeProfitPrice) : null,
      horizonMs: Number.isFinite(Number(row.horizonMs)) ? Number(row.horizonMs) : null,
      outcomeStatus: typeof row.outcomeStatus === "string" ? row.outcomeStatus : "pending",
      outcomeResult: typeof row.outcomeResult === "string" ? row.outcomeResult : null,
      outcomePnlPct: Number.isFinite(Number(row.outcomePnlPct)) ? Number(row.outcomePnlPct) : null,
      maxFavorablePct: Number.isFinite(Number(row.maxFavorablePct)) ? Number(row.maxFavorablePct) : null,
      maxAdversePct: Number.isFinite(Number(row.maxAdversePct)) ? Number(row.maxAdversePct) : null,
      outcomeEvaluatedAt:
        row.outcomeEvaluatedAt instanceof Date ? row.outcomeEvaluatedAt.toISOString() : null,
      autoScheduleEnabled: isAutoScheduleEnabled(snapshot.autoScheduleEnabled),
      confidenceTargetPct: readConfiguredConfidenceTarget(snapshot),
      exchange: fallbackExchange,
      accountId: fallbackAccountId
    };
  });

  return res.json({
    items
  });
});

app.get("/api/predictions/quality", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const rows = await db.prediction.findMany({
    where: {
      userId: user.id,
      outcomeStatus: "closed"
    },
    orderBy: { tsCreated: "desc" },
    take: 500,
    select: {
      outcomeResult: true,
      outcomePnlPct: true
    }
  });

  let tp = 0;
  let sl = 0;
  let expired = 0;
  let skipped = 0;
  let invalid = 0;
  let pnlSum = 0;
  let pnlCount = 0;

  for (const row of rows) {
    const result = typeof row.outcomeResult === "string" ? row.outcomeResult : "";
    if (result === "tp_hit") tp += 1;
    else if (result === "sl_hit") sl += 1;
    else if (result === "expired") expired += 1;
    else if (result === "skipped") skipped += 1;
    else if (result === "invalid") invalid += 1;

    const pnl = Number(row.outcomePnlPct);
    if (Number.isFinite(pnl)) {
      pnlSum += pnl;
      pnlCount += 1;
    }
  }

  const sampleSize = rows.length;
  const winRatePct = sampleSize > 0 ? Number(((tp / sampleSize) * 100).toFixed(2)) : null;
  const avgOutcomePnlPct = pnlCount > 0 ? Number((pnlSum / pnlCount).toFixed(4)) : null;

  return res.json({
    sampleSize,
    tp,
    sl,
    expired,
    skipped,
    invalid,
    winRatePct,
    avgOutcomePnlPct
  });
});

app.get("/api/predictions/running", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);

  const [rows, exchangeAccounts] = await Promise.all([
    db.prediction.findMany({
      where: { userId: user.id },
      orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
      take: Math.max(200, PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT),
      select: {
        id: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        tsCreated: true,
        featuresSnapshot: true
      }
    }),
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        exchange: true,
        label: true
      }
    })
  ]);

  const accountMap = new Map<string, { exchange: string; label: string }>();
  for (const account of exchangeAccounts) {
    accountMap.set(account.id, {
      exchange: account.exchange,
      label: account.label
    });
  }

  const templateMap = new Map<string, {
    id: string;
    symbol: string;
    marketType: PredictionMarketType;
    timeframe: PredictionTimeframe;
    exchangeAccountId: string;
    exchange: string;
    label: string;
    directionPreference: DirectionPreference;
    confidenceTargetPct: number;
    leverage: number | null;
    paused: boolean;
    tsCreated: string;
    nextRunAt: string;
    dueInSec: number;
  } | null>();

  const now = Date.now();
  for (const row of rows) {
    const snapshot = asRecord(row.featuresSnapshot);
    const exchangeAccountId = readPrefillExchangeAccountId(snapshot);
    if (!exchangeAccountId) continue;

    const symbol = normalizeSymbolInput(row.symbol);
    if (!symbol) continue;

    const timeframe = normalizePredictionTimeframe(row.timeframe);
    const marketType = normalizePredictionMarketType(row.marketType);
    const key = predictionTemplateKey({
      userId: user.id,
      exchangeAccountId,
      symbol,
      marketType,
      timeframe
    });

    if (templateMap.has(key)) continue;

    if (!isAutoScheduleEnabled(snapshot.autoScheduleEnabled)) {
      templateMap.set(key, null);
      continue;
    }
    const paused = isAutoSchedulePaused(snapshot);

    const dueAt = row.tsCreated.getTime() + timeframeToIntervalMs(timeframe);
    const dueInSec = Math.max(0, Math.floor((dueAt - now) / 1000));
    const account = accountMap.get(exchangeAccountId);

    templateMap.set(key, {
      id: row.id,
      symbol,
      marketType,
      timeframe,
      exchangeAccountId,
      exchange: account?.exchange ?? "bitget",
      label: account?.label ?? exchangeAccountId,
      directionPreference: parseDirectionPreference(snapshot.directionPreference),
      confidenceTargetPct: readConfidenceTarget(snapshot),
      leverage: readRequestedLeverage(snapshot) ?? null,
      paused,
      tsCreated: row.tsCreated.toISOString(),
      nextRunAt: new Date(dueAt).toISOString(),
      dueInSec
    });
  }

  const items = Array.from(templateMap.values())
    .filter((item): item is Exclude<typeof item, null> => Boolean(item))
    .sort((a, b) => a.dueInSec - b.dueInSec);

  return res.json({ items });
});

app.post("/api/predictions/:id/pause", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = predictionIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "invalid_prediction_id" });
  }
  const body = predictionPauseSchema.safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: "invalid_payload", details: body.error.flatten() });
  }

  const scope = await resolvePredictionTemplateScope(user.id, params.data.id);
  if (!scope) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const templateRowIds = await findPredictionTemplateRowIds(user.id, {
    symbol: scope.symbol,
    marketType: scope.marketType,
    timeframe: scope.timeframe,
    exchangeAccountId: scope.exchangeAccountId
  });
  const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

  const rows = await db.prediction.findMany({
    where: {
      id: { in: ids },
      userId: user.id
    },
    select: {
      id: true,
      featuresSnapshot: true
    }
  });

  await Promise.all(
    rows.map((row: any) => {
      const snapshot = asRecord(row.featuresSnapshot);
      return db.prediction.update({
        where: { id: row.id },
        data: {
          featuresSnapshot: {
            ...snapshot,
            autoScheduleEnabled: true,
            autoSchedulePaused: body.data.paused
          }
        }
      });
    })
  );

  return res.json({
    ok: true,
    paused: body.data.paused,
    updatedCount: rows.length
  });
});

app.post("/api/predictions/:id/stop", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = predictionIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "invalid_prediction_id" });
  }

  const scope = await resolvePredictionTemplateScope(user.id, params.data.id);
  if (!scope) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const templateRowIds = await findPredictionTemplateRowIds(user.id, {
    symbol: scope.symbol,
    marketType: scope.marketType,
    timeframe: scope.timeframe,
    exchangeAccountId: scope.exchangeAccountId
  });
  const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

  const rows = await db.prediction.findMany({
    where: {
      id: { in: ids },
      userId: user.id
    },
    select: {
      id: true,
      featuresSnapshot: true
    }
  });

  await Promise.all(
    rows.map((row: any) =>
      db.prediction.update({
        where: { id: row.id },
        data: {
          featuresSnapshot: withAutoScheduleFlag(row.featuresSnapshot, false)
        }
      })
    )
  );

  return res.json({
    ok: true,
    stoppedCount: rows.length
  });
});

app.post("/api/predictions/:id/delete-schedule", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = predictionIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "invalid_prediction_id" });
  }

  const scope = await resolvePredictionTemplateScope(user.id, params.data.id);
  if (!scope) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const templateRowIds = await findPredictionTemplateRowIds(user.id, {
    symbol: scope.symbol,
    marketType: scope.marketType,
    timeframe: scope.timeframe,
    exchangeAccountId: scope.exchangeAccountId
  });
  const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

  const deleted = await db.prediction.deleteMany({
    where: {
      userId: user.id,
      id: { in: ids }
    }
  });

  return res.json({
    ok: true,
    deletedCount: deleted.count
  });
});

app.post("/api/predictions/clear-old", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionClearOldSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const olderThanDays = parsed.data.olderThanDays;
  const keepRunningTemplates = parsed.data.keepRunningTemplates;
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const preservedIds = new Set<string>();
  if (keepRunningTemplates) {
    const rows = await db.prediction.findMany({
      where: { userId: user.id },
      orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        featuresSnapshot: true
      }
    });

    const seen = new Set<string>();
    for (const row of rows) {
      const snapshot = asRecord(row.featuresSnapshot);
      const exchangeAccountId = readPrefillExchangeAccountId(snapshot);
      if (!exchangeAccountId) continue;

      const symbol = normalizeSymbolInput(row.symbol);
      if (!symbol) continue;

      const key = predictionTemplateKey({
        userId: user.id,
        exchangeAccountId,
        symbol,
        marketType: normalizePredictionMarketType(row.marketType),
        timeframe: normalizePredictionTimeframe(row.timeframe)
      });
      if (seen.has(key)) continue;
      seen.add(key);

      if (isAutoScheduleEnabled(snapshot.autoScheduleEnabled)) {
        preservedIds.add(row.id);
      }
    }
  }

  const oldRows = await db.prediction.findMany({
    where: {
      userId: user.id,
      tsCreated: { lt: cutoff }
    },
    select: { id: true }
  });

  const deleteIds = oldRows
    .map((row: any) => row.id)
    .filter((id: string) => !preservedIds.has(id));

  if (deleteIds.length === 0) {
    return res.json({
      ok: true,
      olderThanDays,
      cutoffIso: cutoff.toISOString(),
      deletedCount: 0,
      preservedCount: preservedIds.size
    });
  }

  const deleted = await db.prediction.deleteMany({
    where: {
      userId: user.id,
      id: { in: deleteIds }
    }
  });

  return res.json({
    ok: true,
    olderThanDays,
    cutoffIso: cutoff.toISOString(),
    deletedCount: deleted.count,
    preservedCount: preservedIds.size
  });
});

app.post("/api/predictions/delete-many", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionDeleteManySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const uniqueIds = Array.from(new Set(parsed.data.ids));
  if (uniqueIds.length === 0) {
    return res.json({ ok: true, deletedCount: 0 });
  }

  const deleted = await db.prediction.deleteMany({
    where: {
      userId: user.id,
      id: { in: uniqueIds }
    }
  });

  return res.json({
    ok: true,
    deletedCount: deleted.count
  });
});

app.get("/api/predictions/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = predictionIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "invalid_prediction_id" });
  }

  const row = await db.prediction.findFirst({
    where: {
      id: params.data.id,
      userId: user.id
    }
  });

  if (!row) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const [linkedBot, exchangeAccounts] = await Promise.all([
    row.botId
      ? db.bot.findFirst({
          where: {
            id: row.botId,
            userId: user.id
          },
          select: {
            exchange: true,
            exchangeAccountId: true
          }
        })
      : Promise.resolve(null),
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        exchange: true
      }
    })
  ]);

  const accountMap = new Map<string, { exchange: string }>();
  for (const account of exchangeAccounts) {
    accountMap.set(account.id, { exchange: account.exchange });
  }
  const defaultAccount = exchangeAccounts[0] ?? null;

  const snapshot = asRecord(row.featuresSnapshot);
  const requestedPrefillAccountId =
    typeof snapshot.prefillExchangeAccountId === "string"
      ? snapshot.prefillExchangeAccountId
      : null;
  const requestedPrefillExchange =
    typeof snapshot.prefillExchange === "string"
      ? snapshot.prefillExchange
      : null;
  const prefillAccountId =
    requestedPrefillAccountId && accountMap.has(requestedPrefillAccountId)
      ? requestedPrefillAccountId
      : null;

  const suggestedEntry = deriveSuggestedEntry(snapshot);
  const suggestedStopLoss = pickNumber(snapshot, ["suggestedStopLoss", "stopLoss", "slPrice", "sl"]);
  const suggestedTakeProfit = pickNumber(snapshot, ["suggestedTakeProfit", "takeProfit", "tpPrice", "tp"]);
  const requestedLeverageRaw = pickNumber(snapshot, ["requestedLeverage", "leverage"]);
  const requestedLeverage =
    requestedLeverageRaw !== null && Number.isFinite(requestedLeverageRaw)
      ? Math.max(1, Math.min(125, Math.trunc(requestedLeverageRaw)))
      : null;
  const positionSizeHint = derivePositionSizeHint(snapshot);

  const resolvedAccountId =
    prefillAccountId ??
    linkedBot?.exchangeAccountId ??
    defaultAccount?.id ??
    null;

  const resolvedExchangeFromAccount =
    resolvedAccountId ? accountMap.get(resolvedAccountId)?.exchange : null;

  return res.json({
    id: row.id,
    predictionId: row.id,
    symbol: row.symbol,
    marketType: normalizePredictionMarketType(row.marketType),
    timeframe: normalizePredictionTimeframe(row.timeframe),
    tsCreated: row.tsCreated.toISOString(),
    signal: normalizePredictionSignal(row.signal),
    expectedMovePct: row.expectedMovePct,
    confidence: row.confidence,
    leverage: requestedLeverage,
    explanation: typeof row.explanation === "string" ? row.explanation : "",
    tags: asStringArray(row.tags).slice(0, 10),
    keyDrivers: derivePredictionKeyDrivers(snapshot),
    exchange:
      requestedPrefillExchange ??
      resolvedExchangeFromAccount ??
      linkedBot?.exchange ??
      defaultAccount?.exchange ??
      "bitget",
    accountId: resolvedAccountId,
    suggestedEntry,
    suggestedStopLoss,
    suggestedTakeProfit,
    positionSizeHint,
    entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
    stopLossPrice: Number.isFinite(Number(row.stopLossPrice)) ? Number(row.stopLossPrice) : null,
    takeProfitPrice: Number.isFinite(Number(row.takeProfitPrice)) ? Number(row.takeProfitPrice) : null,
    horizonMs: Number.isFinite(Number(row.horizonMs)) ? Number(row.horizonMs) : null,
    outcomeStatus: typeof row.outcomeStatus === "string" ? row.outcomeStatus : "pending",
    outcomeResult: typeof row.outcomeResult === "string" ? row.outcomeResult : null,
    outcomeReason: typeof row.outcomeReason === "string" ? row.outcomeReason : null,
    outcomePnlPct: Number.isFinite(Number(row.outcomePnlPct)) ? Number(row.outcomePnlPct) : null,
    maxFavorablePct: Number.isFinite(Number(row.maxFavorablePct)) ? Number(row.maxFavorablePct) : null,
    maxAdversePct: Number.isFinite(Number(row.maxAdversePct)) ? Number(row.maxAdversePct) : null,
    outcomeEvaluatedAt:
      row.outcomeEvaluatedAt instanceof Date ? row.outcomeEvaluatedAt.toISOString() : null
  });
});

app.get("/api/symbols", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const symbols = await listSymbols(adapter);
      return res.json({
        exchangeAccountId: account.id,
        exchange: account.exchange,
        ...symbols
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/account/summary", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const [summary, positions] = await Promise.all([
        adapter.getAccountState(),
        adapter.getPositions()
      ]);

      return res.json({
        exchangeAccountId: account.id,
        exchange: account.exchange,
        equity: summary.equity ?? null,
        availableMargin: summary.availableMargin ?? null,
        marginMode: summary.marginMode ?? null,
        positionsCount: positions.length,
        updatedAt: new Date().toISOString()
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/account/leverage", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = adjustLeverageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }

      await adapter.setLeverage(
        symbol,
        parsed.data.leverage,
        parsed.data.marginMode
      );

      return res.json({
        ok: true,
        exchangeAccountId: account.id,
        symbol,
        leverage: parsed.data.leverage,
        marginMode: parsed.data.marginMode
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/positions", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const symbol = normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);

    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const items = await listPositions(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: account.id,
        items
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/orders/open", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const symbol = normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);

    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const items = await listOpenOrders(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: account.id,
        items
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }

      if (parsed.data.leverage !== undefined) {
        await adapter.setLeverage(
          symbol,
          parsed.data.leverage,
          parsed.data.marginMode ?? "cross"
        );
      }

      const side = parsed.data.side === "long" ? "buy" : "sell";
      const placed = await adapter.placeOrder({
        symbol,
        side,
        type: parsed.data.type,
        qty: parsed.data.qty,
        price: parsed.data.price,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice,
        reduceOnly: parsed.data.reduceOnly
      });

      return res.status(201).json({
        exchangeAccountId: account.id,
        orderId: placed.orderId,
        status: "accepted"
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders/cancel", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = cancelOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (symbol) {
        await adapter.tradeApi.cancelOrder({
          symbol: await adapter.toExchangeSymbol(symbol),
          orderId: parsed.data.orderId,
          productType: adapter.productType
        });
      } else {
        await adapter.cancelOrder(parsed.data.orderId);
      }
      return res.json({ ok: true });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders/cancel-all", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : typeof req.body?.exchangeAccountId === "string"
        ? req.body.exchangeAccountId
        : undefined;
    const symbol = normalizeSymbolInput(
      typeof req.query.symbol === "string"
        ? req.query.symbol
        : typeof req.body?.symbol === "string"
          ? req.body.symbol
          : null
    );
    const account = await resolveTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(account);

    try {
      const result = await cancelAllOrders(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: account.id,
        ...result
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/positions/close", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = closePositionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(account);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }
      const orderIds = await closePositionsMarket(adapter, symbol, parsed.data.side);
      return res.json({
        exchangeAccountId: account.id,
        closedCount: orderIds.length,
        orderIds
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/exchange-accounts", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const rows = await db.exchangeAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  const items = rows.map((row: any) => {
    let apiKeyMasked = "****";
    try {
      apiKeyMasked = maskSecret(decryptSecret(row.apiKeyEnc));
    } catch {
      apiKeyMasked = "****";
    }
    return {
      id: row.id,
      exchange: row.exchange,
      label: row.label,
      apiKeyMasked,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt
    };
  });

  return res.json({ items });
});

app.get("/dashboard/overview", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const [accounts, bots] = await Promise.all([
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        spotBudgetTotal: true,
        spotBudgetAvailable: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        lastSyncErrorAt: true,
        lastSyncErrorMessage: true
      }
    }),
    db.bot.findMany({
      where: {
        userId: user.id,
        exchangeAccountId: { not: null }
      },
      select: {
        id: true,
        exchangeAccountId: true,
        status: true,
        lastError: true,
        runtime: {
          select: {
            updatedAt: true,
            lastHeartbeatAt: true,
            lastTickAt: true,
            lastError: true,
            freeUsdt: true
          }
        }
      }
    })
  ]);

  const aggregate = new Map<string, {
    running: number;
    stopped: number;
    error: number;
    latestSyncAt: Date | null;
    latestRuntimeAt: Date | null;
    latestRuntimeFreeUsdt: number | null;
    lastErrorMessage: string | null;
  }>();

  for (const account of accounts) {
    aggregate.set(account.id, {
      running: 0,
      stopped: 0,
      error: 0,
      latestSyncAt: null,
      latestRuntimeAt: null,
      latestRuntimeFreeUsdt: null,
      lastErrorMessage: null
    });
  }

  for (const bot of bots) {
    const exchangeAccountId = bot.exchangeAccountId as string | null;
    if (!exchangeAccountId) continue;
    const current = aggregate.get(exchangeAccountId);
    if (!current) continue;

    if (bot.status === "running") current.running += 1;
    else if (bot.status === "error") current.error += 1;
    else current.stopped += 1;

    if (!current.lastErrorMessage) {
      current.lastErrorMessage = bot.lastError ?? bot.runtime?.lastError ?? null;
    }

    const lastSyncAt = resolveLastSyncAt(bot.runtime);
    if (lastSyncAt && (!current.latestSyncAt || lastSyncAt.getTime() > current.latestSyncAt.getTime())) {
      current.latestSyncAt = lastSyncAt;
    }

    const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
    if (runtimeUpdatedAt && (!current.latestRuntimeAt || runtimeUpdatedAt.getTime() > current.latestRuntimeAt.getTime())) {
      current.latestRuntimeAt = runtimeUpdatedAt;
      current.latestRuntimeFreeUsdt =
        typeof bot.runtime?.freeUsdt === "number" ? bot.runtime.freeUsdt : null;
    }
  }

  const overview: ExchangeAccountOverview[] = accounts.map((account) => {
    const row = aggregate.get(account.id);
    const lastSyncAt = row?.latestSyncAt ?? account.lastUsedAt ?? null;
    const hasBotActivity =
      ((row?.running ?? 0) + (row?.stopped ?? 0) + (row?.error ?? 0)) > 0;
    const status = computeConnectionStatus(lastSyncAt, hasBotActivity);

    return {
      exchangeAccountId: account.id,
      exchange: account.exchange,
      label: account.label,
      status,
      lastSyncAt: toIso(lastSyncAt),
      spotBudget:
        account.spotBudgetTotal !== null || account.spotBudgetAvailable !== null
          ? {
              total: account.spotBudgetTotal,
              available: account.spotBudgetAvailable
            }
          : null,
      futuresBudget: (() => {
        const availableMargin =
          row?.latestRuntimeFreeUsdt !== null && row?.latestRuntimeFreeUsdt !== undefined
            ? row.latestRuntimeFreeUsdt
            : account.futuresBudgetAvailableMargin;
        const equity = account.futuresBudgetEquity;
        if (equity === null && availableMargin === null) return null;
        return {
          equity,
          availableMargin
        };
      })(),
      pnlTodayUsd: account.pnlTodayUsd ?? null,
      lastSyncError:
        account.lastSyncErrorAt || account.lastSyncErrorMessage
          ? {
              at: toIso(account.lastSyncErrorAt),
              message: account.lastSyncErrorMessage ?? null
            }
          : null,
      bots: {
        running: row?.running ?? 0,
        stopped: row?.stopped ?? 0,
        error: row?.error ?? 0
      },
      alerts: {
        hasErrors: (row?.error ?? 0) > 0,
        message: row?.lastErrorMessage ?? null
      }
    };
  });

  return res.json(overview);
});

app.post("/exchange-accounts", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = exchangeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const created = await db.exchangeAccount.create({
    data: {
      userId: user.id,
      exchange: parsed.data.exchange.toLowerCase(),
      label: parsed.data.label,
      apiKeyEnc: encryptSecret(parsed.data.apiKey),
      apiSecretEnc: encryptSecret(parsed.data.apiSecret),
      passphraseEnc: parsed.data.passphrase ? encryptSecret(parsed.data.passphrase) : null
    }
  });

  return res.status(201).json({
    id: created.id,
    exchange: created.exchange,
    label: created.label,
    apiKeyMasked: maskSecret(parsed.data.apiKey)
  });
});

app.delete("/exchange-accounts/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const id = req.params.id;
  const account = await db.exchangeAccount.findFirst({
    where: { id, userId: user.id }
  });
  if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

  const linkedBots = await db.bot.count({
    where: { userId: user.id, exchangeAccountId: id }
  });
  if (linkedBots > 0) {
    return res.status(409).json({ error: "exchange_account_in_use" });
  }

  await db.exchangeAccount.delete({ where: { id } });
  return res.json({ ok: true });
});

app.post("/exchange-accounts/:id/test-connection", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const id = req.params.id;
  const account: ExchangeAccountSecrets | null = await db.exchangeAccount.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      exchange: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true
    }
  });
  if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

  try {
    const synced = await executeExchangeSync(account);
    await persistExchangeSyncSuccess(account.id, synced);

    return res.json({
      ok: true,
      message: "sync_ok",
      syncedAt: synced.syncedAt.toISOString(),
      spotBudget: synced.spotBudget,
      futuresBudget: synced.futuresBudget,
      pnlTodayUsd: synced.pnlTodayUsd,
      details: synced.details
    });
  } catch (error) {
    await persistExchangeSyncFailure(
      account.id,
      error instanceof ExchangeSyncError
        ? error.message
        : "Manual sync failed due to unexpected error."
    );

    if (error instanceof ExchangeSyncError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code
      });
    }
    return res.status(500).json({
      error: "exchange_sync_failed",
      message: "Unexpected exchange sync failure."
    });
  }
});

app.get("/bots", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const bots = await db.bot.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });
  return res.json(bots.map(toSafeBot));
});

app.get("/bots/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: {
      id: req.params.id,
      userId: user.id
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });

  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  return res.json(toSafeBot(bot));
});

app.get("/bots/:id/runtime", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const runtime = await db.botRuntime.findUnique({
    where: { botId: req.params.id },
    select: {
      botId: true,
      status: true,
      reason: true,
      updatedAt: true,
      workerId: true,
      lastHeartbeatAt: true,
      lastTickAt: true,
      lastError: true,
      consecutiveErrors: true,
      errorWindowStartAt: true,
      lastErrorAt: true,
      lastErrorMessage: true
    }
  });
  if (!runtime) return res.status(404).json({ error: "runtime_not_found" });
  return res.json(runtime);
});

app.get("/bots/:id/risk-events", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const items = await db.riskEvent.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return res.json({ items });
});

app.post("/bots", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = botCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const account = await db.exchangeAccount.findFirst({
    where: {
      id: parsed.data.exchangeAccountId,
      userId: user.id
    }
  });
  if (!account) return res.status(400).json({ error: "exchange_account_not_found" });

  const created = await db.bot.create({
    data: {
      userId: user.id,
      exchangeAccountId: account.id,
      name: parsed.data.name,
      symbol: parsed.data.symbol,
      exchange: account.exchange,
      status: "stopped",
      lastError: null,
      futuresConfig: {
        create: {
          strategyKey: parsed.data.strategyKey,
          marginMode: parsed.data.marginMode,
          leverage: parsed.data.leverage,
          tickMs: parsed.data.tickMs,
          paramsJson: parsed.data.paramsJson
        }
      }
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      }
    }
  });

  return res.status(201).json(toSafeBot(created));
});

app.post("/bots/:id/start", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    include: { futuresConfig: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  if (!bot.futuresConfig) return res.status(409).json({ error: "futures_config_missing" });

  const [totalBots, runningBots] = await Promise.all([
    db.bot.count({ where: { userId: user.id } }),
    db.bot.count({ where: { userId: user.id, status: "running" } })
  ]);

  const decision = await enforceBotStartLicense({
    userId: user.id,
    exchange: bot.exchange,
    totalBots,
    runningBots,
    isAlreadyRunning: bot.status === "running"
  });
  if (!decision.allowed) {
    return res.status(403).json({
      error: "license_blocked",
      reason: decision.reason
    });
  }

  const updated = await db.bot.update({
    where: { id: bot.id },
    data: {
      status: "running",
      lastError: null
    }
  });

  await db.botRuntime.upsert({
    where: { botId: bot.id },
    update: {
      status: "running",
      reason: "start_requested",
      lastError: null,
      lastHeartbeatAt: new Date()
    },
    create: {
      botId: bot.id,
      status: "running",
      reason: "start_requested",
      lastError: null,
      lastHeartbeatAt: new Date()
    }
  });

  try {
    await enqueueBotRun(bot.id);
  } catch (error) {
    const reason = `queue_enqueue_failed:${String(error)}`;
    await Promise.allSettled([
      db.bot.update({
        where: { id: bot.id },
        data: {
          status: "error",
          lastError: reason
        }
      }),
      db.botRuntime.upsert({
        where: { botId: bot.id },
        update: {
          status: "error",
          reason,
          lastError: reason,
          lastHeartbeatAt: new Date()
        },
        create: {
          botId: bot.id,
          status: "error",
          reason,
          lastError: reason,
          lastHeartbeatAt: new Date()
        }
      })
    ]);

    return res.status(503).json({
      error: "queue_enqueue_failed",
      reason: String(error)
    });
  }

  return res.json({ id: updated.id, status: updated.status });
});

app.post("/bots/:id/stop", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const updated = await db.bot.update({
    where: { id: bot.id },
    data: {
      status: "stopped"
    }
  });

  await db.botRuntime.upsert({
    where: { botId: bot.id },
    update: {
      status: "stopped",
      reason: "stopped_by_user",
      lastHeartbeatAt: new Date()
    },
    create: {
      botId: bot.id,
      status: "stopped",
      reason: "stopped_by_user",
      lastHeartbeatAt: new Date()
    }
  });

  try {
    await cancelBotRun(bot.id);
  } catch {
    // Worker loop also exits on DB status check even if queue cleanup is unavailable.
  }

  return res.json({ id: updated.id, status: updated.status });
});

function wsSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function coerceFirstItem(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (payload && typeof payload === "object") {
    const list = (payload as Record<string, unknown>).list;
    if (Array.isArray(list)) return list[0] ?? null;
  }
  return payload;
}

async function handleMarketWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");
  const requestedSymbol = url.searchParams.get("symbol");

  let context: MarketWsContext | null = null;
  let cleaned = false;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (context) await context.stop();
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const resolved = await createMarketWsContext(
      user.id,
      exchangeAccountId ?? settings.exchangeAccountId
    );
    context = resolved.ctx;

    const contracts = context.adapter.contractCache.snapshot();
    const symbol = pickWsSymbol(
      requestedSymbol ?? settings.symbol,
      contracts.map((row) => ({
        canonicalSymbol: row.canonicalSymbol,
        apiAllowed: row.apiAllowed
      }))
    );
    if (!symbol) {
      throw new ManualTradingError("no_symbols_available", 404, "no_symbols_available");
    }

    await saveTradingSettings(user.id, {
      exchangeAccountId: resolved.accountId,
      symbol
    });

    unsubs.push(
      context.adapter.onTicker((payload) => {
        const row = coerceFirstItem(extractWsDataArray(payload));
        const normalized = normalizeTickerPayload(row);
        wsSend(socket, {
          type: "ticker",
          symbol,
          data: {
            ...normalized,
            symbol
          }
        });
      })
    );
    unsubs.push(
      context.adapter.onDepth((payload) => {
        const row = coerceFirstItem(extractWsDataArray(payload));
        const normalized = normalizeOrderBookPayload(row);
        wsSend(socket, {
          type: "orderbook",
          symbol,
          data: normalized
        });
      })
    );
    unsubs.push(
      (context.adapter as any).onTrades((payload: unknown) => {
        const rows = extractWsDataArray(payload);
        const normalized = normalizeTradesPayload(rows).map((trade) => ({
          ...trade,
          symbol: symbol
        }));
        wsSend(socket, {
          type: "trades",
          symbol,
          data: normalized
        });
      })
    );

    await Promise.all([
      context.adapter.subscribeTicker(symbol),
      context.adapter.subscribeDepth(symbol),
      (context.adapter as any).subscribeTrades(symbol)
    ]);

    const exchangeSymbol = await context.adapter.toExchangeSymbol(symbol);

    const [tickerSnapshot, depthSnapshot, tradesSnapshot] = await Promise.allSettled([
      context.adapter.marketApi.getTicker(exchangeSymbol, context.adapter.productType),
      context.adapter.marketApi.getDepth(exchangeSymbol, 50, context.adapter.productType),
      context.adapter.marketApi.getTrades(exchangeSymbol, 60, context.adapter.productType)
    ]);

    if (tickerSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:ticker",
        symbol,
        data: {
          ...normalizeTickerPayload(coerceFirstItem(tickerSnapshot.value)),
          symbol
        }
      });
    }

    if (depthSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:orderbook",
        symbol,
        data: normalizeOrderBookPayload(depthSnapshot.value)
      });
    }

    if (tradesSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:trades",
        symbol,
        data: normalizeTradesPayload(tradesSnapshot.value).map((trade) => ({
          ...trade,
          symbol
        }))
      });
    }

    wsSend(socket, {
      type: "ready",
      exchangeAccountId: resolved.accountId,
      symbol
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "market_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });

  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

async function handleUserWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");

  let context: MarketWsContext | null = null;
  let cleaned = false;
  let balanceTimer: NodeJS.Timeout | null = null;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (balanceTimer) clearInterval(balanceTimer);
    if (context) await context.stop();
    balanceTimer = null;
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const resolved = await createMarketWsContext(
      user.id,
      exchangeAccountId ?? settings.exchangeAccountId
    );
    context = resolved.ctx;

    await saveTradingSettings(user.id, {
      exchangeAccountId: resolved.accountId
    });

    unsubs.push(
      context.adapter.onFill((event) => {
        wsSend(socket, {
          type: "fill",
          data: event
        });
      })
    );
    unsubs.push(
      context.adapter.onOrderUpdate((event) => {
        wsSend(socket, {
          type: "order",
          data: event
        });
      })
    );
    unsubs.push(
      context.adapter.onPositionUpdate((event) => {
        wsSend(socket, {
          type: "position",
          data: event
        });
      })
    );

    const sendSummary = async () => {
      if (!context) return;
      const [accountSummary, positions, openOrders] = await Promise.all([
        context.adapter.getAccountState(),
        listPositions(context.adapter),
        listOpenOrders(context.adapter)
      ]);
      wsSend(socket, {
        type: "account",
        data: {
          exchangeAccountId: resolved.accountId,
          equity: accountSummary.equity ?? null,
          availableMargin: accountSummary.availableMargin ?? null,
          positions,
          openOrders
        }
      });
    };

    await sendSummary();
    balanceTimer = setInterval(() => {
      void sendSummary().catch(() => {
        // ignore timer errors
      });
    }, 10_000);

    wsSend(socket, {
      type: "ready",
      exchangeAccountId: resolved.accountId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "user_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });
  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

const marketWss = new WebSocketServer({ noServer: true });
const userWss = new WebSocketServer({ noServer: true });

const port = Number(process.env.API_PORT ?? "4000");
const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (url.pathname !== "/ws/market" && url.pathname !== "/ws/user") {
    wsReject(socket, 404, "Not Found");
    return;
  }

  void (async () => {
    const user = await authenticateWsUser(req);
    if (!user) {
      wsReject(socket, 401, "Unauthorized");
      return;
    }

    if (url.pathname === "/ws/market") {
      marketWss.handleUpgrade(req, socket, head, (ws) => {
        void handleMarketWsConnection(ws, user, url);
      });
      return;
    }

    userWss.handleUpgrade(req, socket, head, (ws) => {
      void handleUserWsConnection(ws, user, url);
    });
  })().catch(() => {
    wsReject(socket, 500, "Internal Server Error");
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}`);
  startExchangeAutoSyncScheduler();
  startPredictionAutoScheduler();
  startPredictionOutcomeEvalScheduler();
});

process.on("SIGTERM", () => {
  stopExchangeAutoSyncScheduler();
  stopPredictionAutoScheduler();
  stopPredictionOutcomeEvalScheduler();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});

process.on("SIGINT", () => {
  stopExchangeAutoSyncScheduler();
  stopPredictionAutoScheduler();
  stopPredictionOutcomeEvalScheduler();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});
