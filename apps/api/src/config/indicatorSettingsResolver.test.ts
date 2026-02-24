import assert from "node:assert/strict";
import test from "node:test";
import { clearIndicatorSettingsCache, resolveIndicatorSettings } from "./indicatorSettingsResolver.js";

function row(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.id ?? "row"),
    scopeType: String(overrides.scopeType ?? "global"),
    exchange: overrides.exchange ?? null,
    accountId: overrides.accountId ?? null,
    symbol: overrides.symbol ?? null,
    timeframe: overrides.timeframe ?? null,
    configJson: overrides.configJson ?? {},
    createdAt: overrides.createdAt ?? new Date("2026-02-12T10:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-02-12T10:00:00.000Z")
  };
}

test("resolveIndicatorSettings applies precedence global->account->symbol->symbol_tf", async () => {
  clearIndicatorSettingsCache();
  const db = {
    indicatorSetting: {
      findMany: async () => [
        row({
          id: "g1",
          scopeType: "global",
          configJson: {
            enabledPacks: { indicatorsV2: true },
            indicatorsV2: {
              volume: { lookback: 110 },
              breakerBlocks: { len: 4, showSPD: true }
            }
          }
        }),
        row({
          id: "a1",
          scopeType: "account",
          accountId: "acc_1",
          configJson: {
            indicatorsV2: {
              volume: { lookback: 150 },
              vumanchu: { wtChannelLen: 11 },
              breakerBlocks: { len: 8, enableTp: true }
            }
          }
        }),
        row({
          id: "s1",
          scopeType: "symbol",
          symbol: "BTCUSDT",
          configJson: {
            indicatorsV2: { fvg: { lookback: 500 } }
          }
        }),
        row({
          id: "st1",
          scopeType: "symbol_tf",
          symbol: "BTCUSDT",
          timeframe: "15m",
          configJson: {
            enabledPacks: { advancedIndicators: false }
          }
        })
      ]
    }
  };

  const resolved = await resolveIndicatorSettings({
    db,
    exchange: "bitget",
    accountId: "acc_1",
    symbol: "BTCUSDT",
    timeframe: "15m",
    skipCache: true
  });

  assert.equal(resolved.config.indicatorsV2.volume.lookback, 150);
  assert.equal(resolved.config.indicatorsV2.vumanchu.wtChannelLen, 11);
  assert.equal(resolved.config.indicatorsV2.fvg.lookback, 500);
  assert.equal(resolved.config.indicatorsV2.breakerBlocks.len, 8);
  assert.equal(resolved.config.indicatorsV2.breakerBlocks.enableTp, true);
  assert.equal(resolved.config.enabledPacks.advancedIndicators, false);
  assert.equal(resolved.breakdown.length, 4);
  assert.ok(resolved.hash.length >= 12);
});

test("resolveIndicatorSettings falls back to defaults when model is unavailable", async () => {
  clearIndicatorSettingsCache();
  const resolved = await resolveIndicatorSettings({
    db: {},
    exchange: "bitget",
    accountId: "acc_1",
    symbol: "BTCUSDT",
    timeframe: "15m",
    skipCache: true
  });

  assert.equal(resolved.config.enabledPacks.indicatorsV1, true);
  assert.equal(resolved.config.advancedIndicators.sessionsUseDST, true);
  assert.equal(resolved.breakdown.length, 0);
});
