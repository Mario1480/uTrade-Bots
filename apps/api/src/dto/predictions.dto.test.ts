import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePredictionConfidence,
  normalizePredictionExplanation,
  normalizePredictionFeatureSnapshot,
  normalizePredictionIndicators,
  normalizePredictionKeyDrivers,
  normalizePredictionTags,
  predictionDetailDtoSchema
} from "./predictions.dto.js";

test("normalizePredictionTags enforces allowlist and max 5", () => {
  const tags = normalizePredictionTags([
    "high_vol",
    "trend_up",
    "invalid_tag",
    "trend_up",
    "low_vol",
    "breakout_risk",
    "range_bound",
    "mean_reversion"
  ]);

  assert.deepEqual(tags, [
    "high_vol",
    "trend_up",
    "low_vol",
    "breakout_risk",
    "range_bound"
  ]);
});

test("normalizePredictionKeyDrivers trims to max 5 and ignores invalid entries", () => {
  const keyDrivers = normalizePredictionKeyDrivers([
    { name: "a", value: 1 },
    { name: "b", value: 2 },
    { name: "", value: 3 },
    { foo: "bar" },
    { name: "c", value: 3 },
    { name: "d", value: 4 },
    { name: "e", value: 5 },
    { name: "f", value: 6 }
  ]);

  assert.equal(keyDrivers.length, 5);
  assert.deepEqual(keyDrivers.map((item) => item.name), ["a", "b", "c", "d", "e"]);
});

test("normalizePredictionIndicators converts invalid numbers to null", () => {
  const indicators = normalizePredictionIndicators({
    rsi_14: "55.123",
    macd: { line: 0.1, signal: "bad", hist: 0.02 },
    bb: { width_pct: "1.25", pos: "oops" },
    vwap: { value: 100, dist_pct: "0.12", mode: "session_utc" },
    adx: { adx_14: "20", plus_di_14: 15.2, minus_di_14: "nan" },
    vumanchu: { waveTrend: { wt1: 1.2 }, dataGap: false }
  });

  assert.ok(indicators);
  assert.equal(indicators?.rsi_14, 55.123);
  assert.equal(indicators?.macd?.signal, null);
  assert.equal(indicators?.bb?.width_pct, 1.25);
  assert.equal(indicators?.bb?.pos, null);
  assert.equal(indicators?.adx?.minus_di_14, null);
  assert.equal((indicators as any)?.vumanchu?.dataGap, false);
});

test("normalizePredictionFeatureSnapshot keeps root keys and normalized indicators", () => {
  const snapshot = normalizePredictionFeatureSnapshot({
    emaSpread: 0.0123,
    indicators: {
      rsi_14: 66.6
    }
  });

  assert.equal(snapshot.emaSpread, 0.0123);
  assert.equal((snapshot.indicators as any).rsi_14, 66.6);
});

test("normalizePredictionConfidence clamps and supports 0..1 input", () => {
  assert.equal(normalizePredictionConfidence(0.67), 67);
  assert.equal(normalizePredictionConfidence(140), 100);
  assert.equal(normalizePredictionConfidence(-2), 0);
});

test("normalizePredictionExplanation truncates > 1000 chars", () => {
  const long = "x".repeat(1200);
  const normalized = normalizePredictionExplanation(long);

  assert.equal(normalized.truncated, true);
  assert.equal(normalized.value?.length, 1000);
});

test("predictionDetailDtoSchema accepts stable dto shape", () => {
  const parsed = predictionDetailDtoSchema.safeParse({
    id: "cmf1234567890123456789012",
    exchange: "bitget",
    accountId: "acc_1",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    tsCreated: "2026-02-11T12:00:00.000Z",
    tsPredictedFor: "2026-02-11T12:00:00.000Z",
    prediction: {
      signal: "up",
      expectedMovePct: 1.2,
      confidence: 72
    },
    tags: ["trend_up", "high_vol"],
    explanation: "Grounded explanation.",
    keyDrivers: [{ name: "rsi", value: 62.1 }],
    featureSnapshot: {
      indicators: {
        rsi_14: 62.1
      },
      emaSpread: 0.1
    },
    modelVersion: "baseline-v1 + openai-explain-v1",
    realized: {
      realizedReturnPct: null,
      evaluatedAt: null,
      errorMetrics: null
    }
  });

  assert.equal(parsed.success, true);
});
