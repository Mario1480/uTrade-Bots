import assert from "node:assert/strict";
import test from "node:test";
import { isSignificantChange, shouldRefreshTF } from "./refreshTriggers.js";

test("shouldRefreshTF returns scheduled_due when interval is exceeded", () => {
  const result = shouldRefreshTF({
    timeframe: "1h",
    nowMs: 2_000_000,
    lastUpdatedMs: 1_000_000,
    refreshIntervalMs: 10_000,
    previousFeatureSnapshot: {},
    currentFeatureSnapshot: {}
  });

  assert.equal(result.refresh, true);
  assert.deepEqual(result.reasons, ["scheduled_due"]);
});

test("shouldRefreshTF detects trigger-based trend flip", () => {
  const result = shouldRefreshTF({
    timeframe: "15m",
    nowMs: 100_000,
    lastUpdatedMs: 95_500,
    refreshIntervalMs: 60_000,
    previousFeatureSnapshot: { emaSpread: 0.002, atr_pct_rank_0_100: 40 },
    currentFeatureSnapshot: { emaSpread: -0.002, atr_pct_rank_0_100: 42 }
  });

  assert.equal(result.refresh, true);
  assert.equal(result.reasons.includes("trigger_trend_flip"), true);
});

test("shouldRefreshTF applies debounce when trigger state is provided", () => {
  const first = shouldRefreshTF({
    timeframe: "5m",
    nowMs: 100_000,
    lastUpdatedMs: 99_000,
    refreshIntervalMs: 300_000,
    previousFeatureSnapshot: { emaSpread: 0.002 },
    currentFeatureSnapshot: { emaSpread: -0.003 },
    previousTriggerState: null,
    triggerDebounceSec: 120
  });
  assert.equal(first.refresh, false);
  assert.equal(first.triggerState.candidateCount, 1);

  const second = shouldRefreshTF({
    timeframe: "5m",
    nowMs: 160_000,
    lastUpdatedMs: 99_000,
    refreshIntervalMs: 300_000,
    previousFeatureSnapshot: { emaSpread: 0.002 },
    currentFeatureSnapshot: { emaSpread: -0.003 },
    previousTriggerState: first.triggerState,
    triggerDebounceSec: 120
  });
  assert.equal(second.refresh, true);
  assert.equal(second.reasons.includes("trigger_trend_flip"), true);
});

test("shouldRefreshTF hysteresis avoids noisy vol regime exits", () => {
  const result = shouldRefreshTF({
    timeframe: "15m",
    nowMs: 100_000,
    lastUpdatedMs: 95_500,
    refreshIntervalMs: 60_000,
    previousFeatureSnapshot: { atr_pct_rank_0_100: 80 },
    currentFeatureSnapshot: { atr_pct_rank_0_100: 70 }
  });
  assert.equal(result.refresh, false);
  assert.equal(result.reasons.includes("trigger_vol_regime"), false);
});

test("isSignificantChange detects signal flip + tag changes", () => {
  const result = isSignificantChange({
    prevState: {
      signal: "down",
      confidence: 61,
      tags: ["trend_down"],
      featureSnapshot: {
        atr_pct_rank_0_100: 30,
        ema_spread_abs_rank_0_100: 30
      }
    },
    newState: {
      signal: "up",
      confidence: 64,
      tags: ["trend_up", "high_vol"],
      featureSnapshot: {
        atr_pct_rank_0_100: 81,
        ema_spread_abs_rank_0_100: 80,
        breakout_score: 0.9
      }
    }
  });

  assert.equal(result.significant, true);
  assert.equal(result.changeType, "signal_flip");
  assert.equal(result.reasons.some((item) => item.startsWith("signal:")), true);
});

test("isSignificantChange can stay non-significant on tiny updates", () => {
  const result = isSignificantChange({
    prevState: {
      signal: "up",
      confidence: 68,
      tags: ["trend_up"],
      featureSnapshot: {
        atr_pct_rank_0_100: 55,
        ema_spread_abs_rank_0_100: 60
      }
    },
    newState: {
      signal: "up",
      confidence: 69,
      tags: ["trend_up"],
      featureSnapshot: {
        atr_pct_rank_0_100: 56,
        ema_spread_abs_rank_0_100: 61
      }
    }
  });

  assert.equal(result.significant, false);
});
