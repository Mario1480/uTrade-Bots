import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateStrategyAccess,
  evaluateAiPromptAccess,
  enforceBotStartLicense,
  getDefaultStrategyEntitlements,
  getStubEntitlements,
  isAiModelAllowed,
  isLicenseEnforcementEnabled,
  isLicenseStubEnabled,
  isStrategyIdAllowed,
  isStrategyKindAllowed,
  resetLicenseCache,
  type StrategyLicenseKind,
  resolveStrategyEntitlementsForWorkspace
} from "./license.js";

test("LICENSE_ENFORCEMENT defaults to on", () => {
  const prev = process.env.LICENSE_ENFORCEMENT;
  process.env.LICENSE_ENFORCEMENT = "";
  assert.equal(isLicenseEnforcementEnabled(undefined), true);
  assert.equal(isLicenseEnforcementEnabled("on"), true);
  assert.equal(isLicenseEnforcementEnabled("off"), false);
  process.env.LICENSE_ENFORCEMENT = prev;
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

test("strategy entitlement defaults per plan", () => {
  const free = getDefaultStrategyEntitlements("free");
  assert.deepEqual(free.allowedStrategyKinds, ["local"]);
  assert.equal(free.maxCompositeNodes, 0);
  assert.deepEqual(free.aiAllowedModels, []);

  const pro = getDefaultStrategyEntitlements("pro");
  assert.deepEqual(pro.allowedStrategyKinds, ["local", "ai", "composite"]);
  assert.equal(pro.maxCompositeNodes, 12);
  assert.equal(pro.aiAllowedModels, null);
});

test("strategy kind and id allowlist matching", () => {
  const allowedKinds: StrategyLicenseKind[] = ["local", "ai", "composite"];
  const base = {
    allowedStrategyKinds: allowedKinds,
    allowedStrategyIds: ["local:*", "ai:prompt_1", "composite:cmp_1"]
  };
  assert.equal(isStrategyKindAllowed(base, "local"), true);
  assert.equal(isStrategyKindAllowed(base, "ai"), true);
  assert.equal(isStrategyIdAllowed(base, "local", "any_local"), true);
  assert.equal(isStrategyIdAllowed(base, "ai", "prompt_1"), true);
  assert.equal(isStrategyIdAllowed(base, "ai", "prompt_2"), false);
  assert.equal(isStrategyIdAllowed(base, "composite", "cmp_1"), true);
  assert.equal(isStrategyIdAllowed(base, "composite", "cmp_2"), false);
});

test("ai model allowlist supports wildcards", () => {
  assert.equal(isAiModelAllowed({ aiAllowedModels: null }, "gpt-4o-mini"), true);
  assert.equal(isAiModelAllowed({ aiAllowedModels: [] }, "gpt-4o-mini"), false);
  assert.equal(isAiModelAllowed({ aiAllowedModels: ["*"] }, "gpt-4o-mini"), true);
  assert.equal(isAiModelAllowed({ aiAllowedModels: ["gpt-4o-mini"] }, "gpt-4o-mini"), true);
  assert.equal(isAiModelAllowed({ aiAllowedModels: ["gpt-4o-mini"] }, "gpt-5"), false);
});

test("evaluateStrategyAccess enforces kind/id/model/max nodes", () => {
  const allowedKinds: StrategyLicenseKind[] = ["local", "ai", "composite"];
  const entitlements = {
    workspaceId: "ws_1",
    plan: "pro" as const,
    allowedStrategyKinds: allowedKinds,
    allowedStrategyIds: ["ai:prompt_ok", "local:*", "composite:*"],
    maxCompositeNodes: 4,
    aiAllowedModels: ["gpt-4o-mini"],
    aiMonthlyBudgetUsd: null,
    source: "db" as const
  };
  assert.equal(
    evaluateStrategyAccess({
      entitlements: { ...entitlements, allowedStrategyKinds: ["local"] },
      kind: "ai",
      strategyId: "prompt_ok"
    }).reason,
    "kind_not_allowed"
  );
  assert.equal(
    evaluateStrategyAccess({
      entitlements,
      kind: "ai",
      strategyId: "prompt_blocked"
    }).reason,
    "strategy_id_not_allowed"
  );
  assert.equal(
    evaluateStrategyAccess({
      entitlements,
      kind: "ai",
      strategyId: "prompt_ok",
      aiModel: "gpt-5"
    }).reason,
    "ai_model_not_allowed"
  );
  assert.equal(
    evaluateStrategyAccess({
      entitlements,
      kind: "composite",
      strategyId: "cmp_1",
      compositeNodes: 8
    }).reason,
    "composite_nodes_exceeded"
  );
  assert.equal(
    evaluateStrategyAccess({
      entitlements,
      kind: "local",
      strategyId: "any_local"
    }).reason,
    "ok"
  );
});

test("resolveStrategyEntitlementsForWorkspace falls back to plan defaults", async () => {
  const prevPlan = process.env.STRATEGY_LICENSE_DEFAULT_PLAN;
  process.env.STRATEGY_LICENSE_DEFAULT_PLAN = "free";

  const resolved = await resolveStrategyEntitlementsForWorkspace({
    workspaceId: "ws_fallback",
    deps: {
      fetchByWorkspaceId: async () => null
    }
  });
  assert.equal(resolved.plan, "free");
  assert.deepEqual(resolved.allowedStrategyKinds, ["local"]);
  assert.equal(resolved.maxCompositeNodes, 0);
  assert.equal(resolved.source, "plan_default");

  process.env.STRATEGY_LICENSE_DEFAULT_PLAN = prevPlan;
});

test("resolveStrategyEntitlementsForWorkspace parses stored row", async () => {
  const resolved = await resolveStrategyEntitlementsForWorkspace({
    workspaceId: "ws_db",
    deps: {
      fetchByWorkspaceId: async () => ({
        workspaceId: "ws_db",
        plan: "enterprise",
        allowedStrategyKinds: ["ai", "composite"],
        allowedStrategyIds: ["ai:smc", "composite:alpha"],
        maxCompositeNodes: 20,
        aiAllowedModels: ["gpt-4o-mini"],
        aiMonthlyBudgetUsd: 50
      })
    }
  });
  assert.equal(resolved.plan, "enterprise");
  assert.deepEqual(resolved.allowedStrategyKinds, ["ai", "composite"]);
  assert.deepEqual(resolved.allowedStrategyIds, ["ai:smc", "composite:alpha"]);
  assert.equal(resolved.maxCompositeNodes, 20);
  assert.deepEqual(resolved.aiAllowedModels, ["gpt-4o-mini"]);
  assert.equal(resolved.aiMonthlyBudgetUsd, 50);
  assert.equal(resolved.source, "db");
});

test.afterEach(() => {
  resetLicenseCache();
});
