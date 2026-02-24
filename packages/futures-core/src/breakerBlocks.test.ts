import assert from "node:assert/strict";
import test from "node:test";
import {
  breakerBlocksSignalKeys,
  computeBreakerBlocksOverlay,
  computeBreakerBlocksSnapshot,
  defaultBreakerBlocksSettings,
  type BreakerBlocksCandle
} from "./breakerBlocks.js";

function buildCandles(count: number, tfMs = 5 * 60 * 1000): BreakerBlocksCandle[] {
  const out: BreakerBlocksCandle[] = [];
  const start = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 8) * 0.8 + Math.cos(i / 17) * 0.35;
    price = Math.max(1, price + 0.08 + wave * 0.2);
    const open = price - 0.22;
    const close = price + 0.18;
    const high = Math.max(open, close) + 0.42;
    const low = Math.min(open, close) - 0.44;
    out.push({
      ts: start + (i * tfMs),
      open,
      high,
      low,
      close,
      volume: 100 + (i % 13) * 7
    });
  }
  return out;
}

test("breakerBlocks snapshot exposes all signal keys and dataGap on short history", () => {
  const snapshot = computeBreakerBlocksSnapshot(buildCandles(40));
  assert.equal(snapshot.dataGap, true);

  const signalKeys = breakerBlocksSignalKeys();
  assert.equal(Object.keys(snapshot.signals).length, signalKeys.length);
  for (const key of signalKeys) {
    assert.equal(typeof snapshot.signals[key], "boolean");
    assert.equal(typeof snapshot.eventCounts[key], "number");
  }
});

test("breakerBlocks overlay series align with candle count", () => {
  const candles = buildCandles(520);
  const overlay = computeBreakerBlocksOverlay(candles, {
    enableTp: true,
    showSPD: true,
    rrTp1: 2,
    rrTp2: 3,
    rrTp3: 4
  });

  const size = candles.length;
  assert.equal(overlay.series.bbTop.length, size);
  assert.equal(overlay.series.bbBottom.length, size);
  assert.equal(overlay.series.bbMid.length, size);
  assert.equal(overlay.series.line1.length, size);
  assert.equal(overlay.series.line2.length, size);
  assert.equal(overlay.series.pd1.length, size);
  assert.equal(overlay.series.pd2.length, size);
  assert.equal(overlay.series.tp1.length, size);
  assert.equal(overlay.series.tp2.length, size);
  assert.equal(overlay.series.tp3.length, size);
  assert.equal(Array.isArray(overlay.events), true);
});

test("breakerBlocks settings fallback keeps sane defaults", () => {
  const defaults = defaultBreakerBlocksSettings();
  const overlay = computeBreakerBlocksOverlay(buildCandles(180), {
    len: 100,
    rrTp1: -10,
    rrTp2: 999,
    rrTp3: NaN,
    bbPlusColorA: "",
    tpColor: "#ff00ff"
  });

  assert.equal(defaults.len, 5);
  assert.equal(overlay.settings.len, 10);
  assert.equal(overlay.settings.rrTp1, 0.2);
  assert.equal(overlay.settings.rrTp2, 100);
  assert.equal(overlay.settings.rrTp3, defaults.rrTp3);
  assert.equal(overlay.settings.bbPlusColorA, defaults.bbPlusColorA);
  assert.equal(overlay.settings.tpColor, "#ff00ff");
});
