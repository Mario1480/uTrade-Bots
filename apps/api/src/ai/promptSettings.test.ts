import test from "node:test";
import assert from "node:assert/strict";
import { filterFeatureSnapshotForAiPrompt } from "./promptSettings.js";

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
