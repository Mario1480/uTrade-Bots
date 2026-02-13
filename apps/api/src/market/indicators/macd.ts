import { MACD } from "technicalindicators";
import { toFinite } from "./shared.js";

export function computeMacd(closes: number[]): {
  line: number | null;
  signal: number | null;
  hist: number | null;
} {
  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const latest = macdSeries[macdSeries.length - 1] as
    | { MACD?: number; signal?: number; histogram?: number }
    | undefined;

  return {
    line: toFinite(latest?.MACD),
    signal: toFinite(latest?.signal),
    hist: toFinite(latest?.histogram)
  };
}
