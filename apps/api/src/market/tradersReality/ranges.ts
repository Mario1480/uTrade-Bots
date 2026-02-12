import type { Candle } from "../timeframe.js";
import {
  aggregateDaily,
  aggregateMonthly,
  aggregateWeekly
} from "./levels.js";

type NullableNumber = number | null;

type RangeBand = {
  mode: "hilo" | "open";
  value: NullableNumber;
  high: NullableNumber;
  low: NullableNumber;
  high50: NullableNumber;
  low50: NullableNumber;
};

export type TradersRealityRangesSnapshot = {
  adr: RangeBand;
  awr: RangeBand;
  amr: RangeBand;
  rd: RangeBand;
  rw: RangeBand;
  distancesPct: {
    dist_to_adrHigh_pct: NullableNumber;
    dist_to_adrLow_pct: NullableNumber;
    dist_to_awrHigh_pct: NullableNumber;
    dist_to_awrLow_pct: NullableNumber;
    dist_to_amrHigh_pct: NullableNumber;
    dist_to_amrLow_pct: NullableNumber;
    dist_to_rdHigh_pct: NullableNumber;
    dist_to_rdLow_pct: NullableNumber;
    dist_to_rwHigh_pct: NullableNumber;
    dist_to_rwLow_pct: NullableNumber;
  };
};

type OhlcAggregate = {
  open: number;
  high: number;
  low: number;
  close: number;
};

type RangeModes = {
  adrUseOpen: boolean;
  awrUseOpen: boolean;
  amrUseOpen: boolean;
  rdUseOpen: boolean;
  rwUseOpen: boolean;
};

const DEFAULT_MODES: RangeModes = {
  adrUseOpen: false,
  awrUseOpen: false,
  amrUseOpen: false,
  rdUseOpen: false,
  rwUseOpen: false
};

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return sum / values.length;
}

function emptyBand(mode: "hilo" | "open"): RangeBand {
  return { mode, value: null, high: null, low: null, high50: null, low50: null };
}

function buildBand(
  anchor: { open: number; high: number; low: number } | null,
  rangeValue: number | null,
  useOpen: boolean
): RangeBand {
  const mode: "hilo" | "open" = useOpen ? "open" : "hilo";
  if (
    anchor === null ||
    rangeValue === null ||
    !Number.isFinite(anchor.open) ||
    !Number.isFinite(anchor.high) ||
    !Number.isFinite(anchor.low) ||
    !Number.isFinite(rangeValue)
  ) {
    return emptyBand(mode);
  }

  const high = useOpen ? anchor.open + rangeValue : anchor.low + rangeValue;
  const low = useOpen ? anchor.open - rangeValue : anchor.high - rangeValue;
  const half = rangeValue / 2;
  const high50 = high - half;
  const low50 = low + half;

  return {
    mode,
    value: round(rangeValue, 6),
    high: round(high, 6),
    low: round(low, 6),
    high50: round(high50, 6),
    low50: round(low50, 6)
  };
}

function distPct(price: number | null, level: number | null): number | null {
  if (price === null || level === null || level === 0) return null;
  return round(((price / level) - 1) * 100, 6);
}

function completedRanges(
  periods: OhlcAggregate[],
  count: number
): number[] {
  if (periods.length <= 1) return [];
  const completed = periods.slice(0, -1);
  const tail = completed.slice(-count);
  return tail
    .map((row) => row.high - row.low)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function computeTradersRealityRanges(
  candles: Candle[],
  options: Partial<RangeModes> = {}
): TradersRealityRangesSnapshot {
  const modes: RangeModes = { ...DEFAULT_MODES, ...options };
  const daily = aggregateDaily(candles);
  const weekly = aggregateWeekly(candles);
  const monthly = aggregateMonthly(candles);
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : null;

  const currentDay = daily.length > 0 ? daily[daily.length - 1] : null;
  const currentWeek = weekly.length > 0 ? weekly[weekly.length - 1] : null;
  const currentMonth = monthly.length > 0 ? monthly[monthly.length - 1] : null;

  const adrValue = average(completedRanges(daily, 14));
  const awrValue = average(completedRanges(weekly, 4));
  const amrValue = average(completedRanges(monthly, 6));
  const rdValue = average(completedRanges(daily, 15));
  const rwValue = average(completedRanges(weekly, 13));

  const adr = buildBand(currentDay, adrValue, modes.adrUseOpen);
  const awr = buildBand(currentWeek, awrValue, modes.awrUseOpen);
  const amr = buildBand(currentMonth, amrValue, modes.amrUseOpen);
  const rd = buildBand(currentDay, rdValue, modes.rdUseOpen);
  const rw = buildBand(currentWeek, rwValue, modes.rwUseOpen);

  return {
    adr,
    awr,
    amr,
    rd,
    rw,
    distancesPct: {
      dist_to_adrHigh_pct: distPct(lastClose, adr.high),
      dist_to_adrLow_pct: distPct(lastClose, adr.low),
      dist_to_awrHigh_pct: distPct(lastClose, awr.high),
      dist_to_awrLow_pct: distPct(lastClose, awr.low),
      dist_to_amrHigh_pct: distPct(lastClose, amr.high),
      dist_to_amrLow_pct: distPct(lastClose, amr.low),
      dist_to_rdHigh_pct: distPct(lastClose, rd.high),
      dist_to_rdLow_pct: distPct(lastClose, rd.low),
      dist_to_rwHigh_pct: distPct(lastClose, rw.high),
      dist_to_rwLow_pct: distPct(lastClose, rw.low)
    }
  };
}
