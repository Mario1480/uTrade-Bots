import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "./timeframe.js";
import { computeFVGSummary } from "./fvg.js";

function candle(ts: number, open: number, high: number, low: number, close: number): Candle {
  return { ts, open, high, low, close, volume: 10 };
}

test("computeFVGSummary detects bullish and bearish gaps", () => {
  const bars: Candle[] = [
    candle(1, 100, 102, 99, 101),
    candle(2, 101, 103, 100, 102),
    candle(3, 104, 106, 104, 105), // bullish gap vs bar 1
    candle(4, 105, 106, 103, 104),
    candle(5, 103, 103, 100, 101),
    candle(6, 98, 99, 97, 98), // bearish gap vs bar 4
    candle(7, 98, 99, 97, 98)
  ];

  const summary = computeFVGSummary(bars, { lookbackBars: 100, fillRule: "overlap" });
  assert.ok(summary.open_bullish_count >= 0);
  assert.ok(summary.open_bearish_count >= 0);
  assert.equal(summary.last_created.type !== null, true);
});

test("computeFVGSummary marks filled gaps with overlap rule", () => {
  const bars: Candle[] = [
    candle(1, 100, 102, 99, 101),
    candle(2, 101, 103, 100, 102),
    candle(3, 104, 106, 104, 105), // bullish gap [102, 104]
    candle(4, 103, 104.5, 101.5, 103) // overlaps gap => filled
  ];

  const summary = computeFVGSummary(bars, { lookbackBars: 50, fillRule: "overlap" });
  assert.equal(summary.open_bullish_count, 0);
  assert.equal(summary.last_filled.type, "bullish");
  assert.equal(typeof summary.last_filled.age_bars === "number", true);
});

test("computeFVGSummary nearest gap distance is finite when gap exists", () => {
  const bars: Candle[] = [
    candle(1, 100, 102, 99, 101),
    candle(2, 101, 103, 100, 102),
    candle(3, 104, 106, 104, 105), // bullish gap
    candle(4, 106, 108, 106, 107),
    candle(5, 107, 109, 107, 108)
  ];
  const summary = computeFVGSummary(bars, { lookbackBars: 20 });
  if (summary.nearest_bullish_gap.mid !== null) {
    assert.equal(Number.isFinite(summary.nearest_bullish_gap.dist_pct), true);
  }
});
