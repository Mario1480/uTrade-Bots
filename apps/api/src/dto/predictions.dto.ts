import { z } from "zod";
import { EXPLAINER_TAG_ALLOWLIST } from "../ai/predictionExplainer.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUID_REGEX = /^c[a-z0-9]{24}$/;

const tagAllowlist = new Set<string>(EXPLAINER_TAG_ALLOWLIST);
const PREDICTION_EXPLANATION_MAX_CHARS = 1000;

export const predictionIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .refine((value) => UUID_REGEX.test(value) || CUID_REGEX.test(value), {
      message: "id must be uuid or cuid"
    })
});

export const predictionSignalSchema = z.enum(["up", "down", "neutral"]);
export const predictionMarketTypeSchema = z.enum(["spot", "perp"]);
export const predictionTimeframeSchema = z.enum(["5m", "15m", "1h", "4h", "1d"]);

export const predictionIndicatorsSchema = z.object({
  rsi_14: z.number().nullable().optional(),
  macd: z
    .object({
      line: z.number().nullable().optional(),
      signal: z.number().nullable().optional(),
      hist: z.number().nullable().optional()
    })
    .optional(),
  bb: z
    .object({
      upper: z.number().nullable().optional(),
      mid: z.number().nullable().optional(),
      lower: z.number().nullable().optional(),
      width_pct: z.number().nullable().optional(),
      pos: z.number().nullable().optional()
    })
    .optional(),
  vwap: z
    .object({
      value: z.number().nullable().optional(),
      dist_pct: z.number().nullable().optional(),
      mode: z.string().optional(),
      sessionStartUtcMs: z.number().nullable().optional()
    })
    .optional(),
  adx: z
    .object({
      adx_14: z.number().nullable().optional(),
      plus_di_14: z.number().nullable().optional(),
      minus_di_14: z.number().nullable().optional()
    })
    .optional(),
  stochrsi: z
    .object({
      rsi_len: z.number().int().positive().optional(),
      stoch_len: z.number().int().positive().optional(),
      smooth_k: z.number().int().positive().optional(),
      smooth_d: z.number().int().positive().optional(),
      k: z.number().nullable().optional(),
      d: z.number().nullable().optional(),
      value: z.number().nullable().optional()
    })
    .optional(),
  volume: z
    .object({
      lookback: z.number().int().positive().optional(),
      vol_z: z.number().nullable().optional(),
      rel_vol: z.number().nullable().optional(),
      vol_ema_fast: z.number().nullable().optional(),
      vol_ema_slow: z.number().nullable().optional(),
      vol_trend: z.number().nullable().optional()
    })
    .optional(),
  fvg: z
    .object({
      lookback: z.number().int().positive().optional(),
      fill_rule: z.enum(["overlap", "mid_touch"]).optional(),
      open_bullish_count: z.number().int().nonnegative().optional(),
      open_bearish_count: z.number().int().nonnegative().optional(),
      nearest_bullish_gap: z
        .object({
          upper: z.number().nullable().optional(),
          lower: z.number().nullable().optional(),
          mid: z.number().nullable().optional(),
          dist_pct: z.number().nullable().optional(),
          age_bars: z.number().nullable().optional()
        })
        .optional(),
      nearest_bearish_gap: z
        .object({
          upper: z.number().nullable().optional(),
          lower: z.number().nullable().optional(),
          mid: z.number().nullable().optional(),
          dist_pct: z.number().nullable().optional(),
          age_bars: z.number().nullable().optional()
        })
        .optional(),
      last_created: z
        .object({
          type: z.enum(["bullish", "bearish"]).nullable().optional(),
          age_bars: z.number().nullable().optional()
        })
        .optional(),
      last_filled: z
        .object({
          type: z.enum(["bullish", "bearish"]).nullable().optional(),
          age_bars: z.number().nullable().optional()
        })
        .optional()
    })
    .optional(),
  vumanchu: z
    .object({
      waveTrend: z.record(z.unknown()).optional(),
      rsiMfi: z.record(z.unknown()).optional(),
      divergences: z.record(z.unknown()).optional(),
      signals: z.record(z.unknown()).optional(),
      levels: z.record(z.unknown()).optional(),
      dataGap: z.boolean().optional()
    })
    .optional()
});

export const predictionFeatureSnapshotSchema = z
  .object({
    indicators: predictionIndicatorsSchema.optional()
  })
  .catchall(z.unknown());

export const predictionDetailDtoSchema = z.object({
  id: z.string().min(1),
  exchange: z.string().min(1),
  accountId: z.string().min(1),
  symbol: z.string().min(1),
  marketType: predictionMarketTypeSchema,
  timeframe: predictionTimeframeSchema,
  tsCreated: z.string().datetime(),
  tsPredictedFor: z.string().datetime(),
  prediction: z.object({
    signal: predictionSignalSchema,
    expectedMovePct: z.number().nullable(),
    confidence: z.number().min(0).max(100)
  }),
  tags: z.array(z.string()).max(5),
  explanation: z.string().max(PREDICTION_EXPLANATION_MAX_CHARS).nullable(),
  keyDrivers: z
    .array(
      z.object({
        name: z.string().min(1),
        value: z.unknown()
      })
    )
    .max(5),
  featureSnapshot: predictionFeatureSnapshotSchema,
  modelVersion: z.string().min(1),
  realized: z.object({
    realizedReturnPct: z.number().nullable(),
    evaluatedAt: z.string().datetime().nullable(),
    errorMetrics: z.record(z.unknown()).nullable()
  })
});

export type PredictionDetailDTO = z.infer<typeof predictionDetailDtoSchema>;
export type PredictionIndicators = z.infer<typeof predictionIndicatorsSchema>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toFiniteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIntOrUndefined(value: unknown): number | undefined {
  const parsed = toFiniteOrNull(value);
  if (parsed === null) return undefined;
  return Math.trunc(parsed);
}

export function normalizePredictionConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, normalized));
}

export function normalizePredictionTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const rawTag of value) {
    const tag = String(rawTag).trim();
    if (!tagAllowlist.has(tag)) continue;
    out.add(tag);
    if (out.size >= 5) break;
  }
  return [...out];
}

export function normalizePredictionKeyDrivers(
  value: unknown
): Array<{ name: string; value: unknown }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name: string; value: unknown }> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const name = String(record.name ?? "").trim();
    if (!name) continue;
    out.push({ name, value: record.value });
    if (out.length >= 5) break;
  }
  return out;
}

export function normalizePredictionExplanation(value: unknown): {
  value: string | null;
  truncated: boolean;
} {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { value: null, truncated: false };
  if (text.length <= PREDICTION_EXPLANATION_MAX_CHARS) return { value: text, truncated: false };
  return {
    value: text.slice(0, PREDICTION_EXPLANATION_MAX_CHARS),
    truncated: true
  };
}

export function normalizePredictionIndicators(value: unknown): PredictionIndicators | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const stoch = asRecord(record.stochrsi);
  const volume = asRecord(record.volume);
  const fvg = asRecord(record.fvg);
  const nearestBull = asRecord(fvg?.nearest_bullish_gap);
  const nearestBear = asRecord(fvg?.nearest_bearish_gap);
  const lastCreated = asRecord(fvg?.last_created);
  const lastFilled = asRecord(fvg?.last_filled);
  const vumanchu = asRecord(record.vumanchu);
  return {
    rsi_14: toFiniteOrNull(record.rsi_14),
    macd: {
      line: toFiniteOrNull(asRecord(record.macd)?.line),
      signal: toFiniteOrNull(asRecord(record.macd)?.signal),
      hist: toFiniteOrNull(asRecord(record.macd)?.hist)
    },
    bb: {
      upper: toFiniteOrNull(asRecord(record.bb)?.upper),
      mid: toFiniteOrNull(asRecord(record.bb)?.mid),
      lower: toFiniteOrNull(asRecord(record.bb)?.lower),
      width_pct: toFiniteOrNull(asRecord(record.bb)?.width_pct),
      pos: toFiniteOrNull(asRecord(record.bb)?.pos)
    },
    vwap: {
      value: toFiniteOrNull(asRecord(record.vwap)?.value),
      dist_pct: toFiniteOrNull(asRecord(record.vwap)?.dist_pct),
      mode: typeof asRecord(record.vwap)?.mode === "string" ? String(asRecord(record.vwap)?.mode) : undefined,
      sessionStartUtcMs: toFiniteOrNull(asRecord(record.vwap)?.sessionStartUtcMs)
    },
    adx: {
      adx_14: toFiniteOrNull(asRecord(record.adx)?.adx_14),
      plus_di_14: toFiniteOrNull(asRecord(record.adx)?.plus_di_14),
      minus_di_14: toFiniteOrNull(asRecord(record.adx)?.minus_di_14)
    },
    stochrsi: {
      rsi_len: toIntOrUndefined(stoch?.rsi_len),
      stoch_len: toIntOrUndefined(stoch?.stoch_len),
      smooth_k: toIntOrUndefined(stoch?.smooth_k),
      smooth_d: toIntOrUndefined(stoch?.smooth_d),
      k: toFiniteOrNull(stoch?.k),
      d: toFiniteOrNull(stoch?.d),
      value: toFiniteOrNull(stoch?.value)
    },
    volume: {
      lookback: toIntOrUndefined(volume?.lookback),
      vol_z: toFiniteOrNull(volume?.vol_z),
      rel_vol: toFiniteOrNull(volume?.rel_vol),
      vol_ema_fast: toFiniteOrNull(volume?.vol_ema_fast),
      vol_ema_slow: toFiniteOrNull(volume?.vol_ema_slow),
      vol_trend: toFiniteOrNull(volume?.vol_trend)
    },
    fvg: {
      lookback: toIntOrUndefined(fvg?.lookback),
      fill_rule:
        String(fvg?.fill_rule ?? "").trim().toLowerCase() === "mid_touch"
          ? "mid_touch"
          : "overlap",
      open_bullish_count: Math.max(0, Math.trunc(toFiniteOrNull(fvg?.open_bullish_count) ?? 0)),
      open_bearish_count: Math.max(0, Math.trunc(toFiniteOrNull(fvg?.open_bearish_count) ?? 0)),
      nearest_bullish_gap: {
        upper: toFiniteOrNull(nearestBull?.upper),
        lower: toFiniteOrNull(nearestBull?.lower),
        mid: toFiniteOrNull(nearestBull?.mid),
        dist_pct: toFiniteOrNull(nearestBull?.dist_pct),
        age_bars: toFiniteOrNull(nearestBull?.age_bars)
      },
      nearest_bearish_gap: {
        upper: toFiniteOrNull(nearestBear?.upper),
        lower: toFiniteOrNull(nearestBear?.lower),
        mid: toFiniteOrNull(nearestBear?.mid),
        dist_pct: toFiniteOrNull(nearestBear?.dist_pct),
        age_bars: toFiniteOrNull(nearestBear?.age_bars)
      },
      last_created: {
        type: lastCreated?.type === "bullish" || lastCreated?.type === "bearish"
          ? lastCreated.type
          : null,
        age_bars: toFiniteOrNull(lastCreated?.age_bars)
      },
      last_filled: {
        type: lastFilled?.type === "bullish" || lastFilled?.type === "bearish"
          ? lastFilled.type
          : null,
        age_bars: toFiniteOrNull(lastFilled?.age_bars)
      }
    },
    vumanchu: vumanchu ? {
      waveTrend: asRecord(vumanchu.waveTrend) ?? undefined,
      rsiMfi: asRecord(vumanchu.rsiMfi) ?? undefined,
      divergences: asRecord(vumanchu.divergences) ?? undefined,
      signals: asRecord(vumanchu.signals) ?? undefined,
      levels: asRecord(vumanchu.levels) ?? undefined,
      dataGap: typeof vumanchu.dataGap === "boolean" ? vumanchu.dataGap : undefined
    } : undefined
  };
}

export function normalizePredictionFeatureSnapshot(value: unknown): Record<string, unknown> {
  const snapshot = asRecord(value) ?? {};
  const indicators = normalizePredictionIndicators(snapshot.indicators);
  return {
    ...snapshot,
    ...(indicators ? { indicators } : {})
  };
}
