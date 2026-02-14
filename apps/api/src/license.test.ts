import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAiPromptAccess,
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

test("ai prompt license mode defaults to off and allows", () => {
  const prevMode = process.env.AI_PROMPT_LICENSE_MODE;
  const prevAllowed = process.env.AI_PROMPT_ALLOWED_PUBLIC_IDS;
  process.env.AI_PROMPT_LICENSE_MODE = "";
  process.env.AI_PROMPT_ALLOWED_PUBLIC_IDS = "prompt_a";

  const decision = evaluateAiPromptAccess({
    userId: "u1",
    selectedPromptId: "prompt_b"
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.mode, "off");
  assert.equal(decision.wouldBlock, true);

  process.env.AI_PROMPT_LICENSE_MODE = prevMode;
  process.env.AI_PROMPT_ALLOWED_PUBLIC_IDS = prevAllowed;
});

test("ai prompt license enforce blocks unknown prompt ids", () => {
  const prevMode = process.env.AI_PROMPT_LICENSE_MODE;
  const prevAllowed = process.env.AI_PROMPT_ALLOWED_PUBLIC_IDS;
  process.env.AI_PROMPT_LICENSE_MODE = "enforce";
  process.env.AI_PROMPT_ALLOWED_PUBLIC_IDS = "prompt_a,prompt_b";

  const denied = evaluateAiPromptAccess({
    userId: "u1",
    selectedPromptId: "prompt_c"
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "prompt_not_allowed");
  assert.equal(denied.wouldBlock, true);

  const allowed = evaluateAiPromptAccess({
    userId: "u1",
    selectedPromptId: "prompt_a"
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "ok");

  process.env.AI_PROMPT_LICENSE_MODE = prevMode;
  process.env.AI_PROMPT_ALLOWED_PUBLIC_IDS = prevAllowed;
});

test.afterEach(() => {
  resetLicenseCache();
});
