import assert from "node:assert/strict";
import test from "node:test";
import { computeRetryDelayMs, shouldRetryExchangeError } from "./retry-policy.js";

test("retry policy allows rate-limit only for idempotent operations", () => {
  assert.equal(
    shouldRetryExchangeError("EX_RATE_LIMIT", {
      attempt: 1,
      maxAttempts: 3,
      operation: "GET /public",
      idempotent: true
    }),
    true
  );
  assert.equal(
    shouldRetryExchangeError("EX_RATE_LIMIT", {
      attempt: 1,
      maxAttempts: 3,
      operation: "POST /private/order",
      idempotent: false
    }),
    false
  );
});

test("retry policy keeps network/timeout retryable for non-idempotent operations", () => {
  assert.equal(
    shouldRetryExchangeError("EX_NETWORK", {
      attempt: 1,
      maxAttempts: 3,
      operation: "POST /private/order",
      idempotent: false
    }),
    true
  );
  assert.equal(
    shouldRetryExchangeError("EX_TIMEOUT", {
      attempt: 3,
      maxAttempts: 3,
      operation: "POST /private/order",
      idempotent: false
    }),
    false
  );
});

test("retry delay is exponential and capped", () => {
  assert.equal(computeRetryDelayMs(1, 300, 2000), 300);
  assert.equal(computeRetryDelayMs(2, 300, 2000), 600);
  assert.equal(computeRetryDelayMs(5, 300, 2000), 2000);
});
