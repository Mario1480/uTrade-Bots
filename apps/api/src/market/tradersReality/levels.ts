import type { Candle } from "../timeframe.js";

type NullableNumber = number | null;

type OhlcAggregate = {
  startTs: number;
  endTs: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TradersRealityLevelsSnapshot = {
  daily: {
    dayOpen: NullableNumber;
    dayHigh: NullableNumber;
    dayLow: NullableNumber;
    dayClose: NullableNumber;
    pivots: {
      pp: NullableNumber;
      r1: NullableNumber;
      s1: NullableNumber;
      r2: NullableNumber;
      s2: NullableNumber;
      r3: NullableNumber;
      s3: NullableNumber;
      m0: NullableNumber;
      m1: NullableNumber;
      m2: NullableNumber;
      m3: NullableNumber;
      m4: NullableNumber;
      m5: NullableNumber;
    };
  };
  weekly: {
    weekHigh: NullableNumber;
    weekLow: NullableNumber;
  };
  monthly: {
    monthHigh: NullableNumber;
    monthLow: NullableNumber;
  };
};

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

function startOfUtcWeek(ts: number): number {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - mondayOffset,
    0,
    0,
    0,
    0
  );
}

function startOfUtcMonth(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

function aggregateByPeriod(
  candles: Candle[],
  periodStart: (ts: number) => number
): OhlcAggregate[] {
  const valid = candles
    .filter((row): row is Candle & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .sort((a, b) => (a.ts as number) - (b.ts as number));
  const map = new Map<number, OhlcAggregate>();
  for (const row of valid) {
    const ts = row.ts as number;
    const key = periodStart(ts);
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        startTs: key,
        endTs: ts,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close
      });
      continue;
    }
    if (ts < current.startTs) current.startTs = ts;
    if (ts > current.endTs) {
      current.endTs = ts;
      current.close = row.close;
    }
    if (row.high > current.high) current.high = row.high;
    if (row.low < current.low) current.low = row.low;
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, agg]) => agg);
}

function emptyLevels(): TradersRealityLevelsSnapshot {
  return {
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
  };
}

function pivotMids(pivots: {
  r3: number;
  r2: number;
  r1: number;
  pp: number;
  s1: number;
  s2: number;
  s3: number;
}): { m0: number; m1: number; m2: number; m3: number; m4: number; m5: number } {
  return {
    m0: (pivots.s3 + pivots.s2) / 2,
    m1: (pivots.s2 + pivots.s1) / 2,
    m2: (pivots.s1 + pivots.pp) / 2,
    m3: (pivots.pp + pivots.r1) / 2,
    m4: (pivots.r1 + pivots.r2) / 2,
    m5: (pivots.r2 + pivots.r3) / 2
  };
}

export function computeTradersRealityLevels(candles: Candle[]): TradersRealityLevelsSnapshot {
  const levels = emptyLevels();
  const daily = aggregateByPeriod(candles, startOfUtcDay);
  const weekly = aggregateByPeriod(candles, startOfUtcWeek);
  const monthly = aggregateByPeriod(candles, startOfUtcMonth);

  const currentDay = daily.length > 0 ? daily[daily.length - 1] : null;
  const prevDay = daily.length > 1 ? daily[daily.length - 2] : null;
  if (currentDay) {
    levels.daily.dayOpen = round(currentDay.open, 6);
    levels.daily.dayHigh = round(currentDay.high, 6);
    levels.daily.dayLow = round(currentDay.low, 6);
    levels.daily.dayClose = round(currentDay.close, 6);
  }

  if (prevDay) {
    const pp = (prevDay.high + prevDay.low + prevDay.close) / 3;
    const r1 = (2 * pp) - prevDay.low;
    const s1 = (2 * pp) - prevDay.high;
    const r2 = pp + (prevDay.high - prevDay.low);
    const s2 = pp - (prevDay.high - prevDay.low);
    const r3 = prevDay.high + (2 * (pp - prevDay.low));
    const s3 = prevDay.low - (2 * (prevDay.high - pp));
    const mids = pivotMids({ r3, r2, r1, pp, s1, s2, s3 });
    levels.daily.pivots = {
      pp: round(pp, 6),
      r1: round(r1, 6),
      s1: round(s1, 6),
      r2: round(r2, 6),
      s2: round(s2, 6),
      r3: round(r3, 6),
      s3: round(s3, 6),
      m0: round(mids.m0, 6),
      m1: round(mids.m1, 6),
      m2: round(mids.m2, 6),
      m3: round(mids.m3, 6),
      m4: round(mids.m4, 6),
      m5: round(mids.m5, 6)
    };
  }

  const prevWeek = weekly.length > 1 ? weekly[weekly.length - 2] : null;
  const prevMonth = monthly.length > 1 ? monthly[monthly.length - 2] : null;
  if (prevWeek) {
    levels.weekly.weekHigh = round(prevWeek.high, 6);
    levels.weekly.weekLow = round(prevWeek.low, 6);
  }
  if (prevMonth) {
    levels.monthly.monthHigh = round(prevMonth.high, 6);
    levels.monthly.monthLow = round(prevMonth.low, 6);
  }

  return levels;
}

export function aggregateDaily(candles: Candle[]): OhlcAggregate[] {
  return aggregateByPeriod(candles, startOfUtcDay);
}

export function aggregateWeekly(candles: Candle[]): OhlcAggregate[] {
  return aggregateByPeriod(candles, startOfUtcWeek);
}

export function aggregateMonthly(candles: Candle[]): OhlcAggregate[] {
  return aggregateByPeriod(candles, startOfUtcMonth);
}
