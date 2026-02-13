import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../timeframe.js";
import { computeSmartMoneyConcepts } from "./smartMoneyConcepts.js";

function buildCandles(count: number, tfMs = 5 * 60 * 1000): Candle[] {
  const out: Candle[] = [];
  const start = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const drift = i > count * 0.7 ? 0.2 : 0.03;
    const wave = Math.sin(i / 9) * 0.5 + Math.cos(i / 21) * 0.35;
    price = Math.max(1, price + drift + wave * 0.08);
    const open = price - 0.22;
    const close = price + 0.24;
    const high = Math.max(open, close) + 0.42;
    const low = Math.min(open, close) - 0.41;
    out.push({
      ts: start + i * tfMs,
      open,
      high,
      low,
      close,
      volume: 100 + (i % 13) * 8
    });
  }
  return out;
}

test("smartMoneyConcepts returns dataGap on insufficient history", () => {
  const snapshot = computeSmartMoneyConcepts(buildCandles(20));
  assert.equal(snapshot.dataGap, true);
  assert.equal(snapshot.internal.trend, "neutral");
  assert.equal(snapshot.swing.lastEvent.type, null);
});

test("smartMoneyConcepts computes structure/order blocks/zones on sufficient history", () => {
  const snapshot = computeSmartMoneyConcepts(buildCandles(700));

  assert.equal(snapshot.dataGap, false);
  assert.ok(snapshot.internal.bullishBreaks + snapshot.internal.bearishBreaks >= 1);
  assert.ok(snapshot.swing.bullishBreaks + snapshot.swing.bearishBreaks >= 0);
  assert.ok(
    snapshot.swing.trend === "bullish" ||
    snapshot.swing.trend === "bearish" ||
    snapshot.swing.trend === "neutral"
  );

  assert.ok(snapshot.orderBlocks.internal.bullishCount >= 0);
  assert.ok(snapshot.orderBlocks.internal.bearishCount >= 0);
  assert.ok(snapshot.orderBlocks.swing.bullishCount >= 0);
  assert.ok(snapshot.orderBlocks.swing.bearishCount >= 0);

  assert.ok(snapshot.fairValueGaps.bullishCount >= 0);
  assert.ok(snapshot.fairValueGaps.bearishCount >= 0);

  if (
    snapshot.zones.trailingTop !== null &&
    snapshot.zones.trailingBottom !== null &&
    snapshot.zones.premiumBottom !== null &&
    snapshot.zones.discountTop !== null
  ) {
    assert.ok(snapshot.zones.trailingTop > snapshot.zones.trailingBottom);
    assert.ok(snapshot.zones.premiumBottom > snapshot.zones.discountTop);
  }
});

test("smartMoneyConcepts equal-level threshold can be tuned", () => {
  const candles = buildCandles(250);
  const tight = computeSmartMoneyConcepts(candles, { equalThreshold: 0.01 });
  const loose = computeSmartMoneyConcepts(candles, { equalThreshold: 0.5 });

  const tightHits = Number(tight.equalLevels.eqh.detected) + Number(tight.equalLevels.eql.detected);
  const looseHits = Number(loose.equalLevels.eqh.detected) + Number(loose.equalLevels.eql.detected);

  assert.ok(looseHits >= tightHits);
});
