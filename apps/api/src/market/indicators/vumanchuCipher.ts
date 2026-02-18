import { RSI } from "technicalindicators";
import type { Candle } from "../timeframe.js";
import type { NormalizedIndicatorSettings } from "./settings.js";
import { round, smaSeries } from "./shared.js";
import type { VumanchuSnapshot } from "./types.js";

type VumanchuConfig = NormalizedIndicatorSettings["vumanchu"];

type Pivot = {
  index: number;
  oscillator: number;
  price: number;
};

type DivergenceResult = {
  bullishNow: boolean;
  bearishNow: boolean;
  bullishHiddenNow: boolean;
  bearishHiddenNow: boolean;
  lastBullishAgeBars: number | null;
  lastBearishAgeBars: number | null;
  currentBottomPrevOscillator: number | null;
  currentBottomPrevIndex: number | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePriceDiv(open: number, high: number, low: number, close: number): number {
  const range = high - low;
  if (!isFiniteNumber(range) || Math.abs(range) < 1e-12) return 0;
  const value = ((close - open) / range);
  return Number.isFinite(value) ? value : 0;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values[0];
  out.push(ema);
  for (let i = 1; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function alignTail(values: number[], totalLength: number): Array<number | null> {
  const out = new Array<number | null>(totalLength).fill(null);
  const offset = totalLength - values.length;
  if (offset < 0) return out;
  for (let i = 0; i < values.length; i += 1) {
    out[i + offset] = values[i];
  }
  return out;
}

function smaNullable(values: Array<number | null>, period: number): Array<number | null> {
  const out = new Array<number | null>(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      const value = values[j];
      if (!isFiniteNumber(value)) {
        ok = false;
        break;
      }
      sum += value;
    }
    if (!ok) continue;
    out[i] = sum / period;
  }
  return out;
}

function computeRsiSeries(closes: number[], period: number): Array<number | null> {
  const rsi = RSI.calculate({ values: closes, period });
  return alignTail(rsi, closes.length);
}

function computeStochKSeries(
  closes: number[],
  rsiLen: number,
  stochLen: number,
  smoothK: number,
  smoothD: number
): { k: Array<number | null>; d: Array<number | null> } {
  const rsiSeries = computeRsiSeries(closes, rsiLen);
  const raw = new Array<number | null>(closes.length).fill(null);

  for (let i = 0; i < rsiSeries.length; i += 1) {
    if (i < stochLen - 1) continue;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let current: number | null = null;
    let valid = true;
    for (let j = i - stochLen + 1; j <= i; j += 1) {
      const value = rsiSeries[j];
      if (!isFiniteNumber(value)) {
        valid = false;
        break;
      }
      if (value < low) low = value;
      if (value > high) high = value;
      if (j === i) current = value;
    }
    if (!valid || !isFiniteNumber(current)) continue;
    const denom = high - low;
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) {
      raw[i] = 50;
      continue;
    }
    raw[i] = clamp(((current - low) / denom) * 100, 0, 100);
  }

  const k = smaNullable(raw, smoothK);
  const d = smaNullable(k, smoothD);
  return { k, d };
}

function fractalTop(src: Array<number | null>, center: number): boolean {
  if (center < 2 || center + 2 >= src.length) return false;
  const a = src[center - 2];
  const b = src[center - 1];
  const c = src[center];
  const d = src[center + 1];
  const e = src[center + 2];
  if (!isFiniteNumber(a) || !isFiniteNumber(b) || !isFiniteNumber(c) || !isFiniteNumber(d) || !isFiniteNumber(e)) {
    return false;
  }
  return a < c && b < c && c > d && c > e;
}

function fractalBottom(src: Array<number | null>, center: number): boolean {
  if (center < 2 || center + 2 >= src.length) return false;
  const a = src[center - 2];
  const b = src[center - 1];
  const c = src[center];
  const d = src[center + 1];
  const e = src[center + 2];
  if (!isFiniteNumber(a) || !isFiniteNumber(b) || !isFiniteNumber(c) || !isFiniteNumber(d) || !isFiniteNumber(e)) {
    return false;
  }
  return a > c && b > c && c < d && c < e;
}

function findDivergences(
  src: Array<number | null>,
  highs: number[],
  lows: number[],
  topLimit: number,
  bottomLimit: number,
  useLimits: boolean
): DivergenceResult {
  const lastIndex = src.length - 1;
  const confirmedCenter = lastIndex - 2;

  let lastTopPivot: Pivot | null = null;
  let lastBottomPivot: Pivot | null = null;

  let bullishNow = false;
  let bearishNow = false;
  let bullishHiddenNow = false;
  let bearishHiddenNow = false;
  let lastBullishCenter: number | null = null;
  let lastBearishCenter: number | null = null;
  let currentBottomPrevOscillator: number | null = null;
  let currentBottomPrevIndex: number | null = null;

  for (let center = 2; center <= src.length - 3; center += 1) {
    const oscillator = src[center];
    if (!isFiniteNumber(oscillator)) continue;

    const top = fractalTop(src, center);
    const bottom = fractalBottom(src, center);

    if (top && (!useLimits || oscillator >= topLimit)) {
      if (lastTopPivot) {
        const bearish = highs[center] > lastTopPivot.price && oscillator < lastTopPivot.oscillator;
        const bearishHidden = highs[center] < lastTopPivot.price && oscillator > lastTopPivot.oscillator;
        if (bearish) {
          lastBearishCenter = center;
          if (center === confirmedCenter) bearishNow = true;
        }
        if (bearishHidden) {
          if (center === confirmedCenter) bearishHiddenNow = true;
        }
      }
      lastTopPivot = {
        index: center,
        oscillator,
        price: highs[center]
      };
    }

    if (bottom && (!useLimits || oscillator <= bottomLimit)) {
      if (lastBottomPivot) {
        const bullish = lows[center] < lastBottomPivot.price && oscillator > lastBottomPivot.oscillator;
        const bullishHidden = lows[center] > lastBottomPivot.price && oscillator < lastBottomPivot.oscillator;
        if (bullish) {
          lastBullishCenter = center;
          if (center === confirmedCenter) bullishNow = true;
        }
        if (bullishHidden) {
          if (center === confirmedCenter) bullishHiddenNow = true;
        }
        if (center === confirmedCenter) {
          currentBottomPrevOscillator = lastBottomPivot.oscillator;
          currentBottomPrevIndex = lastBottomPivot.index;
        }
      }
      lastBottomPivot = {
        index: center,
        oscillator,
        price: lows[center]
      };
    }
  }

  return {
    bullishNow,
    bearishNow,
    bullishHiddenNow,
    bearishHiddenNow,
    lastBullishAgeBars: lastBullishCenter === null ? null : Math.max(0, lastIndex - lastBullishCenter),
    lastBearishAgeBars: lastBearishCenter === null ? null : Math.max(0, lastIndex - lastBearishCenter),
    currentBottomPrevOscillator,
    currentBottomPrevIndex
  };
}

function crossInfo(a: Array<number | null>, b: Array<number | null>, index: number): {
  cross: boolean;
  crossUp: boolean;
  crossDown: boolean;
} {
  if (index <= 0) return { cross: false, crossUp: false, crossDown: false };
  const aCurr = a[index];
  const bCurr = b[index];
  const aPrev = a[index - 1];
  const bPrev = b[index - 1];
  if (!isFiniteNumber(aCurr) || !isFiniteNumber(bCurr) || !isFiniteNumber(aPrev) || !isFiniteNumber(bPrev)) {
    return { cross: false, crossUp: false, crossDown: false };
  }
  const prevDiff = aPrev - bPrev;
  const currDiff = aCurr - bCurr;
  const cross = (prevDiff <= 0 && currDiff > 0) || (prevDiff >= 0 && currDiff < 0);
  return {
    cross,
    crossUp: (bCurr - aCurr) <= 0,
    crossDown: (bCurr - aCurr) >= 0
  };
}

function latestAge(flagSeries: boolean[]): number | null {
  for (let i = flagSeries.length - 1; i >= 0; i -= 1) {
    if (flagSeries[i]) {
      return flagSeries.length - 1 - i;
    }
  }
  return null;
}

function finiteOrNull(value: number | null): number | null {
  return isFiniteNumber(value) ? value : null;
}

export function emptyVuManChuSnapshot(
  config: VumanchuConfig,
  dataGap: boolean
): VumanchuSnapshot {
  return {
    waveTrend: {
      wt1: null,
      wt2: null,
      wtVwap: null,
      cross: false,
      crossUp: false,
      crossDown: false,
      oversold: false,
      overbought: false
    },
    rsiMfi: {
      value: null,
      period: config.rsiMfiPeriod,
      multiplier: config.rsiMfiMultiplier,
      yPos: config.rsiMfiPosY
    },
    divergences: {
      wt: {
        bullish: false,
        bearish: false,
        bullishHidden: false,
        bearishHidden: false,
        bullishAdd: false,
        bearishAdd: false,
        lastBullishAgeBars: null,
        lastBearishAgeBars: null
      },
      rsi: {
        bullish: false,
        bearish: false,
        bullishHidden: false,
        bearishHidden: false,
        lastBullishAgeBars: null,
        lastBearishAgeBars: null
      },
      stoch: {
        bullish: false,
        bearish: false,
        bullishHidden: false,
        bearishHidden: false,
        lastBullishAgeBars: null,
        lastBearishAgeBars: null
      }
    },
    signals: {
      buy: false,
      sell: false,
      buyDiv: false,
      sellDiv: false,
      goldNoBuyLong: false,
      ages: {
        buy: null,
        sell: null,
        buyDiv: null,
        sellDiv: null,
        goldNoBuyLong: null
      }
    },
    levels: {
      obLevel: config.obLevel,
      osLevel: config.osLevel,
      osLevel3: config.osLevel3,
      wtDivObLevel: config.wtDivObLevel,
      wtDivOsLevel: config.wtDivOsLevel,
      wtDivObLevelAdd: config.wtDivObLevelAdd,
      wtDivOsLevelAdd: config.wtDivOsLevelAdd
    },
    dataGap
  };
}

export function computeVuManChuCipher(
  candles: Candle[],
  config: VumanchuConfig
): VumanchuSnapshot {
  if (candles.length < 10) return emptyVuManChuSnapshot(config, true);

  const closes = candles.map((row) => row.close);
  const highs = candles.map((row) => row.high);
  const lows = candles.map((row) => row.low);
  const opens = candles.map((row) => row.open);
  const hlc3 = candles.map((row) => (row.high + row.low + row.close) / 3);

  const esa = emaSeries(hlc3, config.wtChannelLen);
  const de = emaSeries(
    hlc3.map((value, index) => Math.abs(value - (esa[index] ?? value))),
    config.wtChannelLen
  );
  const ci = hlc3.map((value, index) => {
    const denom = (de[index] ?? 0) * 0.015;
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return 0;
    return (value - (esa[index] ?? value)) / denom;
  });
  const wt1Series = emaSeries(ci, config.wtAverageLen);
  const wt2Raw = smaSeries(wt1Series, config.wtMaLen);
  const wt2Series = alignTail(wt2Raw, wt1Series.length);
  const wt1 = wt1Series.map((value) => finiteOrNull(value));
  const wt2 = wt2Series.map((value) => finiteOrNull(value));
  const wtVwapSeries = wt1.map((value, index) => {
    const wt2Value = wt2[index];
    if (!isFiniteNumber(value) || !isFiniteNumber(wt2Value)) return null;
    return value - wt2Value;
  });

  const rsiSeries = computeRsiSeries(closes, config.rsiLen);
  const stochSeries = computeStochKSeries(
    closes,
    config.stochRsiLen,
    config.stochLen,
    config.stochKSmooth,
    config.stochDSmooth
  );
  const rsiMfiBase = candles.map((row) => normalizePriceDiv(row.open, row.high, row.low, row.close) * config.rsiMfiMultiplier);
  const rsiMfiRaw = smaSeries(rsiMfiBase, config.rsiMfiPeriod);
  const rsiMfiSeries = alignTail(rsiMfiRaw, candles.length).map((value) => (
    isFiniteNumber(value) ? value - config.rsiMfiPosY : null
  ));

  const wtDiv = findDivergences(
    wt2,
    highs,
    lows,
    config.wtDivObLevel,
    config.wtDivOsLevel,
    true
  );
  const wtDivAdd = findDivergences(
    wt2,
    highs,
    lows,
    config.wtDivObLevelAdd,
    config.wtDivOsLevelAdd,
    true
  );
  const wtDivNoLimit = findDivergences(wt2, highs, lows, 0, 0, false);
  const rsiDiv = findDivergences(rsiSeries, highs, lows, 60, 30, true);
  const rsiDivNoLimit = findDivergences(rsiSeries, highs, lows, 0, 0, false);
  const stochDiv = findDivergences(stochSeries.k, highs, lows, 0, 0, false);

  const latestIndex = candles.length - 1;
  const latestWt1 = wt1[latestIndex];
  const latestWt2 = wt2[latestIndex];
  const latestWtVwap = wtVwapSeries[latestIndex];
  const latestCross = crossInfo(wt1, wt2, latestIndex);
  const wtOversold = isFiniteNumber(latestWt2) && latestWt2 <= config.osLevel;
  const wtOverbought = isFiniteNumber(latestWt2) && latestWt2 >= config.obLevel;

  const buySeries = new Array<boolean>(candles.length).fill(false);
  const sellSeries = new Array<boolean>(candles.length).fill(false);
  for (let i = 1; i < candles.length; i += 1) {
    const info = crossInfo(wt1, wt2, i);
    const wt2Value = wt2[i];
    if (info.cross && info.crossUp && isFiniteNumber(wt2Value) && wt2Value <= config.osLevel) {
      buySeries[i] = true;
    }
    if (info.cross && info.crossDown && isFiniteNumber(wt2Value) && wt2Value >= config.obLevel) {
      sellSeries[i] = true;
    }
  }

  const wtBullHidden = config.useHiddenDiv
    ? (config.useHiddenDivNoLimits ? wtDivNoLimit.bullishHiddenNow : wtDiv.bullishHiddenNow)
    : false;
  const wtBearHidden = config.useHiddenDiv
    ? (config.useHiddenDivNoLimits ? wtDivNoLimit.bearishHiddenNow : wtDiv.bearishHiddenNow)
    : false;
  const rsiBullHidden = config.useHiddenDiv
    ? (config.useHiddenDivNoLimits ? rsiDivNoLimit.bullishHiddenNow : rsiDiv.bullishHiddenNow)
    : false;
  const rsiBearHidden = config.useHiddenDiv
    ? (config.useHiddenDivNoLimits ? rsiDivNoLimit.bearishHiddenNow : rsiDiv.bearishHiddenNow)
    : false;

  const buySignalDiv = wtDiv.bullishNow || wtDivAdd.bullishNow || stochDiv.bullishNow || rsiDiv.bullishNow;
  const sellSignalDiv = wtDiv.bearishNow || wtDivAdd.bearishNow || stochDiv.bearishNow || rsiDiv.bearishNow;

  const lastRsiFromWtPrevBottom = wtDiv.currentBottomPrevIndex === null
    ? null
    : rsiSeries[wtDiv.currentBottomPrevIndex];

  const goldNoBuyLong =
    (wtDiv.bullishNow || rsiDiv.bullishNow)
    && isFiniteNumber(wtDiv.currentBottomPrevOscillator)
    && isFiniteNumber(latestWt2)
    && wtDiv.currentBottomPrevOscillator <= config.osLevel3
    && latestWt2 > config.osLevel3
    && (latestWt2 - wtDiv.currentBottomPrevOscillator) >= config.goldWtDiffMin
    && isFiniteNumber(lastRsiFromWtPrevBottom)
    && lastRsiFromWtPrevBottom < config.goldRsiThreshold;

  const buyDivAgeCandidates = [
    wtDiv.lastBullishAgeBars,
    wtDivAdd.lastBullishAgeBars,
    stochDiv.lastBullishAgeBars,
    rsiDiv.lastBullishAgeBars
  ].filter((value): value is number => value !== null);
  const sellDivAgeCandidates = [
    wtDiv.lastBearishAgeBars,
    wtDivAdd.lastBearishAgeBars,
    stochDiv.lastBearishAgeBars,
    rsiDiv.lastBearishAgeBars
  ].filter((value): value is number => value !== null);

  const wtAgeCandidatesBull = [wtDiv.lastBullishAgeBars, wtDivAdd.lastBullishAgeBars]
    .filter((value): value is number => value !== null);
  const wtAgeCandidatesBear = [wtDiv.lastBearishAgeBars, wtDivAdd.lastBearishAgeBars]
    .filter((value): value is number => value !== null);

  const ageBuy = latestAge(buySeries);
  const ageSell = latestAge(sellSeries);
  const ageBuyDiv = buyDivAgeCandidates.length > 0 ? Math.min(...buyDivAgeCandidates) : null;
  const ageSellDiv = sellDivAgeCandidates.length > 0 ? Math.min(...sellDivAgeCandidates) : null;
  const ageGold = goldNoBuyLong ? 0 : null;

  const hasDataGap = [
    latestWt1,
    latestWt2,
    latestWtVwap,
    rsiSeries[latestIndex],
    stochSeries.k[latestIndex],
    stochSeries.d[latestIndex],
    rsiMfiSeries[latestIndex]
  ].some((value) => value === null);

  return {
    waveTrend: {
      wt1: round(finiteOrNull(latestWt1), 6),
      wt2: round(finiteOrNull(latestWt2), 6),
      wtVwap: round(finiteOrNull(latestWtVwap), 6),
      cross: latestCross.cross,
      crossUp: latestCross.crossUp,
      crossDown: latestCross.crossDown,
      oversold: wtOversold,
      overbought: wtOverbought
    },
    rsiMfi: {
      value: round(finiteOrNull(rsiMfiSeries[latestIndex]), 6),
      period: config.rsiMfiPeriod,
      multiplier: round(config.rsiMfiMultiplier, 3) ?? config.rsiMfiMultiplier,
      yPos: round(config.rsiMfiPosY, 3) ?? config.rsiMfiPosY
    },
    divergences: {
      wt: {
        bullish: wtDiv.bullishNow,
        bearish: wtDiv.bearishNow,
        bullishHidden: wtBullHidden,
        bearishHidden: wtBearHidden,
        bullishAdd: wtDivAdd.bullishNow,
        bearishAdd: wtDivAdd.bearishNow,
        lastBullishAgeBars: wtAgeCandidatesBull.length > 0 ? Math.min(...wtAgeCandidatesBull) : null,
        lastBearishAgeBars: wtAgeCandidatesBear.length > 0 ? Math.min(...wtAgeCandidatesBear) : null
      },
      rsi: {
        bullish: rsiDiv.bullishNow,
        bearish: rsiDiv.bearishNow,
        bullishHidden: rsiBullHidden,
        bearishHidden: rsiBearHidden,
        lastBullishAgeBars: rsiDiv.lastBullishAgeBars,
        lastBearishAgeBars: rsiDiv.lastBearishAgeBars
      },
      stoch: {
        bullish: stochDiv.bullishNow,
        bearish: stochDiv.bearishNow,
        bullishHidden: config.useHiddenDiv ? stochDiv.bullishHiddenNow : false,
        bearishHidden: config.useHiddenDiv ? stochDiv.bearishHiddenNow : false,
        lastBullishAgeBars: stochDiv.lastBullishAgeBars,
        lastBearishAgeBars: stochDiv.lastBearishAgeBars
      }
    },
    signals: {
      buy: buySeries[latestIndex],
      sell: sellSeries[latestIndex],
      buyDiv: buySignalDiv,
      sellDiv: sellSignalDiv,
      goldNoBuyLong: goldNoBuyLong,
      ages: {
        buy: ageBuy,
        sell: ageSell,
        buyDiv: ageBuyDiv,
        sellDiv: ageSellDiv,
        goldNoBuyLong: ageGold
      }
    },
    levels: {
      obLevel: config.obLevel,
      osLevel: config.osLevel,
      osLevel3: config.osLevel3,
      wtDivObLevel: config.wtDivObLevel,
      wtDivOsLevel: config.wtDivOsLevel,
      wtDivObLevelAdd: config.wtDivObLevelAdd,
      wtDivOsLevelAdd: config.wtDivOsLevelAdd
    },
    dataGap: hasDataGap
  };
}

export const __vmcTest = {
  findDivergences
};
