import { EMA } from "technicalindicators";
import { mean, toFinite } from "./shared.js";

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

type EmaLatest = { latest: number | null; prev: number | null };

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

function latestEma(values: number[], period: number): EmaLatest {
  const series = emaSeries(values, period);
  if (series.length === 0) return { latest: null, prev: null };
  const latest = toFinite(series[series.length - 1]);
  const prev = toFinite(series.length > 1 ? series[series.length - 2] : null);
  return { latest, prev };
}

export type TradersRealityEmaComputed = {
  ema5: EmaLatest;
  ema13: EmaLatest;
  ema50: EmaLatest;
  ema200: EmaLatest;
  ema800: EmaLatest;
  bullishStack: boolean;
  bearishStack: boolean;
};

export function computeTradersRealityEma(closes: number[]): TradersRealityEmaComputed {
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

  return {
    ema5,
    ema13,
    ema50,
    ema200,
    ema800,
    bullishStack,
    bearishStack
  };
}
