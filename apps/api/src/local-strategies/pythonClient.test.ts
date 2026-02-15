import assert from "node:assert/strict";
import test from "node:test";
import {
  PythonStrategyClientError,
  runPythonStrategy
} from "./pythonClient.js";

const originalFetch = globalThis.fetch;

function withMockFetch(fn: typeof fetch) {
  (globalThis as any).fetch = fn;
}

function restoreFetch() {
  (globalThis as any).fetch = originalFetch;
}

test("runPythonStrategy normalizes successful response", async () => {
  process.env.PY_STRATEGY_ENABLED = "true";
  process.env.PY_STRATEGY_URL = "http://python.local";
  withMockFetch(async () => {
    return new Response(JSON.stringify({
      allow: true,
      score: 92,
      reasonCodes: ["ok"],
      tags: ["trend_up"],
      explanation: "ok",
      meta: { runtimeMs: 12 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await runPythonStrategy({
    strategyType: "regime_gate",
    config: {},
    featureSnapshot: {},
    context: {}
  });
  assert.equal(result.allow, true);
  assert.equal(result.score, 92);
  assert.equal(result.meta.engine, "python");
  restoreFetch();
});

test("runPythonStrategy throws for invalid json", async () => {
  process.env.PY_STRATEGY_ENABLED = "true";
  process.env.PY_STRATEGY_URL = "http://python.local";
  withMockFetch(async () => {
    return new Response("{invalid", { status: 200, headers: { "content-type": "application/json" } });
  });

  await assert.rejects(
    () => runPythonStrategy({
      strategyType: "regime_gate",
      config: {},
      featureSnapshot: {},
      context: {}
    }),
    (error: unknown) => {
      assert.equal(error instanceof PythonStrategyClientError, true);
      assert.equal((error as PythonStrategyClientError).code, "invalid_json");
      return true;
    }
  );
  restoreFetch();
});

test("runPythonStrategy throws when disabled", async () => {
  process.env.PY_STRATEGY_ENABLED = "false";
  await assert.rejects(
    () => runPythonStrategy({
      strategyType: "regime_gate",
      config: {},
      featureSnapshot: {},
      context: {}
    }),
    (error: unknown) => {
      assert.equal(error instanceof PythonStrategyClientError, true);
      assert.equal((error as PythonStrategyClientError).code, "disabled");
      return true;
    }
  );
});
