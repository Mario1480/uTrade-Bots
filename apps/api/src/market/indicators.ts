import { ADX, ATR, BollingerBands, MACD, RSI } from "technicalindicators";
import {
  bucketCandlesWithMeta,
  isIntradayTimeframe,
  type Candle,
  type Timeframe
} from "./timeframe.js";
import {
  computeRollingVWAP,
  computeSessionVWAP
} from "./indicatorsVwap.js";
import {
  computeFVGSummary,
  type FvgFillRule,
  type FvgSummary
} from "./fvg.js";

export type { Candle, Timeframe } from "./timeframe.js";

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

type IndicatorsComputeSettings = {
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
const ADX_PERIOD = 14;
const VWAP_ROLLING_LEN_DAILY = 20;
const rawFvgLookback = Number(process.env.FVG_LOOKBACK_BARS ?? 300);
const FVG_LOOKBACK_BARS = Number.isFinite(rawFvgLookback)
  ? Math.max(50, Math.trunc(rawFvgLookback))
  : 300;
const FVG_FILL_RULE: FvgFillRule =
  String(process.env.FVG_FILL_RULE ?? "overlap").trim().toLowerCase() === "mid_touch"
    ? "mid_touch"
    : "overlap";

function toFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInt(value: unknown, fallback: number, min = 1, max = 5000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeSettings(settings: IndicatorsComputeSettings | undefined) {
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
      fillRule:
        settings?.fvg?.fillRule === "mid_touch"
          ? "mid_touch"
          : FVG_FILL_RULE
    } as { lookback: number; fillRule: FvgFillRule }
  };
}

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return sum / values.length;
}

function std(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = mean(values);
  if (avg === null) return null;
  let sum = 0;
  for (const value of values) {
    const delta = value - avg;
    sum += delta * delta;
  }
  return Math.sqrt(sum / values.length);
}

function smaSeries(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  const out: number[] = [];
  let windowSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    windowSum += values[i];
    if (i >= period) {
      windowSum -= values[i - period];
    }
    if (i >= period - 1) {
      out.push(windowSum / period);
    }
  }
  return out;
}

function emaLatest(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  const seed = mean(values.slice(0, period));
  if (seed === null) return null;
  let ema = seed;
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeStochRsi(
  values: number[],
  params: {
    rsiLen: number;
    stochLen: number;
    smoothK: number;
    smoothD: number;
    requiredBars: number;
  }
): {
  k: number | null;
  d: number | null;
  value: number | null;
} {
  if (values.length < params.requiredBars) {
    return { k: null, d: null, value: null };
  }
  const rsiSeries = RSI.calculate({ values, period: params.rsiLen });
  if (rsiSeries.length < params.stochLen + params.smoothK + params.smoothD) {
    return { k: null, d: null, value: null };
  }

  const rawStoch: number[] = [];
  for (let i = params.stochLen - 1; i < rsiSeries.length; i += 1) {
    const window = rsiSeries.slice(i - params.stochLen + 1, i + 1);
    const low = Math.min(...window);
    const high = Math.max(...window);
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    const denom = high - low;
    if (Math.abs(denom) < 1e-12) {
      rawStoch.push(50);
    } else {
      rawStoch.push(clamp(((rsiSeries[i] - low) / denom) * 100, 0, 100));
    }
  }

  const kSeries = smaSeries(rawStoch, params.smoothK);
  const dSeries = smaSeries(kSeries, params.smoothD);
  const k = kSeries.length > 0 ? kSeries[kSeries.length - 1] : null;
  const d = dSeries.length > 0 ? dSeries[dSeries.length - 1] : null;

  return {
    k,
    d,
    value: k
  };
}

function computeVolumeFeatures(
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

function emptyIndicators(
  mode: "session_utc" | "rolling_20",
  dataGap: boolean,
  settings: ReturnType<typeof normalizeSettings>
): IndicatorsSnapshot {
  return {
    rsi_14: null,
    macd: { line: null, signal: null, hist: null },
    bb: { upper: null, mid: null, lower: null, width_pct: null, pos: null },
    vwap: { value: null, dist_pct: null, mode, sessionStartUtcMs: null },
    adx: { adx_14: null, plus_di_14: null, minus_di_14: null },
    stochrsi: {
      rsi_len: settings.stochrsi.rsiLen,
      stoch_len: settings.stochrsi.stochLen,
      smooth_k: settings.stochrsi.smoothK,
      smooth_d: settings.stochrsi.smoothD,
      k: null,
      d: null,
      value: null
    },
    volume: {
      lookback: settings.volume.lookback,
      vol_z: null,
      rel_vol: null,
      vol_ema_fast: null,
      vol_ema_slow: null,
      vol_trend: null
    },
    fvg: {
      lookback: settings.fvg.lookback,
      fill_rule: settings.fvg.fillRule,
      open_bullish_count: 0,
      open_bearish_count: 0,
      nearest_bullish_gap: { upper: null, lower: null, mid: null, dist_pct: null, age_bars: null },
      nearest_bearish_gap: { upper: null, lower: null, mid: null, dist_pct: null, age_bars: null },
      last_created: { type: null, age_bars: null },
      last_filled: { type: null, age_bars: null }
    },
    atr_pct: null,
    dataGap
  };
}

export function minimumCandlesForIndicators(tf: Timeframe): number {
  return minimumCandlesForIndicatorsWithSettings(tf, undefined);
}

export function minimumCandlesForIndicatorsWithSettings(
  tf: Timeframe,
  settings: IndicatorsComputeSettings | undefined
): number {
  const normalized = normalizeSettings(settings);
  const intradayMinBars = Math.max(
    200,
    normalized.stochrsiRequiredBars,
    normalized.volume.lookback + 20
  );
  return tf === "1d" ? DAILY_MIN_BARS : intradayMinBars;
}

function computeADX14Manual(candles: Candle[]): { adx_14: number | null; plus_di_14: number | null; minus_di_14: number | null } {
  const period = ADX_PERIOD;
  if (candles.length < period * 2) {
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

  if (tr.length < period) {
    return { adx_14: null, plus_di_14: null, minus_di_14: null };
  }

  let smoothTr = tr.slice(0, period).reduce((sum, v) => sum + v, 0);
  let smoothPlusDm = plusDm.slice(0, period).reduce((sum, v) => sum + v, 0);
  let smoothMinusDm = minusDm.slice(0, period).reduce((sum, v) => sum + v, 0);

  const dxSeries: number[] = [];
  let latestPlusDi: number | null = null;
  let latestMinusDi: number | null = null;

  for (let i = period; i < tr.length; i += 1) {
    smoothTr = smoothTr - smoothTr / period + tr[i];
    smoothPlusDm = smoothPlusDm - smoothPlusDm / period + plusDm[i];
    smoothMinusDm = smoothMinusDm - smoothMinusDm / period + minusDm[i];

    const plusDi = smoothTr > 0 ? (100 * smoothPlusDm) / smoothTr : 0;
    const minusDi = smoothTr > 0 ? (100 * smoothMinusDm) / smoothTr : 0;
    latestPlusDi = plusDi;
    latestMinusDi = minusDi;
    const diSum = plusDi + minusDi;
    const dx = diSum > 0 ? (100 * Math.abs(plusDi - minusDi)) / diSum : 0;
    dxSeries.push(dx);
  }

  if (dxSeries.length < period) {
    return {
      adx_14: null,
      plus_di_14: latestPlusDi,
      minus_di_14: latestMinusDi
    };
  }

  let adx = dxSeries.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < dxSeries.length; i += 1) {
    adx = ((adx * (period - 1)) + dxSeries[i]) / period;
  }

  return {
    adx_14: adx,
    plus_di_14: latestPlusDi,
    minus_di_14: latestMinusDi
  };
}

export function computeADX14(
  candles: Candle[]
): { adx_14: number | null; plus_di_14: number | null; minus_di_14: number | null } {
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

export function computeIndicators(
  candles: Candle[],
  tf: Timeframe,
  context: {
    exchange?: string;
    symbol?: string;
    marketType?: "spot" | "perp";
    vwapCacheTtlMs?: number;
    logVwapMetrics?: boolean;
    settings?: IndicatorsComputeSettings;
  } = {}
): IndicatorsSnapshot {
  const settings = normalizeSettings(context.settings);
  const vwapMode: "session_utc" | "rolling_20" = tf === "1d" ? "rolling_20" : "session_utc";
  const bucketedMeta = bucketCandlesWithMeta(candles, tf);
  const bucketedCandles = bucketedMeta.candles;
  if (!settings.enabledV1) {
    return emptyIndicators(vwapMode, true, settings);
  }
  const minBars = minimumCandlesForIndicatorsWithSettings(tf, context.settings);
  if (bucketedCandles.length < minBars) {
    return emptyIndicators(vwapMode, true, settings);
  }

  const closes = bucketedCandles.map((row) => row.close);
  const highs = bucketedCandles.map((row) => row.high);
  const lows = bucketedCandles.map((row) => row.low);
  const latestClose = closes[closes.length - 1] ?? null;

  const rsiSeries = RSI.calculate({ values: closes, period: 14 });
  const latestRsi = toFinite(rsiSeries[rsiSeries.length - 1]);

  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const latestMacd = macdSeries[macdSeries.length - 1] as
    | { MACD?: number; signal?: number; histogram?: number }
    | undefined;

  const bbSeries = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2
  });
  const latestBb = bbSeries[bbSeries.length - 1] as
    | { upper?: number; middle?: number; lower?: number }
    | undefined;

  const atrSeries = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14
  });
  const latestAtr = toFinite(atrSeries[atrSeries.length - 1]);
  const atrPct = latestAtr !== null && latestClose !== null && latestClose > 0
    ? latestAtr / latestClose
    : null;

  const adx = computeADX14(bucketedCandles);
  const stochRsi = settings.enabledV2
    ? computeStochRsi(closes, {
        rsiLen: settings.stochrsi.rsiLen,
        stochLen: settings.stochrsi.stochLen,
        smoothK: settings.stochrsi.smoothK,
        smoothD: settings.stochrsi.smoothD,
        requiredBars: settings.stochrsiRequiredBars
      })
    : { k: null, d: null, value: null };
  const volumeFeatures = settings.enabledV2
    ? computeVolumeFeatures(bucketedCandles, {
        lookback: settings.volume.lookback,
        emaFast: settings.volume.emaFast,
        emaSlow: settings.volume.emaSlow
      })
    : { vol_z: null, rel_vol: null, vol_ema_fast: null, vol_ema_slow: null, vol_trend: null };
  const fvg = settings.enabledV2
    ? computeFVGSummary(bucketedCandles, {
        lookbackBars: settings.fvg.lookback,
        fillRule: settings.fvg.fillRule
      })
    : computeFVGSummary([], {
        lookbackBars: settings.fvg.lookback,
        fillRule: settings.fvg.fillRule
      });

  let vwapValue: number | null = null;
  let vwapDistPct: number | null = null;
  let vwapSessionStartUtcMs: number | null = null;
  let vwapDataGap = false;

  if (isIntradayTimeframe(tf)) {
    const vwap = computeSessionVWAP(bucketedCandles, tf, {
      exchange: context.exchange,
      symbol: context.symbol,
      marketType: context.marketType,
      cacheTtlMs: context.vwapCacheTtlMs,
      logMetrics: context.logVwapMetrics
    });
    vwapValue = vwap.value;
    vwapDistPct = vwap.dist_pct;
    vwapSessionStartUtcMs = vwap.sessionStartUtcMs;
    vwapDataGap = vwap.dataGap;
  } else {
    vwapValue = computeRollingVWAP(bucketedCandles, VWAP_ROLLING_LEN_DAILY);
    vwapDistPct = vwapValue !== null && latestClose !== null && vwapValue > 0
      ? ((latestClose / vwapValue) - 1) * 100
      : null;
  }

  const bbUpper = toFinite(latestBb?.upper);
  const bbMid = toFinite(latestBb?.middle);
  const bbLower = toFinite(latestBb?.lower);
  const bbWidthPct = bbUpper !== null && bbLower !== null && bbMid !== null && bbMid !== 0
    ? ((bbUpper - bbLower) / bbMid) * 100
    : null;
  const bbPosRaw = bbUpper !== null && bbLower !== null && latestClose !== null && bbUpper !== bbLower
    ? (latestClose - bbLower) / (bbUpper - bbLower)
    : null;
  const bbPos = bbPosRaw !== null ? clamp(bbPosRaw, 0, 1) : null;

  const result: IndicatorsSnapshot = {
    rsi_14: round(latestRsi, 4),
    macd: {
      line: round(toFinite(latestMacd?.MACD), 6),
      signal: round(toFinite(latestMacd?.signal), 6),
      hist: round(toFinite(latestMacd?.histogram), 6)
    },
    bb: {
      upper: round(bbUpper, 6),
      mid: round(bbMid, 6),
      lower: round(bbLower, 6),
      width_pct: round(bbWidthPct, 6),
      pos: round(bbPos, 6)
    },
    vwap: {
      value: round(vwapValue, 6),
      dist_pct: round(vwapDistPct, 6),
      mode: vwapMode,
      sessionStartUtcMs: vwapSessionStartUtcMs
    },
    adx: {
      adx_14: round(toFinite(adx.adx_14), 4),
      plus_di_14: round(toFinite(adx.plus_di_14), 4),
      minus_di_14: round(toFinite(adx.minus_di_14), 4)
    },
    stochrsi: {
      rsi_len: settings.stochrsi.rsiLen,
      stoch_len: settings.stochrsi.stochLen,
      smooth_k: settings.stochrsi.smoothK,
      smooth_d: settings.stochrsi.smoothD,
      k: round(toFinite(stochRsi.k), 4),
      d: round(toFinite(stochRsi.d), 4),
      value: round(toFinite(stochRsi.value), 4)
    },
    volume: {
      lookback: settings.volume.lookback,
      vol_z: round(toFinite(volumeFeatures.vol_z), 6),
      rel_vol: round(toFinite(volumeFeatures.rel_vol), 6),
      vol_ema_fast: round(toFinite(volumeFeatures.vol_ema_fast), 6),
      vol_ema_slow: round(toFinite(volumeFeatures.vol_ema_slow), 6),
      vol_trend: round(toFinite(volumeFeatures.vol_trend), 6)
    },
    fvg,
    atr_pct: round(atrPct, 6),
    dataGap: bucketedMeta.candleBucketed || vwapDataGap
  };

  const hasInvalid = [
    result.rsi_14,
    result.macd.line,
    result.macd.signal,
    result.macd.hist,
    result.bb.upper,
    result.bb.mid,
    result.bb.lower,
    result.bb.width_pct,
    result.bb.pos,
    result.adx.adx_14,
    result.stochrsi.k,
    result.stochrsi.d,
    result.volume.rel_vol,
    result.volume.vol_z,
    result.volume.vol_ema_fast,
    result.volume.vol_ema_slow,
    result.volume.vol_trend,
    result.atr_pct
  ].some((value) => value === null);

  if (hasInvalid) {
    return {
      ...result,
      dataGap: true
    };
  }

  return result;
}
