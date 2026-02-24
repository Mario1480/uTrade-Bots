import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../timeframe.js";
import { computeLiquiditySweeps } from "./liquiditySweeps.js";

function makeCandles(rows: Array<{ high: number; low: number; close: number }>): Candle[] {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  return rows.map((row, index) => ({
    ts: start + (index * 5 * 60 * 1000),
    open: row.close,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: 100 + index
  }));
}

test("liquiditySweeps detects bearish wick sweep", () => {
  const candles = makeCandles([
    { high: 100, low: 95, close: 98 },
    { high: 102, low: 96, close: 100 },
    { high: 105, low: 98, close: 103 },
    { high: 110, low: 100, close: 108 },
    { high: 106, low: 99, close: 104 },
    { high: 104, low: 98, close: 102 },
    { high: 108, low: 99, close: 107 },
    { high: 112, low: 101, close: 109 },
    { high: 109, low: 100, close: 106 }
  ]);

  const snapshot = computeLiquiditySweeps(candles, "5m", {
    len: 2,
    mode: "wicks",
    maxBars: 20
  });

  assert.equal(snapshot.lastEvent?.kind, "wick");
  assert.equal(snapshot.lastEvent?.side, "bear");
  assert.ok((snapshot.activeZones.bearishCount + snapshot.activeZones.bullishCount) >= 1);
});

test("liquiditySweeps detects bullish outbreak retest sweep", () => {
  const candles = makeCandles([
    { high: 101, low: 97, close: 99 },
    { high: 100, low: 95, close: 97 },
    { high: 98, low: 93, close: 95 },
    { high: 96, low: 90, close: 92 },
    { high: 99, low: 93, close: 95 },
    { high: 100, low: 94, close: 97 },
    { high: 97, low: 88, close: 89 },
    { high: 99, low: 91, close: 94 },
    { high: 100, low: 92, close: 96 }
  ]);

  const snapshot = computeLiquiditySweeps(candles, "5m", {
    len: 2,
    mode: "outbreak_retest",
    maxBars: 20
  });

  assert.equal(snapshot.lastEvent?.kind, "outbreak_retest");
  assert.equal(snapshot.lastEvent?.side, "bull");
});

test("liquiditySweeps mode filter applies correctly", () => {
  const wickCandles = makeCandles([
    { high: 100, low: 95, close: 98 },
    { high: 102, low: 96, close: 100 },
    { high: 105, low: 98, close: 103 },
    { high: 110, low: 100, close: 108 },
    { high: 106, low: 99, close: 104 },
    { high: 104, low: 98, close: 102 },
    { high: 108, low: 99, close: 107 },
    { high: 112, low: 101, close: 109 }
  ]);

  const wickOnly = computeLiquiditySweeps(wickCandles, "5m", {
    len: 2,
    mode: "wicks"
  });
  const retestOnly = computeLiquiditySweeps(wickCandles, "5m", {
    len: 2,
    mode: "outbreak_retest"
  });

  assert.equal(wickOnly.recentEvents.some((event) => event.kind === "wick"), true);
  assert.equal(retestOnly.recentEvents.some((event) => event.kind === "wick"), false);
});

test("liquiditySweeps enforces recent events and active zone caps", () => {
  const candles = makeCandles([
    { high: 100, low: 95, close: 98 },
    { high: 102, low: 96, close: 100 },
    { high: 105, low: 98, close: 103 },
    { high: 110, low: 100, close: 108 },
    { high: 106, low: 99, close: 104 },
    { high: 104, low: 98, close: 102 },
    { high: 111, low: 100, close: 109 },
    { high: 112, low: 101, close: 109 },
    { high: 113, low: 101, close: 108 },
    { high: 114, low: 101, close: 107 }
  ]);

  const snapshot = computeLiquiditySweeps(candles, "5m", {
    len: 2,
    mode: "wicks",
    maxBars: 50,
    maxRecentEvents: 1,
    maxActiveZones: 1
  });

  assert.equal(snapshot.recentEvents.length, 1);
  assert.ok((snapshot.activeZones.bullishCount + snapshot.activeZones.bearishCount) <= 1);
});

test("liquiditySweeps extend influences zone lifetime", () => {
  const candles = makeCandles([
    { high: 101, low: 97, close: 99 },
    { high: 100, low: 95, close: 97 },
    { high: 98, low: 93, close: 95 },
    { high: 96, low: 90, close: 92 },
    { high: 99, low: 93, close: 95 },
    { high: 100, low: 94, close: 97 },
    { high: 97, low: 88, close: 89 },
    { high: 99, low: 91, close: 94 },
    { high: 99, low: 89, close: 93 },
    { high: 101, low: 92, close: 96 }
  ]);

  const noExtend = computeLiquiditySweeps(candles, "5m", {
    len: 2,
    mode: "outbreak_retest",
    maxBars: 1,
    extend: false
  });
  const withExtend = computeLiquiditySweeps(candles, "5m", {
    len: 2,
    mode: "outbreak_retest",
    maxBars: 1,
    extend: true
  });

  const zoneCountNoExtend = noExtend.activeZones.bullishCount + noExtend.activeZones.bearishCount;
  const zoneCountWithExtend = withExtend.activeZones.bullishCount + withExtend.activeZones.bearishCount;
  assert.ok(zoneCountWithExtend >= zoneCountNoExtend);
});

test("liquiditySweeps returns null nearest distances when no zones exist", () => {
  const candles = makeCandles([
    { high: 100, low: 99, close: 99.5 },
    { high: 100.2, low: 99.1, close: 99.6 },
    { high: 100.1, low: 99.2, close: 99.5 },
    { high: 100.3, low: 99.1, close: 99.4 },
    { high: 100.2, low: 99.2, close: 99.5 },
    { high: 100.1, low: 99.3, close: 99.4 },
    { high: 100.0, low: 99.4, close: 99.5 }
  ]);

  const snapshot = computeLiquiditySweeps(candles, "5m", {
    len: 2,
    mode: "wicks",
    maxBars: 20
  });

  assert.equal(snapshot.lastEvent, null);
  assert.equal(snapshot.nearestBullDistPct, null);
  assert.equal(snapshot.nearestBearDistPct, null);
});
