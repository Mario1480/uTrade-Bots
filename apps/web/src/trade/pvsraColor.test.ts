import assert from "node:assert/strict";
import test from "node:test";
import {
  PVSRA_BLUE,
  PVSRA_GREEN,
  PVSRA_RED,
  PVSRA_REGULAR_DOWN,
  PVSRA_REGULAR_UP,
  PVSRA_VIOLET,
  getPvsraCandleColor,
  type PvsraCandleInput
} from "./pvsraColor";

function buildLookbackCandles(count = 10): PvsraCandleInput[] {
  const candles: PvsraCandleInput[] = [];
  for (let i = 0; i < count; i += 1) {
    candles.push({
      open: 100,
      high: 120,
      low: 100,
      close: 105,
      volume: 100
    });
  }
  return candles;
}

test("bull candle with >=2x avg volume is green", () => {
  const candles = [
    ...buildLookbackCandles(),
    { open: 100, high: 112, low: 100, close: 111, volume: 200 }
  ];
  assert.equal(getPvsraCandleColor(candles, candles.length - 1), PVSRA_GREEN);
});

test("bear candle with >=2x avg volume is red", () => {
  const candles = [
    ...buildLookbackCandles(),
    { open: 111, high: 112, low: 99, close: 100, volume: 200 }
  ];
  assert.equal(getPvsraCandleColor(candles, candles.length - 1), PVSRA_RED);
});

test("bull candle with >=1.5x avg volume is blue", () => {
  const candles = [
    ...buildLookbackCandles(),
    { open: 100, high: 110, low: 99, close: 108, volume: 150 }
  ];
  assert.equal(getPvsraCandleColor(candles, candles.length - 1), PVSRA_BLUE);
});

test("bear candle with >=1.5x avg volume is violet", () => {
  const candles = [
    ...buildLookbackCandles(),
    { open: 108, high: 109, low: 99, close: 100, volume: 150 }
  ];
  assert.equal(getPvsraCandleColor(candles, candles.length - 1), PVSRA_VIOLET);
});

test("no vector condition returns regular up/down colors", () => {
  const bullish = [
    ...buildLookbackCandles(),
    { open: 100, high: 107, low: 99, close: 102, volume: 120 }
  ];
  const bearish = [
    ...buildLookbackCandles(),
    { open: 102, high: 107, low: 99, close: 100, volume: 120 }
  ];
  assert.equal(getPvsraCandleColor(bullish, bullish.length - 1), PVSRA_REGULAR_UP);
  assert.equal(getPvsraCandleColor(bearish, bearish.length - 1), PVSRA_REGULAR_DOWN);
});

test("index < 10 returns regular colors", () => {
  const candles = [
    { open: 100, high: 110, low: 90, close: 105, volume: 900 },
    { open: 105, high: 106, low: 95, close: 98, volume: 1200 }
  ];
  assert.equal(getPvsraCandleColor(candles, 0), PVSRA_REGULAR_UP);
  assert.equal(getPvsraCandleColor(candles, 1), PVSRA_REGULAR_DOWN);
});

test("highest vol*spread trigger marks extreme vector", () => {
  const candles = [
    ...buildLookbackCandles(),
    { open: 100, high: 140, low: 100, close: 130, volume: 60 }
  ];
  // avgVol10 is 100, so volume is not >=1.5x or >=2x. Extreme comes from spread*volume.
  assert.equal(getPvsraCandleColor(candles, candles.length - 1), PVSRA_GREEN);
});
