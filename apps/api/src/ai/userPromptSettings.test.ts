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
