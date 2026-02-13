import { RSI } from "technicalindicators";
import { clamp, smaSeries } from "./shared.js";

export type StochRsiParams = {
  rsiLen: number;
  stochLen: number;
  smoothK: number;
  smoothD: number;
  requiredBars: number;
};

export function computeStochRsi(
  values: number[],
  params: StochRsiParams
): {
  k: number | null;
  d: number | null;
  value: number | null;
} {
  if (values.length < params.requiredBars) {
    return { k: null, d: null, value: null };
  }

  const rsiSeries = RSI.calculate({ values, period: params.rsiLen });
  if (rsiSeries.length < params.stochLen + params.smoothK + params.smoothD) {
    return { k: null, d: null, value: null };
  }

  const rawStoch: number[] = [];
  for (let i = params.stochLen - 1; i < rsiSeries.length; i += 1) {
    const window = rsiSeries.slice(i - params.stochLen + 1, i + 1);
    const low = Math.min(...window);
    const high = Math.max(...window);
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    const denom = high - low;
    if (Math.abs(denom) < 1e-12) {
      rawStoch.push(50);
    } else {
      rawStoch.push(clamp(((rsiSeries[i] - low) / denom) * 100, 0, 100));
    }
  }

  const kSeries = smaSeries(rawStoch, params.smoothK);
  const dSeries = smaSeries(kSeries, params.smoothD);
  const k = kSeries.length > 0 ? kSeries[kSeries.length - 1] : null;
  const d = dSeries.length > 0 ? dSeries[dSeries.length - 1] : null;

  return {
    k,
    d,
    value: k
  };
}
