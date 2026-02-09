import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrehash,
  buildQueryString,
  buildWsLoginSignature,
  signRequest,
  stableStringify
} from "./bitget.signing.js";

test("buildQueryString sorts keys and url-encodes values", () => {
  const query = buildQueryString({
    symbol: "BTCUSDT",
    productType: "USDT-FUTURES",
    note: "a b"
  });

  assert.equal(query, "note=a%20b&productType=USDT-FUTURES&symbol=BTCUSDT");
});

test("stableStringify sorts nested object keys deterministically", () => {
  const body = stableStringify({
    b: 2,
    a: 1,
    nested: {
      y: 2,
      x: 1
    }
  });

  assert.equal(body, '{"a":1,"b":2,"nested":{"x":1,"y":2}}');
});

test("buildPrehash format matches bitget rule", () => {
  const prehash = buildPrehash({
    timestamp: "1700000000000",
    method: "GET",
    path: "/api/v2/mix/market/contracts",
    queryString: "productType=USDT-FUTURES"
  });

  assert.equal(prehash, "1700000000000GET/api/v2/mix/market/contracts?productType=USDT-FUTURES");
});

test("signRequest deterministic", () => {
  const signature = signRequest({
    timestamp: "1700000000000",
    method: "POST",
    path: "/api/v2/mix/order/place-order",
    body: {
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      size: "1",
      side: "buy",
      orderType: "market"
    },
    secretKey: "bitget-secret"
  });

  assert.ok(signature.length > 10);
  assert.equal(
    signature,
    signRequest({
      timestamp: "1700000000000",
      method: "POST",
      path: "/api/v2/mix/order/place-order",
      body: {
        symbol: "BTCUSDT",
        productType: "USDT-FUTURES",
        size: "1",
        side: "buy",
        orderType: "market"
      },
      secretKey: "bitget-secret"
    })
  );
});

test("buildWsLoginSignature deterministic", () => {
  const signature = buildWsLoginSignature({
    timestamp: "1700000000",
    secretKey: "bitget-secret"
  });

  assert.ok(signature.length > 10);
  assert.equal(
    signature,
    buildWsLoginSignature({
      timestamp: "1700000000",
      secretKey: "bitget-secret"
    })
  );
});
