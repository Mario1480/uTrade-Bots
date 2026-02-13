import { BollingerBands } from "technicalindicators";
import { clamp, toFinite } from "./shared.js";

export function computeBollinger(closes: number[], latestClose: number | null): {
  upper: number | null;
  mid: number | null;
  lower: number | null;
  width_pct: number | null;
  pos: number | null;
} {
  const bbSeries = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2
  });
  const latest = bbSeries[bbSeries.length - 1] as
    | { upper?: number; middle?: number; lower?: number }
    | undefined;

  const upper = toFinite(latest?.upper);
  const mid = toFinite(latest?.middle);
  const lower = toFinite(latest?.lower);
  const widthPct = upper !== null && lower !== null && mid !== null && mid !== 0
    ? ((upper - lower) / mid) * 100
    : null;
  const posRaw = upper !== null && lower !== null && latestClose !== null && upper !== lower
    ? (latestClose - lower) / (upper - lower)
    : null;

  return {
    upper,
    mid,
    lower,
    width_pct: widthPct,
    pos: posRaw !== null ? clamp(posRaw, 0, 1) : null
  };
}
