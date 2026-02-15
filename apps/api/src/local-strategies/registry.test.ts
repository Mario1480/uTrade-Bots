import assert from "node:assert/strict";
import test from "node:test";
import {
  listRegisteredLocalStrategies,
  runLocalStrategy,
  type LocalStrategyDefinitionRecord
} from "./registry.js";

function buildDefinition(overrides: Partial<LocalStrategyDefinitionRecord> = {}): LocalStrategyDefinitionRecord {
  return {
    id: "strategy_1",
    strategyType: "regime_gate",
    name: "Regime Gate",
    description: null,
    version: "1.0.0",
    inputSchema: null,
    configJson: {},
    isEnabled: true,
    createdAt: new Date("2026-02-15T00:00:00.000Z"),
    updatedAt: new Date("2026-02-15T00:00:00.000Z"),
    ...overrides
  };
}

const baseSnapshot = {
  tags: ["trend_up"],
  historyContext: {
    reg: {
      state: "trend_up",
      conf: 76,
      since: "2026-02-15T10:00:00.000Z",
      why: ["ema_stack_bull"]
    },
    ema: {
      stk: "bull"
    },
    vol: {
      z: 0.8
    }
  }
};

function hasInvalidNumber(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasInvalidNumber(item));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasInvalidNumber(item));
  }
  if (typeof value === "number") return !Number.isFinite(value) || Number.isNaN(value);
  return false;
}

test("builtin strategy registry contains regime_gate and signal_filter", () => {
  const types = listRegisteredLocalStrategies().map((item) => item.type).sort();
  assert.deepEqual(types, ["regime_gate", "signal_filter"]);
});

test("runLocalStrategy is deterministic for same snapshot/config", async () => {
  const definition = buildDefinition();
  const getById = async (id: string) => (id === definition.id ? definition : null);

  const first = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up", timeframe: "15m" }, {
    getStrategyById: getById
  });
  const second = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up", timeframe: "15m" }, {
    getStrategyById: getById
  });

  assert.deepEqual(second, first);
});

test("runLocalStrategy enforces null safety (no NaN/Infinity)", async () => {
  const definition = buildDefinition({
    strategyType: "signal_filter",
    configJson: {
      maxVolZ: Infinity,
      blockedTags: ["news_risk"]
    }
  });

  const snapshot = {
    ...baseSnapshot,
    historyContext: {
      ...baseSnapshot.historyContext,
      vol: {
        z: Number.NaN
      }
    }
  };

  const result = await runLocalStrategy(definition.id, snapshot, { signal: "up" }, {
    getStrategyById: async () => definition
  });

  assert.equal(hasInvalidNumber(result), false);
});

test("snapshot hash is idempotent and changes on input changes", async () => {
  const definition = buildDefinition();
  const deps = { getStrategyById: async () => definition };

  const base = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, deps);
  const same = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, deps);
  const changed = await runLocalStrategy(definition.id, {
    ...baseSnapshot,
    historyContext: {
      ...baseSnapshot.historyContext,
      reg: {
        ...baseSnapshot.historyContext.reg,
        state: "trend_down"
      }
    }
  }, { signal: "up" }, deps);

  assert.equal(base.snapshotHash, same.snapshotHash);
  assert.notEqual(base.snapshotHash, changed.snapshotHash);
});

test("disabled strategy returns deterministic skipped result", async () => {
  const definition = buildDefinition({ isEnabled: false });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition
  });

  assert.equal(result.allow, false);
  assert.deepEqual(result.reasonCodes, ["strategy_disabled"]);
});
