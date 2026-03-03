import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiPromptRuntimeForUserSelection } from "./userPromptSettings.js";
import type { AiPromptRuntimeSettings } from "./promptSettings.js";

function makeRuntime(overrides: Partial<AiPromptRuntimeSettings> = {}): AiPromptRuntimeSettings {
  return {
    promptText: "runtime",
    indicatorKeys: [],
    ohlcvBars: 100,
    timeframes: ["15m"],
    runTimeframe: "15m",
    timeframe: "15m",
    directionPreference: "either",
    confidenceTargetPct: 60,
    slTpSource: "local",
    newsRiskMode: "off",
    promptMode: "trading_explainer",
    marketAnalysisUpdateEnabled: false,
    source: "db",
    activePromptId: "default_core",
    activePromptName: "Default",
    selectedFrom: "active_prompt",
    matchedScopeType: null,
    matchedOverrideId: null,
    ...overrides
  };
}

test("resolveAiPromptRuntimeForUserSelection uses default runtime when no template is selected", async () => {
  const runtime = makeRuntime({ activePromptId: "default_core" });
  const resolved = await resolveAiPromptRuntimeForUserSelection({
    userId: "user_1",
    templateId: null,
    context: {},
    deps: {
      getRuntimeSettings: async () => runtime
    }
  });

  assert.ok(resolved);
  assert.equal(resolved.source, "default");
  assert.equal(resolved.templateId, "default_core");
  assert.equal(resolved.isOwnTemplate, false);
});

test("resolveAiPromptRuntimeForUserSelection prioritizes own template over global", async () => {
  const resolved = await resolveAiPromptRuntimeForUserSelection({
    userId: "user_1",
    templateId: "uap_123",
    context: {},
    deps: {
      getOwnById: async () => ({
        id: "uap_123",
        name: "Own Prompt",
        promptText: "own",
        indicatorKeys: ["rsi"],
        ohlcvBars: 120,
        timeframes: ["1h", "15m"],
        runTimeframe: "15m",
        timeframe: "15m",
        directionPreference: "long",
        confidenceTargetPct: 70,
        slTpSource: "hybrid",
        newsRiskMode: "block",
        promptMode: "trading_explainer",
        marketAnalysisUpdateEnabled: false,
        isPublic: false,
        createdAt: "2026-02-24T10:00:00.000Z",
        updatedAt: "2026-02-24T10:00:00.000Z"
      }),
      getGlobalTemplateById: async () => {
        throw new Error("global should not be called when own exists");
      }
    }
  });

  assert.ok(resolved);
  assert.equal(resolved.source, "own");
  assert.equal(resolved.templateId, "uap_123");
  assert.equal(resolved.templateName, "Own Prompt");
  assert.equal(resolved.isOwnTemplate, true);
  assert.equal(resolved.runtimeSettings.directionPreference, "long");
});

test("resolveAiPromptRuntimeForUserSelection keeps market_analysis mode for own template", async () => {
  const resolved = await resolveAiPromptRuntimeForUserSelection({
    userId: "user_1",
    templateId: "uap_analysis",
    context: {},
    deps: {
      getOwnById: async () => ({
        id: "uap_analysis",
        name: "Own Analysis",
        promptText: "analysis",
        indicatorKeys: ["smc"],
        ohlcvBars: 120,
        timeframes: ["4h"],
        runTimeframe: "4h",
        timeframe: "4h",
        directionPreference: "either",
        confidenceTargetPct: 60,
        slTpSource: "local",
        newsRiskMode: "off",
        promptMode: "market_analysis",
        marketAnalysisUpdateEnabled: true,
        isPublic: false,
        createdAt: "2026-02-24T10:00:00.000Z",
        updatedAt: "2026-02-24T10:00:00.000Z"
      })
    }
  });

  assert.ok(resolved);
  assert.equal(resolved.runtimeSettings.promptMode, "market_analysis");
  assert.equal(resolved.runtimeSettings.marketAnalysisUpdateEnabled, true);
});

test("resolveAiPromptRuntimeForUserSelection falls back to global template runtime", async () => {
  const runtime = makeRuntime({ activePromptId: "public_abc", activePromptName: "Public ABC" });
  const resolved = await resolveAiPromptRuntimeForUserSelection({
    userId: "user_1",
    templateId: "public_abc",
    context: {},
    requirePublicGlobalPrompt: true,
    deps: {
      getOwnById: async () => null,
      getGlobalTemplateById: async () => ({
        id: "public_abc",
        name: "Public ABC",
        promptText: "public",
        indicatorKeys: ["rsi"],
        ohlcvBars: 100,
        timeframes: ["15m"],
        runTimeframe: "15m",
        timeframe: "15m",
        directionPreference: "either",
        confidenceTargetPct: 60,
        slTpSource: "local",
        newsRiskMode: "off",
        promptMode: "trading_explainer",
        marketAnalysisUpdateEnabled: false,
        isPublic: true,
        createdAt: "2026-02-24T10:00:00.000Z",
        updatedAt: "2026-02-24T10:00:00.000Z"
      }),
      getRuntimeByTemplateId: async () => runtime
    }
  });

  assert.ok(resolved);
  assert.equal(resolved.source, "global");
  assert.equal(resolved.templateId, "public_abc");
  assert.equal(resolved.isOwnTemplate, false);
});

test("resolveAiPromptRuntimeForUserSelection returns null when template is missing", async () => {
  const resolved = await resolveAiPromptRuntimeForUserSelection({
    userId: "user_1",
    templateId: "missing",
    context: {},
    deps: {
      getOwnById: async () => null,
      getGlobalTemplateById: async () => null
    }
  });

  assert.equal(resolved, null);
});
