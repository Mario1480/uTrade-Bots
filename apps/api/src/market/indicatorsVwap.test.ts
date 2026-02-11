import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionVwapCache,
  computeRollingVWAP,
  computeSessionVWAP
} from "./indicatorsVwap.js";
import type { Candle } from "./timeframe.js";

function candle(
  ts: number,
  high: number,
  low: number,
  close: number,
  volume: number
): Candle {
  return {
    ts,
    open: close,
    high,
    low,
    close,
    volume
  };
}

test.beforeEach(() => {
  clearSessionVwapCache();
});

test("session boundary resets at UTC midnight", () => {
  const d1_2355 = Date.UTC(2026, 1, 10, 23, 55, 0, 0);
  const d2_0000 = Date.UTC(2026, 1, 11, 0, 0, 0, 0);
  const d2_0005 = Date.UTC(2026, 1, 11, 0, 5, 0, 0);
  const candles: Candle[] = [
    candle(d1_2355, 101, 99, 100, 10),
    candle(d2_0000, 103, 97, 100, 2),
    candle(d2_0005, 113, 107, 110, 3)
  ];

  const result = computeSessionVWAP(candles, "5m", {
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    logMetrics: false
  });

  const expected = ((100 * 2) + (110 * 3)) / 5;
  assert.equal(result.sessionStartUtcMs, d2_0000);
  assert.ok(result.value !== null);
  assert.ok(Math.abs(result.value - expected) < 1e-9);
});

test("vwap correctness on handcrafted candles", () => {
  const base = Date.UTC(2026, 1, 11, 10, 0, 0, 0);
  const candles: Candle[] = [
    candle(base, 11, 9, 10, 2), // tp=10
    candle(base + 5 * 60_000, 15, 9, 12, 3), // tp=12
    candle(base + 10 * 60_000, 19, 11, 15, 5) // tp=15
  ];

  const result = computeSessionVWAP(candles, "5m", {
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    logMetrics: false
  });
  const expected = ((10 * 2) + (12 * 3) + (15 * 5)) / 10;
  assert.ok(result.value !== null);
  assert.ok(Math.abs(result.value - expected) < 1e-9);
});

test("cache hit on repeated call and miss when latest bucket changes", () => {
  const base = Date.UTC(2026, 1, 11, 10, 0, 0, 0);
  const candles: Candle[] = [
    candle(base, 11, 9, 10, 2),
    candle(base + 5 * 60_000, 15, 9, 12, 3)
  ];

  const first = computeSessionVWAP(candles, "5m", {
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    cacheTtlMs: 60_000,
    logMetrics: false
  });
  const second = computeSessionVWAP(candles, "5m", {
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    cacheTtlMs: 60_000,
    logMetrics: false
  });
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);

  const third = computeSessionVWAP(
    [...candles, candle(base + 10 * 60_000, 14, 10, 13, 4)],
    "5m",
    {
      exchange: "bitget",
      symbol: "BTCUSDT",
      marketType: "perp",
      cacheTtlMs: 60_000,
      logMetrics: false
    }
  );
  assert.equal(third.cacheHit, false);
});

test("zero-volume session returns null and reason", () => {
  const base = Date.UTC(2026, 1, 11, 10, 0, 0, 0);
  const candles: Candle[] = [
    candle(base, 11, 9, 10, 0),
    candle(base + 5 * 60_000, 15, 9, 12, 0)
  ];

  const result = computeSessionVWAP(candles, "5m", {
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    logMetrics: false
  });

  assert.equal(result.value, null);
  assert.equal(result.vwapNullReason, "zero_volume");
  assert.equal(result.dataGap, true);
});

test("rolling VWAP(20) returns deterministic value", () => {
  const base = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
  const candles: Candle[] = [
    candle(base, 11, 9, 10, 2),
    candle(base + 24 * 60 * 60 * 1000, 15, 9, 12, 3),
    candle(base + 2 * 24 * 60 * 60 * 1000, 19, 11, 15, 5)
  ];

  const value = computeRollingVWAP(candles, 20);
  const expected = ((10 * 2) + (12 * 3) + (15 * 5)) / 10;
  assert.ok(value !== null);
  assert.ok(Math.abs(value - expected) < 1e-9);
});
