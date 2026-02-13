import type { FvgFillRule, FvgSummary } from "../fvg.js";

export type { Candle, Timeframe } from "../timeframe.js";

type NullableNumber = number | null;

export type IndicatorsSnapshot = {
  rsi_14: NullableNumber;
  macd: {
    line: NullableNumber;
    signal: NullableNumber;
    hist: NullableNumber;
  };
  bb: {
    upper: NullableNumber;
    mid: NullableNumber;
    lower: NullableNumber;
    width_pct: NullableNumber;
    pos: NullableNumber;
  };
  vwap: {
    value: NullableNumber;
    dist_pct: NullableNumber;
    mode: "session_utc" | "rolling_20";
    sessionStartUtcMs: NullableNumber;
  };
  adx: {
    adx_14: NullableNumber;
    plus_di_14: NullableNumber;
    minus_di_14: NullableNumber;
  };
  stochrsi: {
    rsi_len: number;
    stoch_len: number;
    smooth_k: number;
    smooth_d: number;
    k: NullableNumber;
    d: NullableNumber;
    value: NullableNumber;
  };
  volume: {
    lookback: number;
    vol_z: NullableNumber;
    rel_vol: NullableNumber;
    vol_ema_fast: NullableNumber;
    vol_ema_slow: NullableNumber;
    vol_trend: NullableNumber;
  };
  fvg: FvgSummary;
  atr_pct: NullableNumber;
  dataGap: boolean;
};

export type IndicatorsComputeSettings = {
  enabledPacks?: {
    indicatorsV1?: boolean;
    indicatorsV2?: boolean;
  };
  stochrsi?: {
    rsiLen?: number;
    stochLen?: number;
    smoothK?: number;
    smoothD?: number;
  };
  volume?: {
    lookback?: number;
    emaFast?: number;
    emaSlow?: number;
  };
  fvg?: {
    lookback?: number;
    fillRule?: FvgFillRule;
  };
};
