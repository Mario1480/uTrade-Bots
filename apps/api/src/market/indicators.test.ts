import assert from "node:assert/strict";
import test from "node:test";
import {
  computeADX14,
  computeIndicators,
  type Candle
} from "./indicators.js";
import { computeSessionVWAP } from "./indicatorsVwap.js";

function buildFixtureCandles(count: number, tfMs = 5 * 60 * 1000): Candle[] {
  const out: Candle[] = [];
  const start = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 9) * 0.7 + Math.cos(i / 17) * 0.5;
    price = Math.max(1, price + 0.15 + wave * 0.1);
    const open = price - 0.2;
    const close = price + 0.2;
    const high = Math.max(open, close) + 0.4;
    const low = Math.min(open, close) - 0.4;
    out.push({
      ts: start + i * tfMs,
      open,
      high,
      low,
      close,
      volume: 10 + (i % 8)
    });
  }
  return out;
}

test("computeIndicators: outputs are bounded and finite on sufficient bars", () => {
  const candles = buildFixtureCandles(360);
  const indicators = computeIndicators(candles, "5m");

  assert.equal(indicators.dataGap, false);
  assert.ok(indicators.rsi_14 !== null);
  assert.ok(indicators.rsi_14! >= 0 && indicators.rsi_14! <= 100);
  assert.ok(indicators.bb.pos !== null);
  assert.ok(indicators.bb.pos! >= 0 && indicators.bb.pos! <= 1);
  assert.ok(indicators.adx.adx_14 !== null);
  assert.ok(indicators.adx.adx_14! >= 0 && indicators.adx.adx_14! <= 100);
  assert.ok(indicators.stochrsi.k !== null);
  assert.ok(indicators.stochrsi.d !== null);
  assert.ok(indicators.stochrsi.k! >= 0 && indicators.stochrsi.k! <= 100);
  assert.ok(indicators.stochrsi.d! >= 0 && indicators.stochrsi.d! <= 100);
  assert.ok(indicators.breakerBlocks !== null);
  assert.equal(typeof indicators.breakerBlocks.signals.BBplus, "boolean");
  assert.equal(typeof indicators.breakerBlocks.signals.BB_min, "boolean");

  const numericValues = [
    indicators.rsi_14,
    indicators.macd.line,
    indicators.macd.signal,
    indicators.macd.hist,
    indicators.bb.upper,
    indicators.bb.mid,
    indicators.bb.lower,
    indicators.bb.width_pct,
    indicators.bb.pos,
    indicators.vwap.value,
    indicators.vwap.dist_pct,
    indicators.adx.adx_14,
    indicators.adx.plus_di_14,
    indicators.adx.minus_di_14,
    indicators.stochrsi.k,
    indicators.stochrsi.d,
    indicators.stochrsi.value,
    indicators.volume.vol_z,
    indicators.volume.rel_vol,
    indicators.volume.vol_ema_fast,
    indicators.volume.vol_ema_slow,
    indicators.volume.vol_trend,
    indicators.fvg.nearest_bullish_gap.dist_pct,
    indicators.fvg.nearest_bearish_gap.dist_pct,
    indicators.atr_pct
  ];
  for (const value of numericValues) {
    assert.ok(value === null || Number.isFinite(value));
  }
});

test("computeSessionVWAP: session mode uses only current UTC day", () => {
  const d1 = Date.UTC(2026, 1, 1, 22, 0, 0, 0);
  const d2a = Date.UTC(2026, 1, 2, 10, 0, 0, 0);
  const d2b = Date.UTC(2026, 1, 2, 10, 5, 0, 0);

  const candles: Candle[] = [
    { ts: d1, open: 9, high: 11, low: 8, close: 10, volume: 5 },
    { ts: d2a, open: 10, high: 12, low: 8, close: 10, volume: 2 },
    { ts: d2b, open: 12, high: 15, low: 9, close: 12, volume: 3 }
  ];

  const result = computeSessionVWAP(candles, "5m", {
    exchange: "bitget",
    symbol: "BTCUSDT",
    marketType: "perp",
    cacheTtlMs: 10_000,
    logMetrics: false
  });
  const expected = ((10 * 2) + (12 * 3)) / (2 + 3);
  assert.ok(result.value !== null);
  assert.ok(Math.abs(result.value! - expected) < 1e-9);
});

test("computeIndicators: insufficient bars marks data gap with null indicators", () => {
  const candles = buildFixtureCandles(80);
  const indicators = computeIndicators(candles, "5m");
  assert.equal(indicators.dataGap, true);
  assert.equal(indicators.rsi_14, null);
  assert.equal(indicators.macd.line, null);
  assert.equal(indicators.bb.upper, null);
  assert.equal(indicators.adx.adx_14, null);
  assert.equal(indicators.stochrsi.k, null);
  assert.equal(indicators.volume.rel_vol, null);
  assert.equal(indicators.breakerBlocks.dataGap, true);
});

test("computeADX14: produces bounded values on valid fixture", () => {
  const candles = buildFixtureCandles(120, 60 * 60 * 1000);
  const adx = computeADX14(candles);
  assert.ok(adx.adx_14 !== null);
  assert.ok(adx.plus_di_14 !== null);
  assert.ok(adx.minus_di_14 !== null);
  assert.ok(adx.adx_14! >= 0 && adx.adx_14! <= 100);
});
