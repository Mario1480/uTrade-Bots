import type { Candle } from "./types.js";
import { emaLatest, mean, std } from "./shared.js";

export function computeVolumeFeatures(
  candles: Candle[],
  params: {
    lookback: number;
    emaFast: number;
    emaSlow: number;
  }
): {
  vol_z: number | null;
  rel_vol: number | null;
  vol_ema_fast: number | null;
  vol_ema_slow: number | null;
  vol_trend: number | null;
} {
  const volumes = candles.map((row) => {
    const parsed = Number(row.volume);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });

  if (volumes.length < params.lookback) {
    return {
      vol_z: null,
      rel_vol: null,
      vol_ema_fast: null,
      vol_ema_slow: null,
      vol_trend: null
    };
  }

  const tail = volumes.slice(-params.lookback);
  const volLast = tail[tail.length - 1];
  const volMean = mean(tail);
  const volStd = std(tail);
  const volSma = volMean;
  const volFast = emaLatest(volumes, params.emaFast);
  const volSlow = emaLatest(volumes, params.emaSlow);

  const volZ = volMean === null || volStd === null
    ? null
    : volStd <= 1e-12
      ? 0
      : (volLast - volMean) / volStd;
  const relVol = volSma !== null && volSma > 0 ? volLast / volSma : null;
  const volTrend =
    volFast !== null && volSlow !== null && volSlow > 0
      ? ((volFast / volSlow) - 1) * 100
      : null;

  return {
    vol_z: volZ,
    rel_vol: relVol,
    vol_ema_fast: volFast,
    vol_ema_slow: volSlow,
    vol_trend: volTrend
  };
}
