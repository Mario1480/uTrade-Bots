import { z } from "zod";
import { logger } from "../logger.js";
import { analyzeWithAiGuards, hashStableObject } from "./analyzer.js";
import { callAi, getAiModel } from "./provider.js";

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
  disclaimer: z.literal("grounded_features_only")
});

type GenerateDeps = {
  callAiFn?: typeof callAi;
};

const SYSTEM_MESSAGE =
  "You are a trading assistant. You must only use the provided JSON featureSnapshot. " +
  "If a value is missing, say 'unknown' or omit it. Do not mention news unless featureSnapshot contains a 'newsRisk' flag.";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function pickNumber(snapshot: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const val = toNumber(snapshot[key]);
    if (val !== null) return val;
  }
  return null;
}

function pickBoolean(snapshot: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const val = toBoolean(snapshot[key]);
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

function stripCodeFenceJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
}

export function validateExplainerOutput(
  rawValue: unknown,
  featureSnapshot: Record<string, unknown>
): ExplainerOutput {
  const parsed = baseOutputSchema.safeParse(rawValue);
  if (!parsed.success) {
    throw new Error(`schema_validation_failed:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`);
  }

  const keySet = new Set(Object.keys(featureSnapshot));
  const invalidDriver = parsed.data.keyDrivers.find((driver) => !keySet.has(driver.name));
  if (invalidDriver) {
    throw new Error(`key_driver_outside_snapshot:${invalidDriver.name}`);
  }

  const tags = normalizeTags(parsed.data.tags);
  const explanation = parsed.data.explanation.trim().slice(0, 400);

  return {
    explanation,
    tags,
    keyDrivers: parsed.data.keyDrivers.slice(0, 5).map((driver) => ({
      name: driver.name,
      value: driver.value
    })),
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

  const vol = pickNumber(snapshot, ["volatility", "vol", "atrPct", "realizedVol", "volatilityPct"]);
  const trend = pickNumber(snapshot, ["emaSpread", "trendScore", "trend", "ema_slope"]);
  const adx = pickNumber(snapshot, ["adx", "trendStrength"]);
  const breakoutProb = pickNumber(snapshot, ["breakoutProb", "breakoutRisk", "breakout_score"]);
  const meanReversionScore = pickNumber(snapshot, ["meanReversionScore", "mrScore", "mean_reversion_score"]);
  const spreadBps = pickNumber(snapshot, ["spreadBps", "bookSpreadBps"]);
  const liquidity = pickNumber(snapshot, ["liquidityScore", "depthScore"]);
  const funding = pickNumber(snapshot, ["fundingRate", "fundingRatePct", "funding"]);
  const newsRisk = pickBoolean(snapshot, ["newsRisk", "news_risk"]);

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
    "rsi",
    "emaSpread",
    "emaFast",
    "emaSlow",
    "macd",
    "atrPct",
    "volatility",
    "fundingRate",
    "spreadBps",
    "liquidityScore"
  ];

  const keyDrivers: { name: string; value: unknown }[] = [];
  for (const key of preferredDrivers) {
    if (!(key in snapshot)) continue;
    keyDrivers.push({ name: key, value: snapshot[key] });
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
    disclaimer: "grounded_features_only"
  };
}

export function buildPredictionExplainerCacheKey(input: ExplainerInput): string {
  const featureHash = hashStableObject(input.featureSnapshot ?? {});
  return `predExplain:${input.symbol}:${input.marketType}:${input.timeframe}:${input.tsCreated}:${featureHash}`;
}

function buildPromptPayload(input: ExplainerInput) {
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
      keyDrivers: "{name: string, value: any}[] <= 5 items, names from featureSnapshot keys only",
      disclaimer: "grounded_features_only"
    }
  };
}

export async function generatePredictionExplanation(
  input: ExplainerInput,
  deps: GenerateDeps = {}
): Promise<ExplainerOutput> {
  const fallback = () => fallbackExplain(input);
  const cacheKey = buildPredictionExplainerCacheKey(input);
  const aiModel = getAiModel();
  const callAiFn = deps.callAiFn ?? callAi;

  const result = await analyzeWithAiGuards({
    cacheKey,
    aiModel,
    compute: async () => {
      const userPayload = buildPromptPayload(input);
      const raw = await callAiFn(JSON.stringify(userPayload), {
        systemMessage: SYSTEM_MESSAGE,
        model: aiModel,
        temperature: 0
      });

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(stripCodeFenceJson(raw));
      } catch (error) {
        logger.warn("ai_validation_failed", {
          ai_validation_failed: true,
          ai_model: aiModel,
          reason: `invalid_json:${String(error)}`
        });
        throw new Error("invalid_json");
      }

      try {
        return validateExplainerOutput(parsedJson, input.featureSnapshot);
      } catch (error) {
        logger.warn("ai_validation_failed", {
          ai_validation_failed: true,
          ai_model: aiModel,
          reason: String(error)
        });
        throw error;
      }
    },
    fallback
  });

  if (result.fallbackUsed) {
    logger.info("ai_fallback_used", {
      ai_fallback_used: true,
      ai_model: aiModel,
      ai_cache_hit: result.cacheHit
    });
  }

  return result.value;
}
