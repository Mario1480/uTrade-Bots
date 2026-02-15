import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle } from "../market/timeframe.js";
import {
  HISTORY_CONTEXT_HARD_CAP_BYTES,
  buildAndAttachHistoryContext,
  buildHistoryContext,
  historyContextHash,
  trimHistoryContextForAi,
  type HistoryContextPack
} from "./historyContext.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readFixture(name: "trend_up" | "range" | "trend_down"): Candle[] {
  const path = join(__dirname, "fixtures", "history-context", `${name}.json`);
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as Candle[];
}

function makeCandles(params: {
  count: number;
  startTs?: number;
  stepMs?: number;
  startPrice?: number;
  driftPerBar?: number;
  waveAmp?: number;
}): Candle[] {
  const count = Math.max(2, Math.trunc(params.count));
  const startTs = Number.isFinite(params.startTs) ? Number(params.startTs) : 1_771_000_000_000;
  const stepMs = Number.isFinite(params.stepMs) ? Number(params.stepMs) : 5 * 60 * 1000;
  const startPrice = Number.isFinite(params.startPrice) ? Number(params.startPrice) : 70_000;
  const driftPerBar = Number.isFinite(params.driftPerBar) ? Number(params.driftPerBar) : 2.5;
  const waveAmp = Number.isFinite(params.waveAmp) ? Number(params.waveAmp) : 18;

  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const ts = startTs + i * stepMs;
    const base = startPrice + i * driftPerBar + Math.sin(i / 5) * waveAmp;
    const open = base;
    const close = base + Math.cos(i / 3) * (waveAmp / 3);
    const high = Math.max(open, close) + 4.2 + ((i % 4) * 0.7);
    const low = Math.min(open, close) - 4.1 - ((i % 3) * 0.6);
    const volume = 1000 + (i % 17) * 22.5;
    candles.push({
      ts,
      open: Number(open.toFixed(8)),
      high: Number(high.toFixed(8)),
      low: Number(low.toFixed(8)),
      close: Number(close.toFixed(8)),
      volume: Number(volume.toFixed(8))
    });
  }
  return candles;
}

function advancedMock() {
  return {
    emas: {
      ema_5: 70110,
      ema_13: 70092,
      ema_50: 70040,
      ema_200: 69780,
      ema_800: 68110,
      emaStack: { bullishStack: true, bearishStack: false },
      emaDistancesPct: {
        price_vs_50_pct: 0.6,
        price_vs_200_pct: 1.2,
        price_vs_800_pct: 3.1,
        spread_13_50_pct: 0.074,
        spread_50_200_pct: 0.372,
        spread_200_800_pct: 1.55
      },
      emaSlopesPct: {
        slope_50_pct_1bar: 0.03,
        slope_200_pct_1bar: 0.01,
        slope_800_pct_1bar: 0.005
      }
    },
    smartMoneyConcepts: {
      internal: {
        trend: "bullish",
        lastEvent: { type: "bos", direction: "bullish", level: 70020, ts: 1_739_085_600_000 },
        bullishBreaks: 4,
        bearishBreaks: 1
      },
      swing: {
        trend: "bullish",
        lastEvent: { type: "choch", direction: "bullish", level: 69980, ts: 1_739_085_900_000 },
        bullishBreaks: 2,
        bearishBreaks: 1
      },
      orderBlocks: {
        internal: { bullishCount: 2, bearishCount: 1, latestBullish: null, latestBearish: null },
        swing: { bullishCount: 1, bearishCount: 0, latestBullish: null, latestBearish: null }
      },
      fairValueGaps: {
        bullishCount: 2,
        bearishCount: 1,
        latestBullish: { top: 70120, bottom: 70080, ts: 1_739_086_200_000 },
        latestBearish: { top: 69950, bottom: 69910, ts: 1_739_084_200_000 },
        autoThresholdPct: 0.04
      },
      zones: {
        trailingTop: 70140,
        trailingBottom: 69510,
        premiumTop: 70140,
        premiumBottom: 70008.5,
        equilibriumTop: 69840.75,
        equilibriumBottom: 69809.25,
        discountTop: 69641.5,
        discountBottom: 69510
      },
      dataGap: false
    }
  };
}

function assertNoNaN(value: unknown): void {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoNaN(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    assertNoNaN(nested);
  }
}

function assertApprox(actual: number | null, expected: number | null, tolerance = 0.0002): void {
  if (actual === null || expected === null) {
    assert.equal(actual, expected);
    return;
  }
  assert.equal(Math.abs(actual - expected) <= tolerance, true);
}

test("buildHistoryContext creates v1 compact schema deterministically", () => {
  const candles = makeCandles({ count: 900, driftPerBar: 3.2, waveAmp: 25 });
  const indicators = {
    adx: { adx_14: 27.5 },
    volume: { vol_z: 2.1, rel_vol: 1.92, vol_trend: 11.58 },
    fvg: {
      open_bullish_count: 1,
      open_bearish_count: 0,
      nearest_bullish_gap: { mid: 70100, dist_pct: 0.12, age_bars: 4 },
      nearest_bearish_gap: { mid: null, dist_pct: null, age_bars: null }
    }
  };
  const advanced = advancedMock();

  const one = buildHistoryContext({
    candles,
    timeframe: "5m",
    indicators: indicators as any,
    advancedIndicators: advanced as any
  });
  const two = buildHistoryContext({
    candles,
    timeframe: "5m",
    indicators: indicators as any,
    advancedIndicators: advanced as any
  });

  assert.deepEqual(one, two);
  assert.equal(one.v, 1);
  assert.equal(one.tf, "5m");
  assert.ok(one.lastBars.n <= 30);
  assert.ok(one.ev.length <= 30);
  assert.equal(typeof one.win.w20.ret === "number" || one.win.w20.ret === null, true);
  assert.equal(typeof one.reg.state, "string");
  assert.ok(one.bud.bytes <= HISTORY_CONTEXT_HARD_CAP_BYTES);
  assertNoNaN(one);
});

test("buildHistoryContext handles insufficient candles with null-safe output", () => {
  const candles = makeCandles({ count: 8, driftPerBar: 0.1, waveAmp: 0.4 });
  const ctx = buildHistoryContext({
    candles,
    timeframe: "5m",
    indicators: null,
    advancedIndicators: null
  });

  assert.equal(ctx.v, 1);
  assert.equal(ctx.lastBars.n, 8);
  assert.equal(ctx.win.w20.ret, null);
  assert.equal(ctx.win.w50.ret, null);
  assert.equal(ctx.ema.e200 === null || typeof ctx.ema.e200 === "number", true);
  assertNoNaN(ctx);
});

test("regime since changes deterministically when market transitions", () => {
  const trendCandles = makeCandles({ count: 360, driftPerBar: 70, waveAmp: 2 });
  const trendCtx = buildHistoryContext({
    candles: trendCandles,
    timeframe: "5m",
    indicators: { adx: { adx_14: 32 } } as any,
    advancedIndicators: advancedMock() as any
  });

  const rangeCandles = makeCandles({ count: 360, driftPerBar: 0.01, waveAmp: 0.8 });
  const rangeCtx = buildHistoryContext({
    candles: rangeCandles,
    timeframe: "5m",
    indicators: { adx: { adx_14: 10 } } as any,
    advancedIndicators: advancedMock() as any,
    existingContext: trendCtx
  });

  assert.notEqual(trendCtx.reg.state, "unknown");
  assert.equal(rangeCtx.reg.state, "range");
  assert.equal(typeof rangeCtx.reg.since, "string");
});

test("trimHistoryContextForAi enforces hard limits and budget trim flags", () => {
  const base = buildHistoryContext({
    candles: makeCandles({ count: 1000, driftPerBar: 4.2, waveAmp: 22 }),
    timeframe: "5m",
    indicators: { adx: { adx_14: 28 } } as any,
    advancedIndicators: advancedMock() as any
  });

  const inflated: HistoryContextPack = {
    ...base,
    ev: Array.from({ length: 40 }, (_, idx) => ({
      t: new Date(1_771_000_000_000 + (idx * 60_000)).toISOString(),
      ty: `event_${idx}`,
      sd: idx % 2 === 0 ? "bull" : "bear",
      k: "wick",
      p: 70000 + idx,
      i: 3
    })),
    lastBars: {
      n: 40,
      ohlc: Array.from({ length: 40 }, (_, idx) => ({
        t: 1_771_000_000 + idx,
        o: 70000,
        h: 70010,
        l: 69990,
        c: 70005,
        v: 123.45
      }))
    }
  };

  const trimmed = trimHistoryContextForAi(inflated, {
    maxEvents: 30,
    lastBars: 30,
    maxBytes: 2048
  });

  const bytes = Buffer.byteLength(JSON.stringify(trimmed), "utf8");
  assert.ok(bytes <= 2048);
  assert.ok(trimmed.ev.length <= 30);
  assert.ok(trimmed.lastBars.n <= 30);
  assert.ok(trimmed.bud.trim.length > 0);
  assertNoNaN(trimmed);
});

test("golden fixtures produce stable history context snapshots within tolerance", () => {
  const expected = {
    trend_up: {
      state: "range",
      stk: "bull",
      conf: 15.23,
      d50: 0.2786,
      d200: 1.1934,
      sl50: 0.0114,
      sl200: 0.012,
      w20ret: 0.2022,
      w50ret: 0.6051,
      w200ret: 2.4235,
      w800ret: 10.6748
    },
    range: {
      state: "range",
      stk: "none",
      conf: 5.51,
      d50: -0.0266,
      d200: -0.0282,
      sl50: -0.0011,
      sl200: -0.0003,
      w20ret: -0.0612,
      w50ret: -0.0005,
      w200ret: -0.0629,
      w800ret: 0.0265
    },
    trend_down: {
      state: "range",
      stk: "bear",
      conf: 15.3,
      d50: -0.3121,
      d200: -1.2043,
      sl50: -0.0127,
      sl200: -0.0121,
      w20ret: -0.2806,
      w50ret: -0.5999,
      w200ret: -2.3965,
      w800ret: -8.7876
    }
  } as const;

  for (const fixtureName of ["trend_up", "range", "trend_down"] as const) {
    const candles = readFixture(fixtureName);
    const ctx = buildHistoryContext({
      candles,
      timeframe: "5m",
      indicators: { adx: { adx_14: fixtureName === "range" ? 13 : 28 } } as any,
      advancedIndicators: null
    });
    const exp = expected[fixtureName];

    assert.equal(ctx.reg.state, exp.state);
    assert.equal(ctx.ema.stk, exp.stk);
    assertApprox(ctx.reg.conf, exp.conf, 0.01);
    assertApprox(ctx.ema.d50, exp.d50, 0.0003);
    assertApprox(ctx.ema.d200, exp.d200, 0.0003);
    assertApprox(ctx.ema.sl50, exp.sl50, 0.0003);
    assertApprox(ctx.ema.sl200, exp.sl200, 0.0003);
    assertApprox(ctx.win.w20.ret, exp.w20ret, 0.0003);
    assertApprox(ctx.win.w50.ret, exp.w50ret, 0.0003);
    assertApprox(ctx.win.w200.ret, exp.w200ret, 0.0003);
    assertApprox(ctx.win.w800.ret, exp.w800ret, 0.0003);

    assert.equal(ctx.lastBars.n <= 30, true);
    assert.equal(ctx.ev.length <= 30, true);
    assert.equal(ctx.bud.bytes <= HISTORY_CONTEXT_HARD_CAP_BYTES, true);
  }
});

test("fixture contexts remain deterministic and under budget caps", () => {
  for (const fixtureName of ["trend_up", "range", "trend_down"] as const) {
    const candles = readFixture(fixtureName);
    const one = buildHistoryContext({
      candles,
      timeframe: "5m",
      indicators: null,
      advancedIndicators: null,
      options: { maxEvents: 30, lastBars: 30, maxBytes: 8192 }
    });
    const two = buildHistoryContext({
      candles,
      timeframe: "5m",
      indicators: null,
      advancedIndicators: null,
      options: { maxEvents: 30, lastBars: 30, maxBytes: 8192 }
    });

    assert.deepEqual(one, two);
    assert.equal(one.ev.length <= 30, true);
    assert.equal(one.lastBars.n <= 30, true);
    assert.equal(one.bud.bytes <= 8192, true);
  }
});

test("buildAndAttachHistoryContext attaches + upserts and skips write on unchanged hash", async () => {
  const candles = makeCandles({ count: 140, driftPerBar: 2.2, waveAmp: 6 });
  const featureSnapshot: Record<string, unknown> = {};
  const upserts: unknown[] = [];

  const dbInitial = {
    marketContextSnapshot: {
      findUnique: async () => null,
      upsert: async (args: unknown) => {
        upserts.push(args);
        return { id: "ctx_1" };
      }
    }
  };

  const first = await buildAndAttachHistoryContext({
    db: dbInitial,
    featureSnapshot,
    candles,
    timeframe: "5m",
    indicators: { adx: { adx_14: 24 } } as any,
    advancedIndicators: advancedMock() as any,
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    options: {
      maxEvents: 30,
      lastBars: 30,
      maxBytes: 8192
    }
  });

  assert.equal(upserts.length, 1);
  assert.equal((featureSnapshot.historyContext as any)?.v, 1);

  const prevHash = historyContextHash(first!);
  const dbSame = {
    marketContextSnapshot: {
      findUnique: async () => ({
        payload: first,
        contextHash: prevHash,
        tsTo: new Date(first!.ts_to)
      }),
      upsert: async (args: unknown) => {
        upserts.push(args);
        return { id: "ctx_2" };
      }
    }
  };

  await buildAndAttachHistoryContext({
    db: dbSame,
    featureSnapshot: {},
    candles,
    timeframe: "5m",
    indicators: { adx: { adx_14: 24 } } as any,
    advancedIndicators: advancedMock() as any,
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    options: {
      maxEvents: 30,
      lastBars: 30,
      maxBytes: 8192
    }
  });

  assert.equal(upserts.length, 1);
});
