"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type ScopeType = "global" | "account" | "symbol" | "symbol_tf";
type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";

type IndicatorSettingsConfig = {
  enabledPacks: {
    indicatorsV1: boolean;
    indicatorsV2: boolean;
    advancedIndicators: boolean;
    liquiditySweeps: boolean;
  };
  indicatorsV2: {
    stochrsi: { rsiLen: number; stochLen: number; smoothK: number; smoothD: number };
    volume: { lookback: number; emaFast: number; emaSlow: number };
    fvg: { lookback: number; fillRule: "overlap" | "mid_touch" };
    breakerBlocks: {
      len: number;
      breakerCandleOnlyBody: boolean;
      breakerCandle2Last: boolean;
      tillFirstBreak: boolean;
      onlyWhenInPDarray: boolean;
      showPDarray: boolean;
      showBreaks: boolean;
      showSPD: boolean;
      pdTextColor: string;
      pdSwingLineColor: string;
      enableTp: boolean;
      tpColor: string;
      rrTp1: number;
      rrTp2: number;
      rrTp3: number;
      bbPlusColorA: string;
      bbPlusColorB: string;
      swingBullColor: string;
      bbMinusColorA: string;
      bbMinusColorB: string;
      swingBearColor: string;
    };
    superOrderBlockFvgBos: {
      plotOB: boolean;
      obBullColor: string;
      obBearColor: string;
      obBoxBorderStyle: "solid" | "dashed" | "dotted";
      obBorderTransparency: number;
      obMaxBoxSet: number;
      filterMitOB: boolean;
      mitOBColor: string;
      plotFVG: boolean;
      plotStructureBreakingFVG: boolean;
      fvgBullColor: string;
      fvgBearColor: string;
      fvgStructBreakingColor: string;
      fvgBoxBorderStyle: "solid" | "dashed" | "dotted";
      fvgBorderTransparency: number;
      fvgMaxBoxSet: number;
      filterMitFVG: boolean;
      mitFVGColor: string;
      plotRJB: boolean;
      rjbBullColor: string;
      rjbBearColor: string;
      rjbBoxBorderStyle: "solid" | "dashed" | "dotted";
      rjbBorderTransparency: number;
      rjbMaxBoxSet: number;
      filterMitRJB: boolean;
      mitRJBColor: string;
      plotPVT: boolean;
      pivotLookup: number;
      pvtTopColor: string;
      pvtBottomColor: string;
      plotBOS: boolean;
      useHighLowForBullishBoS: boolean;
      useHighLowForBearishBoS: boolean;
      bosBoxFlag: boolean;
      bosBoxLength: number;
      bosBullColor: string;
      bosBearColor: string;
      bosBoxBorderStyle: "solid" | "dashed" | "dotted";
      bosBorderTransparency: number;
      bosMaxBoxSet: number;
      plotHVB: boolean;
      hvbBullColor: string;
      hvbBearColor: string;
      hvbEMAPeriod: number;
      hvbMultiplier: number;
      plotPPDD: boolean;
      ppddBullColor: string;
      ppddBearColor: string;
      plotOBFVG: boolean;
      obfvgBullColor: string;
      obfvgBearColor: string;
      plotLabelOB: boolean;
      obLabelColor: string;
      obLabelSize: "huge" | "large" | "small" | "tiny" | "auto" | "normal";
      plotLabelFVG: boolean;
      fvgLabelColor: string;
      fvgLabelSize: "huge" | "large" | "small" | "tiny" | "auto" | "normal";
      plotLabelRJB: boolean;
      rjbLabelColor: string;
      rjbLabelSize: "huge" | "large" | "small" | "tiny" | "auto" | "normal";
      plotLabelBOS: boolean;
      bosLabelColor: string;
      bosLabelSize: "huge" | "large" | "small" | "tiny" | "auto" | "normal";
    };
    vumanchu: {
      wtChannelLen: number;
      wtAverageLen: number;
      wtMaLen: number;
      obLevel: number;
      osLevel: number;
      osLevel3: number;
      wtDivObLevel: number;
      wtDivOsLevel: number;
      wtDivObLevelAdd: number;
      wtDivOsLevelAdd: number;
      rsiLen: number;
      rsiMfiPeriod: number;
      rsiMfiMultiplier: number;
      rsiMfiPosY: number;
      stochLen: number;
      stochRsiLen: number;
      stochKSmooth: number;
      stochDSmooth: number;
      useHiddenDiv: boolean;
      useHiddenDivNoLimits: boolean;
      goldRsiThreshold: number;
      goldWtDiffMin: number;
    };
  };
  advancedIndicators: {
    adrLen: number;
    awrLen: number;
    amrLen: number;
    rdLen: number;
    rwLen: number;
    openingRangeMin: number;
    sessionsUseDST: boolean;
    smcInternalLength: number;
    smcSwingLength: number;
    smcEqualLength: number;
    smcEqualThreshold: number;
    smcMaxOrderBlocks: number;
    smcFvgAutoThreshold: boolean;
  };
  liquiditySweeps: {
    len: number;
    mode: "wicks" | "outbreak_retest" | "both";
    extend: boolean;
    maxBars: number;
    maxRecentEvents: number;
    maxActiveZones: number;
  };
  aiGating: {
    enabled: boolean;
    minConfidenceForExplain: number;
    minConfidenceForNeutralExplain: number;
    confidenceJumpThreshold: number;
    keyLevelNearPct: number;
    recentEventBars: { "5m": number; "15m": number; "1h": number; "4h": number; "1d": number };
    highImportanceMin: number;
    aiCooldownSec: { "5m": number; "15m": number; "1h": number; "4h": number; "1d": number };
    maxHighPriorityPerHour: number;
  };
};

type IndicatorSettingRow = {
  id: string;
  scopeType: ScopeType;
  exchange: string | null;
  accountId: string | null;
  symbol: string | null;
  timeframe: string | null;
  configPatch: Record<string, unknown>;
  configEffective: IndicatorSettingsConfig;
  updatedAt: string;
};

type ListResponse = { items: IndicatorSettingRow[] };

type ResolvedResponse = {
  config: IndicatorSettingsConfig;
  hash: string;
  breakdown: Array<{
    id: string;
    scopeType: ScopeType;
    exchange: string | null;
    accountId: string | null;
    symbol: string | null;
    timeframe: string | null;
    updatedAt: string;
  }>;
  defaults: IndicatorSettingsConfig;
};

type IndicatorCatalogItem = {
  key: string;
  name: string;
  live: boolean;
  outputs: string[];
  params: string[];
  note?: string;
};

type IndicatorCatalogGroup = {
  key: string;
  title: string;
  description: string;
  items: IndicatorCatalogItem[];
};

type StochRsiKey = keyof IndicatorSettingsConfig["indicatorsV2"]["stochrsi"];
type VolumeKey = keyof IndicatorSettingsConfig["indicatorsV2"]["volume"];
type FvgKey = keyof IndicatorSettingsConfig["indicatorsV2"]["fvg"];
type BreakerBlocksKey = keyof IndicatorSettingsConfig["indicatorsV2"]["breakerBlocks"];
type SuperOrderBlockFvgBosKey = keyof IndicatorSettingsConfig["indicatorsV2"]["superOrderBlockFvgBos"];
type AdvancedIndicatorsKey = Exclude<
  keyof IndicatorSettingsConfig["advancedIndicators"],
  "sessionsUseDST" | "smcFvgAutoThreshold"
>;
type AiGatingNumberKey =
  | "minConfidenceForExplain"
  | "minConfidenceForNeutralExplain"
  | "confidenceJumpThreshold"
  | "keyLevelNearPct"
  | "highImportanceMin"
  | "maxHighPriorityPerHour";
type LiquiditySweepsNumberKey = Exclude<
  keyof IndicatorSettingsConfig["liquiditySweeps"],
  "mode" | "extend"
>;
type IndicatorSectionKey =
  | "stochRsi"
  | "volume"
  | "fvg"
  | "breakerBlocks"
  | "superOrderBlockFvgBos"
  | "rangesSessions"
  | "smc"
  | "aiGating"
  | "liquiditySweeps";

const SCOPE_OPTIONS: ScopeType[] = ["global", "account", "symbol", "symbol_tf"];
const TIMEFRAME_OPTIONS: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

const FALLBACK_DEFAULTS: IndicatorSettingsConfig = {
  enabledPacks: {
    indicatorsV1: true,
    indicatorsV2: true,
    advancedIndicators: true,
    liquiditySweeps: true
  },
  indicatorsV2: {
    stochrsi: { rsiLen: 14, stochLen: 14, smoothK: 3, smoothD: 3 },
    volume: { lookback: 100, emaFast: 10, emaSlow: 30 },
    fvg: { lookback: 300, fillRule: "overlap" },
    breakerBlocks: {
      len: 5,
      breakerCandleOnlyBody: false,
      breakerCandle2Last: false,
      tillFirstBreak: true,
      onlyWhenInPDarray: false,
      showPDarray: false,
      showBreaks: false,
      showSPD: true,
      pdTextColor: "#c0c0c0",
      pdSwingLineColor: "#c0c0c0",
      enableTp: false,
      tpColor: "#2157f3",
      rrTp1: 2,
      rrTp2: 3,
      rrTp3: 4,
      bbPlusColorA: "rgba(12,181,26,0.365)",
      bbPlusColorB: "rgba(12,181,26,0.333)",
      swingBullColor: "rgba(255,82,82,0.333)",
      bbMinusColorA: "rgba(255,17,0,0.373)",
      bbMinusColorB: "rgba(255,17,0,0.333)",
      swingBearColor: "rgba(0,137,123,0.333)"
    },
    superOrderBlockFvgBos: {
      plotOB: true,
      obBullColor: "rgba(0,128,0,0.1)",
      obBearColor: "rgba(255,0,0,0.1)",
      obBoxBorderStyle: "solid",
      obBorderTransparency: 80,
      obMaxBoxSet: 10,
      filterMitOB: false,
      mitOBColor: "rgba(128,128,128,0.1)",
      plotFVG: true,
      plotStructureBreakingFVG: true,
      fvgBullColor: "rgba(0,0,0,0.1)",
      fvgBearColor: "rgba(0,0,0,0.1)",
      fvgStructBreakingColor: "rgba(0,0,255,0.1)",
      fvgBoxBorderStyle: "solid",
      fvgBorderTransparency: 80,
      fvgMaxBoxSet: 10,
      filterMitFVG: false,
      mitFVGColor: "rgba(128,128,128,0.1)",
      plotRJB: false,
      rjbBullColor: "rgba(0,128,0,0.1)",
      rjbBearColor: "rgba(255,0,0,0.1)",
      rjbBoxBorderStyle: "solid",
      rjbBorderTransparency: 80,
      rjbMaxBoxSet: 10,
      filterMitRJB: false,
      mitRJBColor: "rgba(128,128,128,0.1)",
      plotPVT: true,
      pivotLookup: 1,
      pvtTopColor: "rgba(192,192,192,1)",
      pvtBottomColor: "rgba(192,192,192,1)",
      plotBOS: false,
      useHighLowForBullishBoS: false,
      useHighLowForBearishBoS: false,
      bosBoxFlag: false,
      bosBoxLength: 3,
      bosBullColor: "rgba(0,128,0,0.1)",
      bosBearColor: "rgba(255,0,0,0.1)",
      bosBoxBorderStyle: "solid",
      bosBorderTransparency: 80,
      bosMaxBoxSet: 10,
      plotHVB: true,
      hvbBullColor: "rgba(0,128,0,1)",
      hvbBearColor: "rgba(255,0,0,1)",
      hvbEMAPeriod: 12,
      hvbMultiplier: 1.5,
      plotPPDD: true,
      ppddBullColor: "rgba(0,128,0,1)",
      ppddBearColor: "rgba(255,0,0,1)",
      plotOBFVG: true,
      obfvgBullColor: "rgba(0,128,0,1)",
      obfvgBearColor: "rgba(255,0,0,1)",
      plotLabelOB: true,
      obLabelColor: "rgba(128,128,128,1)",
      obLabelSize: "tiny",
      plotLabelFVG: true,
      fvgLabelColor: "rgba(128,128,128,1)",
      fvgLabelSize: "tiny",
      plotLabelRJB: true,
      rjbLabelColor: "rgba(128,128,128,1)",
      rjbLabelSize: "tiny",
      plotLabelBOS: true,
      bosLabelColor: "rgba(128,128,128,1)",
      bosLabelSize: "tiny"
    },
    vumanchu: {
      wtChannelLen: 9,
      wtAverageLen: 12,
      wtMaLen: 3,
      obLevel: 53,
      osLevel: -53,
      osLevel3: -75,
      wtDivObLevel: 45,
      wtDivOsLevel: -65,
      wtDivObLevelAdd: 15,
      wtDivOsLevelAdd: -40,
      rsiLen: 14,
      rsiMfiPeriod: 60,
      rsiMfiMultiplier: 150,
      rsiMfiPosY: 2.5,
      stochLen: 14,
      stochRsiLen: 14,
      stochKSmooth: 3,
      stochDSmooth: 3,
      useHiddenDiv: false,
      useHiddenDivNoLimits: true,
      goldRsiThreshold: 30,
      goldWtDiffMin: 5
    }
  },
  advancedIndicators: {
    adrLen: 14,
    awrLen: 4,
    amrLen: 6,
    rdLen: 15,
    rwLen: 13,
    openingRangeMin: 30,
    sessionsUseDST: true,
    smcInternalLength: 5,
    smcSwingLength: 50,
    smcEqualLength: 3,
    smcEqualThreshold: 0.1,
    smcMaxOrderBlocks: 20,
    smcFvgAutoThreshold: true
  },
  liquiditySweeps: {
    len: 5,
    mode: "both",
    extend: true,
    maxBars: 300,
    maxRecentEvents: 20,
    maxActiveZones: 20
  },
  aiGating: {
    enabled: true,
    minConfidenceForExplain: 70,
    minConfidenceForNeutralExplain: 60,
    confidenceJumpThreshold: 10,
    keyLevelNearPct: 0.5,
    recentEventBars: { "5m": 6, "15m": 4, "1h": 2, "4h": 2, "1d": 2 },
    highImportanceMin: 4,
    aiCooldownSec: { "5m": 120, "15m": 240, "1h": 900, "4h": 1800, "1d": 3600 },
    maxHighPriorityPerHour: 12
  }
};

const INDICATOR_CATALOG_GROUPS: IndicatorCatalogGroup[] = [
  {
    key: "momentum",
    title: "Momentum & Trend",
    description: "Direction and trend-strength factors for baseline signaling.",
    items: [
      {
        key: "rsi14",
        name: "RSI (14)",
        live: true,
        outputs: ["indicators.rsi_14"],
        params: ["fixed period=14"]
      },
      {
        key: "macd",
        name: "MACD (12/26/9)",
        live: true,
        outputs: [
          "indicators.macd.line",
          "indicators.macd.signal",
          "indicators.macd.hist"
        ],
        params: ["fixed fast=12 slow=26 signal=9"]
      },
      {
        key: "adx",
        name: "ADX + DI (14)",
        live: true,
        outputs: [
          "indicators.adx.adx_14",
          "indicators.adx.plus_di_14",
          "indicators.adx.minus_di_14"
        ],
        params: ["fixed period=14"]
      },
      {
        key: "stochrsi",
        name: "Stoch RSI",
        live: true,
        outputs: [
          "indicators.stochrsi.k",
          "indicators.stochrsi.d",
          "indicators.stochrsi.value"
        ],
        params: [
          "config.indicatorsV2.stochrsi.rsiLen",
          "config.indicatorsV2.stochrsi.stochLen",
          "config.indicatorsV2.stochrsi.smoothK",
          "config.indicatorsV2.stochrsi.smoothD"
        ]
      }
    ]
  },
  {
    key: "volatility",
    title: "Volatility & Structure",
    description: "Volatility regime and market-structure context.",
    items: [
      {
        key: "bb",
        name: "Bollinger Bands (20/2)",
        live: true,
        outputs: [
          "indicators.bb.upper",
          "indicators.bb.mid",
          "indicators.bb.lower",
          "indicators.bb.width_pct",
          "indicators.bb.pos"
        ],
        params: ["fixed period=20 stdDev=2"]
      },
      {
        key: "atrpct",
        name: "ATR%",
        live: true,
        outputs: ["indicators.atr_pct"],
        params: ["fixed ATR(14) / close"]
      },
      {
        key: "fvg",
        name: "Fair Value Gap (FVG) Summary",
        live: true,
        outputs: [
          "indicators.fvg.open_bullish_count",
          "indicators.fvg.open_bearish_count",
          "indicators.fvg.nearest_bullish_gap.dist_pct",
          "indicators.fvg.nearest_bearish_gap.dist_pct",
          "indicators.fvg.last_created",
          "indicators.fvg.last_filled"
        ],
        params: [
          "config.indicatorsV2.fvg.lookback",
          "config.indicatorsV2.fvg.fillRule"
        ]
      },
      {
        key: "vumanchu",
        name: "VuManChu Cipher B Core",
        live: true,
        outputs: [
          "indicators.vumanchu.waveTrend.*",
          "indicators.vumanchu.divergences.*",
          "indicators.vumanchu.signals.*"
        ],
        params: [
          "config.indicatorsV2.vumanchu.wt*",
          "config.indicatorsV2.vumanchu.rsi*",
          "config.indicatorsV2.vumanchu.stoch*",
          "config.indicatorsV2.vumanchu.useHiddenDiv*",
          "config.indicatorsV2.vumanchu.gold*"
        ]
      },
      {
        key: "breaker-blocks",
        name: "Breaker Blocks with Signals (LuxAlgo)",
        live: true,
        outputs: [
          "indicators.breakerBlocks.dir",
          "indicators.breakerBlocks.top|bottom|mid",
          "indicators.breakerBlocks.signals.*",
          "indicators.breakerBlocks.eventCounts.*"
        ],
        params: [
          "config.indicatorsV2.breakerBlocks.*"
        ]
      },
      {
        key: "super-orderblock-fvg-bos",
        name: "Super OrderBlock / FVG / BoS (makuchaku & eFe)",
        live: true,
        outputs: [
          "indicators.superOrderBlockFvgBos.top|bottom",
          "indicators.superOrderBlockFvgBos.activeZones.*",
          "indicators.superOrderBlockFvgBos.events.*",
          "indicators.superOrderBlockFvgBos.eventCounts.*",
          "indicators.superOrderBlockFvgBos.markerCounts.*"
        ],
        params: [
          "config.indicatorsV2.superOrderBlockFvgBos.*"
        ]
      }
    ]
  },
  {
    key: "flow",
    title: "Flow & Price Anchor",
    description: "Execution-context metrics around price anchoring and participation.",
    items: [
      {
        key: "vwap",
        name: "VWAP (session / rolling)",
        live: true,
        outputs: [
          "indicators.vwap.value",
          "indicators.vwap.dist_pct",
          "indicators.vwap.mode"
        ],
        params: ["intraday=session_utc", "1d=rolling_20"]
      },
      {
        key: "volume",
        name: "Volume Features",
        live: true,
        outputs: [
          "indicators.volume.vol_z",
          "indicators.volume.rel_vol",
          "indicators.volume.vol_ema_fast",
          "indicators.volume.vol_ema_slow",
          "indicators.volume.vol_trend"
        ],
        params: [
          "config.indicatorsV2.volume.lookback",
          "config.indicatorsV2.volume.emaFast",
          "config.indicatorsV2.volume.emaSlow"
        ]
      }
    ]
  },
  {
    key: "advanced-indicators",
    title: "Advanced Indicators",
    description: "Extended context indicators consumed by explainer and prediction inference.",
    items: [
      {
        key: "advanced-emas-cloud",
        name: "EMAs + Cloud",
        live: true,
        outputs: [
          "advancedIndicators.emas.*",
          "advancedIndicators.cloud.*"
        ],
        params: ["derived from candle stream (no dedicated params)"]
      },
      {
        key: "advanced-levels",
        name: "Levels & Pivots",
        live: true,
        outputs: [
          "advancedIndicators.levels.daily.*",
          "advancedIndicators.levels.weekly.*",
          "advancedIndicators.levels.monthly.*"
        ],
        params: ["derived from candle stream (no dedicated params)"]
      },
      {
        key: "advanced-ranges",
        name: "Ranges (ADR/AWR/AMR/RD/RW)",
        live: true,
        outputs: [
          "advancedIndicators.ranges.adr|awr|amr|rd|rw.*",
          "advancedIndicators.ranges.distancesPct.*"
        ],
        params: [
          "config.advancedIndicators.adrLen",
          "config.advancedIndicators.awrLen",
          "config.advancedIndicators.amrLen",
          "config.advancedIndicators.rdLen",
          "config.advancedIndicators.rwLen"
        ]
      },
      {
        key: "advanced-sessions",
        name: "Sessions (DST-aware)",
        live: true,
        outputs: [
          "advancedIndicators.sessions.activeSession",
          "advancedIndicators.sessions.sessions"
        ],
        params: [
          "config.advancedIndicators.openingRangeMin",
          "config.advancedIndicators.sessionsUseDST"
        ]
      },
      {
        key: "advanced-pvsra",
        name: "PVSRA Vector",
        live: true,
        outputs: [
          "advancedIndicators.pvsra.vectorTier",
          "advancedIndicators.pvsra.vectorColor",
          "advancedIndicators.pvsra.patterns.*"
        ],
        params: ["derived from candle stream (no dedicated params)"]
      },
      {
        key: "advanced-smc",
        name: "Smart Money Concepts (SMC)",
        live: true,
        outputs: [
          "advancedIndicators.smartMoneyConcepts.internal.*",
          "advancedIndicators.smartMoneyConcepts.swing.*",
          "advancedIndicators.smartMoneyConcepts.equalLevels.*",
          "advancedIndicators.smartMoneyConcepts.orderBlocks.*",
          "advancedIndicators.smartMoneyConcepts.fairValueGaps.*",
          "advancedIndicators.smartMoneyConcepts.zones.*"
        ],
        params: [
          "config.advancedIndicators.smcInternalLength",
          "config.advancedIndicators.smcSwingLength",
          "config.advancedIndicators.smcEqualLength",
          "config.advancedIndicators.smcEqualThreshold",
          "config.advancedIndicators.smcMaxOrderBlocks",
          "config.advancedIndicators.smcFvgAutoThreshold"
        ]
      }
    ]
  },
  {
    key: "runtime-controls",
    title: "Runtime Controls",
    description: "Controls around AI explain-calls and prepared-but-not-wired features.",
    items: [
      {
        key: "ai-gating",
        name: "AI Explain Gating",
        live: true,
        outputs: ["gating only (no featureSnapshot field)"],
        params: [
          "config.aiGating.enabled",
          "config.aiGating.minConfidenceForExplain",
          "config.aiGating.minConfidenceForNeutralExplain",
          "config.aiGating.confidenceJumpThreshold",
          "config.aiGating.keyLevelNearPct",
          "config.aiGating.recentEventBars.*",
          "config.aiGating.highImportanceMin",
          "config.aiGating.aiCooldownSec.*",
          "config.aiGating.maxHighPriorityPerHour"
        ]
      },
      {
        key: "liquidity-sweeps",
        name: "Liquidity Sweeps",
        live: false,
        outputs: ["none yet in featureSnapshot"],
        params: [
          "config.liquiditySweeps.len",
          "config.liquiditySweeps.mode",
          "config.liquiditySweeps.extend",
          "config.liquiditySweeps.maxBars",
          "config.liquiditySweeps.maxRecentEvents",
          "config.liquiditySweeps.maxActiveZones"
        ],
        note: "Settings exist, but not yet wired into prediction feature computation."
      }
    ]
  }
];

function parseTimeframe(value: string | null | undefined): Timeframe {
  if (value === "5m" || value === "15m" || value === "1h" || value === "4h" || value === "1d") {
    return value;
  }
  return "15m";
}

function parseFvgFillRule(value: string): IndicatorSettingsConfig["indicatorsV2"]["fvg"]["fillRule"] {
  return value === "mid_touch" ? "mid_touch" : "overlap";
}

function parseLiquiditySweepsMode(
  value: string
): IndicatorSettingsConfig["liquiditySweeps"]["mode"] {
  if (value === "wicks" || value === "outbreak_retest" || value === "both") {
    return value;
  }
  return "both";
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function catalogStatus(item: IndicatorCatalogItem) {
  if (item.live) return "live";
  return "settings_only";
}

function catalogStatusColor(status: ReturnType<typeof catalogStatus>): string {
  if (status === "live") return "#54d17a";
  return "var(--muted)";
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function buildScopeLabel(row: {
  scopeType: ScopeType;
  exchange: string | null;
  accountId: string | null;
  symbol: string | null;
  timeframe: string | null;
}) {
  const parts: string[] = [row.scopeType];
  if (row.exchange) parts.push(`ex:${row.exchange}`);
  if (row.accountId) parts.push(`acc:${row.accountId.slice(0, 10)}…`);
  if (row.symbol) parts.push(`sym:${row.symbol}`);
  if (row.timeframe) parts.push(`tf:${row.timeframe}`);
  return parts.join(" · ");
}

export default function AdminIndicatorSettingsPage() {
  const t = useTranslations("admin.indicatorSettings");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [items, setItems] = useState<IndicatorSettingRow[]>([]);
  const [resolved, setResolved] = useState<ResolvedResponse | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("global");
  const [exchange, setExchange] = useState("bitget");
  const [accountId, setAccountId] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [config, setConfig] = useState<IndicatorSettingsConfig>(FALLBACK_DEFAULTS);
  const [openCatalogGroups, setOpenCatalogGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(INDICATOR_CATALOG_GROUPS.map((group) => [group.key, false]))
  );
  const [openIndicatorSections, setOpenIndicatorSections] = useState<Record<IndicatorSectionKey, boolean>>({
    stochRsi: false,
    volume: false,
    fvg: false,
    breakerBlocks: false,
    superOrderBlockFvgBos: false,
    rangesSessions: false,
    smc: false,
    aiGating: false,
    liquiditySweeps: false
  });

  const canSave = useMemo(() => {
    if (scopeType === "account") return accountId.trim().length > 0;
    if (scopeType === "symbol") return symbol.trim().length > 0;
    if (scopeType === "symbol_tf") return symbol.trim().length > 0 && timeframe.trim().length > 0;
    return true;
  }, [accountId, scopeType, symbol, timeframe]);

  const catalogSummary = useMemo(() => {
    const allItems = INDICATOR_CATALOG_GROUPS.flatMap((group) => group.items);
    const liveCount = allItems.filter((item) => item.live).length;
    return {
      groups: INDICATOR_CATALOG_GROUPS.length,
      indicators: allItems.length,
      live: liveCount,
      settingsOnly: allItems.length - liveCount
    };
  }, [t]);

  function setIndicatorsV2StochRsi(field: StochRsiKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        stochrsi: { ...prev.indicatorsV2.stochrsi, [field]: value }
      }
    }));
  }

  function setIndicatorsV2Volume(field: VolumeKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        volume: { ...prev.indicatorsV2.volume, [field]: value }
      }
    }));
  }

  function setIndicatorsV2Fvg(field: FvgKey, value: IndicatorSettingsConfig["indicatorsV2"]["fvg"][FvgKey]) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        fvg: { ...prev.indicatorsV2.fvg, [field]: value }
      }
    }));
  }

  function setIndicatorsV2BreakerBlocks(
    field: BreakerBlocksKey,
    value: IndicatorSettingsConfig["indicatorsV2"]["breakerBlocks"][BreakerBlocksKey]
  ) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        breakerBlocks: { ...prev.indicatorsV2.breakerBlocks, [field]: value }
      }
    }));
  }

  function setIndicatorsV2SuperOrderBlockFvgBos(
    field: SuperOrderBlockFvgBosKey,
    value: IndicatorSettingsConfig["indicatorsV2"]["superOrderBlockFvgBos"][SuperOrderBlockFvgBosKey]
  ) {
    setConfig((prev) => ({
      ...prev,
      indicatorsV2: {
        ...prev.indicatorsV2,
        superOrderBlockFvgBos: {
          ...prev.indicatorsV2.superOrderBlockFvgBos,
          [field]: value
        }
      }
    }));
  }

  function setAdvancedIndicatorsNumber(field: AdvancedIndicatorsKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      advancedIndicators: { ...prev.advancedIndicators, [field]: value }
    }));
  }

  function setAdvancedIndicatorsSessionsUseDst(enabled: boolean) {
    setConfig((prev) => ({
      ...prev,
      advancedIndicators: { ...prev.advancedIndicators, sessionsUseDST: enabled }
    }));
  }

  function setAdvancedIndicatorsSmcFvgAutoThreshold(enabled: boolean) {
    setConfig((prev) => ({
      ...prev,
      advancedIndicators: { ...prev.advancedIndicators, smcFvgAutoThreshold: enabled }
    }));
  }

  function setAiGatingNumber(field: AiGatingNumberKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      aiGating: { ...prev.aiGating, [field]: value }
    }));
  }

  function setAiGatingEnabled(enabled: boolean) {
    setConfig((prev) => ({
      ...prev,
      aiGating: {
        ...prev.aiGating,
        enabled
      }
    }));
  }

  function setAiGatingRecentEventBars(tf: Timeframe, value: number) {
    setConfig((prev) => ({
      ...prev,
      aiGating: {
        ...prev.aiGating,
        recentEventBars: {
          ...prev.aiGating.recentEventBars,
          [tf]: value
        }
      }
    }));
  }

  function setAiGatingCooldownSec(tf: Timeframe, value: number) {
    setConfig((prev) => ({
      ...prev,
      aiGating: {
        ...prev.aiGating,
        aiCooldownSec: {
          ...prev.aiGating.aiCooldownSec,
          [tf]: value
        }
      }
    }));
  }

  function setLiquiditySweepsNumber(field: LiquiditySweepsNumberKey, value: number) {
    setConfig((prev) => ({
      ...prev,
      liquiditySweeps: { ...prev.liquiditySweeps, [field]: value }
    }));
  }

  function setLiquiditySweepsMode(mode: IndicatorSettingsConfig["liquiditySweeps"]["mode"]) {
    setConfig((prev) => ({
      ...prev,
      liquiditySweeps: { ...prev.liquiditySweeps, mode }
    }));
  }

  function setLiquiditySweepsExtend(extend: boolean) {
    setConfig((prev) => ({
      ...prev,
      liquiditySweeps: { ...prev.liquiditySweeps, extend }
    }));
  }

  function toggleIndicatorSection(section: IndicatorSectionKey) {
    setOpenIndicatorSections((prev) => ({
      ...prev,
      [section]: !prev[section]
    }));
  }

  function toggleCatalogGroup(groupKey: string) {
    setOpenCatalogGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsSuperadmin(true);
      const list = await apiGet<ListResponse>("/api/admin/indicator-settings");
      setItems(list.items ?? []);
      const firstResolved = await apiGet<ResolvedResponse>("/api/admin/indicator-settings/resolved");
      setResolved(firstResolved);
      setConfig(firstResolved.config ?? FALLBACK_DEFAULTS);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function refreshResolvedPreview() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (exchange.trim()) params.set("exchange", exchange.trim());
      if (accountId.trim()) params.set("accountId", accountId.trim());
      if (symbol.trim()) params.set("symbol", symbol.trim());
      if (timeframe.trim()) params.set("timeframe", timeframe.trim());
      const query = params.toString();
      const next = await apiGet<ResolvedResponse>(
        `/api/admin/indicator-settings/resolved${query ? `?${query}` : ""}`
      );
      setResolved(next);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  function resetForm() {
    setEditingId(null);
    setScopeType("global");
    setExchange("bitget");
    setAccountId("");
    setSymbol("BTCUSDT");
    setTimeframe("15m");
    setConfig(resolved?.defaults ?? FALLBACK_DEFAULTS);
  }

  function applyRow(row: IndicatorSettingRow, clone = false) {
    setEditingId(clone ? null : row.id);
    setScopeType(row.scopeType);
    setExchange(row.exchange ?? "bitget");
    setAccountId(row.accountId ?? "");
    setSymbol(row.symbol ?? "BTCUSDT");
    setTimeframe(parseTimeframe(row.timeframe));
    setConfig(row.configEffective ?? (resolved?.defaults ?? FALLBACK_DEFAULTS));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        scopeType,
        exchange: scopeType === "global" ? undefined : exchange.trim() || undefined,
        accountId: scopeType === "account" ? accountId.trim() : undefined,
        symbol: scopeType === "symbol" || scopeType === "symbol_tf" ? symbol.trim() : undefined,
        timeframe: scopeType === "symbol_tf" ? timeframe : undefined,
        config
      };

      if (editingId) {
        await apiPut(`/api/admin/indicator-settings/${editingId}`, payload);
        setNotice(t("messages.updated"));
      } else {
        await apiPost("/api/admin/indicator-settings", payload);
        setNotice(t("messages.created"));
      }

      await loadAll();
      await refreshResolvedPreview();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(id: string) {
    if (!confirm(t("messages.confirmDelete"))) return;
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/api/admin/indicator-settings/${id}`);
      if (editingId === id) resetForm();
      setNotice(t("messages.deleted"));
      await loadAll();
      await refreshResolvedPreview();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap">
      <div className="adminTopActions">
        <Link href={withLocalePath("/admin", locale)} className="btn">← {tCommon("backToAdmin")}</Link>
        <Link href={withLocalePath("/settings", locale)} className="btn">← {tCommon("backToSettings")}</Link>
      </div>
      <h2 className="indicatorAdminTitle">{t("title")}</h2>
      <div className="adminPageIntro indicatorAdminIntro">
        {t("subtitle")}
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isSuperadmin ? (
        <>
          <section className="card settingsSection indicatorCatalogSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("catalog.title")}</h3>
              <span className="indicatorCatalogScopeChip">
                {t("catalog.scopeLayers")}: {resolved?.breakdown?.length ?? 0}
              </span>
            </div>
            <div className="indicatorCatalogStatsGrid">
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">{t("catalog.indicatorGroups")}</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.groups}</div>
              </div>
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">{t("catalog.integratedIndicators")}</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.indicators}</div>
              </div>
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">{t("catalog.live")}</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.live}</div>
              </div>
              <div className="indicatorCatalogStatCard">
                <div className="indicatorCatalogStatLabel">{t("catalog.settingsOnly")}</div>
                <div className="indicatorCatalogStatValue">{catalogSummary.settingsOnly}</div>
              </div>
            </div>
            <div className="settingsAccordion indicatorCatalogAccordion">
              {INDICATOR_CATALOG_GROUPS.map((group) => {
                const isOpen = !!openCatalogGroups[group.key];
                return (
                  <div
                    key={group.key}
                    className={`settingsAccordionItem ${isOpen ? "settingsAccordionItemOpen" : ""}`}
                  >
                    <button
                      type="button"
                      className="settingsAccordionTrigger"
                      onClick={() => toggleCatalogGroup(group.key)}
                      aria-expanded={isOpen}
                    >
                      <span>{group.title}</span>
                      <span className="indicatorCatalogAccordionMeta">
                        <span className="indicatorCatalogGroupCount">{group.items.length} {t("catalog.indicators")}</span>
                        <span
                          className={`settingsAccordionChevron ${isOpen ? "settingsAccordionChevronOpen" : ""}`}
                        >
                          ▾
                        </span>
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="settingsAccordionBody">
                        <div className="settingsMutedText">{group.description}</div>
                        <div className="indicatorCatalogItemList">
                          {group.items.map((item) => {
                            const status = catalogStatus(item);
                            return (
                              <div key={item.key} className="indicatorCatalogItemCard">
                                <div className="indicatorCatalogItemHeader">
                                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                                  <span
                                    className="indicatorCatalogItemStatus"
                                    style={{ color: catalogStatusColor(status) }}
                                  >
                                    {status === "live" ? t("catalog.liveStatus") : t("catalog.settingsOnlyStatus")}
                                  </span>
                                </div>
                                {item.note ? (
                                  <div className="settingsMutedText">{item.note}</div>
                                ) : null}
                                <div className="mutedTiny">{t("catalog.outputs")}</div>
                                <div className="indicatorCatalogTokenList">
                                  {item.outputs.map((output) => (
                                    <code
                                      key={`${item.key}-out-${output}`}
                                      className="indicatorCatalogToken"
                                    >
                                      {output}
                                    </code>
                                  ))}
                                </div>
                                <div className="mutedTiny">{t("catalog.configParams")}</div>
                                <div className="indicatorCatalogTokenList">
                                  {item.params.map((param) => (
                                    <code
                                      key={`${item.key}-param-${param}`}
                                      className="indicatorCatalogToken"
                                    >
                                      {param}
                                    </code>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card settingsSection indicatorOverrideSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{editingId ? t("override.editTitle") : t("override.createTitle")}</h3>
              <span className="indicatorOverrideModeChip">
                {editingId ? t("override.updateMode") : t("override.newOverride")}
              </span>
            </div>
            <div className="settingsMutedText indicatorOverrideIntro">
              {t("override.intro")}
            </div>

            <div className="indicatorConfigBlock">
              <div className="indicatorConfigTitle">{t("override.scopeTarget")}</div>
              <div className="settingsMutedText indicatorConfigHint">
                {t("override.scopePriority")}
              </div>
            <div className="indicatorScopeGrid">
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("override.scope")}</span>
                <select className="input" value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)}>
                  {SCOPE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("override.exchange")}</span>
                <input className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="bitget" />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("override.accountId")}</span>
                <input className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={scopeType !== "account"} placeholder={scopeType === "account" ? "acc_..." : t("override.accountOnly")} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("override.symbol")}</span>
                <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={scopeType !== "symbol" && scopeType !== "symbol_tf"} placeholder={scopeType === "symbol" || scopeType === "symbol_tf" ? "BTCUSDT" : t("override.symbolOnly")} />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("override.timeframe")}</span>
                <select
                  className="input"
                  value={timeframe}
                  onChange={(e) => setTimeframe(parseTimeframe(e.target.value))}
                  disabled={scopeType !== "symbol_tf"}
                >
                  {TIMEFRAME_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            </div>

            <div className="settingsAccordion indicatorOverrideAccordion">
              <div className={`settingsAccordionItem ${openIndicatorSections.stochRsi ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("stochRsi")} aria-expanded={openIndicatorSections.stochRsi}>
                  <span>{t("sections.stochRsi")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.stochRsi ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.stochRsi ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rsiLen")}</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.rsiLen} onChange={(e) => setIndicatorsV2StochRsi("rsiLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.stochLen")}</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.stochLen} onChange={(e) => setIndicatorsV2StochRsi("stochLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.smoothK")}</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.smoothK} onChange={(e) => setIndicatorsV2StochRsi("smoothK", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.smoothD")}</span><input className="input" type="number" value={config.indicatorsV2.stochrsi.smoothD} onChange={(e) => setIndicatorsV2StochRsi("smoothD", parseNumber(e.target.value))} /></label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.volume ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("volume")} aria-expanded={openIndicatorSections.volume}>
                  <span>{t("sections.volume")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.volume ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.volume ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">{t("fields.lookback")}</span><input className="input" type="number" value={config.indicatorsV2.volume.lookback} onChange={(e) => setIndicatorsV2Volume("lookback", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.emaFast")}</span><input className="input" type="number" value={config.indicatorsV2.volume.emaFast} onChange={(e) => setIndicatorsV2Volume("emaFast", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.emaSlow")}</span><input className="input" type="number" value={config.indicatorsV2.volume.emaSlow} onChange={(e) => setIndicatorsV2Volume("emaSlow", parseNumber(e.target.value))} /></label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.fvg ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("fvg")} aria-expanded={openIndicatorSections.fvg}>
                  <span>{t("sections.fvg")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.fvg ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.fvg ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">{t("fields.lookback")}</span><input className="input" type="number" value={config.indicatorsV2.fvg.lookback} onChange={(e) => setIndicatorsV2Fvg("lookback", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fillRule")}</span><select className="input" value={config.indicatorsV2.fvg.fillRule} onChange={(e) => setIndicatorsV2Fvg("fillRule", parseFvgFillRule(e.target.value))}><option value="overlap">overlap</option><option value="mid_touch">mid_touch</option></select></label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.breakerBlocks ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("breakerBlocks")} aria-expanded={openIndicatorSections.breakerBlocks}>
                  <span>{t("sections.breakerBlocks")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.breakerBlocks ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.breakerBlocks ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">{t("fields.breakerLen")}</span><input className="input" type="number" min={1} max={10} value={config.indicatorsV2.breakerBlocks.len} onChange={(e) => setIndicatorsV2BreakerBlocks("len", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rrTp1")}</span><input className="input" type="number" min={0.2} max={100} step={0.1} value={config.indicatorsV2.breakerBlocks.rrTp1} onChange={(e) => setIndicatorsV2BreakerBlocks("rrTp1", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rrTp2")}</span><input className="input" type="number" min={0.2} max={100} step={0.1} value={config.indicatorsV2.breakerBlocks.rrTp2} onChange={(e) => setIndicatorsV2BreakerBlocks("rrTp2", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rrTp3")}</span><input className="input" type="number" min={0.2} max={100} step={0.1} value={config.indicatorsV2.breakerBlocks.rrTp3} onChange={(e) => setIndicatorsV2BreakerBlocks("rrTp3", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.pdTextColor")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.pdTextColor} onChange={(e) => setIndicatorsV2BreakerBlocks("pdTextColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.pdSwingLineColor")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.pdSwingLineColor} onChange={(e) => setIndicatorsV2BreakerBlocks("pdSwingLineColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.tpColor")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.tpColor} onChange={(e) => setIndicatorsV2BreakerBlocks("tpColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bbPlusColorA")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.bbPlusColorA} onChange={(e) => setIndicatorsV2BreakerBlocks("bbPlusColorA", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bbPlusColorB")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.bbPlusColorB} onChange={(e) => setIndicatorsV2BreakerBlocks("bbPlusColorB", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.swingBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.swingBullColor} onChange={(e) => setIndicatorsV2BreakerBlocks("swingBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bbMinusColorA")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.bbMinusColorA} onChange={(e) => setIndicatorsV2BreakerBlocks("bbMinusColorA", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bbMinusColorB")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.bbMinusColorB} onChange={(e) => setIndicatorsV2BreakerBlocks("bbMinusColorB", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.swingBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.breakerBlocks.swingBearColor} onChange={(e) => setIndicatorsV2BreakerBlocks("swingBearColor", e.target.value)} /></label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.breakerCandleOnlyBody} onChange={(e) => setIndicatorsV2BreakerBlocks("breakerCandleOnlyBody", e.target.checked)} /> {t("fields.breakerCandleOnlyBody")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.breakerCandle2Last} onChange={(e) => setIndicatorsV2BreakerBlocks("breakerCandle2Last", e.target.checked)} /> {t("fields.breakerCandle2Last")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.tillFirstBreak} onChange={(e) => setIndicatorsV2BreakerBlocks("tillFirstBreak", e.target.checked)} /> {t("fields.tillFirstBreak")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.onlyWhenInPDarray} onChange={(e) => setIndicatorsV2BreakerBlocks("onlyWhenInPDarray", e.target.checked)} /> {t("fields.onlyWhenInPDarray")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.showPDarray} onChange={(e) => setIndicatorsV2BreakerBlocks("showPDarray", e.target.checked)} /> {t("fields.showPDarray")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.showBreaks} onChange={(e) => setIndicatorsV2BreakerBlocks("showBreaks", e.target.checked)} /> {t("fields.showBreaks")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.showSPD} onChange={(e) => setIndicatorsV2BreakerBlocks("showSPD", e.target.checked)} /> {t("fields.showSPD")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.breakerBlocks.enableTp} onChange={(e) => setIndicatorsV2BreakerBlocks("enableTp", e.target.checked)} /> {t("fields.enableTp")}</label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.superOrderBlockFvgBos ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("superOrderBlockFvgBos")} aria-expanded={openIndicatorSections.superOrderBlockFvgBos}>
                  <span>{t("sections.superOrderBlockFvgBos")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.superOrderBlockFvgBos ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.superOrderBlockFvgBos ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">{t("fields.pivotLookup")}</span><input className="input" type="number" min={1} max={5} value={config.indicatorsV2.superOrderBlockFvgBos.pivotLookup} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("pivotLookup", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.hvbEmaPeriod")}</span><input className="input" type="number" min={1} max={500} value={config.indicatorsV2.superOrderBlockFvgBos.hvbEMAPeriod} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("hvbEMAPeriod", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.hvbMultiplier")}</span><input className="input" type="number" min={1} max={100} step={0.1} value={config.indicatorsV2.superOrderBlockFvgBos.hvbMultiplier} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("hvbMultiplier", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.obMaxBoxSet")}</span><input className="input" type="number" min={1} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.obMaxBoxSet} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obMaxBoxSet", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgMaxBoxSet")}</span><input className="input" type="number" min={1} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.fvgMaxBoxSet} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgMaxBoxSet", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rjbMaxBoxSet")}</span><input className="input" type="number" min={1} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.rjbMaxBoxSet} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("rjbMaxBoxSet", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosMaxBoxSet")}</span><input className="input" type="number" min={1} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.bosMaxBoxSet} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosMaxBoxSet", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosBoxLength")}</span><input className="input" type="number" min={1} max={5} value={config.indicatorsV2.superOrderBlockFvgBos.bosBoxLength} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosBoxLength", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.obBorderTransparency")}</span><input className="input" type="number" min={0} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.obBorderTransparency} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obBorderTransparency", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgBorderTransparency")}</span><input className="input" type="number" min={0} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.fvgBorderTransparency} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgBorderTransparency", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rjbBorderTransparency")}</span><input className="input" type="number" min={0} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.rjbBorderTransparency} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("rjbBorderTransparency", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosBorderTransparency")}</span><input className="input" type="number" min={0} max={100} value={config.indicatorsV2.superOrderBlockFvgBos.bosBorderTransparency} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosBorderTransparency", parseNumber(e.target.value))} /></label>

                      <label className="settingsField"><span className="mutedTiny">{t("fields.obBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.obBullColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.obBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.obBearColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obBearColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.mitOBColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.mitOBColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("mitOBColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.fvgBullColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.fvgBearColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgBearColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgStructBreakingColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.fvgStructBreakingColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgStructBreakingColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.mitFVGColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.mitFVGColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("mitFVGColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rjbBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.rjbBullColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("rjbBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rjbBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.rjbBearColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("rjbBearColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.mitRJBColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.mitRJBColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("mitRJBColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.bosBullColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.bosBearColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosBearColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.hvbBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.hvbBullColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("hvbBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.hvbBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.hvbBearColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("hvbBearColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.ppddBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.ppddBullColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("ppddBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.ppddBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.ppddBearColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("ppddBearColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.obfvgBullColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.obfvgBullColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obfvgBullColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.obfvgBearColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.obfvgBearColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obfvgBearColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.pvtTopColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.pvtTopColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("pvtTopColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.pvtBottomColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.pvtBottomColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("pvtBottomColor", e.target.value)} /></label>

                      <label className="settingsField"><span className="mutedTiny">{t("fields.obBoxBorderStyle")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.obBoxBorderStyle} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obBoxBorderStyle", e.target.value as any)}><option value="solid">solid</option><option value="dashed">dashed</option><option value="dotted">dotted</option></select></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgBoxBorderStyle")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.fvgBoxBorderStyle} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgBoxBorderStyle", e.target.value as any)}><option value="solid">solid</option><option value="dashed">dashed</option><option value="dotted">dotted</option></select></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rjbBoxBorderStyle")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.rjbBoxBorderStyle} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("rjbBoxBorderStyle", e.target.value as any)}><option value="solid">solid</option><option value="dashed">dashed</option><option value="dotted">dotted</option></select></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosBoxBorderStyle")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.bosBoxBorderStyle} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosBoxBorderStyle", e.target.value as any)}><option value="solid">solid</option><option value="dashed">dashed</option><option value="dotted">dotted</option></select></label>

                      <label className="settingsField"><span className="mutedTiny">{t("fields.obLabelColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.obLabelColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obLabelColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgLabelColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.fvgLabelColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgLabelColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rjbLabelColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.rjbLabelColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("rjbLabelColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosLabelColor")}</span><input className="input" type="text" value={config.indicatorsV2.superOrderBlockFvgBos.bosLabelColor} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosLabelColor", e.target.value)} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.obLabelSize")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.obLabelSize} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("obLabelSize", e.target.value as any)}>{["huge","large","small","tiny","auto","normal"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.fvgLabelSize")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.fvgLabelSize} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("fvgLabelSize", e.target.value as any)}>{["huge","large","small","tiny","auto","normal"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rjbLabelSize")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.rjbLabelSize} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("rjbLabelSize", e.target.value as any)}>{["huge","large","small","tiny","auto","normal"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.bosLabelSize")}</span><select className="input" value={config.indicatorsV2.superOrderBlockFvgBos.bosLabelSize} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosLabelSize", e.target.value as any)}>{["huge","large","small","tiny","auto","normal"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotOB} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotOB", e.target.checked)} /> {t("fields.plotOB")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.filterMitOB} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("filterMitOB", e.target.checked)} /> {t("fields.filterMitOB")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotFVG} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotFVG", e.target.checked)} /> {t("fields.plotFVG")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotStructureBreakingFVG} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotStructureBreakingFVG", e.target.checked)} /> {t("fields.plotStructureBreakingFVG")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.filterMitFVG} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("filterMitFVG", e.target.checked)} /> {t("fields.filterMitFVG")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotRJB} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotRJB", e.target.checked)} /> {t("fields.plotRJB")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.filterMitRJB} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("filterMitRJB", e.target.checked)} /> {t("fields.filterMitRJB")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotPVT} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotPVT", e.target.checked)} /> {t("fields.plotPVT")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotBOS} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotBOS", e.target.checked)} /> {t("fields.plotBOS")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.useHighLowForBullishBoS} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("useHighLowForBullishBoS", e.target.checked)} /> {t("fields.useHighLowForBullishBoS")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.useHighLowForBearishBoS} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("useHighLowForBearishBoS", e.target.checked)} /> {t("fields.useHighLowForBearishBoS")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.bosBoxFlag} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("bosBoxFlag", e.target.checked)} /> {t("fields.bosBoxFlag")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotHVB} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotHVB", e.target.checked)} /> {t("fields.plotHVB")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotPPDD} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotPPDD", e.target.checked)} /> {t("fields.plotPPDD")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotOBFVG} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotOBFVG", e.target.checked)} /> {t("fields.plotOBFVG")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotLabelOB} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotLabelOB", e.target.checked)} /> {t("fields.plotLabelOB")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotLabelFVG} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotLabelFVG", e.target.checked)} /> {t("fields.plotLabelFVG")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotLabelRJB} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotLabelRJB", e.target.checked)} /> {t("fields.plotLabelRJB")}</label>
                      <label className="inlineCheck"><input type="checkbox" checked={config.indicatorsV2.superOrderBlockFvgBos.plotLabelBOS} onChange={(e) => setIndicatorsV2SuperOrderBlockFvgBos("plotLabelBOS", e.target.checked)} /> {t("fields.plotLabelBOS")}</label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.rangesSessions ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("rangesSessions")} aria-expanded={openIndicatorSections.rangesSessions}>
                  <span>{t("sections.rangesSessions")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.rangesSessions ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.rangesSessions ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">{t("fields.openingRangeMin")}</span><input className="input" type="number" min={1} max={180} value={config.advancedIndicators.openingRangeMin} onChange={(e) => setAdvancedIndicatorsNumber("openingRangeMin", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.adrLen")}</span><input className="input" type="number" min={1} max={365} value={config.advancedIndicators.adrLen} onChange={(e) => setAdvancedIndicatorsNumber("adrLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.awrLen")}</span><input className="input" type="number" min={1} max={52} value={config.advancedIndicators.awrLen} onChange={(e) => setAdvancedIndicatorsNumber("awrLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.amrLen")}</span><input className="input" type="number" min={1} max={24} value={config.advancedIndicators.amrLen} onChange={(e) => setAdvancedIndicatorsNumber("amrLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rdLen")}</span><input className="input" type="number" min={1} max={365} value={config.advancedIndicators.rdLen} onChange={(e) => setAdvancedIndicatorsNumber("rdLen", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.rwLen")}</span><input className="input" type="number" min={1} max={104} value={config.advancedIndicators.rwLen} onChange={(e) => setAdvancedIndicatorsNumber("rwLen", parseNumber(e.target.value))} /></label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck"><input type="checkbox" checked={config.advancedIndicators.sessionsUseDST} onChange={(e) => setAdvancedIndicatorsSessionsUseDst(e.target.checked)} /> {t("fields.sessionsUseDst")}</label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.smc ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("smc")} aria-expanded={openIndicatorSections.smc}>
                  <span>{t("sections.smc")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.smc ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.smc ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">{t("fields.internalLen")}</span><input className="input" type="number" min={2} max={50} value={config.advancedIndicators.smcInternalLength} onChange={(e) => setAdvancedIndicatorsNumber("smcInternalLength", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.swingLen")}</span><input className="input" type="number" min={10} max={250} value={config.advancedIndicators.smcSwingLength} onChange={(e) => setAdvancedIndicatorsNumber("smcSwingLength", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.equalLen")}</span><input className="input" type="number" min={1} max={50} value={config.advancedIndicators.smcEqualLength} onChange={(e) => setAdvancedIndicatorsNumber("smcEqualLength", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.equalThreshold")}</span><input className="input" type="number" min={0} max={0.5} step={0.01} value={config.advancedIndicators.smcEqualThreshold} onChange={(e) => setAdvancedIndicatorsNumber("smcEqualThreshold", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">{t("fields.maxOrderBlocks")}</span><input className="input" type="number" min={1} max={50} value={config.advancedIndicators.smcMaxOrderBlocks} onChange={(e) => setAdvancedIndicatorsNumber("smcMaxOrderBlocks", parseNumber(e.target.value))} /></label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck"><input type="checkbox" checked={config.advancedIndicators.smcFvgAutoThreshold} onChange={(e) => setAdvancedIndicatorsSmcFvgAutoThreshold(e.target.checked)} /> {t("fields.fvgAutoThreshold")}</label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.aiGating ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("aiGating")} aria-expanded={openIndicatorSections.aiGating}>
                  <span>{t("sections.aiGating")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.aiGating ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.aiGating ? (
                  <div className="settingsAccordionBody">
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck">
                        <input
                          type="checkbox"
                          checked={config.aiGating.enabled}
                          onChange={(e) => setAiGatingEnabled(e.target.checked)}
                        />
                        {t("fields.enableAiQualityGate")}
                      </label>
                    </div>
                    <div className="indicatorConfigGrid">
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.minConfidenceForExplain")}</span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={config.aiGating.minConfidenceForExplain}
                          onChange={(e) =>
                            setAiGatingNumber("minConfidenceForExplain", parseNumber(e.target.value))
                          }
                        />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.minConfidenceForNeutralExplain")}</span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={config.aiGating.minConfidenceForNeutralExplain}
                          onChange={(e) =>
                            setAiGatingNumber("minConfidenceForNeutralExplain", parseNumber(e.target.value))
                          }
                        />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.confidenceJumpThreshold")}</span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={config.aiGating.confidenceJumpThreshold}
                          onChange={(e) =>
                            setAiGatingNumber("confidenceJumpThreshold", parseNumber(e.target.value))
                          }
                        />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.nearKeyLevel")}</span>
                        <input
                          className="input"
                          type="number"
                          min={0.05}
                          max={5}
                          step={0.01}
                          value={config.aiGating.keyLevelNearPct}
                          onChange={(e) =>
                            setAiGatingNumber("keyLevelNearPct", parseNumber(e.target.value))
                          }
                        />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.highImportanceMin")}</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={5}
                          step={1}
                          value={config.aiGating.highImportanceMin}
                          onChange={(e) =>
                            setAiGatingNumber("highImportanceMin", parseNumber(e.target.value))
                          }
                        />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.maxHighPriorityPerHour")}</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={200}
                          step={1}
                          value={config.aiGating.maxHighPriorityPerHour}
                          onChange={(e) =>
                            setAiGatingNumber("maxHighPriorityPerHour", parseNumber(e.target.value))
                          }
                        />
                      </label>
                    </div>

                    <div className="settingsMutedText indicatorConfigHint" style={{ marginTop: 8 }}>
                      {t("fields.recentEventBars")}
                    </div>
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">5m</span><input className="input" type="number" min={1} max={100} step={1} value={config.aiGating.recentEventBars["5m"]} onChange={(e) => setAiGatingRecentEventBars("5m", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">15m</span><input className="input" type="number" min={1} max={100} step={1} value={config.aiGating.recentEventBars["15m"]} onChange={(e) => setAiGatingRecentEventBars("15m", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">1h</span><input className="input" type="number" min={1} max={100} step={1} value={config.aiGating.recentEventBars["1h"]} onChange={(e) => setAiGatingRecentEventBars("1h", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">4h</span><input className="input" type="number" min={1} max={100} step={1} value={config.aiGating.recentEventBars["4h"]} onChange={(e) => setAiGatingRecentEventBars("4h", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">1d</span><input className="input" type="number" min={1} max={100} step={1} value={config.aiGating.recentEventBars["1d"]} onChange={(e) => setAiGatingRecentEventBars("1d", parseNumber(e.target.value))} /></label>
                    </div>

                    <div className="settingsMutedText indicatorConfigHint" style={{ marginTop: 8 }}>
                      {t("fields.aiCooldownPerTf")}
                    </div>
                    <div className="indicatorConfigGrid">
                      <label className="settingsField"><span className="mutedTiny">5m</span><input className="input" type="number" min={0} max={86400} step={1} value={config.aiGating.aiCooldownSec["5m"]} onChange={(e) => setAiGatingCooldownSec("5m", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">15m</span><input className="input" type="number" min={0} max={86400} step={1} value={config.aiGating.aiCooldownSec["15m"]} onChange={(e) => setAiGatingCooldownSec("15m", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">1h</span><input className="input" type="number" min={0} max={86400} step={1} value={config.aiGating.aiCooldownSec["1h"]} onChange={(e) => setAiGatingCooldownSec("1h", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">4h</span><input className="input" type="number" min={0} max={86400} step={1} value={config.aiGating.aiCooldownSec["4h"]} onChange={(e) => setAiGatingCooldownSec("4h", parseNumber(e.target.value))} /></label>
                      <label className="settingsField"><span className="mutedTiny">1d</span><input className="input" type="number" min={0} max={86400} step={1} value={config.aiGating.aiCooldownSec["1d"]} onChange={(e) => setAiGatingCooldownSec("1d", parseNumber(e.target.value))} /></label>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={`settingsAccordionItem ${openIndicatorSections.liquiditySweeps ? "settingsAccordionItemOpen" : ""}`}>
                <button type="button" className="settingsAccordionTrigger" onClick={() => toggleIndicatorSection("liquiditySweeps")} aria-expanded={openIndicatorSections.liquiditySweeps}>
                  <span>{t("sections.liquiditySweeps")}</span>
                  <span className={`settingsAccordionChevron ${openIndicatorSections.liquiditySweeps ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
                </button>
                {openIndicatorSections.liquiditySweeps ? (
                  <div className="settingsAccordionBody">
                    <div className="settingsMutedText indicatorConfigHint">
                      {t("fields.liquidityPreparedHint")}
                    </div>
                    <div className="indicatorConfigGrid">
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.sweepLen")}</span>
                        <input className="input" type="number" value={config.liquiditySweeps.len} onChange={(e) => setLiquiditySweepsNumber("len", parseNumber(e.target.value))} />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.mode")}</span>
                        <select className="input" value={config.liquiditySweeps.mode} onChange={(e) => setLiquiditySweepsMode(parseLiquiditySweepsMode(e.target.value))}>
                          <option value="wicks">wicks</option>
                          <option value="outbreak_retest">outbreak_retest</option>
                          <option value="both">both</option>
                        </select>
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.maxBars")}</span>
                        <input className="input" type="number" value={config.liquiditySweeps.maxBars} onChange={(e) => setLiquiditySweepsNumber("maxBars", parseNumber(e.target.value))} />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.maxRecentEvents")}</span>
                        <input className="input" type="number" value={config.liquiditySweeps.maxRecentEvents} onChange={(e) => setLiquiditySweepsNumber("maxRecentEvents", parseNumber(e.target.value))} />
                      </label>
                      <label className="settingsField">
                        <span className="mutedTiny">{t("fields.maxActiveZones")}</span>
                        <input className="input" type="number" value={config.liquiditySweeps.maxActiveZones} onChange={(e) => setLiquiditySweepsNumber("maxActiveZones", parseNumber(e.target.value))} />
                      </label>
                    </div>
                    <div className="indicatorInlineChecks">
                      <label className="inlineCheck">
                        <input type="checkbox" checked={config.liquiditySweeps.extend} onChange={(e) => setLiquiditySweepsExtend(e.target.checked)} />
                        {t("fields.extendZones")}
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="indicatorFormActions">
              <button className="btn btnPrimary" type="button" disabled={saving || !canSave} onClick={save}>{saving ? t("saving") : editingId ? t("override.update") : t("override.create")}</button>
              <button className="btn" type="button" onClick={() => void refreshResolvedPreview()}>{t("override.previewResolved")}</button>
              <button className="btn" type="button" onClick={resetForm}>{t("override.resetForm")}</button>
            </div>
          </section>

          <section className="card settingsSection" style={{ marginBottom: 12 }}>
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>{t("overrides.title")}</h3></div>
            {items.length === 0 ? <div className="settingsMutedText">{t("overrides.empty")}</div> : (
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>{t("overrides.scope")}</th>
                      <th>{t("overrides.updated")}</th>
                      <th>{t("overrides.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id}>
                        <td>{buildScopeLabel(row)}</td>
                        <td>{new Date(row.updatedAt).toLocaleString()}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn" type="button" onClick={() => applyRow(row)}>{t("actions.edit")}</button>
                          <button className="btn" type="button" onClick={() => applyRow(row, true)}>{t("actions.clone")}</button>
                          <button className="btn" type="button" onClick={() => void removeRow(row.id)}>{t("actions.delete")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>{t("preview.title")}</h3></div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("preview.hash")}: {resolved?.hash ?? "-"}
            </div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(resolved?.config ?? FALLBACK_DEFAULTS, null, 2)}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
