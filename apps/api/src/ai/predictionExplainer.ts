import { z } from "zod";
import { logger } from "../logger.js";
import { analyzeWithAiGuards, hashStableObject } from "./analyzer.js";
import { callAi, getAiModel } from "./provider.js";
import {
  filterFeatureSnapshotForAiPrompt,
  getAiPromptRuntimeSettings,
  type AiPromptScopeContext,
  type AiPromptRuntimeSettings
} from "./promptSettings.js";
import { recordAiTraceLog } from "./traceLog.js";
import {
  HISTORY_CONTEXT_HARD_CAP_BYTES,
  trimHistoryContextForAi,
  type HistoryContextPack
} from "./historyContext.js";

export type ExplainerInput = {
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  tsCreated: string;
  prediction: {
    signal: "up" | "down" | "neutral";
    expectedMovePct: number;
    confidence: number;
  };
  featureSnapshot: Record<string, unknown>;
};

export type ExplainerOutput = {
  explanation: string;
  tags: string[];
  keyDrivers: { name: string; value: unknown }[];
  aiPrediction: {
    signal: "up" | "down" | "neutral";
    expectedMovePct: number;
    confidence: number;
  };
  disclaimer: "grounded_features_only";
};

export const EXPLAINER_TAG_ALLOWLIST = [
  "high_vol",
  "low_vol",
  "trend_up",
  "trend_down",
  "range_bound",
  "breakout_risk",
  "mean_reversion",
  "low_liquidity",
  "funding_risk",
  "news_risk",
  "data_gap"
] as const;

type ExplainerTag = (typeof EXPLAINER_TAG_ALLOWLIST)[number];

const allowlist = new Set<string>(EXPLAINER_TAG_ALLOWLIST);

const baseOutputSchema = z.object({
  explanation: z.string().min(1).max(400),
  tags: z.array(z.string()).max(5),
  keyDrivers: z.array(
    z.object({
      name: z.string().min(1).max(120),
      value: z.unknown()
    })
  ).max(5),
  aiPrediction: z
    .object({
      signal: z.enum(["up", "down", "neutral"]),
      expectedMovePct: z.number(),
      confidence: z.number()
    })
    .optional(),
  disclaimer: z.literal("grounded_features_only")
});

type GenerateDeps = {
  callAiFn?: typeof callAi;
  promptSettings?: AiPromptRuntimeSettings;
  promptScopeContext?: AiPromptScopeContext;
  requireSuccessfulAi?: boolean;
};

export type ExplainerPromptPreview = {
  scopeContext: AiPromptScopeContext;
  runtimeSettings: AiPromptRuntimeSettings;
  systemMessage: string;
  userPayload: Record<string, unknown>;
  promptInput: ExplainerInput;
  cacheKey: string;
};

const SYSTEM_MESSAGE =
  "You are a trading assistant. You must only use the provided JSON featureSnapshot. " +
  "If a value is missing, say 'unknown' or omit it. Do not mention news unless featureSnapshot contains a 'newsRisk' flag. " +
  "You may reference indicators only when values exist under featureSnapshot.indicators (including stochrsi, volume, fvg) " +
  "or under featureSnapshot.advancedIndicators (emas, cloud, levels, ranges, sessions, pvsra, smartMoneyConcepts). " +
  "You may reference featureSnapshot.historyContext only when it is present. " +
  "Do not claim volume spikes or fair value gaps unless those fields explicitly support it. " +
  "Never mention TradingView.";

function readEnvNumber(
  value: string | undefined,
  fallback: number,
  min: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

const EXPLAINER_TIMEOUT_MS = readEnvNumber(
  process.env.AI_EXPLAINER_TIMEOUT_MS ?? process.env.AI_TIMEOUT_MS,
  15000,
  1000
);
const EXPLAINER_MAX_TOKENS = readEnvNumber(
  process.env.AI_EXPLAINER_MAX_TOKENS,
  650,
  300
);
const EXPLAINER_RETRY_MAX_TOKENS = readEnvNumber(
  process.env.AI_EXPLAINER_RETRY_MAX_TOKENS,
  Math.max(EXPLAINER_MAX_TOKENS + 350, Math.trunc(EXPLAINER_MAX_TOKENS * 1.5)),
  EXPLAINER_MAX_TOKENS
);
const EXPLAINER_HISTORY_CONTEXT_MAX_EVENTS = normalizeHistoryContextMaxEvents(
  process.env.AI_EXPLAINER_HISTORY_CONTEXT_MAX_EVENTS
);
const EXPLAINER_HISTORY_CONTEXT_LAST_BARS = normalizeHistoryContextLastBars(
  process.env.AI_EXPLAINER_HISTORY_CONTEXT_LAST_BARS
);
const EXPLAINER_HISTORY_CONTEXT_MAX_BYTES = normalizeHistoryContextMaxBytes(
  process.env.AI_EXPLAINER_HISTORY_CONTEXT_MAX_BYTES
);

function withTraceMetaPayload(
  userPayload: Record<string, unknown>,
  retryUsed: boolean,
  retryCount: number
): Record<string, unknown> {
  return {
    ...userPayload,
    __trace: {
      retryUsed,
      retryCount: Math.max(0, Math.trunc(retryCount))
    }
  };
}

function buildSystemMessage(customPromptText: string): string {
  const trimmed = customPromptText.trim();
  if (!trimmed) return SYSTEM_MESSAGE;
  return `${SYSTEM_MESSAGE}\n\nOperator instructions:\n${trimmed}`;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeHistoryContextMaxEvents(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(5, Math.min(30, Math.trunc(parsed)));
}

function normalizeHistoryContextLastBars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(10, Math.min(30, Math.trunc(parsed)));
}

function normalizeHistoryContextMaxBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return HISTORY_CONTEXT_HARD_CAP_BYTES;
  return Math.max(1024, Math.min(HISTORY_CONTEXT_HARD_CAP_BYTES, Math.trunc(parsed)));
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function getByPath(snapshot: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return snapshot[path];
  let cursor: unknown = snapshot;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    const record = cursor as Record<string, unknown>;
    cursor = record[segment];
    if (cursor === undefined && segment === "advancedIndicators") {
      cursor = record.tradersReality;
    } else if (cursor === undefined && segment === "tradersReality") {
      cursor = record.advancedIndicators;
    }
  }
  return cursor;
}

function pickNumberByPaths(snapshot: Record<string, unknown>, paths: string[]): number | null {
  for (const path of paths) {
    const val = toNumber(getByPath(snapshot, path));
    if (val !== null) return val;
  }
  return null;
}

function pickBooleanByPaths(snapshot: Record<string, unknown>, paths: string[]): boolean | null {
  for (const path of paths) {
    const val = toBoolean(getByPath(snapshot, path));
    if (val !== null) return val;
  }
  return null;
}

function boundedConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function confidenceLabel(value: number): "low" | "medium" | "high" {
  if (value >= 0.67) return "high";
  if (value >= 0.4) return "medium";
  return "low";
}

function normalizeTags(tags: string[]): ExplainerTag[] {
  const deduped = new Set<ExplainerTag>();
  for (const tag of tags) {
    if (!allowlist.has(tag)) continue;
    deduped.add(tag as ExplainerTag);
    if (deduped.size >= 5) break;
  }
  return [...deduped];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeOhlcvBarsLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(20, Math.min(500, Math.trunc(parsed)));
}

function applyOhlcvBarsLimit(
  snapshot: Record<string, unknown>,
  maxBars: number
): Record<string, unknown> {
  const seriesRaw = snapshot.ohlcvSeries;
  if (!seriesRaw || typeof seriesRaw !== "object" || Array.isArray(seriesRaw)) {
    return snapshot;
  }
  const series = seriesRaw as Record<string, unknown>;
  const bars = Array.isArray(series.bars) ? series.bars : [];
  const limit = normalizeOhlcvBarsLimit(maxBars);
  if (bars.length <= limit) {
    if (Number(series.count) === bars.length) return snapshot;
    return {
      ...snapshot,
      ohlcvSeries: {
        ...series,
        count: bars.length
      }
    };
  }
  const trimmedBars = bars.slice(-limit);
  return {
    ...snapshot,
    ohlcvSeries: {
      ...series,
      bars: trimmedBars,
      count: trimmedBars.length
    }
  };
}

function applyHistoryContextLimit(snapshot: Record<string, unknown>): Record<string, unknown> {
  const historyContextRaw = asObject(snapshot.historyContext);
  if (!historyContextRaw) return snapshot;
  if (Number(historyContextRaw.v) !== 1) return snapshot;
  const lastBars = asObject(historyContextRaw.lastBars);
  if (!lastBars || !Array.isArray(lastBars.ohlc)) return snapshot;
  if (!Array.isArray(historyContextRaw.ev)) {
    return snapshot;
  }
  const trimmed = trimHistoryContextForAi(historyContextRaw as unknown as HistoryContextPack, {
    maxEvents: EXPLAINER_HISTORY_CONTEXT_MAX_EVENTS,
    lastBars: EXPLAINER_HISTORY_CONTEXT_LAST_BARS,
    maxBytes: EXPLAINER_HISTORY_CONTEXT_MAX_BYTES
  });

  return {
    ...snapshot,
    historyContext: trimmed
  };
}

function normalizeAiPrediction(
  value: unknown
): { signal: "up" | "down" | "neutral"; expectedMovePct: number; confidence: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const signal = record.signal;
  if (signal !== "up" && signal !== "down" && signal !== "neutral") return null;
  const confidenceRaw = toNumber(record.confidence);
  const expectedMoveRaw = toNumber(record.expectedMovePct);
  if (confidenceRaw === null || expectedMoveRaw === null) return null;
  const confidence = confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100;
  return {
    signal,
    confidence: Number(clamp(confidence, 0, 1).toFixed(4)),
    expectedMovePct: Number(clamp(Math.abs(expectedMoveRaw), 0, 25).toFixed(2))
  };
}

function deriveFallbackAiPrediction(input: {
  featureSnapshot: Record<string, unknown>;
  baselinePrediction?: ExplainerInput["prediction"];
}): { signal: "up" | "down" | "neutral"; expectedMovePct: number; confidence: number } {
  const snapshot = input.featureSnapshot ?? {};
  const trend = pickNumberByPaths(snapshot, [
    "emaSpread",
    "trendScore",
    "trend",
    "indicators.macd.hist",
    "advancedIndicators.emas.emaDistancesPct.spread_13_50_pct"
  ]);
  const momentum = pickNumberByPaths(snapshot, ["momentum", "indicators.vwap.dist_pct"]);
  const rsi = pickNumberByPaths(snapshot, ["rsi", "indicators.rsi_14"]);
  const stochK = pickNumberByPaths(snapshot, ["indicators.stochrsi.k", "indicators.stochrsi.value"]);
  const bbPos = pickNumberByPaths(snapshot, ["indicators.bb.pos"]);
  const atrPct = pickNumberByPaths(snapshot, ["indicators.atr_pct", "atrPct"]);
  const baselineExpectedMove = toNumber(input.baselinePrediction?.expectedMovePct);

  let score = 0;
  if (trend !== null) {
    if (trend > 0.0006) score += 0.9;
    else if (trend < -0.0006) score -= 0.9;
  }
  if (momentum !== null) {
    if (momentum > 0.0006) score += 0.7;
    else if (momentum < -0.0006) score -= 0.7;
  }
  if (rsi !== null) {
    if (rsi >= 70) score -= 0.55;
    else if (rsi <= 30) score += 0.55;
  }
  if (stochK !== null) {
    if (stochK >= 80) score -= 0.35;
    else if (stochK <= 20) score += 0.35;
  }
  if (bbPos !== null) {
    if (bbPos >= 0.9) score -= 0.25;
    else if (bbPos <= 0.1) score += 0.25;
  }

  const signal: "up" | "down" | "neutral" =
    score > 0.65 ? "up" : score < -0.65 ? "down" : "neutral";
  const confidence = Number(clamp(0.35 + Math.min(1.5, Math.abs(score)) * 0.28, 0.2, 0.85).toFixed(4));
  const expectedMovePct = Number(
    clamp(
      atrPct !== null ? atrPct * 140 : baselineExpectedMove ?? 0.8,
      0.1,
      6
    ).toFixed(2)
  );
  return {
    signal,
    confidence,
    expectedMovePct
  };
}

function stripCodeFenceJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
}

function collectFeaturePaths(
  value: unknown,
  prefix = "",
  out: Set<string> = new Set<string>(),
  depth = 0
): Set<string> {
  if (depth > 5) return out;
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const [key, next] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (path.startsWith("advancedIndicators")) {
      out.add(path.replace("advancedIndicators", "tradersReality"));
    } else if (path.startsWith("tradersReality")) {
      out.add(path.replace("tradersReality", "advancedIndicators"));
    }
    if (next && typeof next === "object" && !Array.isArray(next)) {
      collectFeaturePaths(next, path, out, depth + 1);
    }
  }
  return out;
}

export function validateExplainerOutput(
  rawValue: unknown,
  featureSnapshot: Record<string, unknown>,
  baselinePrediction?: ExplainerInput["prediction"]
): ExplainerOutput {
  const parsed = baseOutputSchema.safeParse(rawValue);
  if (!parsed.success) {
    throw new Error(`schema_validation_failed:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`);
  }

  const keySet = collectFeaturePaths(featureSnapshot);
  const invalidDriver = parsed.data.keyDrivers.find((driver) => !keySet.has(driver.name));
  if (invalidDriver) {
    throw new Error(`key_driver_outside_snapshot:${invalidDriver.name}`);
  }

  const tags = normalizeTags(parsed.data.tags);
  const explanation = parsed.data.explanation.trim().slice(0, 400);
  const aiPrediction =
    normalizeAiPrediction(parsed.data.aiPrediction) ??
    deriveFallbackAiPrediction({
      featureSnapshot,
      baselinePrediction
    });

  return {
    explanation,
    tags,
    keyDrivers: parsed.data.keyDrivers.slice(0, 5).map((driver) => ({
      name: driver.name,
      value: driver.value
    })),
    aiPrediction,
    disclaimer: "grounded_features_only"
  };
}

function clampText(value: string): string {
  if (value.length <= 400) return value;
  return value.slice(0, 399).trimEnd() + ".";
}

export function fallbackExplain(input: ExplainerInput): ExplainerOutput {
  const snapshot = input.featureSnapshot ?? {};
  const tags: ExplainerTag[] = [];

  const vol = pickNumberByPaths(snapshot, [
    "volatility",
    "vol",
    "atrPct",
    "realizedVol",
    "volatilityPct",
    "indicators.atr_pct",
    "indicators.bb.width_pct"
  ]);
  const trend = pickNumberByPaths(snapshot, [
    "emaSpread",
    "trendScore",
    "trend",
    "ema_slope",
    "indicators.macd.hist",
    "indicators.vwap.dist_pct",
    "advancedIndicators.emas.emaDistancesPct.spread_13_50_pct",
    "advancedIndicators.emas.emaDistancesPct.spread_50_200_pct"
  ]);
  const adx = pickNumberByPaths(snapshot, ["adx", "trendStrength", "indicators.adx.adx_14"]);
  const breakoutProb = pickNumberByPaths(snapshot, ["breakoutProb", "breakoutRisk", "breakout_score"]);
  const meanReversionScore = pickNumberByPaths(snapshot, ["meanReversionScore", "mrScore", "mean_reversion_score"]);
  const rsi = pickNumberByPaths(snapshot, ["rsi", "indicators.rsi_14"]);
  const stochRsiK = pickNumberByPaths(snapshot, ["indicators.stochrsi.k", "indicators.stochrsi.value"]);
  const stochRsiD = pickNumberByPaths(snapshot, ["indicators.stochrsi.d"]);
  const bbPos = pickNumberByPaths(snapshot, ["indicators.bb.pos"]);
  const spreadBps = pickNumberByPaths(snapshot, ["spreadBps", "bookSpreadBps"]);
  const liquidity = pickNumberByPaths(snapshot, ["liquidityScore", "depthScore"]);
  const volZ = pickNumberByPaths(snapshot, ["indicators.volume.vol_z"]);
  const relVol = pickNumberByPaths(snapshot, ["indicators.volume.rel_vol"]);
  const volTrend = pickNumberByPaths(snapshot, ["indicators.volume.vol_trend"]);
  const trPvsraTier = getByPath(snapshot, "advancedIndicators.pvsra.vectorTier");
  const trCloudPos = pickNumberByPaths(snapshot, ["advancedIndicators.cloud.price_pos"]);
  const smcSwingEvent = getByPath(snapshot, "advancedIndicators.smartMoneyConcepts.swing.lastEvent.type");
  const smcSwingDirection = getByPath(
    snapshot,
    "advancedIndicators.smartMoneyConcepts.swing.lastEvent.direction"
  );
  const smcInternalBullBreaks = pickNumberByPaths(snapshot, [
    "advancedIndicators.smartMoneyConcepts.internal.bullishBreaks"
  ]);
  const smcInternalBearBreaks = pickNumberByPaths(snapshot, [
    "advancedIndicators.smartMoneyConcepts.internal.bearishBreaks"
  ]);
  const openBullishGaps = pickNumberByPaths(snapshot, ["indicators.fvg.open_bullish_count"]);
  const openBearishGaps = pickNumberByPaths(snapshot, ["indicators.fvg.open_bearish_count"]);
  const nearestBullGapDist = pickNumberByPaths(snapshot, ["indicators.fvg.nearest_bullish_gap.dist_pct"]);
  const nearestBearGapDist = pickNumberByPaths(snapshot, ["indicators.fvg.nearest_bearish_gap.dist_pct"]);
  const funding = pickNumberByPaths(snapshot, ["fundingRate", "fundingRatePct", "funding"]);
  const newsRisk = pickBooleanByPaths(snapshot, ["newsRisk", "news_risk"]);

  if (vol !== null) {
    if (vol >= 0.03) tags.push("high_vol");
    if (vol <= 0.008) tags.push("low_vol");
  } else {
    tags.push("data_gap");
  }

  if (trend !== null) {
    if (trend > 0) tags.push("trend_up");
    if (trend < 0) tags.push("trend_down");
    if (Math.abs(trend) < 0.0008 && (adx === null || adx < 20)) tags.push("range_bound");
  } else if (adx !== null && adx < 18) {
    tags.push("range_bound");
  }

  if (breakoutProb !== null && breakoutProb >= 0.6) tags.push("breakout_risk");
  if (meanReversionScore !== null && meanReversionScore >= 0.6) tags.push("mean_reversion");
  if (rsi !== null && (rsi >= 70 || rsi <= 30)) tags.push("mean_reversion");
  if (stochRsiK !== null && (stochRsiK >= 80 || stochRsiK <= 20)) tags.push("mean_reversion");
  if (
    (openBullishGaps !== null && openBullishGaps > 0 && nearestBullGapDist !== null && Math.abs(nearestBullGapDist) <= 0.35) ||
    (openBearishGaps !== null && openBearishGaps > 0 && nearestBearGapDist !== null && Math.abs(nearestBearGapDist) <= 0.35) ||
    (volZ !== null && volZ >= 1.8) ||
    (relVol !== null && relVol >= 1.8)
  ) {
    tags.push("breakout_risk");
  }
  if (volTrend !== null && Math.abs(volTrend) < 0.2 && stochRsiD !== null && stochRsiK !== null) {
    tags.push("range_bound");
  }
  if (trCloudPos !== null && (trCloudPos <= 0.1 || trCloudPos >= 0.9)) {
    tags.push("mean_reversion");
  }
  if (trPvsraTier === "extreme") {
    tags.push("breakout_risk");
  }
  if (smcSwingEvent === "bos" || smcSwingEvent === "choch") {
    tags.push("breakout_risk");
    if (smcSwingDirection === "bullish") tags.push("trend_up");
    if (smcSwingDirection === "bearish") tags.push("trend_down");
  }
  if (
    smcInternalBullBreaks !== null &&
    smcInternalBearBreaks !== null &&
    smcInternalBullBreaks > smcInternalBearBreaks
  ) {
    tags.push("trend_up");
  }
  if (
    smcInternalBearBreaks !== null &&
    smcInternalBullBreaks !== null &&
    smcInternalBearBreaks > smcInternalBullBreaks
  ) {
    tags.push("trend_down");
  }
  if (bbPos !== null && (bbPos >= 0.9 || bbPos <= 0.1)) tags.push("mean_reversion");
  if ((spreadBps !== null && spreadBps >= 25) || (liquidity !== null && liquidity <= 0.35)) {
    tags.push("low_liquidity");
  }
  if (funding !== null && Math.abs(funding) >= 0.0005) tags.push("funding_risk");
  if (newsRisk === true) tags.push("news_risk");

  const signalText = input.prediction.signal;
  const confidenceText = confidenceLabel(boundedConfidence(input.prediction.confidence));
  const expectedMovePct = Number.isFinite(input.prediction.expectedMovePct)
    ? input.prediction.expectedMovePct.toFixed(2)
    : "unknown";

  const trendText =
    trend === null
      ? "trend information is incomplete"
      : trend > 0
        ? "trend indicators are positive"
        : trend < 0
          ? "trend indicators are negative"
          : "trend is mixed";

  const volText =
    vol === null
      ? "volatility is unknown"
      : vol >= 0.03
        ? "volatility is elevated"
        : vol <= 0.008
          ? "volatility is muted"
          : "volatility is moderate";

  const explanation = clampText(
    `Signal ${signalText} with ${confidenceText} confidence and expected move ${expectedMovePct}% ` +
    `based on provided features; ${trendText} and ${volText}.`
  );

  const preferredDrivers = [
    "indicators.rsi_14",
    "indicators.macd.hist",
    "indicators.bb.width_pct",
    "indicators.bb.pos",
    "indicators.stochrsi.k",
    "indicators.stochrsi.d",
    "indicators.volume.rel_vol",
    "indicators.volume.vol_z",
    "indicators.volume.vol_trend",
    "indicators.fvg.open_bullish_count",
    "indicators.fvg.open_bearish_count",
    "indicators.fvg.nearest_bullish_gap.dist_pct",
    "indicators.fvg.nearest_bearish_gap.dist_pct",
    "indicators.vwap.dist_pct",
    "indicators.adx.adx_14",
    "advancedIndicators.emas.ema_50",
    "advancedIndicators.emas.ema_200",
    "advancedIndicators.emas.ema_800",
    "advancedIndicators.emas.emaDistancesPct.spread_13_50_pct",
    "advancedIndicators.cloud.price_pos",
    "advancedIndicators.ranges.distancesPct.dist_to_adrHigh_pct",
    "advancedIndicators.ranges.distancesPct.dist_to_adrLow_pct",
    "advancedIndicators.pvsra.vectorTier",
    "advancedIndicators.pvsra.vectorColor",
    "advancedIndicators.smartMoneyConcepts.internal.lastEvent.type",
    "advancedIndicators.smartMoneyConcepts.internal.lastEvent.direction",
    "advancedIndicators.smartMoneyConcepts.swing.lastEvent.type",
    "advancedIndicators.smartMoneyConcepts.swing.lastEvent.direction",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.internal.bullishCount",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.internal.bearishCount",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.swing.bullishCount",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.swing.bearishCount",
    "advancedIndicators.smartMoneyConcepts.fairValueGaps.bullishCount",
    "advancedIndicators.smartMoneyConcepts.fairValueGaps.bearishCount",
    "emaSpread",
    "atrPct",
    "volatility",
    "fundingRate",
    "spreadBps",
    "liquidityScore"
  ];

  const keyDrivers: { name: string; value: unknown }[] = [];
  for (const path of preferredDrivers) {
    const value = getByPath(snapshot, path);
    if (value === undefined) continue;
    keyDrivers.push({ name: path, value });
    if (keyDrivers.length >= 3) break;
  }

  if (keyDrivers.length === 0) {
    const fallbackKeys = Object.keys(snapshot).sort().slice(0, 3);
    for (const key of fallbackKeys) {
      keyDrivers.push({ name: key, value: snapshot[key] });
    }
  }

  return {
    explanation,
    tags: normalizeTags(tags),
    keyDrivers,
    aiPrediction: deriveFallbackAiPrediction({
      featureSnapshot: snapshot,
      baselinePrediction: input.prediction
    }),
    disclaimer: "grounded_features_only"
  };
}

export function buildPredictionExplainerCacheKey(input: ExplainerInput): string {
  const featureHash = hashStableObject(input.featureSnapshot ?? {});
  return `predExplain:${input.symbol}:${input.marketType}:${input.timeframe}:${input.tsCreated}:${featureHash}`;
}

function buildPromptPayload(
  input: ExplainerInput,
  settings: Pick<AiPromptRuntimeSettings, "promptText" | "indicatorKeys" | "ohlcvBars">
) {
  return {
    symbol: input.symbol,
    marketType: input.marketType,
    timeframe: input.timeframe,
    tsCreated: input.tsCreated,
    prediction: input.prediction,
    featureSnapshot: input.featureSnapshot,
    tagsAllowlist: EXPLAINER_TAG_ALLOWLIST,
    outputSchema: {
      explanation: "string <= 400 chars",
      tags: "string[] <= 5 items, must be from tagsAllowlist",
      keyDrivers: "{name: string, value: any}[] <= 5 items, names from featureSnapshot key paths only",
      aiPrediction: "{signal: up|down|neutral, expectedMovePct: number, confidence: number 0..1}",
      disclaimer: "grounded_features_only"
    },
    operatorPrompt: settings.promptText,
    selectedIndicatorKeys: settings.indicatorKeys,
    ohlcvBars: settings.ohlcvBars,
    groundingRules: [
      "Only reference values that exist in featureSnapshot",
      "Only reference stochrsi/volume/fvg when present and non-null",
      "Only reference advancedIndicators fields when present and non-null",
      "historyContext is derived and may be referenced only when present; do not invent missing history fields",
      "Do not claim volume spikes unless rel_vol or vol_z supports it",
      "Do not claim fair value gaps unless fvg counts or distances support it",
      "aiPrediction must be inferred from featureSnapshot and can differ from prediction"
    ]
  };
}

function normalizeContextString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveScopeContext(
  input: ExplainerInput,
  explicitContext: AiPromptScopeContext | undefined
): AiPromptScopeContext {
  const snapshot = input.featureSnapshot ?? {};
  const snapshotExchange = normalizeContextString(snapshot.prefillExchange);
  const snapshotAccount = normalizeContextString(snapshot.prefillExchangeAccountId);
  const explicitExchange = normalizeContextString(explicitContext?.exchange);
  const explicitAccount = normalizeContextString(explicitContext?.accountId);
  const explicitSymbol = normalizeContextString(explicitContext?.symbol);
  const explicitTimeframe = normalizeContextString(explicitContext?.timeframe);

  return {
    exchange: (explicitExchange ?? snapshotExchange ?? null)?.toLowerCase() ?? null,
    accountId: explicitAccount ?? snapshotAccount ?? null,
    symbol: (explicitSymbol ?? input.symbol ?? null)?.toUpperCase() ?? null,
    timeframe: (explicitTimeframe ?? input.timeframe ?? null)?.toLowerCase() ?? null
  };
}

export async function buildPredictionExplainerPromptPreview(
  input: ExplainerInput,
  deps: GenerateDeps = {}
): Promise<ExplainerPromptPreview> {
  const scopeContext = deriveScopeContext(input, deps.promptScopeContext);
  const runtimeSettings =
    deps.promptSettings ?? (await getAiPromptRuntimeSettings(scopeContext));
  const filteredFeatureSnapshot = filterFeatureSnapshotForAiPrompt(
    input.featureSnapshot ?? {},
    runtimeSettings.indicatorKeys
  );
  const runtimeFeatureSnapshot = applyOhlcvBarsLimit(
    filteredFeatureSnapshot,
    runtimeSettings.ohlcvBars
  );
  const runtimeFeatureSnapshotWithHistory = applyHistoryContextLimit(
    runtimeFeatureSnapshot
  );
  const promptInput: ExplainerInput = {
    ...input,
    featureSnapshot: runtimeFeatureSnapshotWithHistory
  };
  const userPayload = buildPromptPayload(promptInput, runtimeSettings);
  const systemMessage = buildSystemMessage(runtimeSettings.promptText);
  const historyContextHash = hashStableObject(
    asObject(promptInput.featureSnapshot)?.historyContext ?? null
  );
  const historyContextBytes = toNumber(
    getByPath(promptInput.featureSnapshot ?? {}, "historyContext.bud.bytes")
  );
  const cacheKey =
    `${buildPredictionExplainerCacheKey(promptInput)}:${hashStableObject({
      promptText: runtimeSettings.promptText,
      indicatorKeys: runtimeSettings.indicatorKeys,
      ohlcvBars: runtimeSettings.ohlcvBars,
      historyContextHash,
      historyContextBytes,
      activePromptId: runtimeSettings.activePromptId,
      activePromptName: runtimeSettings.activePromptName,
      selectedFrom: runtimeSettings.selectedFrom,
      matchedOverrideId: runtimeSettings.matchedOverrideId
    })}`;

  return {
    scopeContext,
    runtimeSettings,
    systemMessage,
    userPayload,
    promptInput,
    cacheKey
  };
}

export async function generatePredictionExplanation(
  input: ExplainerInput,
  deps: GenerateDeps = {}
): Promise<ExplainerOutput> {
  const preview = await buildPredictionExplainerPromptPreview(input, deps);
  const { promptInput, runtimeSettings, systemMessage, userPayload, cacheKey } = preview;
  const fallback = () => fallbackExplain(promptInput);
  const aiModel = getAiModel();
  const callAiFn = deps.callAiFn ?? callAi;
  const traceBase = {
    scope: "prediction_explainer",
    provider: "openai",
    model: aiModel,
    symbol: promptInput.symbol,
    marketType: promptInput.marketType,
    timeframe: promptInput.timeframe,
    promptTemplateId: runtimeSettings.activePromptId,
    promptTemplateName: runtimeSettings.activePromptName,
    systemMessage,
    userPayload
  } as const;

  const result = await analyzeWithAiGuards({
    cacheKey,
    aiModel,
    compute: async () => {
      const startedAt = Date.now();
      let raw: string | null = null;
      let parsedJson: unknown = null;
      let attemptsUsed = 0;
      try {
        let validated: ExplainerOutput | null = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          attemptsUsed = attempt;
          raw = await callAiFn(JSON.stringify(userPayload), {
            systemMessage,
            model: aiModel,
            temperature: 0,
            timeoutMs: EXPLAINER_TIMEOUT_MS,
            maxTokens: attempt === 1 ? EXPLAINER_MAX_TOKENS : EXPLAINER_RETRY_MAX_TOKENS
          });

          try {
            parsedJson = JSON.parse(stripCodeFenceJson(raw));
            validated = validateExplainerOutput(
              parsedJson,
              promptInput.featureSnapshot,
              promptInput.prediction
            );
            break;
          } catch (error) {
            const isInvalidJson = error instanceof SyntaxError;
            if (isInvalidJson && attempt < 2) {
              continue;
            }
            throw error;
          }
        }

        if (!validated) {
          throw new Error("invalid_json");
        }
        const retryCount = Math.max(0, attemptsUsed - 1);
        const retryUsed = retryCount > 0;
        await recordAiTraceLog({
          ...traceBase,
          userPayload: withTraceMetaPayload(userPayload, retryUsed, retryCount),
          rawResponse: raw ?? null,
          parsedResponse: validated,
          success: true,
          fallbackUsed: false,
          cacheHit: false,
          rateLimited: false,
          latencyMs: Date.now() - startedAt
        });
        return validated;
      } catch (error) {
        const isInvalidJson = error instanceof SyntaxError;
        const retryCount = Math.max(0, attemptsUsed - 1);
        const retryUsed = retryCount > 0;
        logger.warn("ai_validation_failed", {
          ai_validation_failed: true,
          ai_model: aiModel,
          reason: isInvalidJson ? `invalid_json:${String(error)}` : String(error)
        });
        await recordAiTraceLog({
          ...traceBase,
          userPayload: withTraceMetaPayload(userPayload, retryUsed, retryCount),
          rawResponse: raw,
          parsedResponse: parsedJson,
          success: false,
          error: isInvalidJson ? "invalid_json" : String(error),
          fallbackUsed: true,
          cacheHit: false,
          rateLimited: false,
          latencyMs: Date.now() - startedAt
        });
        if (isInvalidJson) {
          throw new Error("invalid_json");
        }
        throw error;
      }
    },
    fallback
  });

  if (result.fallbackUsed) {
    if (deps.requireSuccessfulAi) {
      throw new Error("ai_required_but_unavailable");
    }
    logger.info("ai_fallback_used", {
      ai_fallback_used: true,
      ai_model: aiModel,
      ai_cache_hit: result.cacheHit
    });
  }

  return result.value;
}
