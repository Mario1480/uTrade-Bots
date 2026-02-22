import assert from "node:assert/strict";
import test from "node:test";
import {
  createGeneratedPromptDraft,
  generateHybridPromptText,
  PROMPT_GENERATOR_MAX_PROMPT_CHARS
} from "./promptGenerator.js";
import type { AiPromptSettingsStored } from "./promptSettings.js";

const baseSettings: AiPromptSettingsStored = {
  activePromptId: "prompt_existing",
  prompts: [
    {
      id: "prompt_existing",
      name: "Existing",
      promptText: "existing",
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
      isPublic: false,
      createdAt: "2026-02-22T09:00:00.000Z",
      updatedAt: "2026-02-22T09:00:00.000Z"
    }
  ]
};

test("generateHybridPromptText uses AI summary and keeps required sections", async () => {
  const result = await generateHybridPromptText({
    strategyDescription: "Trade pullbacks in trend with RSI and MACD confirmation.",
    selectedIndicators: [
      { key: "rsi", label: "RSI (14)", description: "Momentum oscillator" },
      { key: "macd", label: "MACD", description: "Trend momentum" }
    ],
    timeframes: ["1h", "15m"],
    runTimeframe: "15m",
    callAiFn: async () => "1) Determine HTF bias from selected indicators.\n2) Confirm entries only when momentum aligns."
  });

  assert.equal(result.mode, "ai");
  assert.equal(result.promptText.includes("ROLE / STRATEGY SCOPE"), true);
  assert.equal(result.promptText.includes("ALLOWED DATA (HARD LIMIT)"), true);
  assert.equal(result.promptText.includes("IMPORTANT OUTPUT CONTRACT"), true);
  assert.equal(result.promptText.includes("TIMEFRAME RULES"), true);
  assert.equal(result.promptText.includes("KEYDRIVERS PATH FORMAT"), true);
  assert.equal(result.promptText.includes("INDICATOR SCOPE"), true);
  assert.equal(
    result.promptText.includes('featureSnapshot.mtf.frames["1h" | "15m"].indicators.rsi_14'),
    true
  );
  assert.equal(
    result.promptText.includes('featureSnapshot.mtf.frames["1h" | "15m"].indicators.macd'),
    true
  );
  assert.equal(result.promptText.includes("SMC FIELD USAGE"), false);
  assert.equal(result.promptText.includes("DECISION LOGIC (MANDATORY 1H"), false);
  assert.equal(result.promptText.length <= PROMPT_GENERATOR_MAX_PROMPT_CHARS, true);
});

test("generateHybridPromptText falls back when AI fails", async () => {
  const result = await generateHybridPromptText({
    strategyDescription: "Look for breakout continuation when trend remains intact.",
    selectedIndicators: [],
    timeframes: ["5m"],
    runTimeframe: "5m",
    callAiFn: async () => {
      throw new Error("network_error");
    }
  });

  assert.equal(result.mode, "fallback");
  assert.equal(result.promptText.includes("ALLOWED DATA (HARD LIMIT)"), true);
  assert.equal(result.promptText.includes("TIMEFRAME RULES"), true);
  assert.equal(result.promptText.includes("KEYDRIVERS PATH FORMAT"), true);
  assert.equal(result.promptText.includes("Strategy description source"), true);
  assert.equal(result.promptText.includes("SMC FIELD USAGE"), false);
});

test("createGeneratedPromptDraft honors setActive true/false", () => {
  const nowIso = "2026-02-22T10:10:00.000Z";

  const inactive = createGeneratedPromptDraft({
    existingSettings: baseSettings,
    name: "Generated A",
    promptText: "text",
    indicatorKeys: ["macd"],
    ohlcvBars: 320,
    timeframes: ["1h", "15m"],
    runTimeframe: "15m",
    directionPreference: "short",
    confidenceTargetPct: 77,
    slTpSource: "hybrid",
    newsRiskMode: "block",
    setActive: false,
    isPublic: false,
    nowIso,
    promptId: "prompt_new_1"
  });

  assert.equal(inactive.payload.activePromptId, "prompt_existing");
  assert.equal(inactive.payload.prompts[0]?.id, "prompt_new_1");
  assert.equal(inactive.payload.prompts[0]?.directionPreference, "short");
  assert.equal(inactive.payload.prompts[0]?.confidenceTargetPct, 77);
  assert.equal(inactive.payload.prompts[0]?.slTpSource, "hybrid");
  assert.equal(inactive.payload.prompts[0]?.newsRiskMode, "block");
  assert.equal(inactive.payload.prompts[0]?.ohlcvBars, 320);

  const active = createGeneratedPromptDraft({
    existingSettings: baseSettings,
    name: "Generated B",
    promptText: "text",
    indicatorKeys: ["macd"],
    timeframes: ["1h", "15m"],
    runTimeframe: "15m",
    setActive: true,
    isPublic: true,
    nowIso,
    promptId: "prompt_new_2"
  });

  assert.equal(active.payload.activePromptId, "prompt_new_2");
  assert.equal(active.payload.prompts[0]?.isPublic, true);
});

test("createGeneratedPromptDraft uses defaults for optional runtime fields", () => {
  const draft = createGeneratedPromptDraft({
    existingSettings: baseSettings,
    name: "Generated defaults",
    promptText: "text",
    indicatorKeys: ["rsi"],
    timeframes: ["15m"],
    runTimeframe: "15m",
    setActive: false,
    isPublic: false,
    nowIso: "2026-02-22T10:15:00.000Z",
    promptId: "prompt_defaults"
  });

  assert.equal(draft.payload.prompts[0]?.directionPreference, "either");
  assert.equal(draft.payload.prompts[0]?.confidenceTargetPct, 60);
  assert.equal(draft.payload.prompts[0]?.slTpSource, "local");
  assert.equal(draft.payload.prompts[0]?.newsRiskMode, "off");
  assert.equal(draft.payload.prompts[0]?.ohlcvBars, 100);
});

test("createGeneratedPromptDraft rejects invalid runTimeframe", () => {
  assert.throws(
    () =>
      createGeneratedPromptDraft({
        existingSettings: baseSettings,
        name: "Invalid",
        promptText: "text",
        indicatorKeys: ["rsi"],
        timeframes: ["15m"],
        runTimeframe: "1h",
        setActive: false,
        isPublic: false,
        nowIso: "2026-02-22T10:20:00.000Z",
        promptId: "prompt_invalid"
      }),
    /run_timeframe_not_in_timeframes/
  );
});
