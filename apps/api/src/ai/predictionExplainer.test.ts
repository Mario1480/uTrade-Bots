import assert from "node:assert/strict";
import test from "node:test";
import { resetAiAnalyzerState } from "./analyzer.js";
import {
  buildPredictionExplainerPromptPreview,
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
    spreadBps: 8,
    advancedIndicators: {
      emas: {
        ema_5: 70110,
        ema_13: 70092,
        ema_50: 70040,
        ema_200: 69780,
        ema_800: 68110,
        emaStack: { bullishStack: true, bearishStack: false },
        emaDistancesPct: {
          spread_13_50_pct: 0.074,
          spread_50_200_pct: 0.372
        }
      },
      cloud: { price_pos: 0.88 },
      pvsra: { vectorTier: "high", vectorColor: "blue" },
      smartMoneyConcepts: {
        internal: {
          trend: "bullish",
          lastEvent: { type: "bos", direction: "bullish", level: 70020, ts: 1739085600000 },
          bullishBreaks: 4,
          bearishBreaks: 1
        },
        swing: {
          trend: "bullish",
          lastEvent: { type: "choch", direction: "bullish", level: 69980, ts: 1739085900000 },
          bullishBreaks: 2,
          bearishBreaks: 1
        },
        equalLevels: {
          eqh: { detected: false, level: null, ts: null, deltaPct: null },
          eql: { detected: false, level: null, ts: null, deltaPct: null }
        },
        orderBlocks: {
          internal: { bullishCount: 2, bearishCount: 1, latestBullish: null, latestBearish: null },
          swing: { bullishCount: 1, bearishCount: 0, latestBullish: null, latestBearish: null }
        },
        fairValueGaps: {
          bullishCount: 1,
          bearishCount: 0,
          latestBullish: null,
          latestBearish: null,
          autoThresholdPct: 0.04
        },
        zones: {
          trailingTop: 70140,
          trailingBottom: 69510,
          premiumTop: 70140,
          premiumBottom: 70008.5,
          equilibriumTop: 69840.75,
          equilibriumBottom: 69809.25,
          discountTop: 69641.5,
          discountBottom: 69510
        },
        dataGap: false
      }
    },
    indicators: {
      rsi_14: 57.2,
      macd: { line: 0.1, signal: 0.08, hist: 0.02 },
      bb: { upper: 101, mid: 100, lower: 99, width_pct: 2, pos: 0.6 },
      vwap: { value: 100.1, dist_pct: 0.4, mode: "session_utc" },
      adx: { adx_14: 21.5, plus_di_14: 24.1, minus_di_14: 19.7 },
      stochrsi: { rsi_len: 14, stoch_len: 14, smooth_k: 3, smooth_d: 3, k: 82.4, d: 78.1, value: 82.4 },
      volume: { lookback: 100, vol_z: 2.1, rel_vol: 1.92, vol_ema_fast: 126.2, vol_ema_slow: 113.1, vol_trend: 11.58 },
      fvg: {
        lookback: 300,
        fill_rule: "overlap",
        open_bullish_count: 1,
        open_bearish_count: 0,
        nearest_bullish_gap: { upper: 70120, lower: 70080, mid: 70100, dist_pct: 0.12, age_bars: 4 },
        nearest_bearish_gap: { upper: null, lower: null, mid: null, dist_pct: null, age_bars: null },
        last_created: { type: "bullish", age_bars: 4 },
        last_filled: { type: "bearish", age_bars: 17 }
      }
    }
  }
};

function makeHistoryContextForCache(ts = "2026-02-14T12:00:00.000Z") {
  return {
    v: 1,
    tf: "15m",
    ts_to: ts,
    lastBars: {
      n: 12,
      ohlc: Array.from({ length: 12 }, (_, idx) => ({
        t: 1_771_000_000 + idx,
        o: 70000,
        h: 70010,
        l: 69990,
        c: 70005,
        v: 123 + idx
      }))
    },
    win: {
      w20: { ret: 1, vr: 0.8, atr: 0.4, tr: 60, mx: 1.2, dd: -0.7 },
      w50: { ret: 2, vr: 0.7, atr: 0.5, tr: 62, mx: 2.1, dd: -1.2 },
      w200: { ret: 4, vr: 0.6, atr: 0.6, tr: 58, mx: 3.8, dd: -2.3 },
      w800: { ret: 7, vr: 0.5, atr: 0.7, tr: 52, mx: 7.1, dd: -3.4 }
    },
    reg: {
      state: "transition",
      conf: 56,
      since: "2026-02-14T11:30:00.000Z",
      why: ["trend_strong"]
    },
    lvl: {
      pivD: { pp: null, r1: null, s1: null, r2: null, s2: null },
      hiLo: { yH: null, yL: null, wH: null, wL: null },
      do: { p: null }
    },
    ema: {
      e5: 1,
      e13: 1,
      e50: 1,
      e200: 1,
      e800: 1,
      stk: "bull",
      d50: 0.2,
      d200: 0.5,
      d800: 1.1,
      sl50: 0.01,
      sl200: 0.005
    },
    vol: { z: 0.8, rv: 1.1, tr: 0.3 },
    fvg: {
      ob: 2,
      os: 1,
      nb: { m: 70000, d: 0.12, a: 4 },
      ns: { m: 69800, d: -0.18, a: 6 }
    },
    ls: { le: null, nb: null, ns: null },
    ev: Array.from({ length: 8 }, (_, idx) => ({
      t: new Date(1_771_100_000_000 + idx * 60_000).toISOString(),
      ty: `event_${idx}`,
      i: 3
    })),
    bud: {
      bytes: 2048,
      trim: []
    }
  };
}

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

test("nested keyDrivers paths are accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up with MACD and RSI confirmation.",
      tags: ["trend_up"],
      keyDrivers: [
        { name: "indicators.rsi_14", value: 57.2 },
        { name: "indicators.macd.hist", value: 0.02 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 2);
});

test("featureSnapshot-prefixed keyDrivers paths are normalized and accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up with MACD and RSI confirmation.",
      tags: ["trend_up"],
      keyDrivers: [
        { name: "featureSnapshot.indicators.rsi_14", value: 57.2 },
        { name: "$.featureSnapshot.indicators.macd.hist", value: 0.02 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.deepEqual(
    value.keyDrivers.map((driver) => driver.name),
    ["indicators.rsi_14", "indicators.macd.hist"]
  );
});

test("v2 indicator keyDrivers paths are accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up with elevated StochRSI and volume expansion near open gap.",
      tags: ["breakout_risk", "mean_reversion"],
      keyDrivers: [
        { name: "indicators.stochrsi.k", value: 82.4 },
        { name: "indicators.volume.rel_vol", value: 1.92 },
        { name: "indicators.fvg.open_bullish_count", value: 1 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 3);
});

test("advancedIndicators keyDrivers paths are accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up while EMA structure remains stacked and cloud position is elevated.",
      tags: ["trend_up"],
      keyDrivers: [
        { name: "advancedIndicators.emas.ema_50", value: 70040 },
        { name: "advancedIndicators.emas.emaDistancesPct.spread_13_50_pct", value: 0.074 },
        { name: "advancedIndicators.cloud.price_pos", value: 0.88 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 3);
});

test("legacy tradersReality keyDrivers remain accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Signal up while EMA structure remains stacked and cloud position is elevated.",
      tags: ["trend_up"],
      keyDrivers: [
        { name: "tradersReality.emas.ema_50", value: 70040 },
        { name: "tradersReality.emas.emaDistancesPct.spread_13_50_pct", value: 0.074 },
        { name: "tradersReality.cloud.price_pos", value: 0.88 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 3);
});

test("smartMoneyConcepts keyDrivers paths are accepted", () => {
  const value = validateExplainerOutput(
    {
      explanation: "SMC structure remains bullish with recent CHoCH and active bullish blocks.",
      tags: ["trend_up", "breakout_risk"],
      keyDrivers: [
        { name: "advancedIndicators.smartMoneyConcepts.swing.lastEvent.type", value: "choch" },
        { name: "advancedIndicators.smartMoneyConcepts.orderBlocks.internal.bullishCount", value: 2 },
        { name: "advancedIndicators.smartMoneyConcepts.fairValueGaps.bullishCount", value: 1 }
      ],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );

  assert.equal(value.keyDrivers.length, 3);
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

test("hallucination guard filters keyDrivers not in featureSnapshot", () => {
  const value = validateExplainerOutput(
    {
      explanation: "Invalid driver usage",
      tags: ["trend_up"],
      keyDrivers: [{ name: "inventedDriver", value: 123 }],
      disclaimer: "grounded_features_only"
    },
    baseInput.featureSnapshot
  );
  assert.equal(value.keyDrivers.length, 0);
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
  assert.equal(output.explanation.length <= 1000, true);
  assert.equal(Array.isArray(output.tags), true);
});

test("fallback path is used on timeout error", async () => {
  resetAiAnalyzerState();
  const promptSettings = {
    promptText: "",
    indicatorKeys: [
      "rsi",
      "macd",
      "adx",
      "bollinger",
      "vwap",
      "stochrsi",
      "volume",
      "fvg",
      "history_context",
      "emas_cloud",
      "levels",
      "ranges",
      "sessions",
      "pvsra",
      "smc"
    ] as const,
    ohlcvBars: 100,
    timeframes: [],
    runTimeframe: null,
    timeframe: null,
    directionPreference: "either" as const,
    confidenceTargetPct: 60,
    marketAnalysisUpdateEnabled: false,
    source: "db" as const,
    activePromptId: "test",
    activePromptName: "test",
    selectedFrom: "active_prompt" as const,
    matchedScopeType: null,
    matchedOverrideId: null
  };

  const output = await generatePredictionExplanation(
    {
      ...baseInput,
      tsCreated: "2026-02-09T10:00:02.000Z"
    },
    {
      promptSettings,
      callAiFn: async () => {
        throw new Error("timeout");
      }
    }
  );

  const preview = await buildPredictionExplainerPromptPreview({
    ...baseInput,
    tsCreated: "2026-02-09T10:00:02.000Z"
  }, {
    promptSettings
  });
  const expectedFallback = fallbackExplain(preview.promptInput);

  assert.equal(output.disclaimer, "grounded_features_only");
  assert.equal(output.explanation, expectedFallback.explanation);
});

test("fallback derives v2-based tags when snapshot supports them", () => {
  const out = fallbackExplain(baseInput);
  assert.equal(out.tags.includes("mean_reversion"), true);
  assert.equal(out.tags.includes("breakout_risk"), true);
});

test("prompt preview trims ohlcvSeries and historyContext independently", async () => {
  const ohlcvBars = Array.from({ length: 90 }, (_, idx) => [
    1_771_100_000_000 + idx * 60_000,
    70_000,
    70_010,
    69_990,
    70_005,
    123.45
  ]);
  const historyBars = Array.from({ length: 45 }, (_, idx) => [
    1_771_100_000_000 + idx * 60_000,
    70_000,
    70_010,
    69_990,
    70_005,
    123.45
  ]);

  const input: ExplainerInput = {
    ...baseInput,
    featureSnapshot: {
      ...baseInput.featureSnapshot,
      ohlcvSeries: {
        timeframe: "15m",
        format: ["ts", "open", "high", "low", "close", "volume"],
        bars: ohlcvBars,
        count: ohlcvBars.length
      },
      historyContext: {
        v: 1,
        tf: "15m",
        ts_to: "2026-02-14T12:00:00.000Z",
        lastBars: {
          n: historyBars.length,
          ohlc: historyBars.map((row) => ({
            t: Math.trunc(Number(row[0]) / 1000),
            o: Number(row[1]),
            h: Number(row[2]),
            l: Number(row[3]),
            c: Number(row[4]),
            v: Number(row[5])
          }))
        },
        win: {
          w20: { ret: 1, vr: 1, atr: 1, tr: 60, mx: 1.2, dd: -0.8 },
          w50: { ret: 1, vr: 1, atr: 1, tr: 65, mx: 2.1, dd: -1.3 },
          w200: { ret: 1, vr: 1, atr: 1, tr: 55, mx: 4.3, dd: -2.4 },
          w800: { ret: 1, vr: 1, atr: 1, tr: 50, mx: 8.7, dd: -4.2 }
        },
        reg: {
          state: "transition",
          conf: 62,
          since: "2026-02-14T11:30:00.000Z",
          why: ["trend_strong"]
        },
        lvl: {
          pivD: { pp: null, r1: null, s1: null, r2: null, s2: null },
          hiLo: { yH: null, yL: null, wH: null, wL: null },
          do: { p: null }
        },
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
        },
        vol: { z: 0.8, rv: 1.1, tr: 0.3 },
        fvg: {
          ob: 2,
          os: 1,
          nb: { m: 70000, d: 0.12, a: 4 },
          ns: { m: 69800, d: -0.18, a: 6 }
        },
        ls: { le: null, nb: null, ns: null },
        ev: Array.from({ length: 42 }, (_, idx) => ({
          t: new Date(1_771_100_000_000 + idx * 60_000).toISOString(),
          ty: `event_${idx}`,
          i: 3
        })),
        bud: {
          bytes: 0,
          trim: []
        }
      }
    }
  };

  const preview = await buildPredictionExplainerPromptPreview(input, {
    promptSettings: {
      promptText: "",
      indicatorKeys: ["smc"],
      ohlcvBars: 25,
      timeframes: [],
      runTimeframe: null,
      timeframe: null,
      directionPreference: "either",
      confidenceTargetPct: 60,
      marketAnalysisUpdateEnabled: false,
      source: "db",
      activePromptId: "prompt_test",
      activePromptName: "Test",
      selectedFrom: "active_prompt",
      matchedScopeType: null,
      matchedOverrideId: null
    }
  });

  const snapshot = preview.promptInput.featureSnapshot as any;
  assert.equal(snapshot.ohlcvSeries.bars.length, 25);
  assert.ok(snapshot.historyContext.lastBars.ohlc.length <= 30);
  assert.ok(snapshot.historyContext.ev.length <= 30);
  assert.equal(snapshot.historyContext.lastBars.ohlc.length > snapshot.ohlcvSeries.bars.length, true);
});

test("cache reuses response when market state is unchanged", async () => {
  resetAiAnalyzerState();
  let aiCalls = 0;
  const rawResponse = JSON.stringify({
    explanation: "Signal up with aligned momentum.",
    tags: ["trend_up"],
    keyDrivers: [{ name: "rsi", value: 57.2 }],
    aiPrediction: { signal: "up", expectedMovePct: 1.1, confidence: 0.64 },
    disclaimer: "grounded_features_only"
  });

  const inputA: ExplainerInput = {
    ...baseInput,
    tsCreated: "2026-02-09T10:10:00.000Z"
  };
  const inputB: ExplainerInput = {
    ...baseInput,
    tsCreated: "2026-02-09T10:12:00.000Z"
  };

  const first = await generatePredictionExplanation(inputA, {
    callAiFn: async () => {
      aiCalls += 1;
      return rawResponse;
    }
  });
  const second = await generatePredictionExplanation(inputB, {
    callAiFn: async () => {
      aiCalls += 1;
      return rawResponse;
    }
  });

  assert.equal(aiCalls, 1);
  assert.deepEqual(first, second);
});

test("cache key ignores historyContext.bud.bytes but changes with history content", async () => {
  const promptSettings = {
    promptText: "",
    indicatorKeys: ["smc", "history_context"] as const,
    ohlcvBars: 100,
    timeframes: [],
    runTimeframe: null,
    timeframe: null,
    directionPreference: "either" as const,
    confidenceTargetPct: 60,
    marketAnalysisUpdateEnabled: false,
    source: "db" as const,
    activePromptId: "prompt_smc",
    activePromptName: "SMC",
    selectedFrom: "active_prompt" as const,
    matchedScopeType: null,
    matchedOverrideId: null
  };
  const historyA = makeHistoryContextForCache();
  const historyB = {
    ...makeHistoryContextForCache(),
    bud: {
      bytes: 9999,
      trim: []
    }
  };
  const historyC = {
    ...makeHistoryContextForCache(),
    reg: {
      ...makeHistoryContextForCache().reg,
      state: "range"
    }
  };

  const previewA = await buildPredictionExplainerPromptPreview({
    ...baseInput,
    featureSnapshot: { ...baseInput.featureSnapshot, historyContext: historyA }
  }, { promptSettings });
  const previewB = await buildPredictionExplainerPromptPreview({
    ...baseInput,
    featureSnapshot: { ...baseInput.featureSnapshot, historyContext: historyB }
  }, { promptSettings });
  const previewC = await buildPredictionExplainerPromptPreview({
    ...baseInput,
    featureSnapshot: { ...baseInput.featureSnapshot, historyContext: historyC }
  }, { promptSettings });

  assert.equal(previewA.cacheKey, previewB.cacheKey);
  assert.notEqual(previewA.cacheKey, previewC.cacheKey);
});

test("grounding filters dropped historyContext driver paths after budget trim", () => {
  const trimmedFeatureSnapshot = {
    ...baseInput.featureSnapshot
  };

  const value = validateExplainerOutput(
    {
      explanation: "Invalid use of dropped field",
      tags: ["range_bound"],
      keyDrivers: [{ name: "historyContext.reg.state", value: "range" }],
      disclaimer: "grounded_features_only"
    },
    trimmedFeatureSnapshot
  );

  assert.equal(value.keyDrivers.length, 0);
});

test.afterEach(() => {
  resetAiAnalyzerState();
});
