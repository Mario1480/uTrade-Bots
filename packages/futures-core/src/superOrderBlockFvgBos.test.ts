import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSuperOrderBlockFvgBosOverlay,
  computeSuperOrderBlockFvgBosSnapshot,
  defaultSuperOrderBlockFvgBosSettings,
  normalizeSuperOrderBlockFvgBosSettings,
  superOrderBlockFvgBosEventKeys,
  type SuperOrderBlockFvgBosCandle
} from "./superOrderBlockFvgBos.js";

function buildCandles(count: number, tfMs = 5 * 60 * 1000): SuperOrderBlockFvgBosCandle[] {
  const out: SuperOrderBlockFvgBosCandle[] = [];
  const start = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  let price = 100;

  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 7) * 1.2 + Math.cos(i / 13) * 0.8;
    price = Math.max(1, price + 0.15 + (wave * 0.2));
    const open = price - (i % 2 === 0 ? 0.5 : -0.25);
    const close = price + (i % 2 === 0 ? 0.25 : -0.45);
    const high = Math.max(open, close) + 0.6;
    const low = Math.min(open, close) - 0.6;
    out.push({
      ts: start + (i * tfMs),
      open,
      high,
      low,
      close,
      volume: 100 + ((i * 11) % 70)
    });
  }

  // Force deterministic OB/FVG events near the end.
  if (out.length >= 6) {
    const i = out.length - 1;
    out[i - 2] = {
      ...out[i - 2],
      open: 110,
      close: 108,
      high: 111,
      low: 107,
      volume: 120
    };
    out[i - 1] = {
      ...out[i - 1],
      open: 108,
      close: 112,
      high: 113,
      low: 107.5,
      volume: 320
    };
    out[i] = {
      ...out[i],
      open: 112,
      close: 114,
      high: 115,
      low: 112.5,
      volume: 450
    };
  }

  return out;
}

test("superOrderBlockFvgBos snapshot exposes event keys and dataGap on short history", () => {
  const snapshot = computeSuperOrderBlockFvgBosSnapshot(buildCandles(10));
  assert.equal(snapshot.dataGap, true);

  for (const key of superOrderBlockFvgBosEventKeys()) {
    assert.equal(typeof snapshot.events[key], "boolean");
    assert.equal(typeof snapshot.eventCounts[key], "number");
  }
});

test("superOrderBlockFvgBos overlay yields rectangles, pivots and hvb hints", () => {
  const candles = buildCandles(180);
  const overlay = computeSuperOrderBlockFvgBosOverlay(candles, {
    plotRJB: true,
    plotBOS: true,
    plotPPDD: true,
    plotOBFVG: true,
    hvbEMAPeriod: 8,
    hvbMultiplier: 1.1,
    pivotLookup: 1
  });

  assert.equal(overlay.dataGap, false);
  assert.equal(overlay.pivotTop.length, candles.length);
  assert.equal(overlay.pivotBottom.length, candles.length);
  assert.equal(overlay.hvbColors.length, candles.length);
  assert.equal(Array.isArray(overlay.rectangles), true);
  assert.equal(Array.isArray(overlay.markers), true);
  assert.equal(overlay.rectangles.some((zone) => zone.type === "ob"), true);
  assert.equal(overlay.eventCounts.obBull >= 1 || overlay.eventCounts.obBear >= 1, true);
});

test("superOrderBlockFvgBos settings normalization clamps unsafe values", () => {
  const defaults = defaultSuperOrderBlockFvgBosSettings();
  const normalized = normalizeSuperOrderBlockFvgBosSettings({
    obMaxBoxSet: 999,
    fvgMaxBoxSet: 0,
    bosBoxLength: 99,
    hvbMultiplier: -10,
    obBoxBorderStyle: "line.style_dotted" as unknown as any,
    obLabelSize: "size.huge" as unknown as any,
    obBullColor: "",
    plotOB: false
  });

  assert.equal(normalized.obMaxBoxSet, 100);
  assert.equal(normalized.fvgMaxBoxSet, 1);
  assert.equal(normalized.bosBoxLength, 5);
  assert.equal(normalized.hvbMultiplier, 1);
  assert.equal(normalized.obBoxBorderStyle, "dotted");
  assert.equal(normalized.obLabelSize, "huge");
  assert.equal(normalized.obBullColor, defaults.obBullColor);
  assert.equal(normalized.plotOB, false);
});
