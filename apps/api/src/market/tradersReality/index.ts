import type { Candle, Timeframe } from "../timeframe.js";
import {
  computeTradersRealityEmaSnapshot,
  type TradersRealityCloudSnapshot,
  type TradersRealityEmaSnapshot
} from "./emas.js";
import {
  computeTradersRealityLevels,
  type TradersRealityLevelsSnapshot
} from "./levels.js";
import {
  computeTradersRealityPvsra,
  type TradersRealityPvsraSnapshot
} from "./pvsra.js";
import {
  computeTradersRealityRanges,
  type TradersRealityRangesSnapshot
} from "./ranges.js";
import {
  computeTradersRealitySessions,
  type TradersRealitySessionsSnapshot
} from "./sessions.js";

export type TradersRealitySnapshot = {
  emas: TradersRealityEmaSnapshot;
  cloud: TradersRealityCloudSnapshot;
  levels: TradersRealityLevelsSnapshot;
  ranges: TradersRealityRangesSnapshot;
  sessions: TradersRealitySessionsSnapshot;
  pvsra: TradersRealityPvsraSnapshot;
  timeframe: Timeframe;
  dataGap: boolean;
};

export type TradersRealityComputeOptions = {
  enabled?: boolean;
  adrLen?: number;
  awrLen?: number;
  amrLen?: number;
  rdLen?: number;
  rwLen?: number;
  openingRangeMinutes?: number;
  sessionsUseDST?: boolean;
};

function emptySnapshot(tf: Timeframe): TradersRealitySnapshot {
  return {
    timeframe: tf,
    emas: {
      ema_5: null,
      ema_13: null,
      ema_50: null,
      ema_200: null,
      ema_800: null,
      emaStack: {
        bullishStack: false,
        bearishStack: false
      },
      emaDistancesPct: {
        price_vs_50_pct: null,
        price_vs_200_pct: null,
        price_vs_800_pct: null,
        spread_13_50_pct: null,
        spread_50_200_pct: null,
        spread_200_800_pct: null
      },
      emaSlopesPct: {
        slope_50_pct_1bar: null,
        slope_200_pct_1bar: null,
        slope_800_pct_1bar: null
      }
    },
    cloud: {
      cloud_size: null,
      upper: null,
      lower: null,
      width_pct: null,
      price_pos: null
    },
    levels: {
      daily: {
        dayOpen: null,
        dayHigh: null,
        dayLow: null,
        dayClose: null,
        pivots: {
          pp: null,
          r1: null,
          s1: null,
          r2: null,
          s2: null,
          r3: null,
          s3: null,
          m0: null,
          m1: null,
          m2: null,
          m3: null,
          m4: null,
          m5: null
        }
      },
      weekly: { weekHigh: null, weekLow: null },
      monthly: { monthHigh: null, monthLow: null }
    },
    ranges: {
      adr: { mode: "hilo", value: null, high: null, low: null, high50: null, low50: null },
      awr: { mode: "hilo", value: null, high: null, low: null, high50: null, low50: null },
      amr: { mode: "hilo", value: null, high: null, low: null, high50: null, low50: null },
      rd: { mode: "hilo", value: null, high: null, low: null, high50: null, low50: null },
      rw: { mode: "hilo", value: null, high: null, low: null, high50: null, low50: null },
      distancesPct: {
        dist_to_adrHigh_pct: null,
        dist_to_adrLow_pct: null,
        dist_to_awrHigh_pct: null,
        dist_to_awrLow_pct: null,
        dist_to_amrHigh_pct: null,
        dist_to_amrLow_pct: null,
        dist_to_rdHigh_pct: null,
        dist_to_rdLow_pct: null,
        dist_to_rwHigh_pct: null,
        dist_to_rwLow_pct: null
      }
    },
    sessions: {
      activeSession: null,
      openingRangeMinutes: 30,
      sessions: {}
    },
    pvsra: {
      avgVol10: null,
      spread: null,
      volSpread: null,
      highestVolSpread10: null,
      vectorTier: "none",
      direction: null,
      vectorColor: "regular",
      patterns: {
        redGreen: false,
        greenRed: false,
        redBlue: false,
        blueRed: false,
        greenPurple: false,
        purpleGreen: false,
        bluePurple: false,
        purpleBlue: false
      }
    },
    dataGap: true
  };
}

export function computeTradersRealityFeatures(
  candles: Candle[],
  timeframe: Timeframe,
  options: TradersRealityComputeOptions = {}
): TradersRealitySnapshot {
  if (options.enabled === false) {
    const snapshot = emptySnapshot(timeframe);
    snapshot.dataGap = false;
    return snapshot;
  }
  const sorted = candles
    .filter((row): row is Candle & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .sort((a, b) => (a.ts as number) - (b.ts as number));
  if (sorted.length < 20) {
    return emptySnapshot(timeframe);
  }

  const emaCloud = computeTradersRealityEmaSnapshot(sorted);
  const levels = computeTradersRealityLevels(sorted);
  const ranges = computeTradersRealityRanges(sorted, {
    adrLen: options.adrLen,
    awrLen: options.awrLen,
    amrLen: options.amrLen,
    rdLen: options.rdLen,
    rwLen: options.rwLen
  });
  const sessions = computeTradersRealitySessions(sorted, {
    openingRangeMinutes: options.openingRangeMinutes ?? 30,
    useDst: options.sessionsUseDST ?? true
  });
  const pvsra = computeTradersRealityPvsra(sorted);

  return {
    timeframe,
    emas: emaCloud.emas,
    cloud: emaCloud.cloud,
    levels,
    ranges,
    sessions,
    pvsra,
    dataGap: emaCloud.dataGap
  };
}
