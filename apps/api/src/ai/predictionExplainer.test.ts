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
    spreadBps: 8
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

test.afterEach(() => {
  resetAiAnalyzerState();
});

