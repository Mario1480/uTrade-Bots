import { RSI } from "technicalindicators";
import { toFinite } from "./shared.js";

const RSI_PERIOD = 14;

export function computeRsi14(closes: number[]): number | null {
  const rsiSeries = RSI.calculate({ values: closes, period: RSI_PERIOD });
  return toFinite(rsiSeries[rsiSeries.length - 1]);
}
