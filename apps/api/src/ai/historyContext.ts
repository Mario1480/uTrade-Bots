import { createHash } from "node:crypto";
import type { Candle, Timeframe } from "../market/timeframe.js";
import type { IndicatorsSnapshot } from "../market/indicators.js";
import type { AdvancedIndicatorsSnapshot } from "../market/indicators/advancedIndicators.js";
import { logger } from "../logger.js";

export const HISTORY_CONTEXT_VERSION = 1;
export const HISTORY_CONTEXT_HARD_CAP_BYTES = 16 * 1024;

type RegimeState = "trend_up" | "trend_down" | "range" | "transition" | "unknown";

type HistoryLastBarRow = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
};

type HistoryWindow = {
  ret: number | null;
  vr: number | null;
  atr: number | null;
  tr: number | null;
  mx: number | null;
  dd: number | null;
};

type HistoryEvent = {
  t: string;
  ty: string;
  sd?: string;
  k?: string;
  p?: number;
  i: number;
};

export type HistoryContextV1 = {
  v: 1;
  tf: string;
  ts_to: string;
  lastBars: {
    n: number;
    ohlc: HistoryLastBarRow[];
  };
  win: {
    w20: HistoryWindow;
    w50: HistoryWindow;
    w200: HistoryWindow;
    w800: HistoryWindow;
  };
  reg: {
    state: RegimeState;
    conf: number | null;
    since: string | null;
    why: string[];
  };
  lvl: {
    pivD: { pp: number | null; r1: number | null; s1: number | null; r2: number | null; s2: number | null };
    hiLo: { yH: number | null; yL: number | null; wH: number | null; wL: number | null };
    do: { p: number | null };
  };
  ema: {
    e5: number | null;
    e13: number | null;
    e50: number | null;
    e200: number | null;
    e800: number | null;
    stk: "bull" | "bear" | "none" | "unknown";
    d50: number | null;
    d200: number | null;
    d800: number | null;
    sl50: number | null;
    sl200: number | null;
  };
  vol: {
    z: number | null;
    rv: number | null;
    tr: number | null;
  };
  fvg: {
    ob: number;
    os: number;
    nb: { m: number | null; d: number | null; a: number | null } | null;
    ns: { m: number | null; d: number | null; a: number | null } | null;
  };
  ls: {
    le: { ts: string; s: "bull" | "bear"; k: "wick" | "outbreak_retest"; p: number } | null;
    nb: number | null;
    ns: number | null;
  };
  ev: HistoryEvent[];
  bud: {
    bytes: number;
    trim: string[];
  };
};

export type HistoryContextPack = HistoryContextV1;

export type HistoryContextBuildOptions = {
  enabled?: boolean;
  lastBars?: number;
  maxEvents?: number;
  maxBytes?: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNum(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function safePct(base: number | null, quote: number | null, digits = 4): number | null {
  if (base === null || quote === null || base === 0 || !Number.isFinite(base) || !Number.isFinite(quote)) {
    return null;
  }
  return round(((quote / base) - 1) * 100, digits);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function toTsMs(value: unknown): number | null {
  const parsed = toNum(value);
  if (parsed === null) return null;
  if (parsed > 1_000_000_000_000) return Math.trunc(parsed);
  if (parsed > 1_000_000_000) return Math.trunc(parsed * 1000);
  return null;
}

function toIso(value: unknown): string | null {
  const ts = toTsMs(value);
  if (ts === null) return null;
  const iso = new Date(ts).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function sortCandles(candles: Candle[]): Candle[] {
  return (candles ?? [])
    .filter((row) => row && Number.isFinite(row.open) && Number.isFinite(row.high)
      && Number.isFinite(row.low) && Number.isFinite(row.close))
    .slice()
    .sort((a, b) => (toTsMs(a.ts) ?? 0) - (toTsMs(b.ts) ?? 0));
}

function normalizeLastBars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.trunc(clamp(parsed, 10, 30));
}

function normalizeMaxEvents(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.trunc(clamp(parsed, 5, 30));
}

function normalizeMaxBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return HISTORY_CONTEXT_HARD_CAP_BYTES;
  return Math.trunc(clamp(parsed, 1024, HISTORY_CONTEXT_HARD_CAP_BYTES));
}

function timeframeToMs(timeframe: string): number {
  if (timeframe === "5m") return 5 * 60 * 1000;
  if (timeframe === "15m") return 15 * 60 * 1000;
  if (timeframe === "1h") return 60 * 60 * 1000;
  if (timeframe === "4h") return 4 * 60 * 60 * 1000;
  if (timeframe === "1d") return 24 * 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

function dayStartUtc(tsMs: number): number {
  return Math.floor(tsMs / 86_400_000) * 86_400_000;
}

function weekStartUtc(tsMs: number): number {
  const dayStart = dayStartUtc(tsMs);
  const day = new Date(dayStart).getUTCDay();
  const mondayOffset = (day + 6) % 7;
  return dayStart - (mondayOffset * 86_400_000);
}

function emaSeries(closes: number[], length: number): number[] {
  const out: number[] = [];
  if (closes.length === 0) return out;
  const k = 2 / (length + 1);
  let ema = closes[0];
  out.push(ema);
  for (let i = 1; i < closes.length; i += 1) {
    ema = closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function stackFromEma(e5: number | null, e13: number | null, e50: number | null, e200: number | null, e800: number | null): "bull" | "bear" | "none" | "unknown" {
  if (e5 === null || e13 === null || e50 === null || e200 === null || e800 === null) return "unknown";
  if (e5 > e13 && e13 > e50 && e50 > e200 && e200 > e800) return "bull";
  if (e5 < e13 && e13 < e50 && e50 < e200 && e200 < e800) return "bear";
  return "none";
}

function trendScore(params: {
  adx: number | null;
  emaSpread: number | null;
  dist50: number | null;
  dist200: number | null;
  slope50: number | null;
  slope200: number | null;
  ret50: number | null;
}): number | null {
  const parts: number[] = [];
  if (params.adx !== null) parts.push(clamp(params.adx * 2.5, 0, 100));
  if (params.emaSpread !== null) parts.push(clamp(Math.abs(params.emaSpread) * 150, 0, 100));
  if (params.dist50 !== null) parts.push(clamp(Math.abs(params.dist50) * 8, 0, 100));
  if (params.dist200 !== null) parts.push(clamp(Math.abs(params.dist200) * 8, 0, 100));
  if (params.slope50 !== null) parts.push(clamp(Math.abs(params.slope50) * 80, 0, 100));
  if (params.slope200 !== null) parts.push(clamp(Math.abs(params.slope200) * 120, 0, 100));
  if (params.ret50 !== null) parts.push(clamp(Math.abs(params.ret50) * 12, 0, 100));
  if (parts.length === 0) return null;
  return round(avg(parts), 3);
}

function sanitizeFinite(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFinite(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitizeFinite(nested);
  }
  return out;
}

function buildLastBars(candles: Candle[], maxBars: number): { n: number; ohlc: HistoryLastBarRow[] } {
  const rows = candles.slice(-maxBars).map((row) => {
    const tsMs = toTsMs(row.ts) ?? 0;
    return {
      t: Math.trunc(tsMs / 1000),
      o: round(row.open, 6) ?? 0,
      h: round(row.high, 6) ?? 0,
      l: round(row.low, 6) ?? 0,
      c: round(row.close, 6) ?? 0,
      v: row.volume === null ? null : round(row.volume, 6)
    };
  });
  return {
    n: rows.length,
    ohlc: rows
  };
}

function windowSummary(params: {
  candles: Candle[];
  closes: number[];
  highs: number[];
  lows: number[];
  index: number;
  length: number;
  adx: number | null;
  emaSpread: number | null;
  dist50: number | null;
  dist200: number | null;
  slope50: number | null;
  slope200: number | null;
}): HistoryWindow {
  const { candles, closes, highs, lows, index, length } = params;
  const start = index - length;
  if (start < 0 || closes.length <= index || candles.length <= index) {
    return { ret: null, vr: null, atr: null, tr: null, mx: null, dd: null };
  }

  const startClose = closes[start] ?? null;
  const endClose = closes[index] ?? null;
  const ret = safePct(startClose, endClose, 4);

  const returns: number[] = [];
  const trRows: number[] = [];
  for (let i = start + 1; i <= index; i += 1) {
    const prevClose = closes[i - 1];
    const nextClose = closes[i];
    if (Number.isFinite(prevClose) && prevClose > 0 && Number.isFinite(nextClose)) {
      returns.push((nextClose / prevClose) - 1);
    }
    const prev = closes[i - 1];
    const hi = highs[i];
    const lo = lows[i];
    if (Number.isFinite(prev) && Number.isFinite(hi) && Number.isFinite(lo)) {
      trRows.push(Math.max(Math.abs(hi - lo), Math.abs(hi - prev), Math.abs(lo - prev)));
    }
  }

  const vr = round(stddev(returns) * 100, 4);
  const atr = endClose && endClose > 0 ? round((avg(trRows) / endClose) * 100, 4) : null;
  const tr = trendScore({
    adx: params.adx,
    emaSpread: params.emaSpread,
    dist50: params.dist50,
    dist200: params.dist200,
    slope50: params.slope50,
    slope200: params.slope200,
    ret50: ret
  });

  const highsWindow = highs.slice(start, index + 1);
  const lowsWindow = lows.slice(start, index + 1);
  const maxHigh = highsWindow.length > 0 ? Math.max(...highsWindow) : null;
  const minLow = lowsWindow.length > 0 ? Math.min(...lowsWindow) : null;
  const mx = safePct(startClose, maxHigh, 4);
  const dd = safePct(startClose, minLow, 4);

  return {
    ret,
    vr,
    atr,
    tr,
    mx,
    dd
  };
}

function buildLevels(candles: Candle[]): HistoryContextV1["lvl"] {
  const out: HistoryContextV1["lvl"] = {
    pivD: { pp: null, r1: null, s1: null, r2: null, s2: null },
    hiLo: { yH: null, yL: null, wH: null, wL: null },
    do: { p: null }
  };
  if (candles.length === 0) return out;

  type Agg = { open: number; high: number; low: number; close: number; firstTs: number };
  const day = new Map<number, Agg>();
  const week = new Map<number, Agg>();

  for (const row of candles) {
    const ts = toTsMs(row.ts);
    if (ts === null) continue;

    const dKey = dayStartUtc(ts);
    const existingDay = day.get(dKey);
    if (!existingDay) {
      day.set(dKey, {
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        firstTs: ts
      });
    } else {
      existingDay.high = Math.max(existingDay.high, row.high);
      existingDay.low = Math.min(existingDay.low, row.low);
      if (ts >= existingDay.firstTs) {
        existingDay.close = row.close;
      }
      if (ts < existingDay.firstTs) {
        existingDay.firstTs = ts;
        existingDay.open = row.open;
      }
    }

    const wKey = weekStartUtc(ts);
    const existingWeek = week.get(wKey);
    if (!existingWeek) {
      week.set(wKey, {
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        firstTs: ts
      });
    } else {
      existingWeek.high = Math.max(existingWeek.high, row.high);
      existingWeek.low = Math.min(existingWeek.low, row.low);
      if (ts >= existingWeek.firstTs) {
        existingWeek.close = row.close;
      }
      if (ts < existingWeek.firstTs) {
        existingWeek.firstTs = ts;
        existingWeek.open = row.open;
      }
    }
  }

  const lastTs = toTsMs(candles[candles.length - 1]?.ts);
  if (lastTs === null) return out;

  const currentDay = dayStartUtc(lastTs);
  const previousDay = day.get(currentDay - 86_400_000);
  const currentDayAgg = day.get(currentDay);
  if (currentDayAgg) {
    out.do.p = round(currentDayAgg.open, 6);
  }
  if (previousDay) {
    out.hiLo.yH = round(previousDay.high, 6);
    out.hiLo.yL = round(previousDay.low, 6);
    const pp = (previousDay.high + previousDay.low + previousDay.close) / 3;
    out.pivD.pp = round(pp, 6);
    out.pivD.r1 = round((2 * pp) - previousDay.low, 6);
    out.pivD.s1 = round((2 * pp) - previousDay.high, 6);
    out.pivD.r2 = round(pp + (previousDay.high - previousDay.low), 6);
    out.pivD.s2 = round(pp - (previousDay.high - previousDay.low), 6);
  }

  const currentWeek = weekStartUtc(lastTs);
  const previousWeek = week.get(currentWeek - (7 * 86_400_000));
  if (previousWeek) {
    out.hiLo.wH = round(previousWeek.high, 6);
    out.hiLo.wL = round(previousWeek.low, 6);
  }

  return out;
}

function buildEmaSummary(params: {
  closes: number[];
  advancedIndicators?: AdvancedIndicatorsSnapshot | null;
}): HistoryContextV1["ema"] {
  const closes = params.closes;
  const lastClose = closes[closes.length - 1] ?? null;
  const e5Series = emaSeries(closes, 5);
  const e13Series = emaSeries(closes, 13);
  const e50Series = emaSeries(closes, 50);
  const e200Series = emaSeries(closes, 200);
  const e800Series = emaSeries(closes, 800);
  const index = closes.length - 1;

  const advanced = params.advancedIndicators?.emas;
  const e5 = round(toNum(advanced?.ema_5) ?? e5Series[index] ?? null, 6);
  const e13 = round(toNum(advanced?.ema_13) ?? e13Series[index] ?? null, 6);
  const e50 = round(toNum(advanced?.ema_50) ?? e50Series[index] ?? null, 6);
  const e200 = round(toNum(advanced?.ema_200) ?? e200Series[index] ?? null, 6);
  const e800 = round(toNum(advanced?.ema_800) ?? e800Series[index] ?? null, 6);

  const stk = stackFromEma(e5, e13, e50, e200, e800);
  const d50 = round(toNum(advanced?.emaDistancesPct?.price_vs_50_pct) ?? safePct(e50, lastClose, 4), 4);
  const d200 = round(toNum(advanced?.emaDistancesPct?.price_vs_200_pct) ?? safePct(e200, lastClose, 4), 4);
  const d800 = round(toNum(advanced?.emaDistancesPct?.price_vs_800_pct) ?? safePct(e800, lastClose, 4), 4);

  const prev50 = e50Series[index - 1] ?? null;
  const prev200 = e200Series[index - 1] ?? null;
  const sl50 = round(
    toNum(advanced?.emaSlopesPct?.slope_50_pct_1bar)
    ?? safePct(prev50, e50, 4),
    4
  );
  const sl200 = round(
    toNum(advanced?.emaSlopesPct?.slope_200_pct_1bar)
    ?? safePct(prev200, e200, 4),
    4
  );

  return { e5, e13, e50, e200, e800, stk, d50, d200, d800, sl50, sl200 };
}

function buildVolumeSummary(params: {
  candles: Candle[];
  indicators?: IndicatorsSnapshot | null;
}): HistoryContextV1["vol"] {
  const fromIndicators = params.indicators?.volume;
  if (fromIndicators) {
    return {
      z: round(toNum(fromIndicators.vol_z), 4),
      rv: round(toNum(fromIndicators.rel_vol), 4),
      tr: round(toNum(fromIndicators.vol_trend), 4)
    };
  }

  const volumes = params.candles
    .map((row) => toNum(row.volume))
    .filter((value): value is number => value !== null);
  if (volumes.length < 20) {
    return { z: null, rv: null, tr: null };
  }

  const lookback = Math.min(100, volumes.length);
  const slice = volumes.slice(-lookback);
  const last = slice[slice.length - 1] ?? null;
  const mean = avg(slice);
  const dev = stddev(slice);
  const z = dev > 0 && last !== null ? round((last - mean) / dev, 4) : null;
  const rv = mean > 0 && last !== null ? round(last / mean, 4) : null;

  const ema10 = emaSeries(volumes, 10);
  const ema30 = emaSeries(volumes, 30);
  const emaFast = ema10[ema10.length - 1] ?? null;
  const emaSlow = ema30[ema30.length - 1] ?? null;
  const tr = round(safePct(emaSlow, emaFast, 4), 4);

  return { z, rv, tr };
}

function mapFvgNearest(input: Record<string, unknown> | null): { m: number | null; d: number | null; a: number | null } | null {
  if (!input) return null;
  return {
    m: round(toNum(input.mid), 6),
    d: round(toNum(input.dist_pct), 4),
    a: round(toNum(input.age_bars), 0)
  };
}

function findAgeBars(candles: Candle[], tsValue: unknown): number | null {
  const ts = toTsMs(tsValue);
  if (ts === null || candles.length === 0) return null;
  let bestIndex = -1;
  for (let i = 0; i < candles.length; i += 1) {
    const barTs = toTsMs(candles[i]?.ts);
    if (barTs === null) continue;
    if (barTs <= ts) bestIndex = i;
  }
  if (bestIndex < 0) return null;
  return Math.max(0, candles.length - 1 - bestIndex);
}

function buildFvgSummary(params: {
  candles: Candle[];
  indicators?: IndicatorsSnapshot | null;
  advancedIndicators?: AdvancedIndicatorsSnapshot | null;
}): HistoryContextV1["fvg"] {
  const fromIndicators = params.indicators?.fvg;
  if (fromIndicators) {
    return {
      ob: Math.max(0, Math.trunc(toNum(fromIndicators.open_bullish_count) ?? 0)),
      os: Math.max(0, Math.trunc(toNum(fromIndicators.open_bearish_count) ?? 0)),
      nb: mapFvgNearest(asObject(fromIndicators.nearest_bullish_gap)),
      ns: mapFvgNearest(asObject(fromIndicators.nearest_bearish_gap))
    };
  }

  const smc = params.advancedIndicators?.smartMoneyConcepts?.fairValueGaps;
  const latestClose = params.candles[params.candles.length - 1]?.close ?? null;
  const mapSide = (side: { top: number; bottom: number; ts: number } | null): { m: number | null; d: number | null; a: number | null } | null => {
    if (!side) return null;
    const m = round((side.top + side.bottom) / 2, 6);
    const d = latestClose && latestClose > 0 && m !== null ? round(((m / latestClose) - 1) * 100, 4) : null;
    return {
      m,
      d,
      a: findAgeBars(params.candles, side.ts)
    };
  };

  return {
    ob: Math.max(0, Math.trunc(toNum(smc?.bullishCount) ?? 0)),
    os: Math.max(0, Math.trunc(toNum(smc?.bearishCount) ?? 0)),
    nb: mapSide(smc?.latestBullish ?? null),
    ns: mapSide(smc?.latestBearish ?? null)
  };
}

function buildLiquiditySweepSummary(advancedIndicators: AdvancedIndicatorsSnapshot | null | undefined): HistoryContextV1["ls"] {
  const base: HistoryContextV1["ls"] = {
    le: null,
    nb: null,
    ns: null
  };

  const advanced = asObject(advancedIndicators as unknown);
  if (!advanced) return base;
  const lsRaw = asObject(advanced.liquiditySweeps)
    ?? asObject(asObject(advanced.smartMoneyConcepts)?.liquiditySweeps)
    ?? null;
  if (!lsRaw) return base;

  const nearestBull = toNum(lsRaw.nearestBullDistPct ?? lsRaw.nearestBullDist ?? lsRaw.nb);
  const nearestBear = toNum(lsRaw.nearestBearDistPct ?? lsRaw.nearestBearDist ?? lsRaw.ns);
  base.nb = round(nearestBull, 4);
  base.ns = round(nearestBear, 4);

  const lastEvent = asObject(lsRaw.lastEvent)
    ?? (Array.isArray(lsRaw.recentEvents) ? asObject(lsRaw.recentEvents[0]) : null)
    ?? null;
  if (!lastEvent) return base;

  const ts = toIso(lastEvent.ts ?? lastEvent.time);
  const sideRaw = String(lastEvent.side ?? lastEvent.direction ?? "").toLowerCase();
  const s: "bull" | "bear" | null = sideRaw.includes("bull") || sideRaw.includes("buy")
    ? "bull"
    : sideRaw.includes("bear") || sideRaw.includes("sell")
      ? "bear"
      : null;
  const kindRaw = String(lastEvent.kind ?? lastEvent.type ?? "wick").toLowerCase();
  const k: "wick" | "outbreak_retest" = kindRaw.includes("retest") ? "outbreak_retest" : "wick";
  const p = round(toNum(lastEvent.price ?? lastEvent.level), 6);

  if (ts && s && p !== null) {
    base.le = { ts, s, k, p };
  }

  return base;
}

function regimeFromState(state: RegimeState): "bull" | "bear" | null {
  if (state === "trend_up") return "bull";
  if (state === "trend_down") return "bear";
  return null;
}

function deriveState(stk: "bull" | "bear" | "none" | "unknown", tr: number | null): RegimeState {
  if (stk === "bull" && tr !== null && tr >= 65) return "trend_up";
  if (stk === "bear" && tr !== null && tr >= 65) return "trend_down";
  if (tr !== null && tr <= 45) return "range";
  if (stk === "unknown" && tr === null) return "unknown";
  return "transition";
}

function stateAtIndex(params: {
  closes: number[];
  e5: number[];
  e13: number[];
  e50: number[];
  e200: number[];
  e800: number[];
  index: number;
  adx: number | null;
}): RegimeState {
  const i = params.index;
  const close = params.closes[i] ?? null;
  const e50 = params.e50[i] ?? null;
  const e200 = params.e200[i] ?? null;
  const e800 = params.e800[i] ?? null;
  const prev50 = params.e50[i - 1] ?? null;
  const prev200 = params.e200[i - 1] ?? null;
  const stack = stackFromEma(
    params.e5[i] ?? null,
    params.e13[i] ?? null,
    e50,
    e200,
    e800
  );
  const tr = trendScore({
    adx: params.adx,
    emaSpread: safePct(params.e13[i] ?? null, e50, 4),
    dist50: safePct(e50, close, 4),
    dist200: safePct(e200, close, 4),
    slope50: safePct(prev50, e50, 4),
    slope200: safePct(prev200, e200, 4),
    ret50: i >= 50 ? safePct(params.closes[i - 50], close, 4) : null
  });
  return deriveState(stack, tr);
}

function buildRegime(params: {
  candles: Candle[];
  closes: number[];
  ema: HistoryContextV1["ema"];
  win: HistoryContextV1["win"];
  adx: number | null;
  levels: HistoryContextV1["lvl"];
  previous: HistoryContextV1 | null;
}): HistoryContextV1["reg"] {
  const currentState = deriveState(params.ema.stk, params.win.w50.tr);
  const conf = round(clamp(toNum(params.win.w50.tr) ?? 0, 0, 100), 2);

  const e5Series = emaSeries(params.closes, 5);
  const e13Series = emaSeries(params.closes, 13);
  const e50Series = emaSeries(params.closes, 50);
  const e200Series = emaSeries(params.closes, 200);
  const e800Series = emaSeries(params.closes, 800);

  let sinceTs: number | null = null;
  const end = params.candles.length - 1;
  if (end >= 0) {
    const start = Math.max(0, end - 800);
    sinceTs = toTsMs(params.candles[start]?.ts);
    for (let i = end - 1; i >= start; i -= 1) {
      const st = stateAtIndex({
        closes: params.closes,
        e5: e5Series,
        e13: e13Series,
        e50: e50Series,
        e200: e200Series,
        e800: e800Series,
        index: i,
        adx: params.adx
      });
      if (st !== currentState) {
        sinceTs = toTsMs(params.candles[i + 1]?.ts);
        break;
      }
    }
  }

  const why: string[] = [];
  if (params.ema.stk === "bull") why.push("ema_stack_bull");
  if (params.ema.stk === "bear") why.push("ema_stack_bear");
  if ((params.win.w50.tr ?? 0) >= 65) why.push("trend_strong");
  const v20 = params.win.w20.vr ?? null;
  const v200 = params.win.w200.vr ?? null;
  if (v20 !== null && v200 !== null) {
    if (v20 > v200 * 1.4) why.push("vol_high");
    else if (v20 < v200 * 0.7) why.push("vol_low");
  }
  const close = params.closes[params.closes.length - 1] ?? null;
  const nearLevel = [
    params.levels.pivD.pp,
    params.levels.hiLo.yH,
    params.levels.hiLo.yL,
    params.levels.hiLo.wH,
    params.levels.hiLo.wL
  ].some((level) => {
    if (close === null || level === null || close <= 0) return false;
    return Math.abs(((level / close) - 1) * 100) <= 0.25;
  });
  if (nearLevel) why.push("near_key_level");

  const previousState = params.previous?.reg?.state ?? null;
  const previousSince = params.previous?.reg?.since ?? null;
  const since = previousState === currentState
    ? previousSince
    : (sinceTs ? new Date(sinceTs).toISOString() : null);

  return {
    state: currentState,
    conf,
    since,
    why: why.slice(0, 4)
  };
}

function buildEvents(params: {
  candles: Candle[];
  reg: HistoryContextV1["reg"];
  ema: HistoryContextV1["ema"];
  vol: HistoryContextV1["vol"];
  fvg: HistoryContextV1["fvg"];
  ls: HistoryContextV1["ls"];
  advancedIndicators?: AdvancedIndicatorsSnapshot | null;
  maxEvents: number;
}): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const push = (event: HistoryEvent | null) => {
    if (!event) return;
    events.push(event);
  };

  const lastTsIso = toIso(params.candles[params.candles.length - 1]?.ts) ?? new Date().toISOString();

  if (params.reg.since && params.reg.since !== lastTsIso) {
    push({
      t: params.reg.since,
      ty: "reg_sw",
      sd: regimeFromState(params.reg.state) ?? undefined,
      i: 4
    });
  }

  if (params.ema.stk === "bull" || params.ema.stk === "bear") {
    push({
      t: lastTsIso,
      ty: "ema_stk",
      sd: params.ema.stk,
      i: 3
    });
  }

  if ((params.vol.z ?? 0) >= 2 || (params.vol.rv ?? 0) >= 1.8) {
    push({
      t: lastTsIso,
      ty: "vol_spike",
      i: 4
    });
  }

  if ((params.fvg.ob + params.fvg.os) > 0) {
    push({
      t: lastTsIso,
      ty: "fvg_open",
      sd: params.fvg.ob >= params.fvg.os ? "bull" : "bear",
      i: 3
    });
  }

  if (params.ls.le) {
    push({
      t: params.ls.le.ts,
      ty: "liq_sweep",
      sd: params.ls.le.s,
      k: params.ls.le.k,
      p: params.ls.le.p,
      i: 5
    });
  }

  const smc = params.advancedIndicators?.smartMoneyConcepts;
  const internal = smc?.internal?.lastEvent;
  if (internal?.type && internal?.ts) {
    push({
      t: toIso(internal.ts) ?? lastTsIso,
      ty: `smc_i_${String(internal.type).toLowerCase()}`,
      sd: internal.direction ?? undefined,
      p: round(toNum(internal.level), 6) ?? undefined,
      i: 4
    });
  }
  const swing = smc?.swing?.lastEvent;
  if (swing?.type && swing?.ts) {
    push({
      t: toIso(swing.ts) ?? lastTsIso,
      ty: `smc_s_${String(swing.type).toLowerCase()}`,
      sd: swing.direction ?? undefined,
      p: round(toNum(swing.level), 6) ?? undefined,
      i: 3
    });
  }

  const deduped = new Map<string, HistoryEvent>();
  for (const event of events) {
    const key = `${event.t}:${event.ty}:${event.sd ?? ""}:${event.k ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, event);
  }

  return [...deduped.values()]
    .sort((a, b) => {
      const at = Date.parse(a.t);
      const bt = Date.parse(b.t);
      if (bt !== at) return bt - at;
      if (b.i !== a.i) return b.i - a.i;
      return a.ty.localeCompare(b.ty);
    })
    .slice(0, params.maxEvents);
}

function serializeSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function trimHistoryContextForAi(
  context: HistoryContextV1,
  options: Pick<HistoryContextBuildOptions, "maxEvents" | "lastBars" | "maxBytes"> = {}
): HistoryContextV1 {
  const maxEvents = normalizeMaxEvents(options.maxEvents);
  const lastBars = normalizeLastBars(options.lastBars);
  const maxBytes = normalizeMaxBytes(options.maxBytes);

  const out: HistoryContextV1 = JSON.parse(JSON.stringify(context)) as HistoryContextV1;
  const trimFlags: string[] = [];

  if (out.ev.length > maxEvents) {
    out.ev = out.ev.slice(0, maxEvents);
    trimFlags.push("events_trimmed_limit");
  }
  if (out.lastBars.n > lastBars) {
    out.lastBars.ohlc = out.lastBars.ohlc.slice(-lastBars);
    out.lastBars.n = out.lastBars.ohlc.length;
    trimFlags.push("lastBars_trimmed_limit");
  }

  let bytes = serializeSize(out);
  if (bytes > maxBytes && out.ev.length > 20) {
    out.ev = out.ev.slice(0, 20);
    trimFlags.push("events_trimmed_20");
    bytes = serializeSize(out);
  }
  if (bytes > maxBytes && out.ev.length > 10) {
    out.ev = out.ev.slice(0, 10);
    trimFlags.push("events_trimmed_10");
    bytes = serializeSize(out);
  }
  if (bytes > maxBytes && out.lastBars.n > 20) {
    out.lastBars.ohlc = out.lastBars.ohlc.slice(-20);
    out.lastBars.n = out.lastBars.ohlc.length;
    trimFlags.push("lastBars_trimmed_20");
    bytes = serializeSize(out);
  }
  if (bytes > maxBytes && out.lastBars.n > 10) {
    out.lastBars.ohlc = out.lastBars.ohlc.slice(-10);
    out.lastBars.n = out.lastBars.ohlc.length;
    trimFlags.push("lastBars_trimmed_10");
    bytes = serializeSize(out);
  }
  if (bytes > maxBytes) {
    out.lvl.do.p = null;
    out.lvl.hiLo.wH = null;
    out.lvl.hiLo.wL = null;
    trimFlags.push("optional_levels_dropped");
    bytes = serializeSize(out);
  }
  if (bytes > maxBytes && out.ev.length > 0) {
    out.ev = [];
    trimFlags.push("events_dropped");
    bytes = serializeSize(out);
  }

  out.bud.bytes = bytes;
  out.bud.trim = trimFlags;
  return sanitizeFinite(out) as HistoryContextV1;
}

function hashContext(context: HistoryContextV1): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

function asHistoryContextV1(value: unknown): HistoryContextV1 | null {
  const parsed = asObject(value);
  if (!parsed) return null;
  if (Number(parsed.v) !== 1) return null;
  if (!asObject(parsed.lastBars) || !asObject(parsed.win) || !asObject(parsed.reg) || !Array.isArray(parsed.ev)) {
    return null;
  }
  return parsed as unknown as HistoryContextV1;
}

export function buildHistoryContext(params: {
  candles: Candle[];
  timeframe: Timeframe | string;
  nowTs?: number | Date;
  indicators?: IndicatorsSnapshot | null;
  advancedIndicators?: AdvancedIndicatorsSnapshot | null;
  existingContext?: HistoryContextV1 | null;
  options?: HistoryContextBuildOptions;
}): HistoryContextV1 {
  const options = params.options ?? {};
  const lastBarsLimit = normalizeLastBars(options.lastBars);
  const maxEvents = normalizeMaxEvents(options.maxEvents);
  const maxBytes = normalizeMaxBytes(options.maxBytes);

  const candles = sortCandles(params.candles ?? []);
  const closes = candles.map((row) => row.close);
  const highs = candles.map((row) => row.high);
  const lows = candles.map((row) => row.low);
  const lastIndex = candles.length - 1;

  const nowTsMs = params.nowTs instanceof Date
    ? params.nowTs.getTime()
    : (typeof params.nowTs === "number" ? params.nowTs : Date.now());
  const tsToIso = toIso(candles[lastIndex]?.ts) ?? new Date(nowTsMs).toISOString();

  const ema = buildEmaSummary({
    closes,
    advancedIndicators: params.advancedIndicators ?? null
  });
  const adx = round(toNum(params.indicators?.adx?.adx_14), 4);
  const emaSpread = round(
    toNum(params.advancedIndicators?.emas?.emaDistancesPct?.spread_13_50_pct),
    4
  );

  const win = {
    w20: windowSummary({
      candles,
      closes,
      highs,
      lows,
      index: lastIndex,
      length: 20,
      adx,
      emaSpread,
      dist50: ema.d50,
      dist200: ema.d200,
      slope50: ema.sl50,
      slope200: ema.sl200
    }),
    w50: windowSummary({
      candles,
      closes,
      highs,
      lows,
      index: lastIndex,
      length: 50,
      adx,
      emaSpread,
      dist50: ema.d50,
      dist200: ema.d200,
      slope50: ema.sl50,
      slope200: ema.sl200
    }),
    w200: windowSummary({
      candles,
      closes,
      highs,
      lows,
      index: lastIndex,
      length: 200,
      adx,
      emaSpread,
      dist50: ema.d50,
      dist200: ema.d200,
      slope50: ema.sl50,
      slope200: ema.sl200
    }),
    w800: windowSummary({
      candles,
      closes,
      highs,
      lows,
      index: lastIndex,
      length: 800,
      adx,
      emaSpread,
      dist50: ema.d50,
      dist200: ema.d200,
      slope50: ema.sl50,
      slope200: ema.sl200
    })
  };

  const lvl = buildLevels(candles);
  const reg = buildRegime({
    candles,
    closes,
    ema,
    win,
    adx,
    levels: lvl,
    previous: params.existingContext ?? null
  });
  const vol = buildVolumeSummary({
    candles,
    indicators: params.indicators ?? null
  });
  const fvg = buildFvgSummary({
    candles,
    indicators: params.indicators ?? null,
    advancedIndicators: params.advancedIndicators ?? null
  });
  const ls = buildLiquiditySweepSummary(params.advancedIndicators ?? null);

  const ctx: HistoryContextV1 = {
    v: HISTORY_CONTEXT_VERSION,
    tf: String(params.timeframe),
    ts_to: tsToIso,
    lastBars: buildLastBars(candles, lastBarsLimit),
    win,
    reg,
    lvl,
    ema,
    vol,
    fvg,
    ls,
    ev: [],
    bud: {
      bytes: 0,
      trim: []
    }
  };

  ctx.ev = buildEvents({
    candles,
    reg,
    ema,
    vol,
    fvg,
    ls,
    advancedIndicators: params.advancedIndicators ?? null,
    maxEvents
  });

  return trimHistoryContextForAi(ctx, {
    maxEvents,
    lastBars: lastBarsLimit,
    maxBytes
  });
}

export async function upsertMarketContextSnapshot(params: {
  db: any;
  exchange: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: Timeframe | string;
  tsFrom: Date;
  tsTo: Date;
  payload: HistoryContextV1;
  contextHash?: string;
}) {
  const contextHash = params.contextHash ?? hashContext(params.payload);
  try {
    await params.db.marketContextSnapshot.upsert({
      where: {
        exchange_symbol_marketType_timeframe: {
          exchange: params.exchange,
          symbol: params.symbol,
          marketType: params.marketType,
          timeframe: params.timeframe
        }
      },
      update: {
        tsFrom: params.tsFrom,
        tsTo: params.tsTo,
        contextVersion: `v${HISTORY_CONTEXT_VERSION}`,
        contextHash,
        payload: params.payload
      },
      create: {
        exchange: params.exchange,
        symbol: params.symbol,
        marketType: params.marketType,
        timeframe: params.timeframe,
        tsFrom: params.tsFrom,
        tsTo: params.tsTo,
        contextVersion: `v${HISTORY_CONTEXT_VERSION}`,
        contextHash,
        payload: params.payload
      }
    });
  } catch (error) {
    logger.warn("market_context_snapshot_upsert_failed", {
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      reason: String(error)
    });
  }
}

export async function buildAndAttachHistoryContext(params: {
  db: any;
  featureSnapshot: Record<string, unknown>;
  candles: Candle[];
  timeframe: Timeframe | string;
  nowTs?: number | Date;
  indicators?: IndicatorsSnapshot | null;
  advancedIndicators?: AdvancedIndicatorsSnapshot | null;
  exchange: string;
  symbol: string;
  marketType: "spot" | "perp";
  options?: HistoryContextBuildOptions;
}) {
  if (params.options?.enabled === false) {
    delete params.featureSnapshot.historyContext;
    return null;
  }

  const candles = sortCandles(params.candles ?? []);
  let previousContext: HistoryContextV1 | null = null;
  let previousHash: string | null = null;
  let previousTsTo: string | null = null;

  try {
    const previousRow = await params.db.marketContextSnapshot.findUnique({
      where: {
        exchange_symbol_marketType_timeframe: {
          exchange: params.exchange,
          symbol: params.symbol,
          marketType: params.marketType,
          timeframe: params.timeframe
        }
      },
      select: {
        payload: true,
        contextHash: true,
        tsTo: true
      }
    });
    previousContext = asHistoryContextV1(previousRow?.payload ?? null);
    previousHash = typeof previousRow?.contextHash === "string" ? previousRow.contextHash : null;
    previousTsTo = previousRow?.tsTo instanceof Date ? previousRow.tsTo.toISOString() : null;
  } catch {
    previousContext = null;
    previousHash = null;
    previousTsTo = null;
  }

  const context = buildHistoryContext({
    candles,
    timeframe: params.timeframe,
    nowTs: params.nowTs,
    indicators: params.indicators ?? null,
    advancedIndicators: params.advancedIndicators ?? null,
    existingContext: previousContext,
    options: params.options
  });
  params.featureSnapshot.historyContext = context;

  const contextHash = hashContext(context);
  const tsTo = context.ts_to;
  if (previousHash && previousHash === contextHash && previousTsTo === tsTo) {
    return context;
  }

  const now = new Date();
  const firstTs = toTsMs(candles[0]?.ts);
  const lastTs = toTsMs(candles[candles.length - 1]?.ts) ?? Date.parse(tsTo);

  await upsertMarketContextSnapshot({
    db: params.db,
    exchange: params.exchange,
    symbol: params.symbol,
    marketType: params.marketType,
    timeframe: params.timeframe,
    tsFrom: firstTs ? new Date(firstTs) : now,
    tsTo: Number.isFinite(lastTs) ? new Date(lastTs) : now,
    payload: context,
    contextHash
  });

  return context;
}

export function historyContextHash(context: HistoryContextV1 | null | undefined): string | null {
  if (!context) return null;
  return hashContext(context);
}
