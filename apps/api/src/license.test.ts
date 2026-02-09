import assert from "node:assert/strict";
import test from "node:test";
import {
  enforceBotStartLicense,
  getStubEntitlements,
  isLicenseEnforcementEnabled,
  isLicenseStubEnabled,
  resetLicenseCache
} from "./license.js";

test("LICENSE_ENFORCEMENT defaults to on", () => {
  assert.equal(isLicenseEnforcementEnabled(undefined), true);
  assert.equal(isLicenseEnforcementEnabled("on"), true);
  assert.equal(isLicenseEnforcementEnabled("off"), false);
});

test("license stub can be enabled by default in non-production", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  assert.equal(isLicenseStubEnabled(undefined), true);
  process.env.NODE_ENV = prev;
});

test("enforcement off always allows bot start", async () => {
  const prev = process.env.LICENSE_ENFORCEMENT;
  process.env.LICENSE_ENFORCEMENT = "off";

  const decision = await enforceBotStartLicense({
    userId: "u1",
    exchange: "mexc",
    totalBots: 999,
    runningBots: 999,
    isAlreadyRunning: false
  });
  assert.deepEqual(decision, { allowed: true, reason: "enforcement_off" });
  process.env.LICENSE_ENFORCEMENT = prev;
});

test("enforcement on fails closed when license server is unreachable", async () => {
  const prev = process.env.LICENSE_ENFORCEMENT;
  const prevUrl = process.env.LICENSE_SERVER_URL;
  process.env.LICENSE_ENFORCEMENT = "on";
  process.env.LICENSE_SERVER_URL = "http://127.0.0.1:1";

  const decision = await enforceBotStartLicense({
    userId: "u1",
    exchange: "mexc",
    totalBots: 1,
    runningBots: 0,
    isAlreadyRunning: false
  });
  assert.deepEqual(decision, { allowed: false, reason: "license_server_unreachable" });
  process.env.LICENSE_ENFORCEMENT = prev;
  process.env.LICENSE_SERVER_URL = prevUrl;
});

test("stub entitlements parse sane defaults", () => {
  const e = getStubEntitlements();
  assert.equal(typeof e.maxBotsTotal, "number");
  assert.equal(typeof e.maxRunningBots, "number");
  assert.ok(Array.isArray(e.allowedExchanges));
});

test.afterEach(() => {
  resetLicenseCache();
});
