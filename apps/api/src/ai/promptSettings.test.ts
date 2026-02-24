import test from "node:test";
import assert from "node:assert/strict";
import {
  filterFeatureSnapshotForAiPrompt,
  parseStoredAiPromptSettings,
  resolveAiPromptRuntimeSettingsForContext
} from "./promptSettings.js";

test("filterFeatureSnapshotForAiPrompt keeps only selected indicators and context keys", () => {
  const snapshot = {
    rsi: 77.16,
    emaSpread: 0.02,
    prefillExchange: "paper",
    meta: { indicatorSettingsHash: "abc" },
    ohlcvSeries: {
      timeframe: "15m",
      format: ["ts", "open", "high", "low", "close", "volume"],
      bars: [[1771099200000, 70000, 70100, 69900, 70050, 1234.56]]
    },
    historyContext: {
      summaries: {
        windows: {
          w20: { returnPct: 1.2, volPct: 0.2, atrPct: 0.4, trendScore: 0.8, adx: 22, emaStack: "bullish" },
          w50: { returnPct: 2.8, volPct: 0.3, atrPct: 0.5, trendScore: 1.2, adx: 25, emaStack: "bullish" },
          w200: { returnPct: 4.4, volPct: 0.4, atrPct: 0.6, trendScore: 1.6, adx: 24, emaStack: "bullish" },
          w800: { returnPct: 9.2, volPct: 0.5, atrPct: 0.7, trendScore: 2.4, adx: 23, emaStack: "bullish" }
        },
        regime: {
          state: "trend",
          confidencePct: 81,
          lastSwitchTs: 1771099200000,
          switchReason: "adx_trend_strength"
        }
      },
      events: [],
      anchors: {
        last: { ts: 1771099200000, o: 70000, h: 70100, l: 69900, c: 70050, v: 1234.56 }
      },
      lastBars: [[1771099200000, 70000, 70100, 69900, 70050, 1234.56]],
      meta: {
        version: "history-context-v1",
        bytes: 640,
        capped: false,
        maxEvents: 30,
        lastBars: 30,
        anchorMode: "standard"
      }
    },
    indicators: {
      rsi_14: 77.16
    },
    advancedIndicators: {
      smartMoneyConcepts: {
        internal: { trend: "bullish" }
      },
      cloud: { price_pos: 0.8 }
    },
    mtf: {
      runTimeframe: "5m",
      timeframes: ["1h", "5m"],
      frames: {
        "1h": {
          indicators: { rsi_14: 55.5, macd: { hist: 0.01 } },
          advancedIndicators: {
            smartMoneyConcepts: {
              internal: { trend: "bullish" }
            },
            cloud: { price_pos: 0.7 }
          }
        }
      }
    }
  } as Record<string, unknown>;

  const filtered = filterFeatureSnapshotForAiPrompt(snapshot, ["smc"]);

  assert.equal("rsi" in filtered, false);
  assert.equal("emaSpread" in filtered, false);
  assert.equal(filtered.prefillExchange, "paper");
  assert.deepEqual(filtered.meta, { indicatorSettingsHash: "abc" });
  assert.equal((filtered as any).ohlcvSeries?.timeframe, "15m");
  assert.equal(Array.isArray((filtered as any).ohlcvSeries?.bars), true);
  assert.equal((filtered as any).historyContext?.summaries?.regime?.state, "trend");
  assert.equal(
    (filtered as any).advancedIndicators?.smartMoneyConcepts?.internal?.trend,
    "bullish"
  );
  assert.equal((filtered as any).advancedIndicators?.cloud, undefined);
  assert.equal((filtered as any).indicators, undefined);
  assert.equal(
    (filtered as any).mtf?.frames?.["1h"]?.advancedIndicators?.smartMoneyConcepts?.internal?.trend,
    "bullish"
  );
  assert.equal((filtered as any).mtf?.frames?.["1h"]?.advancedIndicators?.cloud, undefined);
});

test("filterFeatureSnapshotForAiPrompt includes selected core indicator paths", () => {
  const snapshot = {
    indicators: {
      rsi_14: 45.2,
      macd: { hist: 0.01 }
    },
    prefillExchange: "bitget"
  } as Record<string, unknown>;

  const filtered = filterFeatureSnapshotForAiPrompt(snapshot, ["rsi"]);
  assert.equal(filtered.prefillExchange, "bitget");
  assert.equal((filtered as any).indicators?.rsi_14, 45.2);
  assert.equal((filtered as any).indicators?.macd, undefined);
});

test("filterFeatureSnapshotForAiPrompt includes breaker blocks when selected", () => {
  const snapshot = {
    indicators: {
      breakerBlocks: {
        dir: 1,
        top: 105.2,
        signals: { BBplus: true }
      },
      vumanchu: {
        waveTrend: { wt1: 10 }
      }
    }
  } as Record<string, unknown>;

  const filtered = filterFeatureSnapshotForAiPrompt(snapshot, ["breaker_blocks"]);
  assert.equal((filtered as any).indicators?.breakerBlocks?.dir, 1);
  assert.equal((filtered as any).indicators?.vumanchu, undefined);
});

test("ai prompt template defaults marketAnalysisUpdateEnabled to false", () => {
  const parsed = parseStoredAiPromptSettings({
    activePromptId: "prompt_a",
    prompts: [
      {
        id: "prompt_a",
        name: "A",
        promptText: "x",
        indicatorKeys: ["rsi"],
        ohlcvBars: 100,
        timeframe: null,
        directionPreference: "either",
        confidenceTargetPct: 60,
        isPublic: false
      }
    ]
  });

  assert.equal(parsed.prompts[0]?.marketAnalysisUpdateEnabled, false);
  assert.equal(parsed.prompts[0]?.slTpSource, "local");
  assert.deepEqual(parsed.prompts[0]?.timeframes, []);
  assert.equal(parsed.prompts[0]?.runTimeframe, null);
});

test("ai prompt template keeps marketAnalysisUpdateEnabled=true and exposes it in runtime settings", () => {
  const parsed = parseStoredAiPromptSettings({
    activePromptId: "prompt_analysis",
    prompts: [
      {
        id: "prompt_analysis",
        name: "Analysis",
        promptText: "analysis only",
        indicatorKeys: ["history_context"],
        ohlcvBars: 120,
        timeframes: ["1h", "5m"],
        runTimeframe: "5m",
        timeframe: "4h",
        directionPreference: "either",
        confidenceTargetPct: 60,
        marketAnalysisUpdateEnabled: true,
        isPublic: true
      }
    ]
  });

  assert.equal(parsed.prompts[0]?.marketAnalysisUpdateEnabled, true);
  assert.deepEqual(parsed.prompts[0]?.timeframes, ["1h", "5m"]);
  assert.equal(parsed.prompts[0]?.runTimeframe, "5m");
  assert.equal(parsed.prompts[0]?.timeframe, "5m");
  const runtime = resolveAiPromptRuntimeSettingsForContext(parsed, {}, "db");
  assert.equal(runtime.marketAnalysisUpdateEnabled, true);
  assert.deepEqual(runtime.timeframes, ["1h", "5m"]);
  assert.equal(runtime.runTimeframe, "5m");
});

test("legacy timeframe maps to timeframes and runTimeframe", () => {
  const parsed = parseStoredAiPromptSettings({
    activePromptId: "prompt_legacy",
    prompts: [
      {
        id: "prompt_legacy",
        name: "Legacy",
        promptText: "x",
        indicatorKeys: ["rsi"],
        ohlcvBars: 100,
        timeframe: "15m",
        directionPreference: "either",
        confidenceTargetPct: 60,
        isPublic: false
      }
    ]
  });

  assert.deepEqual(parsed.prompts[0]?.timeframes, ["15m"]);
  assert.equal(parsed.prompts[0]?.runTimeframe, "15m");
  assert.equal(parsed.prompts[0]?.timeframe, "15m");
});

test("invalid runTimeframe is normalized to first timeframe", () => {
  const parsed = parseStoredAiPromptSettings({
    activePromptId: "prompt_mtf",
    prompts: [
      {
        id: "prompt_mtf",
        name: "MTF",
        promptText: "x",
        indicatorKeys: ["rsi"],
        ohlcvBars: 100,
        timeframes: ["1h", "5m"],
        runTimeframe: "4h",
        directionPreference: "either",
        confidenceTargetPct: 60,
        isPublic: false
      }
    ]
  });

  assert.deepEqual(parsed.prompts[0]?.timeframes, ["1h", "5m"]);
  assert.equal(parsed.prompts[0]?.runTimeframe, "1h");
  assert.equal(parsed.prompts[0]?.timeframe, "1h");
});

test("ai prompt template keeps configured slTpSource in runtime settings", () => {
  const parsed = parseStoredAiPromptSettings({
    activePromptId: "prompt_levels",
    prompts: [
      {
        id: "prompt_levels",
        name: "Levels",
        promptText: "x",
        indicatorKeys: ["history_context"],
        ohlcvBars: 100,
        timeframes: ["1h"],
        runTimeframe: "1h",
        directionPreference: "either",
        confidenceTargetPct: 60,
        slTpSource: "hybrid",
        isPublic: false
      }
    ]
  });

  assert.equal(parsed.prompts[0]?.slTpSource, "hybrid");
  const runtime = resolveAiPromptRuntimeSettingsForContext(parsed, {}, "db");
  assert.equal(runtime.slTpSource, "hybrid");
});

test("ai prompt template keeps up to 8000 chars and trims beyond", () => {
  const overLimit = "x".repeat(8500);
  const parsed = parseStoredAiPromptSettings({
    activePromptId: "prompt_long",
    prompts: [
      {
        id: "prompt_long",
        name: "Long",
        promptText: overLimit,
        indicatorKeys: ["rsi"],
        ohlcvBars: 100,
        directionPreference: "either",
        confidenceTargetPct: 60,
        isPublic: false
      }
    ]
  });

  assert.equal(parsed.prompts[0]?.promptText.length, 8000);
});
