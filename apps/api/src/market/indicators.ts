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
  atr_pct: NullableNumber;
  dataGap: boolean;
};

const INTRADAY_MIN_BARS = 300;
const DAILY_MIN_BARS = 220;
const ADX_PERIOD = 14;
const VWAP_ROLLING_LEN_DAILY = 20;

function toFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyIndicators(mode: "session_utc" | "rolling_20", dataGap: boolean): IndicatorsSnapshot {
  return {
    rsi_14: null,
    macd: { line: null, signal: null, hist: null },
    bb: { upper: null, mid: null, lower: null, width_pct: null, pos: null },
    vwap: { value: null, dist_pct: null, mode, sessionStartUtcMs: null },
    adx: { adx_14: null, plus_di_14: null, minus_di_14: null },
    atr_pct: null,
    dataGap
  };
}

export function minimumCandlesForIndicators(tf: Timeframe): number {
  return tf === "1d" ? DAILY_MIN_BARS : INTRADAY_MIN_BARS;
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
  } = {}
): IndicatorsSnapshot {
  const vwapMode: "session_utc" | "rolling_20" = tf === "1d" ? "rolling_20" : "session_utc";
  const bucketedMeta = bucketCandlesWithMeta(candles, tf);
  const bucketedCandles = bucketedMeta.candles;
  const minBars = minimumCandlesForIndicators(tf);
  if (bucketedCandles.length < minBars) {
    return emptyIndicators(vwapMode, true);
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
