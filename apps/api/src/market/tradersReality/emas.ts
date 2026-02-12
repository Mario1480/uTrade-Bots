import { EMA } from "technicalindicators";
import type { Candle } from "../timeframe.js";

type NullableNumber = number | null;

export type TradersRealityEmaSnapshot = {
  ema_5: NullableNumber;
  ema_13: NullableNumber;
  ema_50: NullableNumber;
  ema_200: NullableNumber;
  ema_800: NullableNumber;
  emaStack: {
    bullishStack: boolean;
    bearishStack: boolean;
  };
  emaDistancesPct: {
    price_vs_50_pct: NullableNumber;
    price_vs_200_pct: NullableNumber;
    price_vs_800_pct: NullableNumber;
    spread_13_50_pct: NullableNumber;
    spread_50_200_pct: NullableNumber;
    spread_200_800_pct: NullableNumber;
  };
  emaSlopesPct: {
    slope_50_pct_1bar: NullableNumber;
    slope_200_pct_1bar: NullableNumber;
    slope_800_pct_1bar: NullableNumber;
  };
};

export type TradersRealityCloudSnapshot = {
  cloud_size: NullableNumber;
  upper: NullableNumber;
  lower: NullableNumber;
  width_pct: NullableNumber;
  price_pos: NullableNumber;
};

function toFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return sum / values.length;
}

function std(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = mean(values);
  if (avg === null) return null;
  let sum = 0;
  for (const value of values) {
    const delta = value - avg;
    sum += delta * delta;
  }
  return Math.sqrt(sum / values.length);
}

function emaSeries(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  try {
    const series = EMA.calculate({ period, values });
    if (Array.isArray(series) && series.length > 0) return series;
  } catch {
    // fallback below
  }
  const out: number[] = [];
  const k = 2 / (period + 1);
  const seed = mean(values.slice(0, period));
  if (seed === null) return [];
  let ema = seed;
  out.push(ema);
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function latestEma(values: number[], period: number): { latest: number | null; prev: number | null } {
  const series = emaSeries(values, period);
  if (series.length === 0) return { latest: null, prev: null };
  const latest = toFinite(series[series.length - 1]);
  const prev = toFinite(series.length > 1 ? series[series.length - 2] : null);
  return { latest, prev };
}

export function computeTradersRealityEmaSnapshot(candles: Candle[]): {
  emas: TradersRealityEmaSnapshot;
  cloud: TradersRealityCloudSnapshot;
  dataGap: boolean;
} {
  const closes = candles.map((row) => row.close);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;

  const ema5 = latestEma(closes, 5);
  const ema13 = latestEma(closes, 13);
  const ema50 = latestEma(closes, 50);
  const ema200 = latestEma(closes, 200);
  const ema800 = latestEma(closes, 800);

  const bullishStack =
    ema5.latest !== null &&
    ema13.latest !== null &&
    ema50.latest !== null &&
    ema200.latest !== null &&
    ema800.latest !== null &&
    ema5.latest > ema13.latest &&
    ema13.latest > ema50.latest &&
    ema50.latest > ema200.latest &&
    ema200.latest > ema800.latest;
  const bearishStack =
    ema5.latest !== null &&
    ema13.latest !== null &&
    ema50.latest !== null &&
    ema200.latest !== null &&
    ema800.latest !== null &&
    ema5.latest < ema13.latest &&
    ema13.latest < ema50.latest &&
    ema50.latest < ema200.latest &&
    ema200.latest < ema800.latest;

  const cloudLen = 100;
  const cloudWindow = closes.length >= cloudLen ? closes.slice(-cloudLen) : [];
  const cloudStd = cloudWindow.length === cloudLen ? std(cloudWindow) : null;
  const cloudSize = cloudStd !== null ? cloudStd / 4 : null;
  const cloudUpper =
    cloudSize !== null && ema50.latest !== null ? ema50.latest + cloudSize : null;
  const cloudLower =
    cloudSize !== null && ema50.latest !== null ? ema50.latest - cloudSize : null;
  const cloudWidthPct =
    cloudUpper !== null &&
    cloudLower !== null &&
    ema50.latest !== null &&
    ema50.latest !== 0
      ? ((cloudUpper - cloudLower) / ema50.latest) * 100
      : null;
  const cloudPricePos =
    cloudUpper !== null &&
    cloudLower !== null &&
    lastClose !== null &&
    cloudUpper !== cloudLower
      ? clamp((lastClose - cloudLower) / (cloudUpper - cloudLower), 0, 1)
      : null;

  const dataGap =
    closes.length < 900 ||
    ema50.latest === null ||
    ema200.latest === null ||
    ema800.latest === null;

  return {
    emas: {
      ema_5: round(ema5.latest, 6),
      ema_13: round(ema13.latest, 6),
      ema_50: round(ema50.latest, 6),
      ema_200: round(ema200.latest, 6),
      ema_800: round(ema800.latest, 6),
      emaStack: {
        bullishStack,
        bearishStack
      },
      emaDistancesPct: {
        price_vs_50_pct:
          lastClose !== null && ema50.latest !== null && ema50.latest !== 0
            ? round(((lastClose / ema50.latest) - 1) * 100, 6)
            : null,
        price_vs_200_pct:
          lastClose !== null && ema200.latest !== null && ema200.latest !== 0
            ? round(((lastClose / ema200.latest) - 1) * 100, 6)
            : null,
        price_vs_800_pct:
          lastClose !== null && ema800.latest !== null && ema800.latest !== 0
            ? round(((lastClose / ema800.latest) - 1) * 100, 6)
            : null,
        spread_13_50_pct:
          ema13.latest !== null && ema50.latest !== null && ema50.latest !== 0
            ? round(((ema13.latest / ema50.latest) - 1) * 100, 6)
            : null,
        spread_50_200_pct:
          ema50.latest !== null && ema200.latest !== null && ema200.latest !== 0
            ? round(((ema50.latest / ema200.latest) - 1) * 100, 6)
            : null,
        spread_200_800_pct:
          ema200.latest !== null && ema800.latest !== null && ema800.latest !== 0
            ? round(((ema200.latest / ema800.latest) - 1) * 100, 6)
            : null
      },
      emaSlopesPct: {
        slope_50_pct_1bar:
          ema50.latest !== null && ema50.prev !== null && ema50.prev !== 0
            ? round(((ema50.latest / ema50.prev) - 1) * 100, 6)
            : null,
        slope_200_pct_1bar:
          ema200.latest !== null && ema200.prev !== null && ema200.prev !== 0
            ? round(((ema200.latest / ema200.prev) - 1) * 100, 6)
            : null,
        slope_800_pct_1bar:
          ema800.latest !== null && ema800.prev !== null && ema800.prev !== 0
            ? round(((ema800.latest / ema800.prev) - 1) * 100, 6)
            : null
      }
    },
    cloud: {
      cloud_size: round(cloudSize, 6),
      upper: round(cloudUpper, 6),
      lower: round(cloudLower, 6),
      width_pct: round(cloudWidthPct, 6),
      price_pos: round(cloudPricePos, 6)
    },
    dataGap
  };
}
