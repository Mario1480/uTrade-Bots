import type { FvgFillRule, FvgSummary } from "../fvg.js";

export type { Candle, Timeframe } from "../timeframe.js";

type NullableNumber = number | null;

export type VumanchuSnapshot = {
  waveTrend: {
    wt1: NullableNumber;
    wt2: NullableNumber;
    wtVwap: NullableNumber;
    cross: boolean;
    crossUp: boolean;
    crossDown: boolean;
    oversold: boolean;
    overbought: boolean;
  };
  rsiMfi: {
    value: NullableNumber;
    period: number;
    multiplier: number;
    yPos: number;
  };
  divergences: {
    wt: {
      bullish: boolean;
      bearish: boolean;
      bullishHidden: boolean;
      bearishHidden: boolean;
      bullishAdd: boolean;
      bearishAdd: boolean;
      lastBullishAgeBars: NullableNumber;
      lastBearishAgeBars: NullableNumber;
    };
    rsi: {
      bullish: boolean;
      bearish: boolean;
      bullishHidden: boolean;
      bearishHidden: boolean;
      lastBullishAgeBars: NullableNumber;
      lastBearishAgeBars: NullableNumber;
    };
    stoch: {
      bullish: boolean;
      bearish: boolean;
      bullishHidden: boolean;
      bearishHidden: boolean;
      lastBullishAgeBars: NullableNumber;
      lastBearishAgeBars: NullableNumber;
    };
  };
  signals: {
    buy: boolean;
    sell: boolean;
    buyDiv: boolean;
    sellDiv: boolean;
    goldNoBuyLong: boolean;
    ages: {
      buy: NullableNumber;
      sell: NullableNumber;
      buyDiv: NullableNumber;
      sellDiv: NullableNumber;
      goldNoBuyLong: NullableNumber;
    };
  };
  levels: {
    obLevel: number;
    osLevel: number;
    osLevel3: number;
    wtDivObLevel: number;
    wtDivOsLevel: number;
    wtDivObLevelAdd: number;
    wtDivOsLevelAdd: number;
  };
  dataGap: boolean;
};

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
  vumanchu: VumanchuSnapshot;
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
  vumanchu?: {
    wtChannelLen?: number;
    wtAverageLen?: number;
    wtMaLen?: number;
    obLevel?: number;
    osLevel?: number;
    osLevel3?: number;
    wtDivObLevel?: number;
    wtDivOsLevel?: number;
    wtDivObLevelAdd?: number;
    wtDivOsLevelAdd?: number;
    rsiLen?: number;
    rsiMfiPeriod?: number;
    rsiMfiMultiplier?: number;
    rsiMfiPosY?: number;
    stochLen?: number;
    stochRsiLen?: number;
    stochKSmooth?: number;
    stochDSmooth?: number;
    useHiddenDiv?: boolean;
    useHiddenDivNoLimits?: boolean;
    goldRsiThreshold?: number;
    goldWtDiffMin?: number;
  };
};
