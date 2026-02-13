import type { Candle } from "../timeframe.js";
import { clamp, round } from "./shared.js";

type SmcDirection = "bullish" | "bearish";
type SmcTrendBias = SmcDirection | "neutral";
type SmcEventType = "bos" | "choch";

type SmcStructureEvent = {
  type: SmcEventType | null;
  direction: SmcDirection | null;
  level: number | null;
  ts: number | null;
};

type SmcStructureSnapshot = {
  trend: SmcTrendBias;
  lastEvent: SmcStructureEvent;
  bullishBreaks: number;
  bearishBreaks: number;
};

type SmcLevelEvent = {
  detected: boolean;
  level: number | null;
  ts: number | null;
  deltaPct: number | null;
};

type SmcOrderBlock = {
  top: number;
  bottom: number;
  ts: number;
  bias: SmcDirection;
};

type SmcOrderBlockSnapshot = {
  bullishCount: number;
  bearishCount: number;
  latestBullish: { top: number; bottom: number; ts: number } | null;
  latestBearish: { top: number; bottom: number; ts: number } | null;
};

type SmcFvg = {
  top: number;
  bottom: number;
  ts: number;
  bias: SmcDirection;
};

type SmcFvgSnapshot = {
  bullishCount: number;
  bearishCount: number;
  latestBullish: { top: number; bottom: number; ts: number } | null;
  latestBearish: { top: number; bottom: number; ts: number } | null;
  autoThresholdPct: number | null;
};

type SmcZonesSnapshot = {
  trailingTop: number | null;
  trailingBottom: number | null;
  premiumTop: number | null;
  premiumBottom: number | null;
  equilibriumTop: number | null;
  equilibriumBottom: number | null;
  discountTop: number | null;
  discountBottom: number | null;
};

export type SmartMoneyConceptsSnapshot = {
  internal: SmcStructureSnapshot;
  swing: SmcStructureSnapshot;
  equalLevels: {
    eqh: SmcLevelEvent;
    eql: SmcLevelEvent;
  };
  orderBlocks: {
    internal: SmcOrderBlockSnapshot;
    swing: SmcOrderBlockSnapshot;
  };
  fairValueGaps: SmcFvgSnapshot;
  zones: SmcZonesSnapshot;
  dataGap: boolean;
};

export type SmartMoneyConceptsOptions = {
  internalLength?: number;
  swingLength?: number;
  equalLength?: number;
  equalThreshold?: number;
  maxOrderBlocks?: number;
  fvgAutoThreshold?: boolean;
};

type PivotState = {
  level: number | null;
  index: number;
  ts: number | null;
  crossed: boolean;
};

type StructureEvalResult = {
  structure: SmcStructureSnapshot;
  orderBlocks: SmcOrderBlock[];
  lastHighPivot: PivotState;
  lastLowPivot: PivotState;
};

const DEFAULT_INTERNAL_LENGTH = 5;
const DEFAULT_SWING_LENGTH = 50;
const DEFAULT_EQUAL_LENGTH = 3;
const DEFAULT_EQUAL_THRESHOLD = 0.1;
const DEFAULT_MAX_ORDER_BLOCKS = 20;
const DEFAULT_FVG_AUTO_THRESHOLD = true;
const MAX_STORED_ORDER_BLOCKS = 100;

function toTs(candle: Candle): number | null {
  return candle.ts !== null && Number.isFinite(candle.ts) ? candle.ts : null;
}

function emptyStructureSnapshot(): SmcStructureSnapshot {
  return {
    trend: "neutral",
    lastEvent: {
      type: null,
      direction: null,
      level: null,
      ts: null
    },
    bullishBreaks: 0,
    bearishBreaks: 0
  };
}

function emptyOrderBlockSnapshot(): SmcOrderBlockSnapshot {
  return {
    bullishCount: 0,
    bearishCount: 0,
    latestBullish: null,
    latestBearish: null
  };
}

function emptyLevelEvent(): SmcLevelEvent {
  return {
    detected: false,
    level: null,
    ts: null,
    deltaPct: null
  };
}

function emptyFvgSnapshot(): SmcFvgSnapshot {
  return {
    bullishCount: 0,
    bearishCount: 0,
    latestBullish: null,
    latestBearish: null,
    autoThresholdPct: null
  };
}

function emptyZonesSnapshot(): SmcZonesSnapshot {
  return {
    trailingTop: null,
    trailingBottom: null,
    premiumTop: null,
    premiumBottom: null,
    equilibriumTop: null,
    equilibriumBottom: null,
    discountTop: null,
    discountBottom: null
  };
}

function emptySnapshot(dataGap: boolean): SmartMoneyConceptsSnapshot {
  return {
    internal: emptyStructureSnapshot(),
    swing: emptyStructureSnapshot(),
    equalLevels: {
      eqh: emptyLevelEvent(),
      eql: emptyLevelEvent()
    },
    orderBlocks: {
      internal: emptyOrderBlockSnapshot(),
      swing: emptyOrderBlockSnapshot()
    },
    fairValueGaps: emptyFvgSnapshot(),
    zones: emptyZonesSnapshot(),
    dataGap
  };
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function calcTrueRanges(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const row = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : row.close;
    const tr = Math.max(
      row.high - row.low,
      Math.abs(row.high - prevClose),
      Math.abs(row.low - prevClose)
    );
    out.push(Number.isFinite(tr) ? tr : 0);
  }
  return out;
}

function rollingMean(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    const window = Math.min(period, i + 1);
    out.push(sum / window);
  }
  return out;
}

function cumulativeMean(values: number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    out.push(sum / (i + 1));
  }
  return out;
}

function isPivotHigh(candles: Candle[], index: number, size: number): boolean {
  if (index - size < 0 || index + size >= candles.length) return false;
  const level = candles[index].high;
  for (let i = index - size; i <= index + size; i += 1) {
    if (i === index) continue;
    if (candles[i].high >= level) return false;
  }
  return true;
}

function isPivotLow(candles: Candle[], index: number, size: number): boolean {
  if (index - size < 0 || index + size >= candles.length) return false;
  const level = candles[index].low;
  for (let i = index - size; i <= index + size; i += 1) {
    if (i === index) continue;
    if (candles[i].low <= level) return false;
  }
  return true;
}

function normalizeBlock(top: number, bottom: number, ts: number, bias: SmcDirection): SmcOrderBlock {
  const parsedTop = Math.max(top, bottom);
  const parsedBottom = Math.min(top, bottom);
  return { top: parsedTop, bottom: parsedBottom, ts, bias };
}

function extractOrderBlock(
  candles: Candle[],
  parsedHighs: number[],
  parsedLows: number[],
  fromIndex: number,
  toIndex: number,
  bias: SmcDirection
): SmcOrderBlock | null {
  if (fromIndex < 0 || toIndex <= fromIndex || toIndex >= candles.length) return null;

  let chosenIndex = fromIndex;
  if (bias === "bearish") {
    let maxHigh = -Infinity;
    for (let i = fromIndex; i <= toIndex; i += 1) {
      if (parsedHighs[i] > maxHigh) {
        maxHigh = parsedHighs[i];
        chosenIndex = i;
      }
    }
  } else {
    let minLow = Infinity;
    for (let i = fromIndex; i <= toIndex; i += 1) {
      if (parsedLows[i] < minLow) {
        minLow = parsedLows[i];
        chosenIndex = i;
      }
    }
  }

  const row = candles[chosenIndex];
  const ts = toTs(row);
  if (ts === null) return null;
  return normalizeBlock(parsedHighs[chosenIndex], parsedLows[chosenIndex], ts, bias);
}

function pruneMitigatedBlocks(orderBlocks: SmcOrderBlock[], candle: Candle): void {
  for (let i = orderBlocks.length - 1; i >= 0; i -= 1) {
    const block = orderBlocks[i];
    const mitigated = block.bias === "bearish"
      ? candle.high > block.top
      : candle.low < block.bottom;
    if (mitigated) {
      orderBlocks.splice(i, 1);
    }
  }
}

function snapshotOrderBlocks(orderBlocks: SmcOrderBlock[], maxOrderBlocks: number): SmcOrderBlockSnapshot {
  const visible = orderBlocks.slice(0, Math.min(maxOrderBlocks, orderBlocks.length));
  let bullishCount = 0;
  let bearishCount = 0;
  let latestBullish: SmcOrderBlockSnapshot["latestBullish"] = null;
  let latestBearish: SmcOrderBlockSnapshot["latestBearish"] = null;

  for (const block of visible) {
    if (block.bias === "bullish") {
      bullishCount += 1;
      if (!latestBullish) {
        latestBullish = { top: round(block.top, 6)!, bottom: round(block.bottom, 6)!, ts: block.ts };
      }
    } else {
      bearishCount += 1;
      if (!latestBearish) {
        latestBearish = { top: round(block.top, 6)!, bottom: round(block.bottom, 6)!, ts: block.ts };
      }
    }
  }

  return {
    bullishCount,
    bearishCount,
    latestBullish,
    latestBearish
  };
}

function evaluateStructure(
  candles: Candle[],
  parsedHighs: number[],
  parsedLows: number[],
  pivotSize: number
): StructureEvalResult {
  const structure = emptyStructureSnapshot();
  const orderBlocks: SmcOrderBlock[] = [];

  const highPivot: PivotState = { level: null, index: -1, ts: null, crossed: false };
  const lowPivot: PivotState = { level: null, index: -1, ts: null, crossed: false };

  let trendBias = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const row = candles[i];

    if (isPivotHigh(candles, i, pivotSize)) {
      highPivot.level = row.high;
      highPivot.index = i;
      highPivot.ts = toTs(row);
      highPivot.crossed = false;
    }

    if (isPivotLow(candles, i, pivotSize)) {
      lowPivot.level = row.low;
      lowPivot.index = i;
      lowPivot.ts = toTs(row);
      lowPivot.crossed = false;
    }

    pruneMitigatedBlocks(orderBlocks, row);

    if (
      highPivot.level !== null &&
      !highPivot.crossed &&
      prev.close <= highPivot.level &&
      row.close > highPivot.level
    ) {
      const type: SmcEventType = trendBias < 0 ? "choch" : "bos";
      trendBias = 1;
      highPivot.crossed = true;
      structure.bullishBreaks += 1;
      structure.lastEvent = {
        type,
        direction: "bullish",
        level: round(highPivot.level, 6),
        ts: highPivot.ts
      };

      const block = extractOrderBlock(candles, parsedHighs, parsedLows, highPivot.index, i, "bullish");
      if (block) {
        orderBlocks.unshift(block);
        if (orderBlocks.length > MAX_STORED_ORDER_BLOCKS) {
          orderBlocks.pop();
        }
      }
    }

    if (
      lowPivot.level !== null &&
      !lowPivot.crossed &&
      prev.close >= lowPivot.level &&
      row.close < lowPivot.level
    ) {
      const type: SmcEventType = trendBias > 0 ? "choch" : "bos";
      trendBias = -1;
      lowPivot.crossed = true;
      structure.bearishBreaks += 1;
      structure.lastEvent = {
        type,
        direction: "bearish",
        level: round(lowPivot.level, 6),
        ts: lowPivot.ts
      };

      const block = extractOrderBlock(candles, parsedHighs, parsedLows, lowPivot.index, i, "bearish");
      if (block) {
        orderBlocks.unshift(block);
        if (orderBlocks.length > MAX_STORED_ORDER_BLOCKS) {
          orderBlocks.pop();
        }
      }
    }
  }

  structure.trend = trendBias > 0 ? "bullish" : trendBias < 0 ? "bearish" : "neutral";

  return {
    structure,
    orderBlocks,
    lastHighPivot: highPivot,
    lastLowPivot: lowPivot
  };
}

function computeEqualLevels(
  candles: Candle[],
  pivotSize: number,
  threshold: number,
  atrSeries: number[]
): { eqh: SmcLevelEvent; eql: SmcLevelEvent } {
  const eqh = emptyLevelEvent();
  const eql = emptyLevelEvent();

  let prevHigh: { level: number; index: number } | null = null;
  let prevLow: { level: number; index: number } | null = null;

  for (let i = 0; i < candles.length; i += 1) {
    if (isPivotHigh(candles, i, pivotSize)) {
      const level = candles[i].high;
      if (prevHigh) {
        const atr = atrSeries[i] ?? 0;
        const diff = Math.abs(prevHigh.level - level);
        if (atr > 0 && diff < threshold * atr) {
          eqh.detected = true;
          eqh.level = round(level, 6);
          eqh.ts = toTs(candles[i]);
          const base = Math.max(Math.abs(prevHigh.level), Math.abs(level), 1e-9);
          eqh.deltaPct = round((diff / base) * 100, 6);
        }
      }
      prevHigh = { level, index: i };
    }

    if (isPivotLow(candles, i, pivotSize)) {
      const level = candles[i].low;
      if (prevLow) {
        const atr = atrSeries[i] ?? 0;
        const diff = Math.abs(prevLow.level - level);
        if (atr > 0 && diff < threshold * atr) {
          eql.detected = true;
          eql.level = round(level, 6);
          eql.ts = toTs(candles[i]);
          const base = Math.max(Math.abs(prevLow.level), Math.abs(level), 1e-9);
          eql.deltaPct = round((diff / base) * 100, 6);
        }
      }
      prevLow = { level, index: i };
    }
  }

  return { eqh, eql };
}

function computeFairValueGaps(
  candles: Candle[],
  useAutoThreshold: boolean
): SmcFvgSnapshot {
  const out = emptyFvgSnapshot();
  const active: SmcFvg[] = [];

  let deltaCum = 0;
  let lastThreshold = 0;

  for (let i = 2; i < candles.length; i += 1) {
    const row = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];

    for (let j = active.length - 1; j >= 0; j -= 1) {
      const gap = active[j];
      const mitigated = gap.bias === "bullish"
        ? row.low < gap.bottom
        : row.high > gap.top;
      if (mitigated) {
        active.splice(j, 1);
      }
    }

    const bodyPct = prev.open !== 0 ? Math.abs((prev.close - prev.open) / (prev.open * 100)) : 0;
    deltaCum += bodyPct;
    const threshold = useAutoThreshold ? (deltaCum / (i + 1)) * 2 : 0;
    lastThreshold = threshold;

    const bullish = row.low > prev2.high && prev.close > prev2.high && bodyPct > threshold;
    const bearish = row.high < prev2.low && prev.close < prev2.low && bodyPct > threshold;

    const ts = toTs(row);
    if (ts !== null && bullish) {
      active.unshift({
        top: round(row.low, 6)!,
        bottom: round(prev2.high, 6)!,
        ts,
        bias: "bullish"
      });
    }

    if (ts !== null && bearish) {
      active.unshift({
        top: round(prev2.low, 6)!,
        bottom: round(row.high, 6)!,
        ts,
        bias: "bearish"
      });
    }
  }

  out.autoThresholdPct = round(lastThreshold * 100, 6);

  for (const gap of active) {
    if (gap.bias === "bullish") {
      out.bullishCount += 1;
      if (!out.latestBullish) {
        out.latestBullish = { top: gap.top, bottom: gap.bottom, ts: gap.ts };
      }
    } else {
      out.bearishCount += 1;
      if (!out.latestBearish) {
        out.latestBearish = { top: gap.top, bottom: gap.bottom, ts: gap.ts };
      }
    }
  }

  return out;
}

function computeZones(
  candles: Candle[],
  swingEval: StructureEvalResult
): SmcZonesSnapshot {
  const out = emptyZonesSnapshot();

  const fallbackTop = candles.reduce((max, row) => Math.max(max, row.high), -Infinity);
  const fallbackBottom = candles.reduce((min, row) => Math.min(min, row.low), Infinity);

  const trailingTop = swingEval.lastHighPivot.level ?? (Number.isFinite(fallbackTop) ? fallbackTop : null);
  const trailingBottom = swingEval.lastLowPivot.level ?? (Number.isFinite(fallbackBottom) ? fallbackBottom : null);

  if (trailingTop === null || trailingBottom === null || trailingTop <= trailingBottom) {
    return out;
  }

  out.trailingTop = round(trailingTop, 6);
  out.trailingBottom = round(trailingBottom, 6);
  out.premiumTop = round(trailingTop, 6);
  out.premiumBottom = round(0.95 * trailingTop + 0.05 * trailingBottom, 6);
  out.equilibriumTop = round(0.525 * trailingTop + 0.475 * trailingBottom, 6);
  out.equilibriumBottom = round(0.525 * trailingBottom + 0.475 * trailingTop, 6);
  out.discountTop = round(0.95 * trailingBottom + 0.05 * trailingTop, 6);
  out.discountBottom = round(trailingBottom, 6);

  return out;
}

export function computeSmartMoneyConcepts(
  candles: Candle[],
  options: SmartMoneyConceptsOptions = {}
): SmartMoneyConceptsSnapshot {
  const sorted = candles
    .filter((row): row is Candle & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .sort((a, b) => (a.ts as number) - (b.ts as number));

  if (sorted.length < 30) {
    return emptySnapshot(true);
  }

  const internalLength = clampInt(options.internalLength, 2, 50, DEFAULT_INTERNAL_LENGTH);
  const swingLength = clampInt(options.swingLength, 10, 250, DEFAULT_SWING_LENGTH);
  const equalLength = clampInt(options.equalLength, 1, 50, DEFAULT_EQUAL_LENGTH);
  const maxOrderBlocks = clampInt(options.maxOrderBlocks, 1, 50, DEFAULT_MAX_ORDER_BLOCKS);
  const equalThreshold = clamp(
    Number.isFinite(options.equalThreshold ?? NaN)
      ? Number(options.equalThreshold)
      : DEFAULT_EQUAL_THRESHOLD,
    0,
    0.5
  );
  const useAutoFvgThreshold = options.fvgAutoThreshold ?? DEFAULT_FVG_AUTO_THRESHOLD;

  const tr = calcTrueRanges(sorted);
  const atr200 = rollingMean(tr, 200);
  const meanRange = cumulativeMean(tr);

  const parsedHighs: number[] = [];
  const parsedLows: number[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    const volMeasure = atr200[i] > 0 ? atr200[i] : meanRange[i];
    const highVolatility = (row.high - row.low) >= 2 * volMeasure;
    parsedHighs.push(highVolatility ? row.low : row.high);
    parsedLows.push(highVolatility ? row.high : row.low);
  }

  const internalEval = evaluateStructure(sorted, parsedHighs, parsedLows, internalLength);
  const swingEval = evaluateStructure(sorted, parsedHighs, parsedLows, swingLength);
  const equalLevels = computeEqualLevels(sorted, equalLength, equalThreshold, atr200);
  const fairValueGaps = computeFairValueGaps(sorted, useAutoFvgThreshold);
  const zones = computeZones(sorted, swingEval);

  return {
    internal: internalEval.structure,
    swing: swingEval.structure,
    equalLevels,
    orderBlocks: {
      internal: snapshotOrderBlocks(internalEval.orderBlocks, maxOrderBlocks),
      swing: snapshotOrderBlocks(swingEval.orderBlocks, maxOrderBlocks)
    },
    fairValueGaps,
    zones,
    dataGap: false
  };
}
