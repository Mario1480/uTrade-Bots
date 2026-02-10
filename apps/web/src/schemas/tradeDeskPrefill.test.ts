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
    leverage: 10,
    side: "long",
    tags: ["trend_up"],
    explanation: "Trend and momentum align to the upside."
  });

  assert.ok(parsed);
  assert.equal(parsed?.symbol, "BTCUSDT");
  assert.equal(parsed?.confidence, 72);
  assert.equal(parsed?.leverage, 10);
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
    leverage: 12,
    tags: ["trend_up"],
    explanation: "Momentum is positive."
  });

  assert.equal(built.payload.confidence, 63);
  assert.equal(built.payload.side, "long");
  assert.equal(built.payload.leverage, 12);
});
