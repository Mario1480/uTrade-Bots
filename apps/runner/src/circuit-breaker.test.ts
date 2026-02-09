import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCircuitBreakerOutcome,
  defaultCircuitBreakerState,
  type CircuitBreakerConfig
} from "./circuit-breaker.js";

const config: CircuitBreakerConfig = {
  maxErrors: 3,
  windowSeconds: 60,
  cooldownSeconds: 300,
  action: "stop"
};

test("circuit breaker trips after threshold in window", () => {
  const t0 = new Date("2026-02-09T00:00:00.000Z");
  const s0 = defaultCircuitBreakerState();

  const s1 = applyCircuitBreakerOutcome({
    outcome: "error",
    state: s0,
    config,
    now: t0,
    errorMessage: "err1"
  });
  assert.equal(s1.tripped, false);
  assert.equal(s1.state.consecutiveErrors, 1);

  const s2 = applyCircuitBreakerOutcome({
    outcome: "error",
    state: s1.state,
    config,
    now: new Date(t0.getTime() + 10_000),
    errorMessage: "err2"
  });
  assert.equal(s2.tripped, false);
  assert.equal(s2.state.consecutiveErrors, 2);

  const s3 = applyCircuitBreakerOutcome({
    outcome: "error",
    state: s2.state,
    config,
    now: new Date(t0.getTime() + 20_000),
    errorMessage: "err3"
  });
  assert.equal(s3.tripped, true);
  assert.equal(s3.state.consecutiveErrors, 3);
});

test("circuit breaker window resets after timeout", () => {
  const t0 = new Date("2026-02-09T00:00:00.000Z");

  const s1 = applyCircuitBreakerOutcome({
    outcome: "error",
    state: defaultCircuitBreakerState(),
    config,
    now: t0,
    errorMessage: "err1"
  });

  const s2 = applyCircuitBreakerOutcome({
    outcome: "error",
    state: s1.state,
    config,
    now: new Date(t0.getTime() + 61_000),
    errorMessage: "err2"
  });

  assert.equal(s2.tripped, false);
  assert.equal(s2.state.consecutiveErrors, 1);
  assert.equal(s2.state.errorWindowStartAt?.toISOString(), new Date(t0.getTime() + 61_000).toISOString());
});

test("non-error blocked outcome does not increment errors", () => {
  const t0 = new Date("2026-02-09T00:00:00.000Z");
  const s1 = applyCircuitBreakerOutcome({
    outcome: "error",
    state: defaultCircuitBreakerState(),
    config,
    now: t0,
    errorMessage: "err1"
  });

  const sBlocked = applyCircuitBreakerOutcome({
    outcome: "blocked",
    state: s1.state,
    config,
    now: new Date(t0.getTime() + 5_000)
  });

  assert.equal(sBlocked.tripped, false);
  assert.equal(sBlocked.state.consecutiveErrors, 1);
});
