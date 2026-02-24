import {
  bucketCandlesWithMeta,
  isIntradayTimeframe
} from "./timeframe.js";
import {
  computeRollingVWAP,
  computeSessionVWAP
} from "./indicatorsVwap.js";
import { computeFVGSummary } from "./fvg.js";
import { computeADX14 } from "./indicators/adx.js";
import { computeAtrPct } from "./indicators/atr.js";
import { computeBollinger } from "./indicators/bollinger.js";
import { computeMacd } from "./indicators/macd.js";
import { computeRsi14 } from "./indicators/rsi.js";
import {
  minimumCandlesForIndicators,
  minimumCandlesForIndicatorsWithSettings,
  normalizeIndicatorSettings,
  type NormalizedIndicatorSettings
} from "./indicators/settings.js";
import { round, toFinite } from "./indicators/shared.js";
import { computeStochRsi } from "./indicators/stochrsi.js";
import {
  computeVuManChuCipher,
  emptyVuManChuSnapshot
} from "./indicators/vumanchuCipher.js";
import { computeVolumeFeatures } from "./indicators/volume.js";
import type {
  Candle,
  Timeframe,
  IndicatorsComputeSettings,
  IndicatorsSnapshot
} from "./indicators/types.js";
import type {
  BreakerBlocksSnapshot,
  SuperOrderBlockFvgBosSnapshot
} from "@mm/futures-core";
import {
  computeBreakerBlocksSnapshot,
  computeSuperOrderBlockFvgBosSnapshot
} from "@mm/futures-core";

export type {
  Candle,
  Timeframe,
  IndicatorsComputeSettings,
  IndicatorsSnapshot
} from "./indicators/types.js";

export {
  computeADX14,
  minimumCandlesForIndicators,
  minimumCandlesForIndicatorsWithSettings
};

const VWAP_ROLLING_LEN_DAILY = 20;

function emptyBreakerBlocksSnapshot(
  dataGap: boolean,
  settings: NormalizedIndicatorSettings
): BreakerBlocksSnapshot {
  const snapshot = computeBreakerBlocksSnapshot([], settings.breakerBlocks);
  return {
    ...snapshot,
    dataGap
  };
}

function emptySuperOrderBlockFvgBosSnapshot(
  dataGap: boolean,
  settings: NormalizedIndicatorSettings
): SuperOrderBlockFvgBosSnapshot {
  const snapshot = computeSuperOrderBlockFvgBosSnapshot([], settings.superOrderBlockFvgBos);
  return {
    ...snapshot,
    dataGap
  };
}

function emptyIndicators(
  mode: "session_utc" | "rolling_20",
  dataGap: boolean,
  settings: NormalizedIndicatorSettings
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
    vumanchu: emptyVuManChuSnapshot(settings.vumanchu, dataGap),
    breakerBlocks: emptyBreakerBlocksSnapshot(dataGap, settings),
    superOrderBlockFvgBos: emptySuperOrderBlockFvgBosSnapshot(dataGap, settings),
    atr_pct: null,
    dataGap
  };
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
  const settings = normalizeIndicatorSettings(context.settings);
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

  const rsi = computeRsi14(closes);
  const macd = computeMacd(closes);
  const bb = computeBollinger(closes, latestClose);
  const atrPct = computeAtrPct(highs, lows, closes, latestClose);
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
  const vumanchu = settings.enabledV2
    ? computeVuManChuCipher(bucketedCandles, settings.vumanchu)
    : emptyVuManChuSnapshot(settings.vumanchu, false);
  const breakerBlocks = settings.enabledV2
    ? computeBreakerBlocksSnapshot(bucketedCandles, settings.breakerBlocks)
    : emptyBreakerBlocksSnapshot(false, settings);
  const superOrderBlockFvgBos = settings.enabledV2
    ? computeSuperOrderBlockFvgBosSnapshot(bucketedCandles, settings.superOrderBlockFvgBos)
    : emptySuperOrderBlockFvgBosSnapshot(false, settings);

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

  const result: IndicatorsSnapshot = {
    rsi_14: round(rsi, 4),
    macd: {
      line: round(toFinite(macd.line), 6),
      signal: round(toFinite(macd.signal), 6),
      hist: round(toFinite(macd.hist), 6)
    },
    bb: {
      upper: round(toFinite(bb.upper), 6),
      mid: round(toFinite(bb.mid), 6),
      lower: round(toFinite(bb.lower), 6),
      width_pct: round(toFinite(bb.width_pct), 6),
      pos: round(toFinite(bb.pos), 6)
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
    vumanchu,
    breakerBlocks,
    superOrderBlockFvgBos,
    atr_pct: round(atrPct, 6),
    dataGap:
      bucketedMeta.candleBucketed
      || vwapDataGap
      || vumanchu.dataGap
      || breakerBlocks.dataGap
      || superOrderBlockFvgBos.dataGap
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
    result.vumanchu.waveTrend.wt1,
    result.vumanchu.waveTrend.wt2,
    result.vumanchu.waveTrend.wtVwap,
    result.vumanchu.rsiMfi.value,
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
