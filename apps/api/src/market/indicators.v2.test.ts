import assert from "node:assert/strict";
import test from "node:test";
import { computeIndicators, type Candle } from "./indicators.js";
import { computeFVGSummary } from "./fvg.js";

function buildCandles(count: number, tfMs = 5 * 60 * 1000, constantVolume = false): Candle[] {
  const out: Candle[] = [];
  const start = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 8) * 0.65 + Math.cos(i / 15) * 0.45;
    price = Math.max(1, price + 0.2 + wave * 0.13);
    const open = price - 0.25;
    const close = price + 0.25;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    out.push({
      ts: start + i * tfMs,
      open,
      high,
      low,
      close,
      volume: constantVolume ? 100 : 100 + (i % 10) * 7
    });
  }
  return out;
}

test("stochrsi values are bounded in [0,100]", () => {
  const indicators = computeIndicators(buildCandles(360), "5m");
  assert.ok(indicators.stochrsi.k !== null);
  assert.ok(indicators.stochrsi.d !== null);
  assert.ok(indicators.stochrsi.k! >= 0 && indicators.stochrsi.k! <= 100);
  assert.ok(indicators.stochrsi.d! >= 0 && indicators.stochrsi.d! <= 100);
});

test("volume features are stable on constant volume", () => {
  const indicators = computeIndicators(buildCandles(360, 5 * 60 * 1000, true), "5m");
  assert.equal(indicators.volume.rel_vol, 1);
  assert.equal(indicators.volume.vol_z, 0);
});

test("fvg summary detects and fills known gap fixtures", () => {
  const bars: Candle[] = [
    { ts: 1, open: 100, high: 102, low: 99, close: 101, volume: 100 },
    { ts: 2, open: 101, high: 103, low: 100, close: 102, volume: 100 },
    { ts: 3, open: 104, high: 106, low: 104, close: 105, volume: 100 }, // bullish gap vs ts 1
    { ts: 4, open: 103, high: 104.2, low: 101.8, close: 103, volume: 100 } // overlap fill
  ];
  const summary = computeFVGSummary(bars, { lookbackBars: 50, fillRule: "overlap" });
  assert.equal(summary.last_created.type, "bullish");
  assert.equal(summary.last_filled.type, "bullish");
  assert.equal(summary.open_bullish_count, 0);
});

test("computeIndicators v2 emits finite nested values", () => {
  const indicators = computeIndicators(buildCandles(360), "1h");
  const values = [
    indicators.stochrsi.k,
    indicators.stochrsi.d,
    indicators.stochrsi.value,
    indicators.volume.rel_vol,
    indicators.volume.vol_z,
    indicators.volume.vol_ema_fast,
    indicators.volume.vol_ema_slow,
    indicators.volume.vol_trend,
    indicators.fvg.nearest_bullish_gap.dist_pct,
    indicators.fvg.nearest_bearish_gap.dist_pct
  ];
  for (const value of values) {
    assert.ok(value === null || Number.isFinite(value));
  }
});
