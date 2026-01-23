import test from "node:test";
import assert from "node:assert/strict";
import {
  signLicenseBody,
  mapLicenseErrorFromStatus,
  shouldAllowGrace,
  enforceLicense,
  type LicenseVerifyResponse
} from "./license.js";

test("signLicenseBody creates expected HMAC hex for raw JSON body", async () => {
  const body = "{\"licenseKey\":\"abc\",\"instanceId\":\"vps-123\"}";
  const secret = "secret";
  const expected = "61326d4b134866a5ec5c9a58a9cb1647807b09dfe13de31e50ca148b8dd26211";
  assert.equal(await signLicenseBody(body, secret), expected);
});

test("mapLicenseErrorFromStatus maps status codes", () => {
  assert.equal(mapLicenseErrorFromStatus(400), "INVALID_REQUEST");
  assert.equal(mapLicenseErrorFromStatus(401), "INVALID_SIGNATURE");
  assert.equal(mapLicenseErrorFromStatus(404), "NOT_FOUND");
  assert.equal(mapLicenseErrorFromStatus(409), "INSTANCE_MISMATCH");
  assert.equal(mapLicenseErrorFromStatus(500), "SERVER_ERROR");
  assert.equal(mapLicenseErrorFromStatus(503), "SERVER_ERROR");
  assert.equal(mapLicenseErrorFromStatus(418), "NETWORK_ERROR");
});

test("shouldAllowGrace allows only network/server errors within grace", () => {
  const now = Date.now();
  assert.equal(
    shouldAllowGrace({ lastOkAt: now - 60_000, now, graceMin: 120, errorCode: "NETWORK_ERROR" }),
    true
  );
  assert.equal(
    shouldAllowGrace({ lastOkAt: now - 200 * 60_000, now, graceMin: 120, errorCode: "NETWORK_ERROR" }),
    false
  );
  assert.equal(
    shouldAllowGrace({ lastOkAt: now - 60_000, now, graceMin: 120, errorCode: "INVALID_SIGNATURE" }),
    false
  );
});

test("enforceLicense blocks limits and features unless unlimited", () => {
  const base: LicenseVerifyResponse = {
    status: "ACTIVE",
    validUntil: "2026-12-31T23:59:59Z",
    limits: { includedBots: 1, addOnBots: 0, includedCex: 1, addOnCex: 0 },
    features: { priceSupport: false, priceFollow: true, aiRecommendations: false },
    overrides: { manual: false, unlimited: false }
  };

  const tooManyBots = enforceLicense({
    response: base,
    botCount: 2,
    cexCount: 1,
    usePriceSupport: false,
    usePriceFollow: false,
    useAiRecommendations: false
  });
  assert.equal(tooManyBots.allowed, false);
  assert.equal(tooManyBots.reason, "LICENSE_BOT_LIMIT");

  const featureBlocked = enforceLicense({
    response: base,
    botCount: 1,
    cexCount: 1,
    usePriceSupport: true,
    usePriceFollow: false,
    useAiRecommendations: false
  });
  assert.equal(featureBlocked.allowed, false);
  assert.equal(featureBlocked.reason, "LICENSE_FEATURE_PRICE_SUPPORT");

  const unlimitedOk = enforceLicense({
    response: { ...base, overrides: { manual: false, unlimited: true }, features: base.features },
    botCount: 99,
    cexCount: 99,
    usePriceSupport: false,
    usePriceFollow: true,
    useAiRecommendations: false
  });
  assert.equal(unlimitedOk.allowed, true);
});
