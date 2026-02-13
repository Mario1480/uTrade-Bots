import type { Candle, Timeframe } from "../timeframe.js";
import {
  computeEmaCloudSnapshot,
  type CloudSnapshot,
  type EmaSnapshot
} from "./emaCloud.js";
import {
  computeLevels,
  type LevelsSnapshot
} from "./levels.js";
import {
  computePvsra,
  type PvsraSnapshot
} from "./pvsra.js";
import {
  computeRanges,
  type RangesSnapshot
} from "./ranges.js";
import {
  computeSessions,
  type SessionsSnapshot
} from "./sessions.js";
import {
  computeSmartMoneyConcepts,
  type SmartMoneyConceptsSnapshot
} from "./smartMoneyConcepts.js";

export type AdvancedIndicatorsSnapshot = {
  emas: EmaSnapshot;
  cloud: CloudSnapshot;
  levels: LevelsSnapshot;
  ranges: RangesSnapshot;
  sessions: SessionsSnapshot;
  pvsra: PvsraSnapshot;
  smartMoneyConcepts: SmartMoneyConceptsSnapshot;
  timeframe: Timeframe;
  dataGap: boolean;
};

export type AdvancedIndicatorsComputeOptions = {
  enabled?: boolean;
  adrLen?: number;
  awrLen?: number;
  amrLen?: number;
  rdLen?: number;
  rwLen?: number;
  openingRangeMinutes?: number;
  sessionsUseDST?: boolean;
  smcInternalLength?: number;
  smcSwingLength?: number;
  smcEqualLength?: number;
  smcEqualThreshold?: number;
  smcMaxOrderBlocks?: number;
  smcFvgAutoThreshold?: boolean;
};

function emptySnapshot(tf: Timeframe): AdvancedIndicatorsSnapshot {
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
    smartMoneyConcepts: {
      internal: {
        trend: "neutral",
        lastEvent: {
          type: null,
          direction: null,
          level: null,
          ts: null
        },
        bullishBreaks: 0,
        bearishBreaks: 0
      },
      swing: {
        trend: "neutral",
        lastEvent: {
          type: null,
          direction: null,
          level: null,
          ts: null
        },
        bullishBreaks: 0,
        bearishBreaks: 0
      },
      equalLevels: {
        eqh: {
          detected: false,
          level: null,
          ts: null,
          deltaPct: null
        },
        eql: {
          detected: false,
          level: null,
          ts: null,
          deltaPct: null
        }
      },
      orderBlocks: {
        internal: {
          bullishCount: 0,
          bearishCount: 0,
          latestBullish: null,
          latestBearish: null
        },
        swing: {
          bullishCount: 0,
          bearishCount: 0,
          latestBullish: null,
          latestBearish: null
        }
      },
      fairValueGaps: {
        bullishCount: 0,
        bearishCount: 0,
        latestBullish: null,
        latestBearish: null,
        autoThresholdPct: null
      },
      zones: {
        trailingTop: null,
        trailingBottom: null,
        premiumTop: null,
        premiumBottom: null,
        equilibriumTop: null,
        equilibriumBottom: null,
        discountTop: null,
        discountBottom: null
      },
      dataGap: true
    },
    dataGap: true
  };
}

export function computeAdvancedIndicators(
  candles: Candle[],
  timeframe: Timeframe,
  options: AdvancedIndicatorsComputeOptions = {}
): AdvancedIndicatorsSnapshot {
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

  const emaCloud = computeEmaCloudSnapshot(sorted);
  const levels = computeLevels(sorted);
  const ranges = computeRanges(sorted, {
    adrLen: options.adrLen,
    awrLen: options.awrLen,
    amrLen: options.amrLen,
    rdLen: options.rdLen,
    rwLen: options.rwLen
  });
  const sessions = computeSessions(sorted, {
    openingRangeMinutes: options.openingRangeMinutes ?? 30,
    useDst: options.sessionsUseDST ?? true
  });
  const pvsra = computePvsra(sorted);
  const smartMoneyConcepts = computeSmartMoneyConcepts(sorted, {
    internalLength: options.smcInternalLength,
    swingLength: options.smcSwingLength,
    equalLength: options.smcEqualLength,
    equalThreshold: options.smcEqualThreshold,
    maxOrderBlocks: options.smcMaxOrderBlocks,
    fvgAutoThreshold: options.smcFvgAutoThreshold
  });

  return {
    timeframe,
    emas: emaCloud.emas,
    cloud: emaCloud.cloud,
    levels,
    ranges,
    sessions,
    pvsra,
    smartMoneyConcepts,
    dataGap: emaCloud.dataGap
  };
}
