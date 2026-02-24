import type { Candle, Timeframe } from "../timeframe.js";
import { timeframeToMs } from "../timeframe.js";
import { clamp, round } from "./shared.js";

export type LiquiditySweepKind = "wick" | "outbreak_retest";
export type LiquiditySweepSide = "bull" | "bear";

export type LiquiditySweepEvent = {
  ts: number;
  side: LiquiditySweepSide;
  kind: LiquiditySweepKind;
  price: number;
  level: number;
};

export type LiquiditySweepZone = {
  side: LiquiditySweepSide;
  level: number;
  createdTs: number;
  expiresTs: number;
};

export type LiquiditySweepsSnapshot = {
  lastEvent: LiquiditySweepEvent | null;
  recentEvents: LiquiditySweepEvent[];
  nearestBullDistPct: number | null;
  nearestBearDistPct: number | null;
  activeZones: {
    bullishCount: number;
    bearishCount: number;
  };
  dataGap: boolean;
};

export type LiquiditySweepsComputeOptions = {
  enabled?: boolean;
  len?: number;
  mode?: "wicks" | "outbreak_retest" | "both";
  extend?: boolean;
  maxBars?: number;
  maxRecentEvents?: number;
  maxActiveZones?: number;
};

type PivotLevel = {
  side: "high" | "low";
  level: number;
  ts: number;
  expiresTs: number;
};

type PendingRetest = {
  side: "high" | "low";
  level: number;
  breakoutTs: number;
  expiresTs: number;
};

const DEFAULT_LEN = 5;
const DEFAULT_MODE: NonNullable<LiquiditySweepsComputeOptions["mode"]> = "both";
const DEFAULT_EXTEND = true;
const DEFAULT_MAX_BARS = 300;
const DEFAULT_MAX_RECENT_EVENTS = 20;
const DEFAULT_MAX_ACTIVE_ZONES = 20;

function emptySnapshot(dataGap: boolean): LiquiditySweepsSnapshot {
  return {
    lastEvent: null,
    recentEvents: [],
    nearestBullDistPct: null,
    nearestBearDistPct: null,
    activeZones: {
      bullishCount: 0,
      bearishCount: 0
    },
    dataGap
  };
}

function levelKey(side: "high" | "low", level: number): string {
  return `${side}:${level.toFixed(8)}`;
}

function zoneInteraction(zone: LiquiditySweepZone, candle: Candle): boolean {
  if (zone.side === "bull") {
    return candle.low <= zone.level || candle.close <= zone.level;
  }
  return candle.high >= zone.level || candle.close >= zone.level;
}

function isPivotHigh(candles: Candle[], index: number, len: number): boolean {
  if (index - len < 0 || index + len >= candles.length) return false;
  const candidate = candles[index]?.high;
  if (!Number.isFinite(candidate)) return false;
  for (let i = index - len; i <= index + len; i += 1) {
    if (i === index) continue;
    if (candles[i].high >= candidate) return false;
  }
  return true;
}

function isPivotLow(candles: Candle[], index: number, len: number): boolean {
  if (index - len < 0 || index + len >= candles.length) return false;
  const candidate = candles[index]?.low;
  if (!Number.isFinite(candidate)) return false;
  for (let i = index - len; i <= index + len; i += 1) {
    if (i === index) continue;
    if (candles[i].low <= candidate) return false;
  }
  return true;
}

function nearestDistancePct(params: {
  side: LiquiditySweepSide;
  zones: LiquiditySweepZone[];
  close: number | null;
}): number | null {
  if (params.close === null || params.close <= 0) return null;
  const candidates = params.zones.filter((zone) => zone.side === params.side);
  if (candidates.length === 0) return null;

  let best: number | null = null;
  for (const zone of candidates) {
    const raw = ((zone.level / params.close) - 1) * 100;
    if (!Number.isFinite(raw)) continue;
    if (best === null || Math.abs(raw) < Math.abs(best)) {
      best = raw;
    }
  }

  return round(best, 4);
}

function pushEvent(events: LiquiditySweepEvent[], event: LiquiditySweepEvent): void {
  const exists = events.some((row) =>
    row.ts === event.ts
    && row.side === event.side
    && row.kind === event.kind
    && Math.abs(row.level - event.level) < 1e-8
  );
  if (!exists) {
    events.push(event);
  }
}

export function computeLiquiditySweeps(
  candlesInput: Candle[],
  timeframe: Timeframe,
  options: LiquiditySweepsComputeOptions = {}
): LiquiditySweepsSnapshot {
  const enabled = options.enabled ?? true;
  if (!enabled) {
    return emptySnapshot(false);
  }

  const mode = options.mode ?? DEFAULT_MODE;
  const len = clamp(Math.trunc(options.len ?? DEFAULT_LEN), 1, 200);
  const maxBars = clamp(Math.trunc(options.maxBars ?? DEFAULT_MAX_BARS), 20, 5000);
  const maxRecentEvents = clamp(
    Math.trunc(options.maxRecentEvents ?? DEFAULT_MAX_RECENT_EVENTS),
    1,
    200
  );
  const maxActiveZones = clamp(
    Math.trunc(options.maxActiveZones ?? DEFAULT_MAX_ACTIVE_ZONES),
    1,
    200
  );
  const extend = options.extend ?? DEFAULT_EXTEND;

  const candles = candlesInput
    .filter((row): row is Candle & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .sort((a, b) => (a.ts as number) - (b.ts as number));

  if (candles.length < (len * 2) + 1) {
    return emptySnapshot(true);
  }

  const tfMs = timeframeToMs(timeframe);
  const windowMs = maxBars * tfMs;

  const pivotHighs: PivotLevel[] = [];
  const pivotLows: PivotLevel[] = [];
  const pendingRetests: PendingRetest[] = [];
  const zones: LiquiditySweepZone[] = [];
  const events: LiquiditySweepEvent[] = [];

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const ts = candle.ts as number;

    const pivotIndex = i - len;
    if (pivotIndex >= len && pivotIndex + len < candles.length) {
      if (isPivotHigh(candles, pivotIndex, len)) {
        const pivot = candles[pivotIndex];
        const level = pivot.high;
        if (Number.isFinite(level) && pivot.ts !== null) {
          pivotHighs.push({
            side: "high",
            level,
            ts: pivot.ts,
            expiresTs: pivot.ts + windowMs
          });
        }
      }
      if (isPivotLow(candles, pivotIndex, len)) {
        const pivot = candles[pivotIndex];
        const level = pivot.low;
        if (Number.isFinite(level) && pivot.ts !== null) {
          pivotLows.push({
            side: "low",
            level,
            ts: pivot.ts,
            expiresTs: pivot.ts + windowMs
          });
        }
      }
    }

    for (let p = pivotHighs.length - 1; p >= 0; p -= 1) {
      if (pivotHighs[p].expiresTs < ts) pivotHighs.splice(p, 1);
    }
    for (let p = pivotLows.length - 1; p >= 0; p -= 1) {
      if (pivotLows[p].expiresTs < ts) pivotLows.splice(p, 1);
    }

    for (let p = pendingRetests.length - 1; p >= 0; p -= 1) {
      if (pendingRetests[p].expiresTs < ts) pendingRetests.splice(p, 1);
    }

    if (mode === "wicks" || mode === "both") {
      for (let p = pivotHighs.length - 1; p >= 0; p -= 1) {
        const level = pivotHighs[p].level;
        if (candle.high > level && candle.close < level) {
          pushEvent(events, {
            ts,
            side: "bear",
            kind: "wick",
            price: round(candle.close, 6) ?? candle.close,
            level: round(level, 6) ?? level
          });
          break;
        }
      }

      for (let p = pivotLows.length - 1; p >= 0; p -= 1) {
        const level = pivotLows[p].level;
        if (candle.low < level && candle.close > level) {
          pushEvent(events, {
            ts,
            side: "bull",
            kind: "wick",
            price: round(candle.close, 6) ?? candle.close,
            level: round(level, 6) ?? level
          });
          break;
        }
      }
    }

    if (mode === "outbreak_retest" || mode === "both") {
      for (let p = pivotHighs.length - 1; p >= 0; p -= 1) {
        const level = pivotHighs[p].level;
        if (candle.close > level) {
          const exists = pendingRetests.some((row) => levelKey(row.side, row.level) === levelKey("high", level));
          if (!exists) {
            pendingRetests.push({
              side: "high",
              level,
              breakoutTs: ts,
              expiresTs: ts + windowMs
            });
          }
        }
      }

      for (let p = pivotLows.length - 1; p >= 0; p -= 1) {
        const level = pivotLows[p].level;
        if (candle.close < level) {
          const exists = pendingRetests.some((row) => levelKey(row.side, row.level) === levelKey("low", level));
          if (!exists) {
            pendingRetests.push({
              side: "low",
              level,
              breakoutTs: ts,
              expiresTs: ts + windowMs
            });
          }
        }
      }

      for (let p = pendingRetests.length - 1; p >= 0; p -= 1) {
        const pending = pendingRetests[p];
        if (pending.side === "high" && ts > pending.breakoutTs && candle.close < pending.level) {
          const level = round(pending.level, 6) ?? pending.level;
          pushEvent(events, {
            ts,
            side: "bear",
            kind: "outbreak_retest",
            price: round(candle.close, 6) ?? candle.close,
            level
          });
          pendingRetests.splice(p, 1);
          continue;
        }
        if (pending.side === "low" && ts > pending.breakoutTs && candle.close > pending.level) {
          const level = round(pending.level, 6) ?? pending.level;
          pushEvent(events, {
            ts,
            side: "bull",
            kind: "outbreak_retest",
            price: round(candle.close, 6) ?? candle.close,
            level
          });
          pendingRetests.splice(p, 1);
        }
      }
    }

    for (let e = events.length - 1; e >= 0; e -= 1) {
      const event = events[e];
      if (event.ts !== ts) break;
      zones.push({
        side: event.side,
        level: event.level,
        createdTs: ts,
        expiresTs: ts + windowMs
      });
    }

    for (let z = zones.length - 1; z >= 0; z -= 1) {
      const zone = zones[z];
      if (zone.expiresTs < ts) {
        zones.splice(z, 1);
        continue;
      }
      if (extend && zoneInteraction(zone, candle)) {
        zone.expiresTs = Math.max(zone.expiresTs, ts + windowMs);
      }
    }

    if (zones.length > maxActiveZones) {
      zones.sort((a, b) => a.createdTs - b.createdTs);
      zones.splice(0, zones.length - maxActiveZones);
    }
  }

  const recentEvents = [...events]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, maxRecentEvents)
    .map((row) => ({
      ...row,
      price: round(row.price, 6) ?? row.price,
      level: round(row.level, 6) ?? row.level
    }));

  const lastClose = candles[candles.length - 1]?.close ?? null;

  const bullishCount = zones.filter((zone) => zone.side === "bull").length;
  const bearishCount = zones.filter((zone) => zone.side === "bear").length;

  return {
    lastEvent: recentEvents[0] ?? null,
    recentEvents,
    nearestBullDistPct: nearestDistancePct({ side: "bull", zones, close: lastClose }),
    nearestBearDistPct: nearestDistancePct({ side: "bear", zones, close: lastClose }),
    activeZones: {
      bullishCount,
      bearishCount
    },
    dataGap: false
  };
}
