import assert from "node:assert/strict";
import test from "node:test";
import { ExchangeError } from "../core/exchange-error.types.js";
import { mapMexcError } from "./mexc-error.mapper.js";
import { MexcAuthError, MexcRateLimitError, MexcApiError } from "./mexc.errors.js";

test("mapMexcError keeps ExchangeError instance", () => {
  const source = new ExchangeError({
    exchange: "mexc",
    code: "EX_UNKNOWN",
    message: "already normalized",
    retryable: false,
    httpStatus: 500
  });
  const mapped = mapMexcError(source);
  assert.equal(mapped, source);
});

test("mapMexcError maps auth and rate limit classes", () => {
  const auth = mapMexcError(
    new MexcAuthError("invalid api key", {
      endpoint: "/private",
      method: "GET",
      status: 401
    })
  );
  assert.equal(auth.code, "EX_AUTH");
  assert.equal(auth.retryable, false);

  const rate = mapMexcError(
    new MexcRateLimitError("too many requests", {
      endpoint: "/private",
      method: "GET",
      status: 429
    })
  );
  assert.equal(rate.code, "EX_RATE_LIMIT");
  assert.equal(rate.retryable, true);
});

test("mapMexcError maps generic network and validation failures", () => {
  const network = mapMexcError(new Error("network timeout during request"));
  assert.equal(network.code, "EX_NETWORK");
  assert.equal(network.retryable, true);

  const invalid = mapMexcError(
    new MexcApiError("invalid precision for symbol", {
      endpoint: "/private/order",
      method: "POST",
      status: 400
    })
  );
  assert.equal(invalid.code, "EX_PRECISION_INVALID");
  assert.equal(invalid.retryable, false);
});
