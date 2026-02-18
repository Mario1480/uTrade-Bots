import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIndicatorSettings } from "./settings.js";
import { computeVuManChuCipher, __vmcTest } from "./vumanchuCipher.js";
import type { Candle } from "../timeframe.js";

function buildCandles(count: number, tfMs = 60 * 60 * 1000): Candle[] {
  const out: Candle[] = [];
  const start = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 8) * 0.8 + Math.cos(i / 17) * 0.45;
    price = Math.max(1, price + 0.1 + wave * 0.12);
    const open = price - 0.3;
    const close = price + 0.25;
    const high = Math.max(open, close) + 0.4;
    const low = Math.min(open, close) - 0.4;
    out.push({
      ts: start + i * tfMs,
      open,
      high,
      low,
      close,
      volume: 100 + (i % 7) * 8
    });
  }
  return out;
}

function hasInvalidNumber(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasInvalidNumber(entry));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => hasInvalidNumber(entry));
  }
  if (typeof value === "number") return !Number.isFinite(value) || Number.isNaN(value);
  return false;
}

test("findDivergences detects bullish regular divergence", () => {
  const osc = [60, 55, 50, 45, 40, 45, 50, 42, 41, 46, 50].map((value) => value as number | null);
  const highs = new Array(osc.length).fill(110);
  const lows = [120, 118, 116, 114, 100, 113, 115, 112, 95, 111, 113];
  const result = __vmcTest.findDivergences(osc, highs, lows, 0, 0, false);
  assert.equal(result.bullishNow, true);
  assert.equal(result.bearishNow, false);
});

test("findDivergences detects bullish hidden divergence", () => {
  const osc = [60, 55, 50, 45, 40, 45, 50, 38, 35, 44, 49].map((value) => value as number | null);
  const highs = new Array(osc.length).fill(110);
  const lows = [120, 118, 116, 114, 100, 113, 115, 112, 105, 111, 113];
  const result = __vmcTest.findDivergences(osc, highs, lows, 0, 0, false);
  assert.equal(result.bullishHiddenNow, true);
  assert.equal(result.bearishHiddenNow, false);
});

test("findDivergences detects bearish regular divergence", () => {
  const osc = [20, 25, 30, 35, 40, 35, 30, 31, 33, 29, 27].map((value) => value as number | null);
  const highs = [90, 92, 95, 98, 100, 96, 94, 97, 105, 99, 96];
  const lows = new Array(osc.length).fill(80);
  const result = __vmcTest.findDivergences(osc, highs, lows, 0, 0, false);
  assert.equal(result.bearishNow, true);
  assert.equal(result.bullishNow, false);
});

test("findDivergences detects bearish hidden divergence", () => {
  const osc = [20, 25, 30, 35, 40, 35, 30, 41, 45, 38, 34].map((value) => value as number | null);
  const highs = [90, 92, 95, 98, 110, 96, 94, 97, 105, 99, 96];
  const lows = new Array(osc.length).fill(80);
  const result = __vmcTest.findDivergences(osc, highs, lows, 0, 0, false);
  assert.equal(result.bearishHiddenNow, true);
  assert.equal(result.bullishHiddenNow, false);
});

test("computeVuManChuCipher is deterministic and null-safe", () => {
  const config = normalizeIndicatorSettings(undefined).vumanchu;
  const candles = buildCandles(320);
  const first = computeVuManChuCipher(candles, config);
  const second = computeVuManChuCipher(candles, config);
  assert.deepEqual(second, first);
  assert.equal(hasInvalidNumber(first), false);
});
