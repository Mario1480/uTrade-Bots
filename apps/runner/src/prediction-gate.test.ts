import assert from "node:assert/strict";
import test from "node:test";
import { applySizeMultiplierToIntent, evaluateGate, readPredictionGatePolicy } from "./prediction-gate.js";

test("readPredictionGatePolicy returns safe defaults", () => {
  const policy = readPredictionGatePolicy({});
  assert.equal(policy.enabled, false);
  assert.equal(policy.timeframe, "15m");
  assert.equal(policy.minConfidence, 65);
  assert.equal(policy.maxAgeSec, 900);
  assert.deepEqual(policy.allowSignals, ["up", "down"]);
});

test("evaluateGate denies when prediction is missing", () => {
  const policy = readPredictionGatePolicy({
    gating: {
      enabled: true
    }
  });
  const result = evaluateGate(policy, null, Date.now());
  assert.equal(result.allow, false);
  assert.equal(result.reason, "missing_prediction_state");
});

test("evaluateGate denies stale and low-confidence predictions", () => {
  const now = new Date("2026-02-12T12:00:00.000Z");
  const stalePolicy = readPredictionGatePolicy({
    gating: {
      enabled: true,
      maxAgeSec: 60
    }
  });
  const staleResult = evaluateGate(
    stalePolicy,
    {
      id: "state-1",
      exchange: "bitget",
      accountId: "acc-1",
      userId: "user-1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      signal: "up",
      confidence: 90,
      tags: [],
      tsUpdated: new Date(now.getTime() - 61_000)
    },
    now.getTime()
  );
  assert.equal(staleResult.allow, false);
  assert.equal(staleResult.reason, "stale_prediction_state");

  const confidencePolicy = readPredictionGatePolicy({
    gating: {
      enabled: true,
      minConfidence: 80
    }
  });
  const confidenceResult = evaluateGate(
    confidencePolicy,
    {
      id: "state-2",
      exchange: "bitget",
      accountId: "acc-1",
      userId: "user-1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      signal: "up",
      confidence: 70,
      tags: [],
      tsUpdated: now
    },
    now.getTime()
  );
  assert.equal(confidenceResult.allow, false);
  assert.equal(confidenceResult.reason, "confidence_below_min");
});

test("evaluateGate denies blocked tags and unsupported signal", () => {
  const blockPolicy = readPredictionGatePolicy({
    gating: {
      enabled: true,
      blockTags: ["news_risk", "low_liquidity"]
    }
  });
  const blocked = evaluateGate(
    blockPolicy,
    {
      id: "state-3",
      exchange: "bitget",
      accountId: "acc-1",
      userId: "user-1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      signal: "up",
      confidence: 92,
      tags: ["trend_up", "news_risk"],
      tsUpdated: new Date("2026-02-12T12:00:00.000Z")
    },
    new Date("2026-02-12T12:01:00.000Z").getTime()
  );
  assert.equal(blocked.allow, false);
  assert.equal(blocked.reason, "blocked_tag:news_risk");

  const signalPolicy = readPredictionGatePolicy({
    gating: {
      enabled: true,
      allowSignals: ["up"]
    }
  });
  const disallowed = evaluateGate(
    signalPolicy,
    {
      id: "state-4",
      exchange: "bitget",
      accountId: "acc-1",
      userId: "user-1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      signal: "down",
      confidence: 95,
      tags: [],
      tsUpdated: new Date("2026-02-12T12:00:00.000Z")
    },
    new Date("2026-02-12T12:01:00.000Z").getTime()
  );
  assert.equal(disallowed.allow, false);
  assert.equal(disallowed.reason, "signal_not_allowed");
});

test("evaluateGate blocks news_risk tag case-insensitive", () => {
  const policy = readPredictionGatePolicy({
    gating: {
      enabled: true,
      blockTags: ["news_risk"]
    }
  });
  const result = evaluateGate(
    policy,
    {
      id: "state-6",
      exchange: "bitget",
      accountId: "acc-1",
      userId: "user-1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      signal: "up",
      confidence: 90,
      tags: ["News_Risk"],
      tsUpdated: new Date("2026-02-12T12:00:00.000Z")
    },
    new Date("2026-02-12T12:00:30.000Z").getTime()
  );
  assert.equal(result.allow, false);
  assert.equal(result.reason, "blocked_tag:news_risk");
});

test("evaluateGate allows and computes multiplier", () => {
  const policy = readPredictionGatePolicy({
    gating: {
      enabled: true,
      minConfidence: 60,
      sizeMultiplier: {
        base: 1,
        highConfidenceThreshold: 80,
        highConfidenceMultiplier: 1.2,
        highVolMultiplier: 0.7
      }
    }
  });
  const result = evaluateGate(
    policy,
    {
      id: "state-5",
      exchange: "bitget",
      accountId: "acc-1",
      userId: "user-1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      signal: "up",
      confidence: 88,
      tags: ["trend_up", "high_vol"],
      tsUpdated: new Date("2026-02-12T12:00:00.000Z")
    },
    new Date("2026-02-12T12:00:30.000Z").getTime()
  );
  assert.equal(result.allow, true);
  assert.equal(result.reason, "allowed");
  assert.equal(result.sizeMultiplier, 0.84);
});

test("applySizeMultiplierToIntent scales open-intent sizing fields only", () => {
  const scaled = applySizeMultiplierToIntent(
    {
      type: "open",
      symbol: "BTCUSDT",
      side: "long",
      order: {
        qty: 1,
        desiredNotionalUsd: 100,
        riskUsd: 20
      }
    },
    1.5
  );
  assert.equal(scaled.type, "open");
  assert.equal(scaled.order?.qty, 1.5);
  assert.equal(scaled.order?.desiredNotionalUsd, 150);
  assert.equal(scaled.order?.riskUsd, 30);

  const closeIntent = applySizeMultiplierToIntent(
    { type: "close", symbol: "BTCUSDT", reason: "tp" },
    2
  );
  assert.equal(closeIntent.type, "close");
});
