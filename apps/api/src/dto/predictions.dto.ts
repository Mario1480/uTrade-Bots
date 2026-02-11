import { z } from "zod";
import { EXPLAINER_TAG_ALLOWLIST } from "../ai/predictionExplainer.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUID_REGEX = /^c[a-z0-9]{24}$/;

const tagAllowlist = new Set<string>(EXPLAINER_TAG_ALLOWLIST);

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
  explanation: z.string().max(400).nullable(),
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
  if (text.length <= 400) return { value: text, truncated: false };
  return {
    value: text.slice(0, 400),
    truncated: true
  };
}

export function normalizePredictionIndicators(value: unknown): PredictionIndicators | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
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
    }
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
