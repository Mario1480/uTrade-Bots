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
    advancedIndicators: { openingRangeMin: 45 },
    indicatorsV2: { fvg: { fillRule: "mid_touch" } }
  });

  assert.equal(merged.enabledPacks.advancedIndicators, false);
  assert.equal(merged.advancedIndicators.openingRangeMin, 45);
  assert.equal(merged.indicatorsV2.fvg.fillRule, "mid_touch");
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
