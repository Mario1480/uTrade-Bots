import test from "node:test";
import assert from "node:assert/strict";
import { filterFeatureSnapshotForAiPrompt } from "./promptSettings.js";

test("filterFeatureSnapshotForAiPrompt keeps only selected indicators and context keys", () => {
  const snapshot = {
    rsi: 77.16,
    emaSpread: 0.02,
    prefillExchange: "paper",
    meta: { indicatorSettingsHash: "abc" },
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
