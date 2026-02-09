import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParameterString,
  buildPostParameterString,
  buildPrivateHeaders,
  buildQueryParameterString,
  signMexcRequest
} from "./mexc.signing.js";

test("buildQueryParameterString sorts keys and url-encodes values", () => {
  const result = buildQueryParameterString({
    symbol: "BTC_USDT",
    page_num: 1,
    page_size: 20,
    keyword: "a b"
  });

  assert.equal(result, "keyword=a%20b&page_num=1&page_size=20&symbol=BTC_USDT");
});

test("buildPostParameterString uses JSON for objects", () => {
  const payload = {
    symbol: "BTC_USDT",
    vol: 1,
    price: 50000
  };

  assert.equal(buildPostParameterString(payload), JSON.stringify(payload));
});

test("buildParameterString uses query for GET and json for POST", () => {
  const getString = buildParameterString("GET", {
    query: { b: 2, a: 1 }
  });
  assert.equal(getString, "a=1&b=2");

  const postString = buildParameterString("POST", {
    body: { b: 2, a: 1 }
  });
  assert.equal(postString, '{"b":2,"a":1}');
});

test("signMexcRequest deterministic signature", () => {
  const signature = signMexcRequest({
    accessKey: "mexc-api-key",
    secretKey: "mexc-secret",
    timestampMs: "1700000000000",
    parameterString: "symbol=BTC_USDT"
  });

  assert.equal(signature.length, 64);
  assert.match(signature, /^[0-9a-f]+$/);
  assert.equal(
    signature,
    signMexcRequest({
      accessKey: "mexc-api-key",
      secretKey: "mexc-secret",
      timestampMs: "1700000000000",
      parameterString: "symbol=BTC_USDT"
    })
  );
});

test("buildPrivateHeaders contains required OPEN-API headers", () => {
  const headers = buildPrivateHeaders({
    apiKey: "mexc-api-key",
    apiSecret: "mexc-secret",
    timestampMs: "1700000000000",
    parameterString: "a=1",
    recvWindowSeconds: 30
  });

  assert.equal(headers.ApiKey, "mexc-api-key");
  assert.equal(headers["Request-Time"], "1700000000000");
  assert.equal(headers["Recv-Window"], "30");
  assert.ok(headers.Signature);
});
