export type PredictionSignal = "up" | "down" | "neutral";

export type PredictionEvaluatorSample = {
  confidence: number;
  signal: PredictionSignal;
  expectedMovePct: number | null;
  realizedReturnPct: number;
  hit: boolean | null;
  absError: number | null;
  sqError: number | null;
};

export type CalibrationBin = {
  binFrom: number;
  binTo: number;
  avgConf: number | null;
  accuracy: number | null;
  n: number;
};

export type PredictionMetricsSummary = {
  evaluatedCount: number;
  hitRate: number | null;
  mae: number | null;
  mse: number | null;
  calibrationBins: CalibrationBin[];
};

function toFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeConfidencePct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

export function computeDirectionalRealizedReturnPct(
  signal: PredictionSignal,
  closeAtStart: number,
  closeAtHorizon: number
): number {
  if (!Number.isFinite(closeAtStart) || closeAtStart <= 0) return 0;
  if (!Number.isFinite(closeAtHorizon) || closeAtHorizon <= 0) return 0;
  if (signal === "down") {
    return ((closeAtStart - closeAtHorizon) / closeAtStart) * 100;
  }
  if (signal === "up") {
    return ((closeAtHorizon - closeAtStart) / closeAtStart) * 100;
  }
  return 0;
}

export function computePredictionErrorMetrics(input: {
  signal: PredictionSignal;
  expectedMovePct: number | null;
  realizedReturnPct: number;
}): {
  hit: boolean | null;
  predictedMovePct: number | null;
  absError: number | null;
  sqError: number | null;
} {
  const expected = toFinite(input.expectedMovePct);
  let predictedSigned: number | null = null;
  if (expected !== null) {
    if (input.signal === "up") predictedSigned = Math.abs(expected);
    else if (input.signal === "down") predictedSigned = -Math.abs(expected);
    else predictedSigned = 0;
  }

  const hit =
    input.signal === "neutral"
      ? null
      : input.signal === "up"
        ? input.realizedReturnPct > 0
        : input.realizedReturnPct < 0;

  if (predictedSigned === null) {
    return {
      hit,
      predictedMovePct: null,
      absError: null,
      sqError: null
    };
  }

  const diff = predictedSigned - input.realizedReturnPct;
  const absError = Math.abs(diff);
  const sqError = diff * diff;
  return {
    hit,
    predictedMovePct: predictedSigned,
    absError,
    sqError
  };
}

export function readRealizedPayloadFromOutcomeMeta(outcomeMeta: unknown): {
  realizedReturnPct: number | null;
  evaluatedAt: string | null;
  errorMetrics: Record<string, unknown> | null;
} {
  const meta = asRecord(outcomeMeta);
  const realizedReturnPct = toFinite(meta.realizedReturnPct);
  const evaluatedAt =
    typeof meta.realizedEvaluatedAt === "string" && meta.realizedEvaluatedAt.trim()
      ? meta.realizedEvaluatedAt
      : null;
  const errorMetricsRaw = asRecord(meta.errorMetrics);
  const errorMetrics = Object.keys(errorMetricsRaw).length > 0 ? errorMetricsRaw : null;
  return {
    realizedReturnPct,
    evaluatedAt,
    errorMetrics
  };
}

export function computeCalibrationBins(
  samples: Array<{ confidence: number; hit: boolean | null }>,
  binCount = 10
): CalibrationBin[] {
  const safeBinCount = Math.max(2, Math.min(20, Math.trunc(binCount)));
  const buckets = Array.from({ length: safeBinCount }, () => ({
    confSum: 0,
    hitSum: 0,
    hitCount: 0,
    n: 0
  }));

  for (const sample of samples) {
    const confidence = normalizeConfidencePct(sample.confidence);
    const idx = Math.min(
      safeBinCount - 1,
      Math.max(0, Math.floor((confidence / 100) * safeBinCount))
    );
    const bucket = buckets[idx];
    bucket.n += 1;
    bucket.confSum += confidence;
    if (typeof sample.hit === "boolean") {
      bucket.hitCount += 1;
      if (sample.hit) bucket.hitSum += 1;
    }
  }

  return buckets.map((bucket, idx) => {
    const step = 100 / safeBinCount;
    const binFrom = Number((idx * step).toFixed(2));
    const binTo = Number(((idx + 1) * step).toFixed(2));
    return {
      binFrom,
      binTo,
      avgConf: bucket.n > 0 ? Number((bucket.confSum / bucket.n).toFixed(2)) : null,
      accuracy:
        bucket.hitCount > 0 ? Number(((bucket.hitSum / bucket.hitCount) * 100).toFixed(2)) : null,
      n: bucket.n
    };
  });
}

export function buildPredictionMetricsSummary(
  samples: PredictionEvaluatorSample[],
  binCount = 10
): PredictionMetricsSummary {
  let hitTotal = 0;
  let hitCount = 0;
  let absSum = 0;
  let absCount = 0;
  let sqSum = 0;
  let sqCount = 0;

  for (const row of samples) {
    if (typeof row.hit === "boolean") {
      hitCount += 1;
      if (row.hit) hitTotal += 1;
    }
    if (typeof row.absError === "number" && Number.isFinite(row.absError)) {
      absCount += 1;
      absSum += row.absError;
    }
    if (typeof row.sqError === "number" && Number.isFinite(row.sqError)) {
      sqCount += 1;
      sqSum += row.sqError;
    }
  }

  return {
    evaluatedCount: samples.length,
    hitRate: hitCount > 0 ? Number(((hitTotal / hitCount) * 100).toFixed(2)) : null,
    mae: absCount > 0 ? Number((absSum / absCount).toFixed(4)) : null,
    mse: sqCount > 0 ? Number((sqSum / sqCount).toFixed(4)) : null,
    calibrationBins: computeCalibrationBins(
      samples.map((row) => ({ confidence: row.confidence, hit: row.hit })),
      binCount
    )
  };
}

