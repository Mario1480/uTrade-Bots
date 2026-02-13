import type { FvgFillRule } from "../fvg.js";
import type { Timeframe, IndicatorsComputeSettings } from "./types.js";

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

  return {
    enabledV1: enabledPacks.indicatorsV1 ?? true,
    enabledV2: enabledPacks.indicatorsV2 ?? DEFAULT_V2_ENABLED,
    stochrsi,
    stochrsiRequiredBars,
    volume: volumeCfg,
    fvg: {
      lookback: toPositiveInt(settings?.fvg?.lookback, FVG_LOOKBACK_BARS, 20, 5000),
      fillRule: settings?.fvg?.fillRule === "mid_touch" ? "mid_touch" : FVG_FILL_RULE
    }
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
    normalized.volume.lookback + 20
  );
  return tf === "1d" ? DAILY_MIN_BARS : intradayMinBars;
}
