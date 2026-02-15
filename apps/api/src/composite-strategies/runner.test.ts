import assert from "node:assert/strict";
import test from "node:test";
import { runCompositeStrategy } from "./runner.js";

const baseFeatureSnapshot = {
  tags: ["trend_up"],
  historyContext: {
    reg: {
      state: "trend_up",
      conf: 70,
      since: "2026-02-15T10:00:00.000Z",
      why: ["ema_stack_bull"]
    },
    ema: {
      stk: "bull"
    }
  }
};

const basePrediction = {
  signal: "up" as const,
  confidence: 68,
  expectedMovePct: 1.2,
  symbol: "BTCUSDT",
  marketType: "perp" as const,
  timeframe: "15m" as const,
  tsCreated: "2026-02-15T12:00:00.000Z"
};

test("pipeline execution order follows topological graph", async () => {
  const executionOrder: string[] = [];
  const result = await runCompositeStrategy({
    compositeId: "comp_1",
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "local_a" },
      { id: "n2", kind: "local", refId: "local_b" },
      { id: "n3", kind: "local", refId: "local_c" }
    ],
    edgesJson: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" }
    ],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveLocalStrategyRef: async () => true,
    runLocalStrategyFn: async (refId) => {
      executionOrder.push(refId);
      return {
        strategyId: refId,
        strategyType: "regime_gate",
        strategyName: refId,
        version: "1.0.0",
        isEnabled: true,
        allow: true,
        score: 70,
        reasonCodes: [],
        tags: [refId],
        explanation: `ok:${refId}`,
        configHash: "cfg",
        snapshotHash: `snap:${refId}`,
        meta: {}
      };
    }
  });

  assert.deepEqual(executionOrder, ["local_a", "local_b", "local_c"]);
  assert.equal(result.validation.valid, true);
});

test("merge policy first_non_neutral picks first non-neutral node output", async () => {
  const result = await runCompositeStrategy({
    compositeId: "comp_2",
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "block" },
      { id: "n2", kind: "ai", refId: "prompt_1" }
    ],
    edgesJson: [{ from: "n1", to: "n2" }],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveLocalStrategyRef: async () => true,
    resolveAiPromptRef: async () => true,
    runLocalStrategyFn: async () => ({
      strategyId: "block",
      strategyType: "signal_filter",
      strategyName: "block",
      version: "1",
      isEnabled: true,
      allow: false,
      score: 20,
      reasonCodes: ["blocked"],
      tags: ["blocked"],
      explanation: "blocked",
      configHash: "cfg",
      snapshotHash: "snap",
      meta: {}
    }),
    shouldInvokeAiExplainFn: () => ({
      allow: true,
      reasonCodes: ["signal_flip"],
      priority: "high",
      recommendedCooldownSec: 240,
      predictionHash: "pred",
      historyHash: "hist",
      decisionHash: "dec",
      state: {
        windowStartedAt: new Date("2026-02-15T11:00:00.000Z"),
        aiCallsLastHour: 0,
        highPriorityCallsLastHour: 0
      }
    }),
    getRuntimePromptSettingsByTemplateId: async () => ({
      promptText: "",
      indicatorKeys: [],
      ohlcvBars: 100,
      timeframe: null,
      directionPreference: "either",
      confidenceTargetPct: 60,
      source: "db",
      activePromptId: "prompt_1",
      activePromptName: "Prompt",
      selectedFrom: "active_prompt",
      matchedScopeType: null,
      matchedOverrideId: null
    }),
    generatePredictionExplanationFn: async () => ({
      explanation: "ai says up",
      tags: ["trend_up"],
      keyDrivers: [{ name: "historyContext.reg.state", value: "trend_up" }],
      aiPrediction: { signal: "up", confidence: 0.81, expectedMovePct: 1.5 },
      disclaimer: "grounded_features_only"
    })
  });

  assert.equal(result.signal, "up");
  assert.equal(result.aiCallsUsed, 1);
  assert.equal(result.tags.includes("trend_up"), true);
});

test("AI nodes respect gating and max AI call budget", async () => {
  let aiCalls = 0;
  const result = await runCompositeStrategy({
    compositeId: "comp_3",
    combineMode: "pipeline",
    outputPolicy: "override_by_confidence",
    nodesJson: [
      { id: "a1", kind: "ai", refId: "prompt_1" },
      { id: "a2", kind: "ai", refId: "prompt_2" }
    ],
    edgesJson: [{ from: "a1", to: "a2" }],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveAiPromptRef: async () => true,
    shouldInvokeAiExplainFn: ({ prediction }) => ({
      allow: prediction.signal !== "neutral",
      reasonCodes: prediction.signal !== "neutral" ? ["signal_flip"] : ["no_actionable_change"],
      priority: "high",
      recommendedCooldownSec: 240,
      predictionHash: "pred",
      historyHash: "hist",
      decisionHash: `dec:${prediction.signal}`,
      state: {
        windowStartedAt: new Date("2026-02-15T11:00:00.000Z"),
        aiCallsLastHour: 0,
        highPriorityCallsLastHour: 0
      }
    }),
    getRuntimePromptSettingsByTemplateId: async ({ templateId }) => ({
      promptText: "",
      indicatorKeys: [],
      ohlcvBars: 100,
      timeframe: null,
      directionPreference: "either",
      confidenceTargetPct: 60,
      source: "db",
      activePromptId: templateId ?? "prompt",
      activePromptName: "Prompt",
      selectedFrom: "active_prompt",
      matchedScopeType: null,
      matchedOverrideId: null
    }),
    generatePredictionExplanationFn: async () => {
      aiCalls += 1;
      return {
        explanation: "ai output",
        tags: ["trend_up"],
        keyDrivers: [],
        aiPrediction: { signal: "up", confidence: 0.8, expectedMovePct: 1.2 },
        disclaimer: "grounded_features_only"
      };
    }
  });

  assert.equal(aiCalls, 1);
  assert.equal(result.aiCallsUsed, 1);
  const second = result.nodes.find((item) => item.nodeId === "a2");
  assert.equal(second?.executed, false);
  assert.equal(second?.skippedReason, "ai_call_budget_exceeded");
});
