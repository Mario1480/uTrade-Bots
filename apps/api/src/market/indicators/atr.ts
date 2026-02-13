import { ATR } from "technicalindicators";
import { toFinite } from "./shared.js";

const ATR_PERIOD = 14;

export function computeAtrPct(
  highs: number[],
  lows: number[],
  closes: number[],
  latestClose: number | null
): number | null {
  const atrSeries = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: ATR_PERIOD
  });
  const latestAtr = toFinite(atrSeries[atrSeries.length - 1]);
  return latestAtr !== null && latestClose !== null && latestClose > 0
    ? latestAtr / latestClose
    : null;
}
