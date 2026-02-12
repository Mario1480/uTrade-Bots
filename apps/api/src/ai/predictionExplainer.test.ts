import assert from "node:assert/strict";
import test from "node:test";
import { resetAiAnalyzerState } from "./analyzer.js";
import {
  fallbackExplain,
  generatePredictionExplanation,
  validateExplainerOutput,
  type ExplainerInput
} from "./predictionExplainer.js";

const baseInput: ExplainerInput = {
  symbol: "BTCUSDT",
  marketType: "perp",
  timeframe: "15m",
  tsCreated: "2026-02-09T10:00:00.000Z",
  prediction: {
    signal: "up",
    expectedMovePct: 1.25,
    confidence: 0.66
  },
  featureSnapshot: {
    rsi: 57.2,
    emaSpread: 0.0012,
    volatility: 0.021,
    spreadBps: 8,
    tradersReality: {
      emas: {
        ema_5: 70110,
        ema_13: 70092,
        ema_50: 70040,
        ema_200: 69780,
        ema_800: 68110,
        emaStack: { bullishStack: true, bearishStack: false },
        emaDistancesPct: {
          spread_13_50_pct: 0.074,
          spread_50_200_pct: 0.372
        }
      },
      cloud: { price_pos: 0.88 },
      pvsra: { vectorTier: "high", vectorColor: "blue" }
    },
    indicators: {
      rsi_14: 57.2,
      macd: { line: 0.1, signal: 0.08, hist: 0.02 },
      bb: { upper: 101, mid: 100, lower: 99, width_pct: 2, pos: 0.6 },
      vwap: { value: 100.1, dist_pct: 0.4, mode: "session_utc" },
      adx: { adx_14: 21.5, plus_di_14: 24.1, minus_di_14: 19.7 },
      stochrsi: { rsi_len: 14, stoch_len: 14, smooth_k: 3, smooth_d: 3, k: 82.4, d: 78.1, value: 82.4 },
      volume: { lookback: 100, vol_z: 2.1, rel_vol: 1.92, vol_ema_fast: 126.2, vol_ema_slow: 113.1, vol_trend: 11.58 },
      fvg: {
        lookback: 300,
        fill_rule: "overlap",
        open_bullish_count: 1,
        open_bearish_count: 0,
        nearest_bullish_gap: { upper: 70120, lower: 70080, mid: 70100, dist_pct: 0.12, age_bars: 4 },
        nearest_bearish_gap: { upper: null, lower: null, mid: null, dist_pct: null, age_bars: null },
        last_created: { type: "bullish", age_bars: 4 },
        last_filled: { type: "bearish", age_bars: 17 }
      }
    }
  }
};

test("schema validation success", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up with momentum and moderate volatility.",
      tags: ["trend_up", "high_vol"],
      keyDrivers: [
        { name: "rsi", value: 57.2 },
        { name: "emaSpread", value: 0.0012 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.disclaimer, "grounded_features_only");
  assert.equal(value.tags.includes("trend_up"), true);
  assert.equal(value.keyDrivers.length, 2);
});

test("nested keyDrivers paths are accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up with MACD and RSI confirmation.",
      tags: ["trend_up"],
      keyDrivers: [
        { name: "indicators.rsi_14", value: 57.2 },
        { name: "indicators.macd.hist", value: 0.02 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 2);
});

test("v2 indicator keyDrivers paths are accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up with elevated StochRSI and volume expansion near open gap.",
      tags: ["breakout_risk", "mean_reversion"],
      keyDrivers: [
        { name: "indicators.stochrsi.k", value: 82.4 },
        { name: "indicators.volume.rel_vol", value: 1.92 },
        { name: "indicators.fvg.open_bullish_count", value: 1 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 3);
});

test("tradersReality keyDrivers paths are accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up while EMA structure remains stacked and cloud position is elevated.",
      tags: ["trend_up"],
      keyDrivers: [
        { name: "tradersReality.emas.ema_50", value: 70040 },
        { name: "tradersReality.emas.emaDistancesPct.spread_13_50_pct", value: 0.074 },
        { name: "tradersReality.cloud.price_pos", value: 0.88 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 3);
});

test("invalid tags are stripped", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up with momentum and moderate volatility.",
      tags: ["trend_up", "not_allowed_tag", "range_bound"],
      keyDrivers: [{ name: "rsi", value: 57.2 }],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.deepEqual(value.tags, ["trend_up", "range_bound"]);
});

test("hallucination guard rejects keyDrivers not in featureSnapshot", () => {
  assert.throws(() =>
    validateExplainerOutput(
      {
        explanation: "Invalid driver usage",
        tags: ["trend_up"],
        keyDrivers: [{ name: "inventedDriver", value: 123 }],
        disclaimer: "grounded_features_only"
      },
      baseInput.featureSnapshot
    )
  );
});

test("fallback path is used on bad JSON", async () => {
  resetAiAnalyzerState();
  const output = await generatePredictionExplanation(
    {
      ...baseInput,
      tsCreated: "2026-02-09T10:00:01.000Z"
    },
    {
      callAiFn: async () => "not-json"
    }
  );

  assert.equal(output.disclaimer, "grounded_features_only");
  assert.equal(output.explanation.length <= 400, true);
  assert.equal(Array.isArray(output.tags), true);
});

test("fallback path is used on timeout error", async () => {
  resetAiAnalyzerState();
  const output = await generatePredictionExplanation(
    {
      ...baseInput,
      tsCreated: "2026-02-09T10:00:02.000Z"
    },
    {
      callAiFn: async () => {
        throw new Error("timeout");
      }
    }
  );

  const expectedFallback = fallbackExplain({
    ...baseInput,
    tsCreated: "2026-02-09T10:00:02.000Z"
  });

  assert.equal(output.disclaimer, "grounded_features_only");
  assert.equal(output.explanation, expectedFallback.explanation);
});

test("fallback derives v2-based tags when snapshot supports them", () => {
  const out = fallbackExplain(baseInput);
  assert.equal(out.tags.includes("mean_reversion"), true);
  assert.equal(out.tags.includes("breakout_risk"), true);
});

test.afterEach(() => {
  resetAiAnalyzerState();
});
