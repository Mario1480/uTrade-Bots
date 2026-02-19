import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTradeDeskPrefillPayload,
  mapSignalToSide,
  parseTradeDeskPrefill
} from "./tradeDeskPrefill";

test("schema validation success", () => {
  const parsed = parseTradeDeskPrefill({
    exchange: "bitget",
    accountId: "acc_1",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    predictionId: "pred_1",
    tsCreated: "2026-02-09T12:00:00.000Z",
    signal: "up",
    confidence: 72,
    expectedMovePct: 1.24,
    leverage: 10,
    side: "long",
    tags: ["trend_up"],
    explanation: "Trend and momentum align to the upside.",
    indicators: {
      rsi_14: 54.3,
      macd: { line: 0.1023, signal: 0.0812, hist: 0.0211 }
    }
  });

  assert.ok(parsed);
  assert.equal(parsed?.symbol, "BTCUSDT");
  assert.equal(parsed?.confidence, 72);
  assert.equal(parsed?.leverage, 10);
  assert.equal(parsed?.expectedMovePct, 1.24);
  assert.equal(parsed?.indicators?.rsi_14, 54.3);
});

test("signal to side mapping for perp", () => {
  assert.equal(mapSignalToSide("up", "perp").side, "long");
  assert.equal(mapSignalToSide("down", "perp").side, "short");
  assert.equal(mapSignalToSide("neutral", "perp").side, undefined);
});

test("spot short guard for down signal", () => {
  const mapped = mapSignalToSide("down", "spot");
  assert.equal(mapped.side, undefined);
  assert.ok(mapped.info?.includes("Spot short"));
});

test("build payload normalizes confidence 0..1 to percent", () => {
  const built = buildTradeDeskPrefillPayload({
    predictionId: "pred_2",
    exchange: "bitget",
    accountId: "acc_2",
    symbol: "ETHUSDT",
    marketType: "perp",
    timeframe: "1h",
    tsCreated: "2026-02-09T12:00:00.000Z",
    signal: "up",
    confidence: 0.63,
    expectedMovePct: 1.2391,
    leverage: 12,
    tags: ["trend_up"],
    explanation: "Momentum is positive.",
    keyDrivers: Array.from({ length: 8 }, (_, i) => ({ name: `k${i}`, value: i })),
    indicators: {
      rsi_14: 63.123,
      macd: { line: 0.123456, signal: 0.111111, hist: 0.012345 },
      bb: { width_pct: 2.4567, pos: 0.6432 },
      vwap: { value: 70234.12345, dist_pct: 0.45678, mode: "session_utc" },
      adx: { adx_14: 24.87, plus_di_14: 27.22, minus_di_14: 19.43 }
    }
  });

  assert.equal(built.payload.confidence, 63);
  assert.equal(built.payload.side, "long");
  assert.equal(built.payload.leverage, 12);
  assert.equal(built.payload.expectedMovePct, 1.24);
  assert.equal(built.payload.keyDrivers?.length, 5);
  assert.equal(built.payload.indicators?.rsi_14, 63.1);
  assert.equal(built.payload.indicators?.macd?.hist, 0.0123);
  assert.equal(built.payload.indicators?.bb?.width_pct, 2.46);
  assert.equal(built.payload.indicators?.vwap?.dist_pct, 0.46);
  assert.equal(built.payload.indicators?.adx?.adx_14, 24.9);
});

test("build payload falls back to stopLossPrice/takeProfitPrice when suggested levels are missing", () => {
  const built = buildTradeDeskPrefillPayload({
    predictionId: "pred_3",
    exchange: "bitget",
    accountId: "acc_3",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    tsCreated: "2026-02-09T12:00:00.000Z",
    signal: "down",
    confidence: 82,
    suggestedStopLoss: null,
    suggestedTakeProfit: null,
    stopLossPrice: 102345.5,
    takeProfitPrice: 98456.7
  });

  assert.equal(built.payload.suggestedStopLoss, 102345.5);
  assert.equal(built.payload.suggestedTakeProfit, 98456.7);
});
