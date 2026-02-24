import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventDelta,
  buildPredictionChangeHash,
  evaluateSignificantChange,
  refreshIntervalsMsFromSec,
  refreshIntervalMsForTimeframe,
  resolveRefreshIntervalsSec,
  shouldMarkUnstableFlips,
  shouldCallAiForRefresh,
  shouldThrottleRepeatedEvent,
  type PredictionStateLike
} from "./refreshService.js";

test("refreshIntervalMsForTimeframe returns configured defaults", () => {
  assert.equal(refreshIntervalMsForTimeframe("5m") > 0, true);
  assert.equal(refreshIntervalMsForTimeframe("1d") >= refreshIntervalMsForTimeframe("1h"), true);
});

test("resolveRefreshIntervalsSec applies overrides and fallback defaults", () => {
  const resolved = resolveRefreshIntervalsSec({
    "5m": 240
  });
  assert.equal(resolved["5m"], 240);
  assert.equal(resolved["15m"] > 0, true);
});

test("refreshIntervalMsForTimeframe uses provided interval map", () => {
  const intervalsMs = refreshIntervalsMsFromSec({
    "1h": 700
  });
  assert.equal(refreshIntervalMsForTimeframe("1h", intervalsMs), 700_000);
});

test("buildPredictionChangeHash is stable for same input", () => {
  const one = buildPredictionChangeHash({
    signal: "up",
    confidence: 0.72,
    tags: ["trend_up", "high_vol"],
    keyDrivers: [{ name: "indicators.rsi_14", value: 63.4 }],
    featureSnapshot: {
      atr_pct_rank_0_100: 81,
      ema_spread_abs_rank_0_100: 76
    }
  });

  const two = buildPredictionChangeHash({
    signal: "up",
    confidence: 0.72,
    tags: ["trend_up", "high_vol"],
    keyDrivers: [{ name: "indicators.rsi_14", value: 63.4 }],
    featureSnapshot: {
      atr_pct_rank_0_100: 81,
      ema_spread_abs_rank_0_100: 76
    }
  });

  assert.equal(one, two);
});

function makePrevState(overrides: Partial<PredictionStateLike> = {}): PredictionStateLike {
  return {
    id: "state_1",
    signal: "up",
    confidence: 0.61,
    tags: ["trend_up"],
    explanation: "prev",
    keyDrivers: [{ name: "emaSpread", value: 0.0012 }],
    featureSnapshot: {
      atr_pct_rank_0_100: 40,
      ema_spread_abs_rank_0_100: 45
    },
    modelVersion: "baseline-v1",
    tsUpdated: new Date("2026-02-11T12:00:00.000Z"),
    lastAiExplainedAt: new Date("2026-02-11T12:00:00.000Z"),
    ...overrides
  };
}

test("shouldCallAiForRefresh blocks ai during cooldown", () => {
  const prev = makePrevState();
  const significant = evaluateSignificantChange({
    prev,
    next: {
      signal: "down",
      confidence: 0.8,
      tags: ["trend_down"],
      featureSnapshot: {
        atr_pct_rank_0_100: 82,
        ema_spread_abs_rank_0_100: 79
      }
    }
  });

  const decision = shouldCallAiForRefresh({
    prev,
    next: {
      signal: "down",
      confidence: 0.8,
      tags: ["trend_down"]
    },
    significant,
    nowMs: prev.lastAiExplainedAt!.getTime() + 30_000,
    cooldownMs: 300_000
  });

  assert.equal(decision.shouldCallAi, false);
  assert.equal(decision.cooldownActive, true);
});

test("buildEventDelta contains tag additions/removals", () => {
  const prev = makePrevState();
  const delta = buildEventDelta({
    prev,
    next: {
      signal: "down",
      confidence: 0.8,
      tags: ["trend_down", "high_vol"],
      expectedMovePct: 1.3
    },
    reasons: ["signal:up->down", "tags_changed"]
  });

  assert.equal(Array.isArray(delta.tagsAdded), true);
  assert.equal(Array.isArray(delta.tagsRemoved), true);
});

test("shouldThrottleRepeatedEvent throttles recent duplicate event", () => {
  const nowMs = Date.now();
  assert.equal(
    shouldThrottleRepeatedEvent({
      nowMs,
      recentSameEventAtMs: nowMs - 60_000,
      eventThrottleMs: 180_000
    }),
    true
  );
  assert.equal(
    shouldThrottleRepeatedEvent({
      nowMs,
      recentSameEventAtMs: nowMs - 300_000,
      eventThrottleMs: 180_000
    }),
    false
  );
});

test("shouldMarkUnstableFlips turns true when frequent flips are detected", () => {
  const nowMs = Date.now();
  assert.equal(
    shouldMarkUnstableFlips({
      recentFlipCount: 4,
      unstableFlipLimit: 4,
      unstableWindowMs: 30 * 60 * 1000,
      lastFlipAtMs: nowMs - 5 * 60 * 1000,
      nowMs
    }),
    true
  );
  assert.equal(
    shouldMarkUnstableFlips({
      recentFlipCount: 2,
      unstableFlipLimit: 4,
      unstableWindowMs: 30 * 60 * 1000,
      lastFlipAtMs: nowMs - 5 * 60 * 1000,
      nowMs
    }),
    false
  );
});
