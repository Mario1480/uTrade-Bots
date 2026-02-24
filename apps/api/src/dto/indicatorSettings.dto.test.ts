import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INDICATOR_SETTINGS,
  indicatorSettingsUpsertSchema,
  mergeIndicatorSettings,
  normalizeIndicatorSettingsPatch
} from "./indicatorSettings.dto.js";

test("normalizeIndicatorSettingsPatch accepts partial config", () => {
  const patch = normalizeIndicatorSettingsPatch({
    indicatorsV2: {
      volume: {
        lookback: 180
      }
    }
  });

  assert.equal(patch.indicatorsV2?.volume?.lookback, 180);
});

test("mergeIndicatorSettings applies nested overrides", () => {
  const merged = mergeIndicatorSettings(DEFAULT_INDICATOR_SETTINGS, {
    enabledPacks: { advancedIndicators: false },
    advancedIndicators: { openingRangeMin: 45, smcEqualThreshold: 0.2 },
    aiGating: { refreshIntervalSec: { "15m": 420 } },
    indicatorsV2: {
      fvg: { fillRule: "mid_touch" },
      vumanchu: { wtChannelLen: 11, useHiddenDiv: true },
      breakerBlocks: { len: 7, enableTp: true, rrTp2: 5.5 },
      superOrderBlockFvgBos: { plotRJB: true, pivotLookup: 3, hvbMultiplier: 2.2 }
    }
  });

  assert.equal(merged.enabledPacks.advancedIndicators, false);
  assert.equal(merged.advancedIndicators.openingRangeMin, 45);
  assert.equal(merged.advancedIndicators.smcEqualThreshold, 0.2);
  assert.equal(merged.indicatorsV2.fvg.fillRule, "mid_touch");
  assert.equal(merged.indicatorsV2.vumanchu.wtChannelLen, 11);
  assert.equal(merged.indicatorsV2.vumanchu.useHiddenDiv, true);
  assert.equal(merged.indicatorsV2.breakerBlocks.len, 7);
  assert.equal(merged.indicatorsV2.breakerBlocks.enableTp, true);
  assert.equal(merged.indicatorsV2.breakerBlocks.rrTp2, 5.5);
  assert.equal(merged.indicatorsV2.superOrderBlockFvgBos.plotRJB, true);
  assert.equal(merged.indicatorsV2.superOrderBlockFvgBos.pivotLookup, 3);
  assert.equal(merged.indicatorsV2.superOrderBlockFvgBos.hvbMultiplier, 2.2);
  assert.equal(merged.aiGating.refreshIntervalSec["15m"], 420);
  assert.equal(
    merged.aiGating.refreshIntervalSec["5m"],
    DEFAULT_INDICATOR_SETTINGS.aiGating.refreshIntervalSec["5m"]
  );
});

test("default indicator settings include breaker blocks defaults", () => {
  assert.equal(DEFAULT_INDICATOR_SETTINGS.indicatorsV2.breakerBlocks.len, 5);
  assert.equal(DEFAULT_INDICATOR_SETTINGS.indicatorsV2.breakerBlocks.tillFirstBreak, true);
  assert.equal(DEFAULT_INDICATOR_SETTINGS.indicatorsV2.breakerBlocks.enableTp, false);
  assert.equal(DEFAULT_INDICATOR_SETTINGS.indicatorsV2.superOrderBlockFvgBos.plotOB, true);
  assert.equal(DEFAULT_INDICATOR_SETTINGS.indicatorsV2.superOrderBlockFvgBos.pivotLookup, 1);
  assert.equal(DEFAULT_INDICATOR_SETTINGS.indicatorsV2.superOrderBlockFvgBos.hvbMultiplier, 1.5);
  assert.deepEqual(DEFAULT_INDICATOR_SETTINGS.aiGating.refreshIntervalSec, {
    "5m": 180,
    "15m": 300,
    "1h": 600,
    "4h": 1800,
    "1d": 10800
  });
});

test("normalizeIndicatorSettingsPatch maps legacy tradersReality keys", () => {
  const patch = normalizeIndicatorSettingsPatch({
    enabledPacks: { tradersReality: false },
    tradersReality: { openingRangeMin: 45 }
  });

  assert.equal(patch.enabledPacks?.advancedIndicators, false);
  assert.equal(patch.advancedIndicators?.openingRangeMin, 45);
});

test("indicatorSettingsUpsertSchema enforces scope requirements", () => {
  const invalid = indicatorSettingsUpsertSchema.safeParse({
    scopeType: "symbol_tf",
    symbol: "BTCUSDT",
    config: { enabledPacks: { indicatorsV2: false } }
  });

  assert.equal(invalid.success, false);

  const valid = indicatorSettingsUpsertSchema.safeParse({
    scopeType: "symbol_tf",
    symbol: "BTCUSDT",
    timeframe: "15m",
    config: { enabledPacks: { indicatorsV2: false } }
  });

  assert.equal(valid.success, true);
});

test("indicatorSettingsUpsertSchema allows refreshIntervalSec only for global scope", () => {
  const invalid = indicatorSettingsUpsertSchema.safeParse({
    scopeType: "account",
    accountId: "acc_1",
    config: {
      aiGating: {
        refreshIntervalSec: {
          "5m": 240
        }
      }
    }
  });

  assert.equal(invalid.success, false);

  const valid = indicatorSettingsUpsertSchema.safeParse({
    scopeType: "global",
    config: {
      aiGating: {
        refreshIntervalSec: {
          "5m": 240
        }
      }
    }
  });

  assert.equal(valid.success, true);
});
