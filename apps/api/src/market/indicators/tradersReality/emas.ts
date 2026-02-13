import type { Candle } from "../../timeframe.js";
import { computeTradersRealityCloud, type TradersRealityCloudSnapshot } from "./indicators/cloud.js";
import { computeTradersRealityEma, type TradersRealityEmaSnapshot } from "./indicators/ema.js";
import { round } from "./indicators/shared.js";

export type { TradersRealityEmaSnapshot } from "./indicators/ema.js";
export type { TradersRealityCloudSnapshot } from "./indicators/cloud.js";

export function computeTradersRealityEmaSnapshot(candles: Candle[]): {
  emas: TradersRealityEmaSnapshot;
  cloud: TradersRealityCloudSnapshot;
  dataGap: boolean;
} {
  const closes = candles.map((row) => row.close);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
  const ema = computeTradersRealityEma(closes);
  const cloud = computeTradersRealityCloud(closes, ema.ema50.latest, lastClose);

  const dataGap =
    closes.length < 900 ||
    ema.ema50.latest === null ||
    ema.ema200.latest === null ||
    ema.ema800.latest === null;

  return {
    emas: {
      ema_5: round(ema.ema5.latest, 6),
      ema_13: round(ema.ema13.latest, 6),
      ema_50: round(ema.ema50.latest, 6),
      ema_200: round(ema.ema200.latest, 6),
      ema_800: round(ema.ema800.latest, 6),
      emaStack: {
        bullishStack: ema.bullishStack,
        bearishStack: ema.bearishStack
      },
      emaDistancesPct: {
        price_vs_50_pct:
          lastClose !== null && ema.ema50.latest !== null && ema.ema50.latest !== 0
            ? round(((lastClose / ema.ema50.latest) - 1) * 100, 6)
            : null,
        price_vs_200_pct:
          lastClose !== null && ema.ema200.latest !== null && ema.ema200.latest !== 0
            ? round(((lastClose / ema.ema200.latest) - 1) * 100, 6)
            : null,
        price_vs_800_pct:
          lastClose !== null && ema.ema800.latest !== null && ema.ema800.latest !== 0
            ? round(((lastClose / ema.ema800.latest) - 1) * 100, 6)
            : null,
        spread_13_50_pct:
          ema.ema13.latest !== null && ema.ema50.latest !== null && ema.ema50.latest !== 0
            ? round(((ema.ema13.latest / ema.ema50.latest) - 1) * 100, 6)
            : null,
        spread_50_200_pct:
          ema.ema50.latest !== null && ema.ema200.latest !== null && ema.ema200.latest !== 0
            ? round(((ema.ema50.latest / ema.ema200.latest) - 1) * 100, 6)
            : null,
        spread_200_800_pct:
          ema.ema200.latest !== null && ema.ema800.latest !== null && ema.ema800.latest !== 0
            ? round(((ema.ema200.latest / ema.ema800.latest) - 1) * 100, 6)
            : null
      },
      emaSlopesPct: {
        slope_50_pct_1bar:
          ema.ema50.latest !== null && ema.ema50.prev !== null && ema.ema50.prev !== 0
            ? round(((ema.ema50.latest / ema.ema50.prev) - 1) * 100, 6)
            : null,
        slope_200_pct_1bar:
          ema.ema200.latest !== null && ema.ema200.prev !== null && ema.ema200.prev !== 0
            ? round(((ema.ema200.latest / ema.ema200.prev) - 1) * 100, 6)
            : null,
        slope_800_pct_1bar:
          ema.ema800.latest !== null && ema.ema800.prev !== null && ema.ema800.prev !== 0
            ? round(((ema.ema800.latest / ema.ema800.prev) - 1) * 100, 6)
            : null
      }
    },
    cloud,
    dataGap
  };
}
