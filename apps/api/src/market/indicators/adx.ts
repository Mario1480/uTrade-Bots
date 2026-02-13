import { ADX } from "technicalindicators";
import type { Candle } from "./types.js";
import { toFinite } from "./shared.js";

const ADX_PERIOD = 14;

function computeADX14Manual(candles: Candle[]): {
  adx_14: number | null;
  plus_di_14: number | null;
  minus_di_14: number | null;
} {
  if (candles.length < ADX_PERIOD * 2) {
    return { adx_14: null, plus_di_14: null, minus_di_14: null };
  }

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    const pDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const mDm = downMove > upMove && downMove > 0 ? downMove : 0;
    const trueRange = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );

    tr.push(trueRange);
    plusDm.push(pDm);
    minusDm.push(mDm);
  }

  if (tr.length < ADX_PERIOD) {
    return { adx_14: null, plus_di_14: null, minus_di_14: null };
  }

  let smoothTr = tr.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0);
  let smoothPlusDm = plusDm.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0);
  let smoothMinusDm = minusDm.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0);

  const dxSeries: number[] = [];
  let latestPlusDi: number | null = null;
  let latestMinusDi: number | null = null;

  for (let i = ADX_PERIOD; i < tr.length; i += 1) {
    smoothTr = smoothTr - smoothTr / ADX_PERIOD + tr[i];
    smoothPlusDm = smoothPlusDm - smoothPlusDm / ADX_PERIOD + plusDm[i];
    smoothMinusDm = smoothMinusDm - smoothMinusDm / ADX_PERIOD + minusDm[i];

    const plusDi = smoothTr > 0 ? (100 * smoothPlusDm) / smoothTr : 0;
    const minusDi = smoothTr > 0 ? (100 * smoothMinusDm) / smoothTr : 0;
    latestPlusDi = plusDi;
    latestMinusDi = minusDi;
    const diSum = plusDi + minusDi;
    const dx = diSum > 0 ? (100 * Math.abs(plusDi - minusDi)) / diSum : 0;
    dxSeries.push(dx);
  }

  if (dxSeries.length < ADX_PERIOD) {
    return {
      adx_14: null,
      plus_di_14: latestPlusDi,
      minus_di_14: latestMinusDi
    };
  }

  let adx = dxSeries.slice(0, ADX_PERIOD).reduce((sum, v) => sum + v, 0) / ADX_PERIOD;
  for (let i = ADX_PERIOD; i < dxSeries.length; i += 1) {
    adx = ((adx * (ADX_PERIOD - 1)) + dxSeries[i]) / ADX_PERIOD;
  }

  return {
    adx_14: adx,
    plus_di_14: latestPlusDi,
    minus_di_14: latestMinusDi
  };
}

export function computeADX14(candles: Candle[]): {
  adx_14: number | null;
  plus_di_14: number | null;
  minus_di_14: number | null;
} {
  if (candles.length < ADX_PERIOD * 2) {
    return { adx_14: null, plus_di_14: null, minus_di_14: null };
  }

  const highs = candles.map((row) => row.high);
  const lows = candles.map((row) => row.low);
  const closes = candles.map((row) => row.close);

  try {
    if (typeof ADX?.calculate === "function") {
      const adxSeries = ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: ADX_PERIOD
      });
      const latest = adxSeries[adxSeries.length - 1];
      if (latest) {
        return {
          adx_14: toFinite((latest as { adx?: number }).adx),
          plus_di_14: toFinite((latest as { pdi?: number }).pdi),
          minus_di_14: toFinite((latest as { mdi?: number }).mdi)
        };
      }
    }
  } catch {
    // Fall through to manual implementation.
  }

  return computeADX14Manual(candles);
}
