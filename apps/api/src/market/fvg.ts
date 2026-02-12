import type { Candle } from "./timeframe.js";

export type FvgType = "bullish" | "bearish";
export type FvgFillRule = "overlap" | "mid_touch";

type NullableNumber = number | null;

type Gap = {
  type: FvgType;
  lower: number;
  upper: number;
  mid: number;
  createdIndex: number;
  filledIndex: number | null;
};

type FvgEdge = {
  upper: NullableNumber;
  lower: NullableNumber;
  mid: NullableNumber;
  dist_pct: NullableNumber;
  age_bars: NullableNumber;
};

export type FvgSummary = {
  lookback: number;
  fill_rule: FvgFillRule;
  open_bullish_count: number;
  open_bearish_count: number;
  nearest_bullish_gap: FvgEdge;
  nearest_bearish_gap: FvgEdge;
  last_created: {
    type: FvgType | null;
    age_bars: NullableNumber;
  };
  last_filled: {
    type: FvgType | null;
    age_bars: NullableNumber;
  };
};

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function emptyEdge(): FvgEdge {
  return {
    upper: null,
    lower: null,
    mid: null,
    dist_pct: null,
    age_bars: null
  };
}

function hasOverlap(bar: Candle, gap: Gap): boolean {
  return bar.high >= gap.lower && bar.low <= gap.upper;
}

function touchesMid(bar: Candle, gap: Gap): boolean {
  return bar.high >= gap.mid && bar.low <= gap.mid;
}

function isFilled(bar: Candle, gap: Gap, rule: FvgFillRule): boolean {
  if (rule === "mid_touch") {
    return touchesMid(bar, gap);
  }
  return hasOverlap(bar, gap);
}

function safeDistancePct(price: number, target: number): number | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(target)) return null;
  return ((target / price) - 1) * 100;
}

function mapNearestGap(gap: Gap | null, latestClose: number, latestIndex: number): FvgEdge {
  if (!gap) return emptyEdge();
  return {
    upper: round(gap.upper, 6),
    lower: round(gap.lower, 6),
    mid: round(gap.mid, 6),
    dist_pct: round(safeDistancePct(latestClose, gap.mid), 6),
    age_bars: Math.max(0, latestIndex - gap.createdIndex)
  };
}

export function computeFVGSummary(
  candles: Candle[],
  options: {
    lookbackBars?: number;
    fillRule?: FvgFillRule;
  } = {}
): FvgSummary {
  const lookback = Math.max(3, Math.trunc(options.lookbackBars ?? 300));
  const fillRule: FvgFillRule = options.fillRule === "mid_touch" ? "mid_touch" : "overlap";
  const source = candles.slice(-lookback);
  const latestIndex = Math.max(0, source.length - 1);
  const latestCloseRaw = source[latestIndex]?.close;
  const latestClose = Number.isFinite(latestCloseRaw) ? Number(latestCloseRaw) : NaN;

  const gaps: Gap[] = [];

  for (let i = 2; i < source.length; i += 1) {
    const left = source[i - 2];
    const curr = source[i];

    if (curr.low > left.high) {
      const lower = left.high;
      const upper = curr.low;
      gaps.push({
        type: "bullish",
        lower,
        upper,
        mid: (lower + upper) / 2,
        createdIndex: i,
        filledIndex: null
      });
    } else if (curr.high < left.low) {
      const lower = curr.high;
      const upper = left.low;
      gaps.push({
        type: "bearish",
        lower,
        upper,
        mid: (lower + upper) / 2,
        createdIndex: i,
        filledIndex: null
      });
    }
  }

  for (const gap of gaps) {
    for (let i = gap.createdIndex + 1; i < source.length; i += 1) {
      const bar = source[i];
      if (isFilled(bar, gap, fillRule)) {
        gap.filledIndex = i;
        break;
      }
    }
  }

  const openBullish = gaps.filter((gap) => gap.type === "bullish" && gap.filledIndex === null);
  const openBearish = gaps.filter((gap) => gap.type === "bearish" && gap.filledIndex === null);
  const filled = gaps.filter((gap) => gap.filledIndex !== null);
  const lastCreated = gaps[gaps.length - 1] ?? null;
  const lastFilled = filled.length > 0 ? filled[filled.length - 1] : null;

  const nearestOpenByPrice = (rows: Gap[]): Gap | null => {
    if (!Number.isFinite(latestClose) || latestClose <= 0 || rows.length === 0) return null;
    let best: Gap | null = null;
    let bestAbs = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const dist = safeDistancePct(latestClose, row.mid);
      if (dist === null) continue;
      const abs = Math.abs(dist);
      if (abs < bestAbs) {
        bestAbs = abs;
        best = row;
      }
    }
    return best;
  };

  const nearestBullish = nearestOpenByPrice(openBullish);
  const nearestBearish = nearestOpenByPrice(openBearish);

  return {
    lookback,
    fill_rule: fillRule,
    open_bullish_count: openBullish.length,
    open_bearish_count: openBearish.length,
    nearest_bullish_gap: mapNearestGap(nearestBullish, latestClose, latestIndex),
    nearest_bearish_gap: mapNearestGap(nearestBearish, latestClose, latestIndex),
    last_created: {
      type: lastCreated?.type ?? null,
      age_bars: lastCreated ? Math.max(0, latestIndex - lastCreated.createdIndex) : null
    },
    last_filled: {
      type: lastFilled?.type ?? null,
      age_bars:
        lastFilled && typeof lastFilled.filledIndex === "number"
          ? Math.max(0, latestIndex - lastFilled.filledIndex)
          : null
    }
  };
}
