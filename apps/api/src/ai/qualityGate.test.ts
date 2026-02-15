import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAiQualityGateCallToState,
  getDefaultAiQualityGateConfig,
  resetAiQualityGateTelemetry,
  shouldInvokeAiExplain,
  type AiQualityGateRollingState
} from "./qualityGate.js";

function makeHistoryContext(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    tf: "15m",
    ts_to: "2026-02-15T12:00:00.000Z",
    lastBars: {
      n: 10,
      ohlc: [{ t: 1_771_000_000, o: 70000, h: 70100, l: 69900, c: 70020, v: 1200 }]
    },
    reg: {
      state: "range",
      conf: 50,
      since: "2026-02-15T11:00:00.000Z",
      why: ["vol_low"]
    },
    lvl: {
      pivD: { pp: 70000, r1: 70300, s1: 69700, r2: null, s2: null },
      hiLo: { yH: 70500, yL: 69500, wH: 71000, wL: 69000 },
      do: { p: 69920 }
    },
    ema: {
      e5: 1,
      e13: 1,
      e50: 1,
      e200: 1,
      e800: 1,
      stk: "none",
      d50: 0.1,
      d200: 0.2,
      d800: 0.4,
      sl50: 0.01,
      sl200: 0.005
    },
    vol: { z: 0.4, rv: 1.1, tr: 0.2 },
    fvg: { ob: 0, os: 0, nb: null, ns: null },
    ls: { le: null, nb: null, ns: null },
    ev: [],
    bud: { bytes: 1000, trim: [] },
    ...overrides
  };
}

function makeGateState(overrides: Partial<AiQualityGateRollingState> = {}): AiQualityGateRollingState {
  return {
    lastAiCallTs: null,
    lastExplainedPredictionHash: null,
    lastExplainedHistoryHash: null,
    lastAiDecisionHash: null,
    windowStartedAt: new Date("2026-02-15T10:00:00.000Z"),
    aiCallsLastHour: 0,
    highPriorityCallsLastHour: 0,
    ...overrides
  };
}

const nowMs = Date.parse("2026-02-15T12:00:00.000Z");

test("signal flip allows with high priority", () => {
  resetAiQualityGateTelemetry();
  const decision = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "down",
      confidence: 0.78,
      expectedMovePct: 1.5,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: {
      suggestedEntryPrice: 70010,
      historyContext: makeHistoryContext()
    },
    prevState: {
      signal: "up",
      confidence: 0.63,
      featureSnapshot: { historyContext: makeHistoryContext() }
    },
    gateState: makeGateState()
  });

  assert.equal(decision.allow, true);
  assert.equal(decision.priority, "high");
  assert.equal(decision.reasonCodes.includes("signal_flip"), true);
});

test("neutral low confidence is blocked", () => {
  const decision = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "neutral",
      confidence: 0.45,
      expectedMovePct: 0.4,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: { suggestedEntryPrice: 70010, historyContext: makeHistoryContext() },
    prevState: null,
    gateState: makeGateState()
  });

  assert.equal(decision.allow, false);
  assert.equal(decision.reasonCodes.includes("neutral_low_confidence"), true);
});

test("regime switch allows high priority", () => {
  const decision = shouldInvokeAiExplain({
    timeframe: "1h",
    nowMs,
    prediction: {
      signal: "up",
      confidence: 82,
      expectedMovePct: 2.2,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: { suggestedEntryPrice: 70010, historyContext: makeHistoryContext({ reg: { state: "trend_up", conf: 80, since: "2026-02-15T11:30:00.000Z", why: ["trend_strong"] } }) },
    prevState: {
      signal: "up",
      confidence: 0.74,
      featureSnapshot: { historyContext: makeHistoryContext({ reg: { state: "range", conf: 40, since: "2026-02-15T09:00:00.000Z", why: [] } }) }
    },
    gateState: makeGateState()
  });

  assert.equal(decision.allow, true);
  assert.equal(decision.priority, "high");
  assert.equal(decision.reasonCodes.includes("regime_state_changed"), true);
});

test("high-importance recent event allows", () => {
  const decision = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "up",
      confidence: 75,
      expectedMovePct: 1.4,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: {
      suggestedEntryPrice: 70010,
      historyContext: makeHistoryContext({
        ev: [
          { t: "2026-02-15T11:30:00.000Z", ty: "vol_spike", i: 4 },
          { t: "2026-02-15T10:00:00.000Z", ty: "ema_stk", i: 3 }
        ]
      })
    },
    prevState: null,
    gateState: makeGateState()
  });

  assert.equal(decision.allow, true);
  assert.equal(decision.reasonCodes.includes("high_importance_event_recent"), true);
});

test("near key level with setup allows normal priority", () => {
  const decision = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "up",
      confidence: 71,
      expectedMovePct: 1.2,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: {
      suggestedEntryPrice: 70020,
      historyContext: makeHistoryContext({
        ema: {
          e5: 1,
          e13: 1,
          e50: 1,
          e200: 1,
          e800: 1,
          stk: "bull",
          d50: 0.2,
          d200: 0.5,
          d800: 1.2,
          sl50: 0.01,
          sl200: 0.005
        }
      })
    },
    prevState: null,
    gateState: makeGateState()
  });

  assert.equal(decision.allow, true);
  assert.equal(decision.reasonCodes.includes("near_key_level_setup"), true);
});

test("cooldown blocks normal priority but not high (unless capped)", () => {
  const baseHistory = makeHistoryContext();
  const cooldownState = makeGateState({
    lastAiCallTs: new Date(nowMs - 30_000)
  });

  const normalDecision = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "up",
      confidence: 72,
      expectedMovePct: 1.2,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: { suggestedEntryPrice: 70020, historyContext: baseHistory },
    prevState: {
      signal: "up",
      confidence: 70,
      featureSnapshot: { historyContext: baseHistory }
    },
    gateState: cooldownState
  });
  assert.equal(normalDecision.allow, false);
  assert.equal(normalDecision.reasonCodes.includes("cooldown_active"), true);

  const highDecision = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "down",
      confidence: 80,
      expectedMovePct: 1.8,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: { suggestedEntryPrice: 70020, historyContext: baseHistory },
    prevState: {
      signal: "up",
      confidence: 70,
      featureSnapshot: { historyContext: baseHistory }
    },
    gateState: cooldownState
  });
  assert.equal(highDecision.allow, true);
  assert.equal(highDecision.priority, "high");

  const cappedDecision = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "down",
      confidence: 80,
      expectedMovePct: 1.8,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: { suggestedEntryPrice: 70020, historyContext: baseHistory },
    prevState: {
      signal: "up",
      confidence: 70,
      featureSnapshot: { historyContext: baseHistory }
    },
    gateState: makeGateState({
      windowStartedAt: new Date(nowMs - 10 * 60_000),
      highPriorityCallsLastHour: 12
    })
  });
  assert.equal(cappedDecision.allow, false);
  assert.equal(cappedDecision.reasonCodes.includes("high_priority_hour_cap"), true);
});

test("budget pressure allows only high priority", () => {
  const baseInput = {
    timeframe: "15m" as const,
    nowMs,
    prediction: {
      signal: "up" as const,
      confidence: 72,
      expectedMovePct: 1.2,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: { suggestedEntryPrice: 70020, historyContext: makeHistoryContext() },
    prevState: {
      signal: "up" as const,
      confidence: 70,
      featureSnapshot: { historyContext: makeHistoryContext() }
    },
    gateState: makeGateState(),
    budgetPressureConsecutive: 3
  };

  const blocked = shouldInvokeAiExplain(baseInput);
  assert.equal(blocked.allow, false);
  assert.equal(blocked.reasonCodes.includes("budget_pressure_requires_high_priority"), true);

  const allowed = shouldInvokeAiExplain({
    ...baseInput,
    prediction: {
      ...baseInput.prediction,
      signal: "down"
    }
  });
  assert.equal(allowed.allow, true);
  assert.equal(allowed.priority, "high");
});

test("idempotency blocks when prediction and history hashes are unchanged", () => {
  const snapshot = { suggestedEntryPrice: 70020, historyContext: makeHistoryContext() };
  const seed = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs,
    prediction: {
      signal: "down",
      confidence: 80,
      expectedMovePct: 1.8,
      tsUpdated: new Date(nowMs)
    },
    featureSnapshot: snapshot,
    prevState: {
      signal: "up",
      confidence: 70,
      featureSnapshot: { historyContext: makeHistoryContext() }
    },
    gateState: makeGateState()
  });
  assert.equal(seed.allow, true);

  const repeated = shouldInvokeAiExplain({
    timeframe: "15m",
    nowMs: nowMs + 60_000,
    prediction: {
      signal: "down",
      confidence: 80,
      expectedMovePct: 1.8,
      tsUpdated: new Date(nowMs + 60_000)
    },
    featureSnapshot: snapshot,
    prevState: {
      signal: "up",
      confidence: 70,
      featureSnapshot: { historyContext: makeHistoryContext() }
    },
    gateState: makeGateState({
      lastExplainedPredictionHash: seed.predictionHash,
      lastExplainedHistoryHash: seed.historyHash
    })
  });
  assert.equal(repeated.allow, false);
  assert.equal(repeated.reasonCodes.includes("idempotent_hash_unchanged"), true);
});

test("applyAiQualityGateCallToState increments counters", () => {
  const updated = applyAiQualityGateCallToState({
    windowStartedAt: new Date(nowMs),
    aiCallsLastHour: 2,
    highPriorityCallsLastHour: 1
  }, "high");
  assert.equal(updated.aiCallsLastHour, 3);
  assert.equal(updated.highPriorityCallsLastHour, 2);
});

test("default config provides expected baseline values", () => {
  const cfg = getDefaultAiQualityGateConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.minConfidenceForExplain, 70);
  assert.equal(cfg.aiCooldownSec["15m"], 240);
});
