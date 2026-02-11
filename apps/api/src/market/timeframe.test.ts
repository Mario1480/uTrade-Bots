import assert from "node:assert/strict";
import test from "node:test";
import {
  bucketCandles,
  bucketCandlesWithMeta,
  toBucketStart,
  type Candle
} from "./timeframe.js";

test("toBucketStart aligns timestamps to timeframe boundaries", () => {
  const ts = Date.UTC(2026, 1, 10, 13, 7, 42, 111);
  assert.equal(toBucketStart(ts, "5m"), Date.UTC(2026, 1, 10, 13, 5, 0, 0));
  assert.equal(toBucketStart(ts, "15m"), Date.UTC(2026, 1, 10, 13, 0, 0, 0));
  assert.equal(toBucketStart(ts, "1h"), Date.UTC(2026, 1, 10, 13, 0, 0, 0));
  assert.equal(toBucketStart(ts, "4h"), Date.UTC(2026, 1, 10, 12, 0, 0, 0));
});

test("bucketCandles aligns off-boundary candles and keeps last candle per bucket", () => {
  const candles: Candle[] = [
    { ts: Date.UTC(2026, 1, 10, 0, 1, 0, 0), open: 1, high: 2, low: 1, close: 1.1, volume: 10 },
    { ts: Date.UTC(2026, 1, 10, 0, 4, 0, 0), open: 1, high: 2, low: 1, close: 1.4, volume: 12 },
    { ts: Date.UTC(2026, 1, 10, 0, 6, 0, 0), open: 2, high: 3, low: 2, close: 2.2, volume: 9 }
  ];

  const bucketed = bucketCandles(candles, "5m");
  assert.equal(bucketed.length, 2);
  assert.equal(bucketed[0].ts, Date.UTC(2026, 1, 10, 0, 0, 0, 0));
  assert.equal(bucketed[1].ts, Date.UTC(2026, 1, 10, 0, 5, 0, 0));
  assert.equal(bucketed[0].close, 1.4);
  assert.equal(bucketed[1].close, 2.2);

  const meta = bucketCandlesWithMeta(candles, "5m");
  assert.equal(meta.candleBucketed, true);
  assert.equal(meta.bucketMismatchCount, 3);
});
