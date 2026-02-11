import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConfidencePenalty,
  buildFeatureThresholds,
  deriveRegimeTags,
  fallbackFeatureThresholds,
  percentileRankFromBands,
  quantile
} from "./prediction-thresholds.js";

test("quantile computes median for known array", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(quantile(values, 0.5), 5.5);
  assert.equal(quantile(values, 0.9), 9.1);
});

test("fallback thresholds are used when series are insufficient", () => {
  const result = buildFeatureThresholds({
    atrPctSeries: [0.01],
    absEmaSpreadPctSeries: [0.001],
    expectedBars: 1000,
    nBars: 1
  });
  assert.equal(result.usedFallback, true);
  assert.equal(result.thresholds.atrPct.volHigh, fallbackFeatureThresholds().atrPct.volHigh);
  assert.equal(result.thresholdsJson.riskFlags.insufficientData, true);
});

test("deriveRegimeTags uses quantile thresholds", () => {
  const thresholds = fallbackFeatureThresholds();
  const tags = deriveRegimeTags({
    signal: "up",
    atrPct: thresholds.atrPct.p90,
    emaSpreadPct: thresholds.absEmaSpreadPct.p90,
    rsi: 60,
    thresholds
  });
  assert.equal(tags.includes("high_vol"), true);
  assert.equal(tags.includes("trend_up"), true);
  assert.equal(tags.includes("breakout_risk"), true);
});

test("percentile rank from quantile bands is bounded", () => {
  const rankLow = percentileRankFromBands(0.001, {
    p10: 0.01,
    p25: 0.02,
    p50: 0.03,
    p75: 0.04,
    p90: 0.05
  });
  const rankHigh = percentileRankFromBands(0.06, {
    p10: 0.01,
    p25: 0.02,
    p50: 0.03,
    p75: 0.04,
    p90: 0.05
  });
  assert.equal(rankLow !== null && rankLow >= 0 && rankLow <= 100, true);
  assert.equal(rankHigh !== null && rankHigh >= 0 && rankHigh <= 100, true);
});

test("confidence penalty lowers confidence in extreme regime", () => {
  const thresholds = fallbackFeatureThresholds();
  const penalized = applyConfidencePenalty({
    baseConfidence: 0.8,
    atrPct: thresholds.atrPct.volExtreme + 0.01,
    emaSpreadPct: 0.0001,
    thresholds
  });
  assert.equal(penalized < 0.8, true);
});

