import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildCoinstoreSignature } from "./coinstore.client.js";

test("buildCoinstoreSignature matches expected HMAC chain", () => {
  const payload = "symbol=BTCUSDT&limit=10";
  const secret = "test-secret";
  const expiresMs = 1_700_000_000_000;
  const bucket = Math.floor(expiresMs / 30000).toString();
  const expectedKey = crypto.createHmac("sha256", secret).update(bucket).digest("hex");
  const expectedSign = crypto.createHmac("sha256", expectedKey).update(payload).digest("hex");
  const actual = buildCoinstoreSignature(payload, secret, expiresMs);
  assert.equal(actual.key, expectedKey);
  assert.equal(actual.sign, expectedSign);
});
