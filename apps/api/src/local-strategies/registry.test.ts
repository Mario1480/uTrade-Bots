import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  listPythonStrategyRegistry,
  listRegisteredLocalStrategies,
  runLocalStrategy,
  type LocalStrategyDefinitionRecord
} from "./registry.js";

function buildDefinition(overrides: Partial<LocalStrategyDefinitionRecord> = {}): LocalStrategyDefinitionRecord {
  return {
    id: "strategy_1",
    strategyType: "regime_gate",
    engine: "ts",
    shadowMode: false,
    remoteStrategyType: null,
    fallbackStrategyType: null,
    timeoutMs: null,
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

test("python registry exposes fallback catalog when sidecar is disabled", async () => {
  const prev = process.env.PY_STRATEGY_ENABLED;
  process.env.PY_STRATEGY_ENABLED = "false";
  try {
    const registry = await listPythonStrategyRegistry();
    const types = registry.items.map((item) => item.type).sort();
    assert.equal(registry.enabled, false);
    assert.equal(types.includes("vmc_cipher_gate"), true);
    assert.equal(types.includes("vmc_divergence_reversal"), true);
  } finally {
    if (prev === undefined) delete process.env.PY_STRATEGY_ENABLED;
    else process.env.PY_STRATEGY_ENABLED = prev;
  }
});

test("python registry merges fallback catalog when sidecar list is partial", async () => {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "1.0.0" }));
      return;
    }
    if (url === "/v1/strategies") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        items: [
          {
            type: "regime_gate",
            name: "Regime Gate",
            version: "1.0.0",
            defaultConfig: {},
            uiSchema: {}
          }
        ]
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const prevEnabled = process.env.PY_STRATEGY_ENABLED;
  const prevUrl = process.env.PY_STRATEGY_URL;
  const prevToken = process.env.PY_STRATEGY_AUTH_TOKEN;
  process.env.PY_STRATEGY_ENABLED = "true";
  process.env.PY_STRATEGY_URL = baseUrl;
  delete process.env.PY_STRATEGY_AUTH_TOKEN;

  try {
    const registry = await listPythonStrategyRegistry();
    const types = registry.items.map((item) => item.type);
    assert.equal(registry.enabled, true);
    assert.equal(types.includes("regime_gate"), true);
    assert.equal(types.includes("vmc_cipher_gate"), true);
    assert.equal(types.includes("vmc_divergence_reversal"), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    if (prevEnabled === undefined) delete process.env.PY_STRATEGY_ENABLED;
    else process.env.PY_STRATEGY_ENABLED = prevEnabled;
    if (prevUrl === undefined) delete process.env.PY_STRATEGY_URL;
    else process.env.PY_STRATEGY_URL = prevUrl;
    if (prevToken === undefined) delete process.env.PY_STRATEGY_AUTH_TOKEN;
    else process.env.PY_STRATEGY_AUTH_TOKEN = prevToken;
  }
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

test("python engine returns python result when remote call succeeds", async () => {
  const definition = buildDefinition({
    strategyType: "regime_gate",
    engine: "python",
    remoteStrategyType: "regime_gate_py",
    timeoutMs: 900
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: true,
      result: {
        allow: true,
        score: 88,
        reasonCodes: ["regime_aligned"],
        tags: ["trend_up"],
        explanation: "Python regime gate passed.",
        meta: { runtimeMs: 22 }
      }
    })
  });

  assert.equal(result.allow, true);
  assert.equal(result.score, 88);
  assert.equal(result.meta.engine, "python");
  assert.equal(result.meta.remoteStrategyType, "regime_gate_py");
});

test("python engine falls back to TS strategy on remote error", async () => {
  const definition = buildDefinition({
    strategyType: "regime_gate",
    engine: "python",
    remoteStrategyType: "regime_gate_py",
    fallbackStrategyType: "signal_filter"
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: false,
      errorCode: "timeout",
      status: null,
      message: "timed out",
      meta: {}
    })
  });

  assert.equal(result.meta.engine, "ts");
  assert.equal(result.meta.mode, "fallback");
  assert.equal(result.meta.fallbackReason, "python_timeout");
});

test("python engine falls back when circuit breaker is open", async () => {
  const definition = buildDefinition({
    strategyType: "regime_gate",
    engine: "python",
    remoteStrategyType: "regime_gate_py",
    fallbackStrategyType: "signal_filter"
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: false,
      errorCode: "cb_open",
      status: null,
      message: "python circuit breaker is open",
      meta: {
        pythonSkipped: true,
        skipReason: "circuit_breaker_open",
        cbOpen: true
      }
    })
  });

  assert.equal(result.meta.mode, "fallback");
  assert.equal(result.meta.fallbackReason, "python_cb_open");
  assert.equal(result.meta.pythonFailure?.errorCode, "cb_open");
});

test("python engine without fallback returns blocked result", async () => {
  const definition = buildDefinition({
    strategyType: "unregistered_python_strategy",
    engine: "python",
    fallbackStrategyType: null
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: false,
      errorCode: "network_error",
      status: null,
      message: "connection refused",
      meta: {}
    })
  });

  assert.equal(result.allow, false);
  assert.deepEqual(result.reasonCodes, ["python_unavailable_no_fallback", "network_error"]);
});

test("shadowMode records python decision and enforces fallback decision", async () => {
  const definition = buildDefinition({
    strategyType: "regime_gate",
    engine: "python",
    shadowMode: true,
    fallbackStrategyType: "signal_filter"
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: true,
      result: {
        allow: true,
        score: 90,
        reasonCodes: ["python_ok"],
        tags: ["trend_up"],
        explanation: "python pass",
        meta: { runtimeMs: 5 }
      }
    })
  });

  assert.equal(result.meta.shadowMode, true);
  assert.equal(result.meta.engine, "ts");
  assert.equal(result.meta.mode, "fallback");
  assert.equal(result.meta.fallbackReason, "shadow_mode_not_enforced");
  assert.equal(Array.isArray(result.meta.pythonDecision?.reasonCodes), true);
  assert.equal(result.reasonCodes.includes("shadow_mode_not_enforced"), true);
});

test("trend_vol_gate python success in shadow mode keeps effective fallback and stores python runtime", async () => {
  const definition = buildDefinition({
    strategyType: "trend_vol_gate",
    engine: "python",
    shadowMode: true,
    remoteStrategyType: "trend_vol_gate",
    fallbackStrategyType: "signal_filter"
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: true,
      result: {
        allow: true,
        score: 86,
        reasonCodes: ["trend_vol_gate_pass"],
        tags: ["trend_up"],
        explanation: "TrendVolGate pass",
        meta: { runtimeMs: 17, engine: "python" }
      }
    })
  });

  assert.equal(result.meta.shadowMode, true);
  assert.equal(result.meta.engine, "ts");
  assert.equal(result.meta.mode, "fallback");
  assert.equal(result.meta.fallbackReason, "shadow_mode_not_enforced");
  assert.equal(result.meta.pythonDecision?.allow, true);
  assert.equal(result.meta.pythonDecision?.meta?.runtimeMs, 17);
  assert.equal(result.meta.pythonDecision?.meta?.engine, "python");
  assert.equal(result.reasonCodes.includes("shadow_mode_not_enforced"), true);
});

test("trend_vol_gate python success without shadow mode is enforced", async () => {
  const definition = buildDefinition({
    strategyType: "trend_vol_gate",
    engine: "python",
    shadowMode: false,
    remoteStrategyType: "trend_vol_gate",
    fallbackStrategyType: "signal_filter"
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: true,
      result: {
        allow: true,
        score: 84,
        reasonCodes: ["trend_vol_gate_pass"],
        tags: ["trend_up"],
        explanation: "TrendVolGate pass",
        meta: { runtimeMs: 19, engine: "python" }
      }
    })
  });

  assert.equal(result.allow, true);
  assert.equal(result.score, 84);
  assert.deepEqual(result.reasonCodes, ["trend_vol_gate_pass"]);
  assert.deepEqual(result.tags, ["trend_up"]);
  assert.equal(result.meta.engine, "python");
  assert.equal(result.meta.remoteStrategyType, "trend_vol_gate");
  assert.equal(result.meta.runtimeMs, 19);
});

test("trend_vol_gate cb_open skips python and uses fallback", async () => {
  const definition = buildDefinition({
    strategyType: "trend_vol_gate",
    engine: "python",
    shadowMode: false,
    remoteStrategyType: "trend_vol_gate",
    fallbackStrategyType: "signal_filter"
  });

  const result = await runLocalStrategy(definition.id, baseSnapshot, { signal: "up" }, {
    getStrategyById: async () => definition,
    runPythonStrategy: async () => ({
      ok: false,
      errorCode: "cb_open",
      status: null,
      message: "python circuit breaker is open",
      meta: {
        pythonSkipped: true,
        skipReason: "circuit_breaker_open",
        cbOpen: true
      }
    })
  });

  assert.equal(result.meta.engine, "ts");
  assert.equal(result.meta.mode, "fallback");
  assert.equal(result.meta.fallbackReason, "python_cb_open");
  assert.equal(result.meta.pythonFailure?.errorCode, "cb_open");
});
