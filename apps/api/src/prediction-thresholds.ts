import assert from "node:assert/strict";

export type ThresholdTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type ThresholdMarketType = "spot" | "perp";
export type ThresholdSignal = "up" | "down" | "neutral";

export const FEATURE_THRESHOLD_VERSION = "quantiles-v1";

export type QuantileBands = {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

export type ResolvedFeatureThresholds = {
  atrPct: QuantileBands & {
    volLow: number;
    volHigh: number;
    volExtreme: number;
  };
  absEmaSpreadPct: QuantileBands & {
    trendWeak: number;
    trendStrong: number;
  };
  spreadBps: (QuantileBands & {
    high: number;
  }) | null;
  depth1pctUsd: (QuantileBands & {
    low: number;
  }) | null;
};

export type FeatureThresholdsJson = {
  version: string;
  winsorizePct: number;
  riskFlags: {
    dataGap: boolean;
    insufficientData: boolean;
  };
  bars: {
    expected: number;
    nBars: number;
    gapRatio: number;
  };
  atrPct: (QuantileBands & {
    volLow: number;
    volHigh: number;
    volExtreme: number;
  }) | null;
  absEmaSpreadPct: (QuantileBands & {
    trendWeak: number;
    trendStrong: number;
  }) | null;
  spreadBps: (QuantileBands & {
    high: number;
  }) | null;
  depth1pctUsd: (QuantileBands & {
    low: number;
  }) | null;
};

const WINDOW_MS_BY_TIMEFRAME: Record<ThresholdTimeframe, number> = {
  "5m": 14 * 24 * 60 * 60 * 1000,
  "15m": 30 * 24 * 60 * 60 * 1000,
  "1h": 120 * 24 * 60 * 60 * 1000,
  "4h": 365 * 24 * 60 * 60 * 1000,
  "1d": 5 * 365 * 24 * 60 * 60 * 1000
};

const MIN_BARS_BY_TIMEFRAME: Record<ThresholdTimeframe, number> = {
  "5m": 2000,
  "15m": 1500,
  "1h": 1000,
  "4h": 800,
  "1d": 365
};

const FALLBACK_THRESHOLDS: ResolvedFeatureThresholds = {
  atrPct: {
    p10: 0.004,
    p25: 0.0075,
    p50: 0.012,
    p75: 0.02,
    p90: 0.03,
    volLow: 0.0075,
    volHigh: 0.02,
    volExtreme: 0.03
  },
  absEmaSpreadPct: {
    p10: 0.0002,
    p25: 0.0005,
    p50: 0.001,
    p75: 0.002,
    p90: 0.003,
    trendWeak: 0.0005,
    trendStrong: 0.002
  },
  spreadBps: null,
  depth1pctUsd: null
};

function toFiniteNumbers(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

export function calibrationWindowMsForTimeframe(timeframe: ThresholdTimeframe): number {
  return WINDOW_MS_BY_TIMEFRAME[timeframe];
}

export function minimumBarsForTimeframe(timeframe: ThresholdTimeframe): number {
  return MIN_BARS_BY_TIMEFRAME[timeframe];
}

export function expectedBarsForWindow(
  timeframe: ThresholdTimeframe,
  windowMs: number
): number {
  const intervalMs = timeframeToIntervalMs(timeframe);
  return Math.max(1, Math.floor(windowMs / intervalMs));
}

export function timeframeToIntervalMs(timeframe: ThresholdTimeframe): number {
  if (timeframe === "5m") return 5 * 60 * 1000;
  if (timeframe === "15m") return 15 * 60 * 1000;
  if (timeframe === "1h") return 60 * 60 * 1000;
  if (timeframe === "4h") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export function quantile(values: number[], q: number): number | null {
  const safe = toFiniteNumbers(values);
  if (safe.length === 0) return null;
  const sorted = [...safe].sort((a, b) => a - b);
  const boundedQ = Math.max(0, Math.min(1, q));
  const index = (sorted.length - 1) * boundedQ;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? null;
  const weight = index - lower;
  const a = sorted[lower] ?? sorted[upper];
  const b = sorted[upper] ?? sorted[lower];
  return a + (b - a) * weight;
}

export function winsorizeSeries(values: number[], winsorizePct = 0.01): number[] {
  const safe = toFiniteNumbers(values);
  if (safe.length < 3) return safe;
  const bounded = Math.max(0, Math.min(0.25, winsorizePct));
  if (bounded <= 0) return safe;
  const low = quantile(safe, bounded);
  const high = quantile(safe, 1 - bounded);
  if (low === null || high === null || low > high) return safe;
  return safe.map((value) => Math.max(low, Math.min(high, value)));
}

export function quantileBands(values: number[], winsorizePct = 0.01): QuantileBands | null {
  const source = winsorizeSeries(values, winsorizePct);
  if (source.length < 5) return null;
  const p10 = quantile(source, 0.1);
  const p25 = quantile(source, 0.25);
  const p50 = quantile(source, 0.5);
  const p75 = quantile(source, 0.75);
  const p90 = quantile(source, 0.9);
  if ([p10, p25, p50, p75, p90].some((item) => item === null)) return null;
  return {
    p10: p10 as number,
    p25: p25 as number,
    p50: p50 as number,
    p75: p75 as number,
    p90: p90 as number
  };
}

export function fallbackFeatureThresholds(): ResolvedFeatureThresholds {
  return JSON.parse(JSON.stringify(FALLBACK_THRESHOLDS)) as ResolvedFeatureThresholds;
}

export function buildFeatureThresholds(input: {
  atrPctSeries: number[];
  absEmaSpreadPctSeries: number[];
  spreadBpsSeries?: number[];
  depth1pctUsdSeries?: number[];
  winsorizePct?: number;
  expectedBars?: number;
  nBars?: number;
  dataGap?: boolean;
}): {
  thresholds: ResolvedFeatureThresholds;
  usedFallback: boolean;
  thresholdsJson: FeatureThresholdsJson;
} {
  const winsorizePct = Math.max(0, Math.min(0.25, input.winsorizePct ?? 0.01));
  const atrBands = quantileBands(input.atrPctSeries, winsorizePct);
  const emaBands = quantileBands(input.absEmaSpreadPctSeries, winsorizePct);
  const spreadBands = quantileBands(input.spreadBpsSeries ?? [], winsorizePct);
  const depthBands = quantileBands(input.depth1pctUsdSeries ?? [], winsorizePct);

  const usedFallback = !(atrBands && emaBands);
  const fallback = fallbackFeatureThresholds();

  const atr = atrBands
    ? {
        ...atrBands,
        volLow: atrBands.p25,
        volHigh: atrBands.p75,
        volExtreme: atrBands.p90
      }
    : fallback.atrPct;
  const absEma = emaBands
    ? {
        ...emaBands,
        trendWeak: emaBands.p25,
        trendStrong: emaBands.p75
      }
    : fallback.absEmaSpreadPct;
  const spread = spreadBands
    ? {
        ...spreadBands,
        high: spreadBands.p90
      }
    : null;
  const depth = depthBands
    ? {
        ...depthBands,
        low: depthBands.p10
      }
    : null;

  const thresholds: ResolvedFeatureThresholds = {
    atrPct: atr,
    absEmaSpreadPct: absEma,
    spreadBps: spread,
    depth1pctUsd: depth
  };

  const expectedBars = Number.isFinite(Number(input.expectedBars)) ? Math.max(0, Number(input.expectedBars)) : 0;
  const nBars = Number.isFinite(Number(input.nBars)) ? Math.max(0, Number(input.nBars)) : 0;
  const gapRatio =
    expectedBars > 0
      ? Math.max(0, Math.min(1, 1 - nBars / Math.max(1, expectedBars)))
      : 0;

  const thresholdsJson: FeatureThresholdsJson = {
    version: FEATURE_THRESHOLD_VERSION,
    winsorizePct,
    riskFlags: {
      dataGap: Boolean(input.dataGap),
      insufficientData: usedFallback
    },
    bars: {
      expected: expectedBars,
      nBars,
      gapRatio
    },
    atrPct: atr,
    absEmaSpreadPct: absEma,
    spreadBps: spread,
    depth1pctUsd: depth
  };

  return {
    thresholds,
    usedFallback,
    thresholdsJson
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseQuantileBands(value: unknown): QuantileBands | null {
  const rec = asRecord(value);
  const p10 = asNumber(rec.p10);
  const p25 = asNumber(rec.p25);
  const p50 = asNumber(rec.p50);
  const p75 = asNumber(rec.p75);
  const p90 = asNumber(rec.p90);
  if ([p10, p25, p50, p75, p90].some((item) => item === null)) return null;
  return {
    p10: p10 as number,
    p25: p25 as number,
    p50: p50 as number,
    p75: p75 as number,
    p90: p90 as number
  };
}

export function readFeatureThresholds(value: unknown): ResolvedFeatureThresholds | null {
  const rec = asRecord(value);

  const atrBands = parseQuantileBands(rec.atrPct);
  const emaBands = parseQuantileBands(rec.absEmaSpreadPct);
  if (!atrBands || !emaBands) return null;

  const spreadBands = parseQuantileBands(rec.spreadBps);
  const depthBands = parseQuantileBands(rec.depth1pctUsd);

  return {
    atrPct: {
      ...atrBands,
      volLow: asNumber(asRecord(rec.atrPct).volLow) ?? atrBands.p25,
      volHigh: asNumber(asRecord(rec.atrPct).volHigh) ?? atrBands.p75,
      volExtreme: asNumber(asRecord(rec.atrPct).volExtreme) ?? atrBands.p90
    },
    absEmaSpreadPct: {
      ...emaBands,
      trendWeak: asNumber(asRecord(rec.absEmaSpreadPct).trendWeak) ?? emaBands.p25,
      trendStrong: asNumber(asRecord(rec.absEmaSpreadPct).trendStrong) ?? emaBands.p75
    },
    spreadBps: spreadBands
      ? {
          ...spreadBands,
          high: asNumber(asRecord(rec.spreadBps).high) ?? spreadBands.p90
        }
      : null,
    depth1pctUsd: depthBands
      ? {
          ...depthBands,
          low: asNumber(asRecord(rec.depth1pctUsd).low) ?? depthBands.p10
        }
      : null
  };
}

function interpolate(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(x1) || !Number.isFinite(x2)) return y1;
  if (x1 === x2) return (y1 + y2) / 2;
  const t = (x - x1) / (x2 - x1);
  return y1 + (y2 - y1) * t;
}

export function percentileRankFromBands(value: number, bands: QuantileBands | null): number | null {
  if (!Number.isFinite(value) || !bands) return null;
  const points: Array<[number, number]> = [
    [10, bands.p10],
    [25, bands.p25],
    [50, bands.p50],
    [75, bands.p75],
    [90, bands.p90]
  ];

  if (value <= bands.p10) {
    const rank = interpolate(value, bands.p10, 10, bands.p25, 25);
    return Math.max(0, Math.min(100, rank));
  }
  if (value >= bands.p90) {
    const rank = interpolate(value, bands.p75, 75, bands.p90, 90);
    const boosted = 90 + (rank - 90);
    return Math.max(0, Math.min(100, boosted));
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const [r1, v1] = points[i];
    const [r2, v2] = points[i + 1];
    if (value >= v1 && value <= v2) {
      const rank = interpolate(value, v1, r1, v2, r2);
      return Math.max(0, Math.min(100, rank));
    }
  }

  return null;
}

export function deriveRegimeTags(input: {
  signal: ThresholdSignal;
  atrPct: number;
  emaSpreadPct: number;
  rsi: number | null;
  thresholds: ResolvedFeatureThresholds;
}): string[] {
  const tags: string[] = [];
  const absEma = Math.abs(input.emaSpreadPct);
  const highVol = input.atrPct >= input.thresholds.atrPct.volHigh;
  const lowVol = input.atrPct <= input.thresholds.atrPct.volLow;

  if (highVol) tags.push("high_vol");
  if (lowVol) tags.push("low_vol");

  const rsiUpOk = input.rsi === null || input.rsi >= 50;
  const rsiDownOk = input.rsi === null || input.rsi <= 50;

  if (input.signal === "up" && absEma >= input.thresholds.absEmaSpreadPct.trendStrong && rsiUpOk) {
    tags.push("trend_up");
  }
  if (input.signal === "down" && absEma >= input.thresholds.absEmaSpreadPct.trendStrong && rsiDownOk) {
    tags.push("trend_down");
  }

  if (
    absEma <= input.thresholds.absEmaSpreadPct.trendWeak &&
    input.atrPct <= input.thresholds.atrPct.p50
  ) {
    tags.push("range_bound");
  }

  let breakoutThreshold = input.thresholds.atrPct.volHigh;
  if (highVol) breakoutThreshold *= 0.5;
  if (input.atrPct >= breakoutThreshold) {
    tags.push("breakout_risk");
  }

  return Array.from(new Set(tags));
}

export function applyConfidencePenalty(input: {
  baseConfidence: number;
  atrPct: number;
  emaSpreadPct: number;
  thresholds: ResolvedFeatureThresholds;
}): number {
  assert.ok(Number.isFinite(input.baseConfidence));
  let next = input.baseConfidence;
  const absEma = Math.abs(input.emaSpreadPct);

  if (input.atrPct >= input.thresholds.atrPct.volExtreme) {
    next *= 0.9;
  }
  if (absEma <= input.thresholds.absEmaSpreadPct.trendWeak) {
    next *= 0.92;
  }
  return Math.max(0, Math.min(1, next));
}

