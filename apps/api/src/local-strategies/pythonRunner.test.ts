import assert from "node:assert/strict";
import test from "node:test";
import { PythonStrategyClientError } from "./pythonClient.js";
import {
  executePythonStrategy,
  getPythonRunnerMetrics,
  resetPythonRunnerStateForTests
} from "./pythonRunner.js";

function withEnv(overrides: Record<string, string>, fn: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return Promise.resolve()
    .then(() => fn())
    .finally(restore);
}

const baseInput = {
  strategyType: "regime_gate",
  config: {},
  featureSnapshot: {},
  context: {}
};

test("circuit breaker opens after repeated timeouts and skips calls", async () => {
  await withEnv({
    PY_STRATEGY_CB_WINDOW_MS: "60000",
    PY_STRATEGY_CB_MAX_FAILURES: "10",
    PY_STRATEGY_CB_MAX_TIMEOUTS: "2",
    PY_STRATEGY_CB_COOLDOWN_MS: "60000"
  }, async () => {
    resetPythonRunnerStateForTests();

    let callCount = 0;
    const runFn = async () => {
      callCount += 1;
      throw new PythonStrategyClientError("timed out", "timeout");
    };

    const first = await executePythonStrategy(baseInput, { runFn });
    const second = await executePythonStrategy(baseInput, { runFn });
    const third = await executePythonStrategy(baseInput, { runFn });

    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.equal(third.errorCode, "cb_open");
      assert.equal(third.meta.pythonSkipped, true);
      assert.equal(third.meta.skipReason, "circuit_breaker_open");
    }
    assert.equal(callCount, 2);

    const metrics = getPythonRunnerMetrics();
    assert.equal(metrics.cbOpen, true);
    assert.equal(metrics.cbOpenTotal >= 1, true);
    assert.equal(metrics.cbSkippedTotal >= 1, true);
  });
});

test("invalid json failure increments failure path and can open breaker", async () => {
  await withEnv({
    PY_STRATEGY_CB_WINDOW_MS: "60000",
    PY_STRATEGY_CB_MAX_FAILURES: "2",
    PY_STRATEGY_CB_MAX_TIMEOUTS: "10",
    PY_STRATEGY_CB_COOLDOWN_MS: "60000"
  }, async () => {
    resetPythonRunnerStateForTests();

    let callCount = 0;
    const runFn = async () => {
      callCount += 1;
      throw new PythonStrategyClientError("bad json", "invalid_json", 200);
    };

    const first = await executePythonStrategy(baseInput, { runFn });
    const second = await executePythonStrategy(baseInput, { runFn });
    const third = await executePythonStrategy(baseInput, { runFn });

    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.equal(third.errorCode, "cb_open");
    }
    assert.equal(callCount, 2);
  });
});

test("successful python run always includes TS runtimeMs and engine meta", async () => {
  resetPythonRunnerStateForTests();
  let nowValues = [1000, 1023];
  const nowMs = () => nowValues.shift() ?? 1023;
  const runFn = async () => ({
    allow: true,
    score: 80,
    reasonCodes: ["ok"],
    tags: ["trend_up"],
    explanation: "ok",
    meta: {}
  });

  const result = await executePythonStrategy(baseInput, { runFn, nowMs });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.result.meta.runtimeMs, 23);
    assert.equal(result.result.meta.engine, "python");
  }
});
