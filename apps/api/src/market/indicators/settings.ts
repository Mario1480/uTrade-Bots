import type { FvgFillRule } from "../fvg.js";
import type { Timeframe, IndicatorsComputeSettings } from "./types.js";
import {
  normalizeBreakerBlocksSettings,
  normalizeSuperOrderBlockFvgBosSettings,
  superOrderBlockFvgBosRequiredBars as computeSuperOrderBlockFvgBosRequiredBars,
  type BreakerBlocksSettings,
  type SuperOrderBlockFvgBosSettings
} from "@mm/futures-core";

const DEFAULT_STOCHRSI = {
  rsiLen: 14,
  stochLen: 14,
  smoothK: 3,
  smoothD: 3
};
const DEFAULT_VOLUME = {
  lookback: 100,
  emaFast: 10,
  emaSlow: 30
};
const DEFAULT_VUMANCHU = {
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
};
const DEFAULT_V2_ENABLED = true;
const DAILY_MIN_BARS = 220;
const rawFvgLookback = Number(process.env.FVG_LOOKBACK_BARS ?? 300);
const FVG_LOOKBACK_BARS = Number.isFinite(rawFvgLookback)
  ? Math.max(50, Math.trunc(rawFvgLookback))
  : 300;
const FVG_FILL_RULE: FvgFillRule =
  String(process.env.FVG_FILL_RULE ?? "overlap").trim().toLowerCase() === "mid_touch"
    ? "mid_touch"
    : "overlap";

export type NormalizedIndicatorSettings = {
  enabledV1: boolean;
  enabledV2: boolean;
  stochrsi: {
    rsiLen: number;
    stochLen: number;
    smoothK: number;
    smoothD: number;
  };
  stochrsiRequiredBars: number;
  volume: {
    lookback: number;
    emaFast: number;
    emaSlow: number;
  };
  fvg: {
    lookback: number;
    fillRule: FvgFillRule;
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
  vumanchuRequiredBars: number;
  breakerBlocks: BreakerBlocksSettings;
  breakerBlocksRequiredBars: number;
  superOrderBlockFvgBos: SuperOrderBlockFvgBosSettings;
  superOrderBlockFvgBosRequiredBars: number;
};

function toPositiveInt(value: unknown, fallback: number, min = 1, max = 5000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function normalizeIndicatorSettings(
  settings: IndicatorsComputeSettings | undefined
): NormalizedIndicatorSettings {
  const stoch = settings?.stochrsi ?? {};
  const volume = settings?.volume ?? {};
  const vumanchu = settings?.vumanchu ?? {};
  const enabledPacks = settings?.enabledPacks ?? {};

  const stochrsi = {
    rsiLen: toPositiveInt(stoch.rsiLen, DEFAULT_STOCHRSI.rsiLen, 2, 200),
    stochLen: toPositiveInt(stoch.stochLen, DEFAULT_STOCHRSI.stochLen, 2, 200),
    smoothK: toPositiveInt(stoch.smoothK, DEFAULT_STOCHRSI.smoothK, 1, 50),
    smoothD: toPositiveInt(stoch.smoothD, DEFAULT_STOCHRSI.smoothD, 1, 50)
  };

  const volumeCfg = {
    lookback: toPositiveInt(volume.lookback, DEFAULT_VOLUME.lookback, 10, 2000),
    emaFast: toPositiveInt(volume.emaFast, DEFAULT_VOLUME.emaFast, 2, 200),
    emaSlow: toPositiveInt(volume.emaSlow, DEFAULT_VOLUME.emaSlow, 2, 400)
  };
  if (volumeCfg.emaFast >= volumeCfg.emaSlow) {
    volumeCfg.emaFast = Math.max(2, volumeCfg.emaSlow - 1);
  }

  const stochrsiRequiredBars =
    stochrsi.rsiLen + stochrsi.stochLen + stochrsi.smoothK + stochrsi.smoothD + 50;
  const vumanchuCfg = {
    wtChannelLen: toPositiveInt(vumanchu.wtChannelLen, DEFAULT_VUMANCHU.wtChannelLen, 2, 100),
    wtAverageLen: toPositiveInt(vumanchu.wtAverageLen, DEFAULT_VUMANCHU.wtAverageLen, 2, 200),
    wtMaLen: toPositiveInt(vumanchu.wtMaLen, DEFAULT_VUMANCHU.wtMaLen, 1, 50),
    obLevel: toPositiveInt(vumanchu.obLevel, DEFAULT_VUMANCHU.obLevel, 1, 150),
    osLevel: -toPositiveInt(Math.abs(Number(vumanchu.osLevel ?? DEFAULT_VUMANCHU.osLevel)), Math.abs(DEFAULT_VUMANCHU.osLevel), 1, 150),
    osLevel3: -toPositiveInt(Math.abs(Number(vumanchu.osLevel3 ?? DEFAULT_VUMANCHU.osLevel3)), Math.abs(DEFAULT_VUMANCHU.osLevel3), 1, 200),
    wtDivObLevel: toPositiveInt(vumanchu.wtDivObLevel, DEFAULT_VUMANCHU.wtDivObLevel, 1, 150),
    wtDivOsLevel: -toPositiveInt(Math.abs(Number(vumanchu.wtDivOsLevel ?? DEFAULT_VUMANCHU.wtDivOsLevel)), Math.abs(DEFAULT_VUMANCHU.wtDivOsLevel), 1, 200),
    wtDivObLevelAdd: toPositiveInt(vumanchu.wtDivObLevelAdd, DEFAULT_VUMANCHU.wtDivObLevelAdd, 1, 150),
    wtDivOsLevelAdd: -toPositiveInt(Math.abs(Number(vumanchu.wtDivOsLevelAdd ?? DEFAULT_VUMANCHU.wtDivOsLevelAdd)), Math.abs(DEFAULT_VUMANCHU.wtDivOsLevelAdd), 1, 200),
    rsiLen: toPositiveInt(vumanchu.rsiLen, DEFAULT_VUMANCHU.rsiLen, 2, 200),
    rsiMfiPeriod: toPositiveInt(vumanchu.rsiMfiPeriod, DEFAULT_VUMANCHU.rsiMfiPeriod, 2, 500),
    rsiMfiMultiplier: Math.max(1, Math.min(500, Number(vumanchu.rsiMfiMultiplier ?? DEFAULT_VUMANCHU.rsiMfiMultiplier))),
    rsiMfiPosY: Math.max(-20, Math.min(20, Number(vumanchu.rsiMfiPosY ?? DEFAULT_VUMANCHU.rsiMfiPosY))),
    stochLen: toPositiveInt(vumanchu.stochLen, DEFAULT_VUMANCHU.stochLen, 2, 200),
    stochRsiLen: toPositiveInt(vumanchu.stochRsiLen, DEFAULT_VUMANCHU.stochRsiLen, 2, 200),
    stochKSmooth: toPositiveInt(vumanchu.stochKSmooth, DEFAULT_VUMANCHU.stochKSmooth, 1, 50),
    stochDSmooth: toPositiveInt(vumanchu.stochDSmooth, DEFAULT_VUMANCHU.stochDSmooth, 1, 50),
    useHiddenDiv: vumanchu.useHiddenDiv === true,
    useHiddenDivNoLimits: vumanchu.useHiddenDivNoLimits !== false,
    goldRsiThreshold: toPositiveInt(vumanchu.goldRsiThreshold, DEFAULT_VUMANCHU.goldRsiThreshold, 1, 100),
    goldWtDiffMin: Math.max(1, Math.min(30, Number(vumanchu.goldWtDiffMin ?? DEFAULT_VUMANCHU.goldWtDiffMin)))
  };
  const vumanchuRequiredBars = Math.max(
    vumanchuCfg.wtChannelLen + vumanchuCfg.wtAverageLen + vumanchuCfg.wtMaLen + 20,
    vumanchuCfg.rsiMfiPeriod + 10,
    vumanchuCfg.rsiLen + 20,
    vumanchuCfg.stochRsiLen + vumanchuCfg.stochLen + vumanchuCfg.stochKSmooth + vumanchuCfg.stochDSmooth + 10
  );
  const breakerBlocks = normalizeBreakerBlocksSettings(settings?.breakerBlocks);
  const breakerBlocksRequiredBars = Math.max(80, breakerBlocks.len * 8);
  const superOrderBlockFvgBos = normalizeSuperOrderBlockFvgBosSettings(
    settings?.superOrderBlockFvgBos
  );
  const superOrderBlockFvgBosRequiredBars = computeSuperOrderBlockFvgBosRequiredBars(
    superOrderBlockFvgBos
  );

  return {
    enabledV1: enabledPacks.indicatorsV1 ?? true,
    enabledV2: enabledPacks.indicatorsV2 ?? DEFAULT_V2_ENABLED,
    stochrsi,
    stochrsiRequiredBars,
    volume: volumeCfg,
    fvg: {
      lookback: toPositiveInt(settings?.fvg?.lookback, FVG_LOOKBACK_BARS, 20, 5000),
      fillRule: settings?.fvg?.fillRule === "mid_touch" ? "mid_touch" : FVG_FILL_RULE
    },
    vumanchu: vumanchuCfg,
    vumanchuRequiredBars,
    breakerBlocks,
    breakerBlocksRequiredBars,
    superOrderBlockFvgBos,
    superOrderBlockFvgBosRequiredBars
  };
}

export function minimumCandlesForIndicators(tf: Timeframe): number {
  return minimumCandlesForIndicatorsWithSettings(tf, undefined);
}

export function minimumCandlesForIndicatorsWithSettings(
  tf: Timeframe,
  settings: IndicatorsComputeSettings | undefined
): number {
  const normalized = normalizeIndicatorSettings(settings);
  const intradayMinBars = Math.max(
    200,
    normalized.stochrsiRequiredBars,
    normalized.volume.lookback + 20,
    normalized.vumanchuRequiredBars,
    normalized.breakerBlocksRequiredBars,
    normalized.superOrderBlockFvgBosRequiredBars
  );
  return tf === "1d"
    ? Math.max(
        DAILY_MIN_BARS,
        normalized.vumanchuRequiredBars,
        normalized.breakerBlocksRequiredBars,
        normalized.superOrderBlockFvgBosRequiredBars
      )
    : intradayMinBars;
}
