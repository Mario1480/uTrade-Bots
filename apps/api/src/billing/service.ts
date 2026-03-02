import crypto from "node:crypto";
import { prisma } from "@mm/db";
import {
  formatUsdCents,
  getCcpayBaseUrl,
  getCcpayPriceFiatId,
  getCcpayWebBaseUrl,
  isCcpayConfigured,
  makeCcpayHeaders
} from "./ccpayment.js";

const db = prisma as any;

export type EffectivePlan = "free" | "pro";
export type BillingPackageKind = "plan" | "ai_topup" | "entitlement_topup";
export type BillingOrderStatus = "pending" | "paid" | "failed" | "expired";
export type AiLedgerReason = "monthly_grant" | "topup" | "usage_debit" | "admin_adjust";
export type BillingFeatureFlags = {
  billingEnabled: boolean;
  billingWebhookEnabled: boolean;
  aiTokenBillingEnabled: boolean;
};

type CcpayCreateInvoiceResponse = {
  code?: number;
  msg?: string;
  message?: string;
  error?: string;
  data?: {
    invoiceUrl?: string;
    msg?: string;
    message?: string;
    error?: string;
  };
};

const BILLING_FEATURE_FLAGS_KEY = "admin.billingFeatureFlags.v1";
const BILLING_FEATURE_FLAGS_CACHE_MS = 5_000;
const DEFAULT_BILLING_FEATURE_FLAGS: BillingFeatureFlags = {
  billingEnabled: false,
  billingWebhookEnabled: true,
  aiTokenBillingEnabled: true
};

const FREE_MAX_RUNNING_BOTS = 1;
const FREE_MAX_BOTS_TOTAL = 2;
const FREE_ALLOWED_EXCHANGES = ["*"];
const FREE_MAX_RUNNING_PREDICTIONS_AI: number | null = null;
const FREE_MAX_PREDICTIONS_AI_TOTAL: number | null = null;
const FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE: number | null = null;
const FREE_MAX_PREDICTIONS_COMPOSITE_TOTAL: number | null = null;
const PRO_MAX_RUNNING_PREDICTIONS_AI = 3;
const PRO_MAX_PREDICTIONS_AI_TOTAL = 10;
const PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE = 2;
const PRO_MAX_PREDICTIONS_COMPOSITE_TOTAL = 6;

export type PredictionQuotaKind = "local" | "ai" | "composite";

export type EffectiveQuota = {
  bots: {
    maxRunning: number;
    maxTotal: number;
  };
  predictions: {
    local: {
      maxRunning: number | null;
      maxTotal: number | null;
    };
    ai: {
      maxRunning: number | null;
      maxTotal: number | null;
    };
    composite: {
      maxRunning: number | null;
      maxTotal: number | null;
    };
  };
};

export type QuotaUsage = {
  bots: {
    running: number;
    total: number;
  };
  predictions: {
    local: {
      running: number;
      total: number;
    };
    ai: {
      running: number;
      total: number;
    };
    composite: {
      running: number;
      total: number;
    };
  };
};

export type EffectiveQuotaCaps = {
  bots?: {
    maxRunning?: number | null;
    maxTotal?: number | null;
  };
  predictions?: {
    ai?: {
      maxRunning?: number | null;
      maxTotal?: number | null;
    };
    composite?: {
      maxRunning?: number | null;
      maxTotal?: number | null;
    };
  };
};

export type QuotaLimitCheckResult = {
  allowed: boolean;
  reason:
    | "ok"
    | "bot_total_limit_exceeded"
    | "prediction_running_limit_exceeded_ai"
    | "prediction_total_limit_exceeded_ai"
    | "prediction_running_limit_exceeded_composite"
    | "prediction_total_limit_exceeded_composite";
  limits: EffectiveQuota;
  usage: QuotaUsage;
};

let billingFeatureFlagsCache:
  | {
      flags: BillingFeatureFlags;
      source: "db" | "default";
      updatedAt: string | null;
      fetchedAt: number;
    }
  | null = null;

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function normalizeInt(value: unknown, fallback: number, min = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function normalizeNullableInt(value: unknown, fallback: number | null, min = 0): number | null {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function applyHardCap(value: number | null, hardCap: number | null | undefined): number | null {
  if (hardCap === null || hardCap === undefined) return value;
  if (value === null) return Math.max(0, hardCap);
  return Math.max(0, Math.min(value, hardCap));
}

function createEmptyQuotaUsage(): QuotaUsage {
  return {
    bots: {
      running: 0,
      total: 0
    },
    predictions: {
      local: {
        running: 0,
        total: 0
      },
      ai: {
        running: 0,
        total: 0
      },
      composite: {
        running: 0,
        total: 0
      }
    }
  };
}

function normalizePredictionQuotaKind(value: unknown): PredictionQuotaKind | null {
  if (value === "local" || value === "ai" || value === "composite") return value;
  return null;
}

function resolvePredictionQuotaKindFromStateRow(row: {
  strategyKind?: unknown;
  signalMode?: unknown;
  featuresSnapshot?: unknown;
}): PredictionQuotaKind {
  const directKind = normalizePredictionQuotaKind(row.strategyKind);
  if (directKind) return directKind;

  const snapshot = asRecord(row.featuresSnapshot);
  const strategyRef = asRecord(snapshot.strategyRef);
  const strategyRefKind = normalizePredictionQuotaKind(strategyRef.kind);
  if (strategyRefKind) return strategyRefKind;

  if (typeof snapshot.compositeStrategyId === "string" && snapshot.compositeStrategyId.trim()) {
    return "composite";
  }
  if (typeof snapshot.localStrategyId === "string" && snapshot.localStrategyId.trim()) {
    return "local";
  }
  if (typeof snapshot.aiPromptTemplateId === "string" && snapshot.aiPromptTemplateId.trim()) {
    return "ai";
  }

  const signalMode =
    row.signalMode === "local_only" || row.signalMode === "ai_only" || row.signalMode === "both"
      ? row.signalMode
      : (typeof snapshot.signalMode === "string" ? snapshot.signalMode : "both");
  if (signalMode === "local_only") return "local";
  return "ai";
}

function normalizeCapacityDelta(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return out.length > 0 ? out : [...fallback];
}

function isSubscriptionPlanActive(row: any, now: Date): boolean {
  if (!row) return false;
  if (row.effectivePlan !== "PRO") return false;
  if (!(row.proValidUntil instanceof Date)) return false;
  return row.proValidUntil.getTime() > now.getTime();
}

function addMonths(base: Date, months: number): Date {
  const next = new Date(base);
  next.setMonth(next.getMonth() + Math.max(1, months));
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "off") return false;
  }
  return fallback;
}

function normalizeBillingFeatureFlags(value: unknown): BillingFeatureFlags {
  const raw = asRecord(value);
  return {
    billingEnabled: asBoolean(raw.billingEnabled, DEFAULT_BILLING_FEATURE_FLAGS.billingEnabled),
    billingWebhookEnabled: asBoolean(
      raw.billingWebhookEnabled,
      DEFAULT_BILLING_FEATURE_FLAGS.billingWebhookEnabled
    ),
    aiTokenBillingEnabled: asBoolean(
      raw.aiTokenBillingEnabled,
      DEFAULT_BILLING_FEATURE_FLAGS.aiTokenBillingEnabled
    )
  };
}

async function loadBillingFeatureFlags(
  force = false
): Promise<{
  flags: BillingFeatureFlags;
  source: "db" | "default";
  updatedAt: string | null;
}> {
  const now = Date.now();
  if (
    !force &&
    billingFeatureFlagsCache &&
    now - billingFeatureFlagsCache.fetchedAt <= BILLING_FEATURE_FLAGS_CACHE_MS
  ) {
    return {
      flags: billingFeatureFlagsCache.flags,
      source: billingFeatureFlagsCache.source,
      updatedAt: billingFeatureFlagsCache.updatedAt
    };
  }

  const row = await db.globalSetting.findUnique({
    where: { key: BILLING_FEATURE_FLAGS_KEY },
    select: { value: true, updatedAt: true }
  });
  const source: "db" | "default" = row ? "db" : "default";
  const flags = row
    ? normalizeBillingFeatureFlags(row.value)
    : { ...DEFAULT_BILLING_FEATURE_FLAGS };
  const updatedAt = row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
  billingFeatureFlagsCache = {
    flags,
    source,
    updatedAt,
    fetchedAt: now
  };
  return { flags, source, updatedAt };
}

export async function getBillingFeatureFlags(): Promise<BillingFeatureFlags> {
  const loaded = await loadBillingFeatureFlags();
  return loaded.flags;
}

export async function getBillingFeatureFlagsSettings(): Promise<
  BillingFeatureFlags & {
    source: "db" | "default";
    updatedAt: string | null;
    defaults: BillingFeatureFlags;
  }
> {
  const loaded = await loadBillingFeatureFlags();
  return {
    ...loaded.flags,
    source: loaded.source,
    updatedAt: loaded.updatedAt,
    defaults: { ...DEFAULT_BILLING_FEATURE_FLAGS }
  };
}

export async function updateBillingFeatureFlags(
  next: BillingFeatureFlags
): Promise<
  BillingFeatureFlags & {
    source: "db";
    updatedAt: string | null;
    defaults: BillingFeatureFlags;
  }
> {
  const normalized = normalizeBillingFeatureFlags(next);
  const row = await db.globalSetting.upsert({
    where: { key: BILLING_FEATURE_FLAGS_KEY },
    create: { key: BILLING_FEATURE_FLAGS_KEY, value: normalized },
    update: { value: normalized },
    select: { value: true, updatedAt: true }
  });
  const effective = normalizeBillingFeatureFlags(row.value);
  const updatedAt = row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
  billingFeatureFlagsCache = {
    flags: effective,
    source: "db",
    updatedAt,
    fetchedAt: Date.now()
  };
  return {
    ...effective,
    source: "db",
    updatedAt,
    defaults: { ...DEFAULT_BILLING_FEATURE_FLAGS }
  };
}

export async function isBillingEnabled(): Promise<boolean> {
  return (await getBillingFeatureFlags()).billingEnabled;
}

export async function isBillingWebhookEnabled(): Promise<boolean> {
  return (await getBillingFeatureFlags()).billingWebhookEnabled;
}

export async function isAiTokenBillingEnabled(): Promise<boolean> {
  return (await getBillingFeatureFlags()).aiTokenBillingEnabled;
}

function formatPlan(value: unknown): EffectivePlan {
  return value === "PRO" ? "pro" : "free";
}

function toStrategyPlan(value: EffectivePlan): "free" | "pro" {
  return value === "pro" ? "pro" : "free";
}

function getDefaultMonthlyTokens(): bigint {
  return toBigInt(process.env.BILLING_PRO_MONTHLY_AI_TOKENS ?? "1000000");
}

export async function ensureBillingDefaults(): Promise<void> {
  if (!db.billingPackage || typeof db.billingPackage.upsert !== "function") return;

  const proMonthlyPriceCents = normalizeInt(process.env.BILLING_PRO_MONTHLY_PRICE_CENTS ?? "2900", 2900);
  const topupPriceCents = normalizeInt(process.env.BILLING_AI_TOPUP_PRICE_CENTS ?? "900", 900);
  const topupTokens = toBigInt(process.env.BILLING_AI_TOPUP_TOKENS ?? "250000");
  const proMonthlyTokens = getDefaultMonthlyTokens();
  const entitlementTopupPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_PRICE_CENTS ?? "1500",
    1500
  );
  const entitlementBotsUnitPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_BOTS_PRICE_CENTS ?? "500",
    500
  );
  const entitlementAiPredictionsUnitPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_AI_PREDICTIONS_PRICE_CENTS ?? "500",
    500
  );
  const entitlementCompositePredictionsUnitPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_COMPOSITE_PREDICTIONS_PRICE_CENTS ?? "500",
    500
  );

  await db.billingPackage.upsert({
    where: { code: "free" },
    update: {},
    create: {
      code: "free",
      name: "Free",
      description: "Starter plan",
      kind: "PLAN",
      isActive: true,
      sortOrder: 0,
      currency: "USD",
      priceCents: 0,
      billingMonths: 1,
      plan: "FREE",
      maxRunningBots: FREE_MAX_RUNNING_BOTS,
      maxBotsTotal: FREE_MAX_BOTS_TOTAL,
      maxRunningPredictionsAi: FREE_MAX_RUNNING_PREDICTIONS_AI,
      maxPredictionsAiTotal: FREE_MAX_PREDICTIONS_AI_TOTAL,
      maxRunningPredictionsComposite: FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      maxPredictionsCompositeTotal: FREE_MAX_PREDICTIONS_COMPOSITE_TOTAL,
      allowedExchanges: [...FREE_ALLOWED_EXCHANGES],
      monthlyAiTokens: 0n,
      topupAiTokens: 0n,
      topupRunningBots: null,
      topupBotsTotal: null,
      topupRunningPredictionsAi: null,
      topupPredictionsAiTotal: null,
      topupRunningPredictionsComposite: null,
      topupPredictionsCompositeTotal: null
    }
  });

  await db.billingPackage.upsert({
    where: { code: "pro_monthly" },
    update: {},
    create: {
      code: "pro_monthly",
      name: "Pro Monthly",
      description: "Monthly Pro subscription",
      kind: "PLAN",
      isActive: true,
      sortOrder: 10,
      currency: "USD",
      priceCents: proMonthlyPriceCents,
      billingMonths: 1,
      plan: "PRO",
      maxRunningBots: normalizeInt(process.env.BILLING_PRO_MAX_RUNNING_BOTS ?? "3", 3),
      maxBotsTotal: normalizeInt(process.env.BILLING_PRO_MAX_BOTS_TOTAL ?? "10", 10),
      maxRunningPredictionsAi: normalizeInt(
        process.env.BILLING_PRO_MAX_RUNNING_PREDICTIONS_AI ?? String(PRO_MAX_RUNNING_PREDICTIONS_AI),
        PRO_MAX_RUNNING_PREDICTIONS_AI
      ),
      maxPredictionsAiTotal: normalizeInt(
        process.env.BILLING_PRO_MAX_PREDICTIONS_AI_TOTAL ?? String(PRO_MAX_PREDICTIONS_AI_TOTAL),
        PRO_MAX_PREDICTIONS_AI_TOTAL
      ),
      maxRunningPredictionsComposite: normalizeInt(
        process.env.BILLING_PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE
        ?? String(PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE),
        PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE
      ),
      maxPredictionsCompositeTotal: normalizeInt(
        process.env.BILLING_PRO_MAX_PREDICTIONS_COMPOSITE_TOTAL
        ?? String(PRO_MAX_PREDICTIONS_COMPOSITE_TOTAL),
        PRO_MAX_PREDICTIONS_COMPOSITE_TOTAL
      ),
      allowedExchanges: ["*"],
      monthlyAiTokens: proMonthlyTokens,
      topupAiTokens: 0n,
      topupRunningBots: null,
      topupBotsTotal: null,
      topupRunningPredictionsAi: null,
      topupPredictionsAiTotal: null,
      topupRunningPredictionsComposite: null,
      topupPredictionsCompositeTotal: null
    }
  });

  await db.billingPackage.upsert({
    where: { code: "ai_topup_250k" },
    update: {},
    create: {
      code: "ai_topup_250k",
      name: "AI Topup 250k",
      description: "Additional AI tokens",
      kind: "AI_TOPUP",
      isActive: true,
      sortOrder: 20,
      currency: "USD",
      priceCents: topupPriceCents,
      billingMonths: 1,
      plan: null,
      maxRunningBots: null,
      maxBotsTotal: null,
      maxRunningPredictionsAi: null,
      maxPredictionsAiTotal: null,
      maxRunningPredictionsComposite: null,
      maxPredictionsCompositeTotal: null,
      allowedExchanges: ["*"],
      monthlyAiTokens: 0n,
      topupAiTokens: topupTokens,
      topupRunningBots: null,
      topupBotsTotal: null,
      topupRunningPredictionsAi: null,
      topupPredictionsAiTotal: null,
      topupRunningPredictionsComposite: null,
      topupPredictionsCompositeTotal: null
    }
  });

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_starter" },
    update: {
      isActive: false
    },
    create: {
      code: "capacity_topup_starter",
      name: "Capacity Topup Starter",
      description: "Extra bot and prediction capacity until plan end",
      kind: "ENTITLEMENT_TOPUP",
      isActive: false,
      sortOrder: 30,
      currency: "USD",
      priceCents: entitlementTopupPriceCents,
      billingMonths: 1,
      plan: "PRO",
      maxRunningBots: null,
      maxBotsTotal: null,
      maxRunningPredictionsAi: null,
      maxPredictionsAiTotal: null,
      maxRunningPredictionsComposite: null,
      maxPredictionsCompositeTotal: null,
      allowedExchanges: ["*"],
      monthlyAiTokens: 0n,
      topupAiTokens: 0n,
      topupRunningBots: 1,
      topupBotsTotal: 2,
      topupRunningPredictionsAi: 1,
      topupPredictionsAiTotal: 3,
      topupRunningPredictionsComposite: 1,
      topupPredictionsCompositeTotal: 2
    }
  });

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_bots_unit" },
    update: {},
    create: {
      code: "capacity_topup_bots_unit",
      name: "Capacity Topup Bots Unit",
      description: "Adds bot capacity until plan end",
      kind: "ENTITLEMENT_TOPUP",
      isActive: true,
      sortOrder: 31,
      currency: "USD",
      priceCents: entitlementBotsUnitPriceCents,
      billingMonths: 1,
      plan: "PRO",
      maxRunningBots: null,
      maxBotsTotal: null,
      maxRunningPredictionsAi: null,
      maxPredictionsAiTotal: null,
      maxRunningPredictionsComposite: null,
      maxPredictionsCompositeTotal: null,
      allowedExchanges: ["*"],
      monthlyAiTokens: 0n,
      topupAiTokens: 0n,
      topupRunningBots: 1,
      topupBotsTotal: 1,
      topupRunningPredictionsAi: 0,
      topupPredictionsAiTotal: 0,
      topupRunningPredictionsComposite: 0,
      topupPredictionsCompositeTotal: 0
    }
  });

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_ai_predictions_unit" },
    update: {},
    create: {
      code: "capacity_topup_ai_predictions_unit",
      name: "Capacity Topup AI Predictions Unit",
      description: "Adds AI prediction capacity until plan end",
      kind: "ENTITLEMENT_TOPUP",
      isActive: true,
      sortOrder: 32,
      currency: "USD",
      priceCents: entitlementAiPredictionsUnitPriceCents,
      billingMonths: 1,
      plan: "PRO",
      maxRunningBots: null,
      maxBotsTotal: null,
      maxRunningPredictionsAi: null,
      maxPredictionsAiTotal: null,
      maxRunningPredictionsComposite: null,
      maxPredictionsCompositeTotal: null,
      allowedExchanges: ["*"],
      monthlyAiTokens: 0n,
      topupAiTokens: 0n,
      topupRunningBots: 0,
      topupBotsTotal: 0,
      topupRunningPredictionsAi: 1,
      topupPredictionsAiTotal: 1,
      topupRunningPredictionsComposite: 0,
      topupPredictionsCompositeTotal: 0
    }
  });

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_composite_predictions_unit" },
    update: {},
    create: {
      code: "capacity_topup_composite_predictions_unit",
      name: "Capacity Topup Composite Predictions Unit",
      description: "Adds composite prediction capacity until plan end",
      kind: "ENTITLEMENT_TOPUP",
      isActive: true,
      sortOrder: 33,
      currency: "USD",
      priceCents: entitlementCompositePredictionsUnitPriceCents,
      billingMonths: 1,
      plan: "PRO",
      maxRunningBots: null,
      maxBotsTotal: null,
      maxRunningPredictionsAi: null,
      maxPredictionsAiTotal: null,
      maxRunningPredictionsComposite: null,
      maxPredictionsCompositeTotal: null,
      allowedExchanges: ["*"],
      monthlyAiTokens: 0n,
      topupAiTokens: 0n,
      topupRunningBots: 0,
      topupBotsTotal: 0,
      topupRunningPredictionsAi: 0,
      topupPredictionsAiTotal: 0,
      topupRunningPredictionsComposite: 1,
      topupPredictionsCompositeTotal: 1
    }
  });
}

async function getOrCreateSubscription(userId: string, tx: any = db): Promise<any> {
  const existing = await tx.userSubscription.findUnique({ where: { userId } });
  if (existing) return existing;
  const freeDefaults = await getFreePlanDefaults(tx);
  return tx.userSubscription.create({
    data: {
      userId,
      effectivePlan: "FREE",
      status: "ACTIVE",
      maxRunningBots: freeDefaults.maxRunningBots,
      maxBotsTotal: freeDefaults.maxBotsTotal,
      maxRunningPredictionsAi: freeDefaults.maxRunningPredictionsAi,
      maxPredictionsAiTotal: freeDefaults.maxPredictionsAiTotal,
      maxRunningPredictionsComposite: freeDefaults.maxRunningPredictionsComposite,
      maxPredictionsCompositeTotal: freeDefaults.maxPredictionsCompositeTotal,
      allowedExchanges: freeDefaults.allowedExchanges,
      aiTokenBalance: freeDefaults.monthlyAiTokens,
      aiTokenUsedLifetime: 0n,
      monthlyAiTokensIncluded: freeDefaults.monthlyAiTokens
    }
  });
}

async function getFreePlanDefaults(tx: any = db): Promise<{
  maxRunningBots: number;
  maxBotsTotal: number;
  maxRunningPredictionsAi: number | null;
  maxPredictionsAiTotal: number | null;
  maxRunningPredictionsComposite: number | null;
  maxPredictionsCompositeTotal: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: bigint;
}> {
  const pkg = await tx.billingPackage.findUnique({
    where: { code: "free" },
    select: {
      maxRunningBots: true,
      maxBotsTotal: true,
      maxRunningPredictionsAi: true,
      maxPredictionsAiTotal: true,
      maxRunningPredictionsComposite: true,
      maxPredictionsCompositeTotal: true,
      allowedExchanges: true,
      monthlyAiTokens: true
    }
  });

  return {
    maxRunningBots: normalizeInt(pkg?.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0),
    maxBotsTotal: normalizeInt(pkg?.maxBotsTotal, FREE_MAX_BOTS_TOTAL, 0),
    maxRunningPredictionsAi: normalizeNullableInt(
      pkg?.maxRunningPredictionsAi,
      FREE_MAX_RUNNING_PREDICTIONS_AI,
      0
    ),
    maxPredictionsAiTotal: normalizeNullableInt(
      pkg?.maxPredictionsAiTotal,
      FREE_MAX_PREDICTIONS_AI_TOTAL,
      0
    ),
    maxRunningPredictionsComposite: normalizeNullableInt(
      pkg?.maxRunningPredictionsComposite,
      FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      0
    ),
    maxPredictionsCompositeTotal: normalizeNullableInt(
      pkg?.maxPredictionsCompositeTotal,
      FREE_MAX_PREDICTIONS_COMPOSITE_TOTAL,
      0
    ),
    allowedExchanges: normalizeStringArray(pkg?.allowedExchanges, [...FREE_ALLOWED_EXCHANGES]),
    monthlyAiTokens: toBigInt(pkg?.monthlyAiTokens)
  };
}

async function syncPlanPackageToSubscriptions(pkg: {
  kind: "PLAN" | "AI_TOPUP" | "ENTITLEMENT_TOPUP";
  plan: "FREE" | "PRO" | null;
  maxRunningBots: number | null;
  maxBotsTotal: number | null;
  maxRunningPredictionsAi: number | null;
  maxPredictionsAiTotal: number | null;
  maxRunningPredictionsComposite: number | null;
  maxPredictionsCompositeTotal: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: bigint;
}): Promise<void> {
  if (pkg.kind !== "PLAN" || !pkg.plan) return;

  if (pkg.plan === "FREE") {
    const freeMonthlyTokens = toBigInt(pkg.monthlyAiTokens);
    const freeRows = await db.userSubscription.findMany({
      where: { effectivePlan: "FREE" },
      select: { userId: true }
    });

    await db.userSubscription.updateMany({
      where: { effectivePlan: "FREE" },
      data: {
        status: "ACTIVE",
        maxRunningBots: normalizeInt(pkg.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0),
        maxBotsTotal: normalizeInt(pkg.maxBotsTotal, FREE_MAX_BOTS_TOTAL, 0),
        maxRunningPredictionsAi: normalizeNullableInt(
          pkg.maxRunningPredictionsAi,
          FREE_MAX_RUNNING_PREDICTIONS_AI,
          0
        ),
        maxPredictionsAiTotal: normalizeNullableInt(
          pkg.maxPredictionsAiTotal,
          FREE_MAX_PREDICTIONS_AI_TOTAL,
          0
        ),
        maxRunningPredictionsComposite: normalizeNullableInt(
          pkg.maxRunningPredictionsComposite,
          FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
          0
        ),
        maxPredictionsCompositeTotal: normalizeNullableInt(
          pkg.maxPredictionsCompositeTotal,
          FREE_MAX_PREDICTIONS_COMPOSITE_TOTAL,
          0
        ),
        allowedExchanges: normalizeStringArray(pkg.allowedExchanges, [...FREE_ALLOWED_EXCHANGES]),
        monthlyAiTokensIncluded: freeMonthlyTokens
      }
    });

    if (freeMonthlyTokens > 0n) {
      const rows = await db.userSubscription.findMany({
        where: {
          effectivePlan: "FREE",
          aiTokenBalance: {
            lt: freeMonthlyTokens
          }
        },
        select: {
          id: true,
          userId: true
        }
      });

      for (const row of rows) {
        await db.$transaction(async (tx: any) => {
          const latest = await tx.userSubscription.findUnique({
            where: { id: row.id },
            select: {
              id: true,
              userId: true,
              aiTokenBalance: true
            }
          });
          if (!latest) return;

          const current = toBigInt(latest.aiTokenBalance);
          if (current >= freeMonthlyTokens) return;

          const next = freeMonthlyTokens;
          const granted = next - current;

          await tx.userSubscription.update({
            where: { id: latest.id },
            data: {
              aiTokenBalance: next
            }
          });

          if (granted > 0n) {
            await tx.aiTokenLedger.create({
              data: {
                userId: latest.userId,
                subscriptionId: latest.id,
                reason: "MONTHLY_GRANT",
                deltaTokens: granted,
                balanceAfter: next,
                meta: {
                  source: "free_package_sync",
                  packagePlan: "FREE"
                }
              }
            });
          }
        });
      }
    }

    for (const row of freeRows) {
      const userId = typeof row.userId === "string" ? row.userId.trim() : "";
      if (!userId) continue;
      await syncPrimaryWorkspaceEntitlementsForUser({
        userId,
        effectivePlan: "free"
      });
    }
    return;
  }

  const proRows = await db.userSubscription.findMany({
    where: { effectivePlan: "PRO" },
    select: { userId: true }
  });

  await db.userSubscription.updateMany({
    where: { effectivePlan: "PRO" },
    data: {
      status: "ACTIVE",
      maxRunningBots: normalizeInt(pkg.maxRunningBots, 3, 0),
      maxBotsTotal: normalizeInt(pkg.maxBotsTotal, 10, 0),
      maxRunningPredictionsAi: normalizeNullableInt(
        pkg.maxRunningPredictionsAi,
        PRO_MAX_RUNNING_PREDICTIONS_AI,
        0
      ),
      maxPredictionsAiTotal: normalizeNullableInt(
        pkg.maxPredictionsAiTotal,
        PRO_MAX_PREDICTIONS_AI_TOTAL,
        0
      ),
      maxRunningPredictionsComposite: normalizeNullableInt(
        pkg.maxRunningPredictionsComposite,
        PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE,
        0
      ),
      maxPredictionsCompositeTotal: normalizeNullableInt(
        pkg.maxPredictionsCompositeTotal,
        PRO_MAX_PREDICTIONS_COMPOSITE_TOTAL,
        0
      ),
      allowedExchanges: normalizeStringArray(pkg.allowedExchanges, ["*"]),
      monthlyAiTokensIncluded: toBigInt(pkg.monthlyAiTokens)
    }
  });

  for (const row of proRows) {
    const userId = typeof row.userId === "string" ? row.userId.trim() : "";
    if (!userId) continue;
    await syncPrimaryWorkspaceEntitlementsForUser({
      userId,
      effectivePlan: "pro"
    });
  }
}

export async function setUserToFreePlan(params: {
  userId: string;
  syncWorkspaceEntitlements?: boolean;
}): Promise<{
  userId: string;
  plan: EffectivePlan;
  status: "active" | "inactive";
  proValidUntil: string | null;
  maxRunningBots: number;
  maxBotsTotal: number;
  maxRunningPredictionsAi: number | null;
  maxPredictionsAiTotal: number | null;
  maxRunningPredictionsComposite: number | null;
  maxPredictionsCompositeTotal: number | null;
  allowedExchanges: string[];
  aiTokenBalance: bigint;
  aiTokenUsedLifetime: bigint;
  monthlyAiTokensIncluded: bigint;
}> {
  await ensureBillingDefaults();

  await db.$transaction(async (tx: any) => {
    const defaults = await getFreePlanDefaults(tx);
    const sub = await getOrCreateSubscription(params.userId, tx);
    const currentBalance = toBigInt(sub.aiTokenBalance);
    const nextBalance =
      currentBalance < defaults.monthlyAiTokens ? defaults.monthlyAiTokens : currentBalance;

    await tx.userSubscription.update({
      where: { id: sub.id },
      data: {
        effectivePlan: "FREE",
        status: "ACTIVE",
        proValidUntil: null,
        maxRunningBots: defaults.maxRunningBots,
        maxBotsTotal: defaults.maxBotsTotal,
        maxRunningPredictionsAi: defaults.maxRunningPredictionsAi,
        maxPredictionsAiTotal: defaults.maxPredictionsAiTotal,
        maxRunningPredictionsComposite: defaults.maxRunningPredictionsComposite,
        maxPredictionsCompositeTotal: defaults.maxPredictionsCompositeTotal,
        allowedExchanges: defaults.allowedExchanges,
        aiTokenBalance: nextBalance,
        monthlyAiTokensIncluded: defaults.monthlyAiTokens
      }
    });

    const granted = nextBalance - currentBalance;
    if (granted > 0n) {
      await tx.aiTokenLedger.create({
        data: {
          userId: params.userId,
          subscriptionId: sub.id,
          reason: "MONTHLY_GRANT",
          deltaTokens: granted,
          balanceAfter: nextBalance,
          meta: {
            source: "set_user_to_free_plan",
            packageCode: "free"
          }
        }
      });
    }
  });

  if (params.syncWorkspaceEntitlements !== false) {
    await syncPrimaryWorkspaceEntitlementsForUser({
      userId: params.userId,
      effectivePlan: "free"
    });
  }

  return resolveEffectivePlanForUser(params.userId);
}

export async function syncPrimaryWorkspaceEntitlementsForUser(params: {
  userId: string;
  effectivePlan: EffectivePlan;
}): Promise<void> {
  if (!db.workspaceMember || !db.licenseEntitlement) return;

  const membership = await db.workspaceMember.findFirst({
    where: { userId: params.userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true }
  });
  const workspaceId = typeof membership?.workspaceId === "string" ? membership.workspaceId.trim() : "";
  if (!workspaceId) return;

  const plan = toStrategyPlan(params.effectivePlan);
  const isPro = plan === "pro";
  const sub = await db.userSubscription.findUnique({
    where: { userId: params.userId },
    select: { monthlyAiTokensIncluded: true }
  });
  const freeAiIncluded = !isPro && toBigInt(sub?.monthlyAiTokensIncluded) > 0n;
  const allowAdvancedStrategies = isPro || freeAiIncluded;
  const allowedStrategyKinds: Array<"local" | "ai" | "composite"> = isPro
    ? ["local", "ai", "composite"]
    : allowAdvancedStrategies
      ? ["local", "ai", "composite"]
      : ["local"];
  const maxCompositeNodes = allowAdvancedStrategies ? 12 : 0;
  const aiAllowedModels = allowAdvancedStrategies ? ["*"] : [];

  await db.licenseEntitlement.upsert({
    where: { workspaceId },
    update: {
      plan,
      allowedStrategyKinds,
      allowedStrategyIds: [],
      maxCompositeNodes,
      aiAllowedModels,
      aiMonthlyBudgetUsd: null
    },
    create: {
      workspaceId,
      plan,
      allowedStrategyKinds,
      allowedStrategyIds: [],
      maxCompositeNodes,
      aiAllowedModels,
      aiMonthlyBudgetUsd: null
    }
  });
}

export async function resolveEffectivePlanForUser(userId: string): Promise<{
  userId: string;
  plan: EffectivePlan;
  status: "active" | "inactive";
  proValidUntil: string | null;
  maxRunningBots: number;
  maxBotsTotal: number;
  maxRunningPredictionsAi: number | null;
  maxPredictionsAiTotal: number | null;
  maxRunningPredictionsComposite: number | null;
  maxPredictionsCompositeTotal: number | null;
  allowedExchanges: string[];
  aiTokenBalance: bigint;
  aiTokenUsedLifetime: bigint;
  monthlyAiTokensIncluded: bigint;
}> {
  const now = new Date();
  const row = await getOrCreateSubscription(userId);

  if (isSubscriptionPlanActive(row, now)) {
    return {
      userId,
      plan: "pro",
      status: "active",
      proValidUntil: row.proValidUntil ? row.proValidUntil.toISOString() : null,
      maxRunningBots: normalizeInt(row.maxRunningBots, 3, 0),
      maxBotsTotal: normalizeInt(row.maxBotsTotal, 10, 0),
      maxRunningPredictionsAi: normalizeNullableInt(
        row.maxRunningPredictionsAi,
        PRO_MAX_RUNNING_PREDICTIONS_AI,
        0
      ),
      maxPredictionsAiTotal: normalizeNullableInt(
        row.maxPredictionsAiTotal,
        PRO_MAX_PREDICTIONS_AI_TOTAL,
        0
      ),
      maxRunningPredictionsComposite: normalizeNullableInt(
        row.maxRunningPredictionsComposite,
        PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE,
        0
      ),
      maxPredictionsCompositeTotal: normalizeNullableInt(
        row.maxPredictionsCompositeTotal,
        PRO_MAX_PREDICTIONS_COMPOSITE_TOTAL,
        0
      ),
      allowedExchanges: normalizeStringArray(row.allowedExchanges, ["*"]),
      aiTokenBalance: toBigInt(row.aiTokenBalance),
      aiTokenUsedLifetime: toBigInt(row.aiTokenUsedLifetime),
      monthlyAiTokensIncluded: toBigInt(row.monthlyAiTokensIncluded)
    };
  }

  if (row.effectivePlan === "PRO") {
    return setUserToFreePlan({ userId, syncWorkspaceEntitlements: true });
  }

  return {
    userId,
    plan: "free",
    status: "active",
    proValidUntil: row.proValidUntil ? row.proValidUntil.toISOString() : null,
    maxRunningBots: normalizeInt(row.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0),
    maxBotsTotal: normalizeInt(row.maxBotsTotal, FREE_MAX_BOTS_TOTAL, 0),
    maxRunningPredictionsAi: normalizeNullableInt(
      row.maxRunningPredictionsAi,
      FREE_MAX_RUNNING_PREDICTIONS_AI,
      0
    ),
    maxPredictionsAiTotal: normalizeNullableInt(
      row.maxPredictionsAiTotal,
      FREE_MAX_PREDICTIONS_AI_TOTAL,
      0
    ),
    maxRunningPredictionsComposite: normalizeNullableInt(
      row.maxRunningPredictionsComposite,
      FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      0
    ),
    maxPredictionsCompositeTotal: normalizeNullableInt(
      row.maxPredictionsCompositeTotal,
      FREE_MAX_PREDICTIONS_COMPOSITE_TOTAL,
      0
    ),
    allowedExchanges: normalizeStringArray(row.allowedExchanges, [...FREE_ALLOWED_EXCHANGES]),
    aiTokenBalance: toBigInt(row.aiTokenBalance),
    aiTokenUsedLifetime: toBigInt(row.aiTokenUsedLifetime),
    monthlyAiTokensIncluded: toBigInt(row.monthlyAiTokensIncluded)
  };
}

async function resolveActiveCapacityGrantDeltas(params: {
  userId: string;
  plan: EffectivePlan;
  now?: Date;
}): Promise<{
  runningBots: number;
  botsTotal: number;
  runningPredictionsAi: number;
  predictionsAiTotal: number;
  runningPredictionsComposite: number;
  predictionsCompositeTotal: number;
}> {
  if (!db.subscriptionCapacityGrant) {
    return {
      runningBots: 0,
      botsTotal: 0,
      runningPredictionsAi: 0,
      predictionsAiTotal: 0,
      runningPredictionsComposite: 0,
      predictionsCompositeTotal: 0
    };
  }

  const now = params.now ?? new Date();
  const rows = await db.subscriptionCapacityGrant.findMany({
    where: {
      userId: params.userId,
      OR: [
        { validUntil: null },
        { validUntil: { gt: now } }
      ]
    },
    select: {
      planScope: true,
      deltaRunningBots: true,
      deltaBotsTotal: true,
      deltaRunningPredictionsAi: true,
      deltaPredictionsAiTotal: true,
      deltaRunningPredictionsComposite: true,
      deltaPredictionsCompositeTotal: true
    }
  });

  const expectedScope = params.plan === "pro" ? "PRO" : "FREE";
  let runningBots = 0;
  let botsTotal = 0;
  let runningPredictionsAi = 0;
  let predictionsAiTotal = 0;
  let runningPredictionsComposite = 0;
  let predictionsCompositeTotal = 0;
  for (const row of rows) {
    if (row.planScope && row.planScope !== expectedScope) continue;
    runningBots += normalizeCapacityDelta(row.deltaRunningBots);
    botsTotal += normalizeCapacityDelta(row.deltaBotsTotal);
    runningPredictionsAi += normalizeCapacityDelta(row.deltaRunningPredictionsAi);
    predictionsAiTotal += normalizeCapacityDelta(row.deltaPredictionsAiTotal);
    runningPredictionsComposite += normalizeCapacityDelta(row.deltaRunningPredictionsComposite);
    predictionsCompositeTotal += normalizeCapacityDelta(row.deltaPredictionsCompositeTotal);
  }

  return {
    runningBots,
    botsTotal,
    runningPredictionsAi,
    predictionsAiTotal,
    runningPredictionsComposite,
    predictionsCompositeTotal
  };
}

export async function resolveEffectiveQuotaForUser(
  userId: string,
  caps?: EffectiveQuotaCaps | null
): Promise<EffectiveQuota> {
  const resolved = await resolveEffectivePlanForUser(userId);
  const deltas = await resolveActiveCapacityGrantDeltas({
    userId,
    plan: resolved.plan
  });

  const baseAiRunning = resolved.maxRunningPredictionsAi;
  const baseAiTotal = resolved.maxPredictionsAiTotal;
  const baseCompositeRunning = resolved.maxRunningPredictionsComposite;
  const baseCompositeTotal = resolved.maxPredictionsCompositeTotal;

  const computed: EffectiveQuota = {
    bots: {
      maxRunning: Math.max(0, resolved.maxRunningBots + deltas.runningBots),
      maxTotal: Math.max(0, resolved.maxBotsTotal + deltas.botsTotal)
    },
    predictions: {
      local: {
        maxRunning: null,
        maxTotal: null
      },
      ai: {
        maxRunning:
          baseAiRunning === null
            ? null
            : Math.max(0, baseAiRunning + deltas.runningPredictionsAi),
        maxTotal:
          baseAiTotal === null
            ? null
            : Math.max(0, baseAiTotal + deltas.predictionsAiTotal)
      },
      composite: {
        maxRunning:
          baseCompositeRunning === null
            ? null
            : Math.max(0, baseCompositeRunning + deltas.runningPredictionsComposite),
        maxTotal:
          baseCompositeTotal === null
            ? null
            : Math.max(0, baseCompositeTotal + deltas.predictionsCompositeTotal)
      }
    }
  };

  return {
    bots: {
      maxRunning: Math.max(0, applyHardCap(computed.bots.maxRunning, caps?.bots?.maxRunning) ?? 0),
      maxTotal: Math.max(0, applyHardCap(computed.bots.maxTotal, caps?.bots?.maxTotal) ?? 0)
    },
    predictions: {
      local: {
        maxRunning: null,
        maxTotal: null
      },
      ai: {
        maxRunning: applyHardCap(computed.predictions.ai.maxRunning, caps?.predictions?.ai?.maxRunning),
        maxTotal: applyHardCap(computed.predictions.ai.maxTotal, caps?.predictions?.ai?.maxTotal)
      },
      composite: {
        maxRunning: applyHardCap(
          computed.predictions.composite.maxRunning,
          caps?.predictions?.composite?.maxRunning
        ),
        maxTotal: applyHardCap(
          computed.predictions.composite.maxTotal,
          caps?.predictions?.composite?.maxTotal
        )
      }
    }
  };
}

export async function resolveQuotaUsageForUser(userId: string): Promise<QuotaUsage> {
  const [botsTotal, botsRunning, predictionStates] = await Promise.all([
    db.bot.count({ where: { userId } }),
    db.bot.count({ where: { userId, status: "running" } }),
    db.predictionState.findMany({
      where: { userId },
      select: {
        strategyKind: true,
        signalMode: true,
        featuresSnapshot: true,
        autoScheduleEnabled: true,
        autoSchedulePaused: true
      }
    })
  ]);

  const usage = createEmptyQuotaUsage();
  usage.bots.total = botsTotal;
  usage.bots.running = botsRunning;
  for (const row of predictionStates) {
    if (!row.autoScheduleEnabled) continue;
    const kind = resolvePredictionQuotaKindFromStateRow(row);
    usage.predictions[kind].total += 1;
    if (!row.autoSchedulePaused) {
      usage.predictions[kind].running += 1;
    }
  }
  return usage;
}

function exceedsLimit(limit: number | null, nextUsage: number): boolean {
  if (limit === null) return false;
  return nextUsage > limit;
}

export async function canCreateBot(params: {
  userId: string;
  caps?: EffectiveQuotaCaps | null;
}): Promise<QuotaLimitCheckResult> {
  const [limits, usage] = await Promise.all([
    resolveEffectiveQuotaForUser(params.userId, params.caps),
    resolveQuotaUsageForUser(params.userId)
  ]);

  if (exceedsLimit(limits.bots.maxTotal, usage.bots.total + 1)) {
    return {
      allowed: false,
      reason: "bot_total_limit_exceeded",
      limits,
      usage
    };
  }

  return {
    allowed: true,
    reason: "ok",
    limits,
    usage
  };
}

export async function canCreatePrediction(params: {
  userId: string;
  kind: PredictionQuotaKind;
  existingStateId: string | null;
  consumesSlot: boolean;
  caps?: EffectiveQuotaCaps | null;
}): Promise<QuotaLimitCheckResult> {
  const [limits, usage] = await Promise.all([
    resolveEffectiveQuotaForUser(params.userId, params.caps),
    resolveQuotaUsageForUser(params.userId)
  ]);
  if (params.kind === "local" || params.existingStateId || !params.consumesSlot) {
    return {
      allowed: true,
      reason: "ok",
      limits,
      usage
    };
  }

  const bucket = params.kind === "ai" ? usage.predictions.ai : usage.predictions.composite;
  const bucketLimits = params.kind === "ai" ? limits.predictions.ai : limits.predictions.composite;
  if (exceedsLimit(bucketLimits.maxTotal, bucket.total + 1)) {
    return {
      allowed: false,
      reason:
        params.kind === "ai"
          ? "prediction_total_limit_exceeded_ai"
          : "prediction_total_limit_exceeded_composite",
      limits,
      usage
    };
  }
  if (exceedsLimit(bucketLimits.maxRunning, bucket.running + 1)) {
    return {
      allowed: false,
      reason:
        params.kind === "ai"
          ? "prediction_running_limit_exceeded_ai"
          : "prediction_running_limit_exceeded_composite",
      limits,
      usage
    };
  }
  return {
    allowed: true,
    reason: "ok",
    limits,
    usage
  };
}

export async function canEnablePredictionSchedule(params: {
  userId: string;
  kind: PredictionQuotaKind;
  currentlyEnabled: boolean;
  currentlyPaused: boolean;
  caps?: EffectiveQuotaCaps | null;
}): Promise<QuotaLimitCheckResult> {
  const [limits, usage] = await Promise.all([
    resolveEffectiveQuotaForUser(params.userId, params.caps),
    resolveQuotaUsageForUser(params.userId)
  ]);
  if (params.kind === "local") {
    return {
      allowed: true,
      reason: "ok",
      limits,
      usage
    };
  }

  const bucket = params.kind === "ai" ? usage.predictions.ai : usage.predictions.composite;
  const bucketLimits = params.kind === "ai" ? limits.predictions.ai : limits.predictions.composite;

  const nextTotal = params.currentlyEnabled ? bucket.total : bucket.total + 1;
  const nextRunning =
    params.currentlyEnabled && !params.currentlyPaused
      ? bucket.running
      : bucket.running + 1;
  if (exceedsLimit(bucketLimits.maxTotal, nextTotal)) {
    return {
      allowed: false,
      reason:
        params.kind === "ai"
          ? "prediction_total_limit_exceeded_ai"
          : "prediction_total_limit_exceeded_composite",
      limits,
      usage
    };
  }
  if (exceedsLimit(bucketLimits.maxRunning, nextRunning)) {
    return {
      allowed: false,
      reason:
        params.kind === "ai"
          ? "prediction_running_limit_exceeded_ai"
          : "prediction_running_limit_exceeded_composite",
      limits,
      usage
    };
  }

  return {
    allowed: true,
    reason: "ok",
    limits,
    usage
  };
}

export async function listActiveBillingPackages(): Promise<any[]> {
  await ensureBillingDefaults();
  return db.billingPackage.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

export async function listBillingPackages(): Promise<any[]> {
  await ensureBillingDefaults();
  return db.billingPackage.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

type CheckoutCartItemInput = {
  packageId: string;
  quantity: number;
};

type CheckoutResolvedLine = {
  packageId: string;
  quantity: number;
  kind: BillingPackageKind;
  unitPriceCents: number;
  lineAmountCents: number;
  currency: string;
  pkg: any;
};

function mapBillingPackageKind(value: unknown): BillingPackageKind {
  if (value === "AI_TOPUP") return "ai_topup";
  if (value === "ENTITLEMENT_TOPUP") return "entitlement_topup";
  return "plan";
}

function buildPackageSnapshot(pkg: any): Record<string, unknown> {
  return {
    id: String(pkg.id ?? ""),
    code: String(pkg.code ?? ""),
    name: String(pkg.name ?? ""),
    description: pkg.description ?? null,
    kind: pkg.kind ?? "PLAN",
    plan: pkg.plan ?? null,
    billingMonths: normalizeInt(pkg.billingMonths, 1, 1),
    maxRunningBots: pkg.maxRunningBots ?? null,
    maxBotsTotal: pkg.maxBotsTotal ?? null,
    maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? null,
    maxPredictionsAiTotal: pkg.maxPredictionsAiTotal ?? null,
    maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? null,
    maxPredictionsCompositeTotal: pkg.maxPredictionsCompositeTotal ?? null,
    allowedExchanges: normalizeStringArray(pkg.allowedExchanges, ["*"]),
    monthlyAiTokens: toBigInt(pkg.monthlyAiTokens).toString(),
    topupAiTokens: toBigInt(pkg.topupAiTokens).toString(),
    topupRunningBots: pkg.topupRunningBots ?? null,
    topupBotsTotal: pkg.topupBotsTotal ?? null,
    topupRunningPredictionsAi: pkg.topupRunningPredictionsAi ?? null,
    topupPredictionsAiTotal: pkg.topupPredictionsAiTotal ?? null,
    topupRunningPredictionsComposite: pkg.topupRunningPredictionsComposite ?? null,
    topupPredictionsCompositeTotal: pkg.topupPredictionsCompositeTotal ?? null,
    priceCents: normalizeInt(pkg.priceCents, 0, 0),
    currency: String(pkg.currency ?? "USD").trim().toUpperCase()
  };
}

async function fetchBillingOrderWithItems(orderId: string): Promise<any> {
  return db.billingOrder.findUnique({
    where: { id: orderId },
    include: {
      pkg: true,
      items: {
        include: {
          pkg: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });
}

async function resolveCheckoutLines(params: {
  userId: string;
  items: CheckoutCartItemInput[];
}): Promise<CheckoutResolvedLine[]> {
  if (!Array.isArray(params.items)) throw new Error("invalid_cart_payload");
  if (params.items.length === 0) throw new Error("cart_empty");
  if (params.items.length > 20) throw new Error("invalid_cart_payload");

  const seen = new Set<string>();
  const normalizedRaw = params.items.map((item) => {
    const packageId = typeof item.packageId === "string" ? item.packageId.trim() : "";
    const rawQuantity = Number(item.quantity);
    if (!packageId) throw new Error("invalid_cart_payload");
    if (!Number.isFinite(rawQuantity) || !Number.isInteger(rawQuantity)) {
      throw new Error("cart_quantity_invalid");
    }
    if (rawQuantity <= 0) throw new Error("cart_quantity_invalid");
    if (seen.has(packageId)) throw new Error("cart_duplicate_package");
    seen.add(packageId);
    return {
      packageId,
      quantity: rawQuantity
    };
  });

  const packageIds = normalizedRaw.map((item) => item.packageId);
  const packages = await db.billingPackage.findMany({
    where: {
      id: { in: packageIds },
      isActive: true
    }
  });
  if (packages.length !== packageIds.length) {
    throw new Error("cart_item_not_found");
  }

  const byId = new Map<string, any>();
  for (const pkg of packages) {
    byId.set(String(pkg.id), pkg);
  }

  const lines: CheckoutResolvedLine[] = normalizedRaw.map((item) => {
    const pkg = byId.get(item.packageId);
    if (!pkg) throw new Error("cart_item_not_found");
    const kind = mapBillingPackageKind(pkg.kind);
    if ((kind === "plan" || kind === "ai_topup") && item.quantity !== 1) {
      throw new Error("cart_quantity_invalid");
    }
    if (kind === "entitlement_topup" && (item.quantity < 1 || item.quantity > 20)) {
      throw new Error("cart_quantity_invalid");
    }
    const unitPriceCents = normalizeInt(pkg.priceCents, 0, 0);
    const currency = String(pkg.currency ?? "USD").trim().toUpperCase();
    return {
      packageId: String(pkg.id),
      quantity: item.quantity,
      kind,
      unitPriceCents,
      lineAmountCents: unitPriceCents * item.quantity,
      currency,
      pkg
    };
  });

  const planLines = lines.filter((line) => line.kind === "plan");
  if (planLines.length > 1) throw new Error("cart_plan_count_invalid");
  const hasProPlanInCart = planLines.some((line) => line.pkg.plan === "PRO");
  const resolved = await resolveEffectivePlanForUser(params.userId);
  const canUsePaidTopups = resolved.plan === "pro" || hasProPlanInCart;

  if (lines.some((line) => line.kind === "entitlement_topup") && !canUsePaidTopups) {
    throw new Error("cart_capacity_requires_pro");
  }
  if (lines.some((line) => line.kind === "ai_topup") && !canUsePaidTopups) {
    throw new Error("pro_required_for_topup");
  }

  const currency = lines[0]?.currency ?? "USD";
  const mixedCurrencies = lines.some((line) => line.currency !== currency);
  if (mixedCurrencies) throw new Error("invalid_cart_payload");

  return lines;
}

export async function createBillingCheckout(params: {
  userId: string;
  items: CheckoutCartItemInput[];
}): Promise<{ order: any; payUrl: string | null; mode: "redirect" | "instant" }> {
  if (!(await isBillingEnabled())) throw new Error("billing_disabled");

  await ensureBillingDefaults();
  const lines = await resolveCheckoutLines({
    userId: params.userId,
    items: params.items
  });
  const planLine = lines.find((line) => line.kind === "plan");
  const anchorPackageId = planLine?.packageId ?? lines[0]?.packageId;
  if (!anchorPackageId) throw new Error("cart_empty");

  const orderId = `UTRADE_${crypto.randomUUID()}`;
  const amountCents = lines.reduce((sum, line) => sum + line.lineAmountCents, 0);
  const product =
    lines.length === 1
      ? `${lines[0]!.pkg.name} x${lines[0]!.quantity}`
      : `${lines
        .slice(0, 3)
        .map((line) => `${line.pkg.name} x${line.quantity}`)
        .join(", ")}${lines.length > 3 ? ` +${lines.length - 3} more` : ""}`;
  const currency = lines[0]?.currency ?? "USD";

  if (amountCents <= 0) {
    const created = await db.billingOrder.create({
      data: {
        provider: "CCPAYMENT",
        userId: params.userId,
        packageId: anchorPackageId,
        status: "PENDING",
        amountCents,
        currency,
        merchantOrderId: orderId,
        createPayload: {
          orderId,
          product,
          price: formatUsdCents(amountCents),
          checkoutMode: "internal_zero_amount",
          items: lines.map((line) => ({
            packageId: line.packageId,
            packageCode: String(line.pkg.code ?? ""),
            packageName: String(line.pkg.name ?? ""),
            kind: line.kind,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            lineAmountCents: line.lineAmountCents
          }))
        },
        items: {
          create: lines.map((line) => ({
            packageId: line.packageId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            lineAmountCents: line.lineAmountCents,
            currency: line.currency,
            kindSnapshot:
              line.kind === "ai_topup"
                ? "AI_TOPUP"
                : line.kind === "entitlement_topup"
                  ? "ENTITLEMENT_TOPUP"
                  : "PLAN",
            packageSnapshot: buildPackageSnapshot(line.pkg)
          }))
        }
      },
      include: {
        pkg: true,
        items: {
          include: {
            pkg: {
              select: {
                id: true,
                code: true,
                name: true,
                kind: true
              }
            }
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        }
      }
    });

    await applyPaidOrder(orderId, "internal_zero_amount");
    const updated = await fetchBillingOrderWithItems(created.id);
    return {
      order: updated ?? created,
      payUrl: null,
      mode: "instant"
    };
  }

  if (!(await isCcpayConfigured())) throw new Error("ccpay_not_configured");

  const webBaseUrl = await getCcpayWebBaseUrl();
  const priceFiatId = await getCcpayPriceFiatId();
  const returnUrl = new URL("/settings/subscription", webBaseUrl);
  returnUrl.searchParams.set("checkout", "success");
  returnUrl.searchParams.set("order", orderId);

  const closeUrl = new URL("/settings/subscription", webBaseUrl);
  closeUrl.searchParams.set("checkout", "cancel");
  closeUrl.searchParams.set("order", orderId);

  const payload = {
    orderId,
    product,
    price: formatUsdCents(amountCents),
    priceFiatId,
    returnUrl: returnUrl.toString(),
    closeUrl: closeUrl.toString(),
    items: lines.map((line) => ({
      packageId: line.packageId,
      packageCode: String(line.pkg.code ?? ""),
      packageName: String(line.pkg.name ?? ""),
      kind: line.kind,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineAmountCents: line.lineAmountCents
    }))
  };

  const created = await db.billingOrder.create({
    data: {
      provider: "CCPAYMENT",
      userId: params.userId,
      packageId: anchorPackageId,
      status: "PENDING",
      amountCents,
      currency,
      merchantOrderId: orderId,
      createPayload: payload,
      items: {
        create: lines.map((line) => ({
          packageId: line.packageId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          lineAmountCents: line.lineAmountCents,
          currency: line.currency,
          kindSnapshot:
            line.kind === "ai_topup"
              ? "AI_TOPUP"
              : line.kind === "entitlement_topup"
                ? "ENTITLEMENT_TOPUP"
                : "PLAN",
          packageSnapshot: buildPackageSnapshot(line.pkg)
        }))
      }
    },
    include: {
      pkg: true,
      items: {
        include: {
          pkg: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });

  const rawBody = JSON.stringify(payload);
  const headers = await makeCcpayHeaders(rawBody);
  const response = await fetch(`${await getCcpayBaseUrl()}/ccpayment/v2/createInvoiceUrl`, {
    method: "POST",
    headers,
    body: rawBody
  });

  const body = (await response
    .json()
    .catch(() => ({}))) as CcpayCreateInvoiceResponse;
  const invoiceUrl = body.data?.invoiceUrl;
  if (!response.ok || body.code !== 10000 || !invoiceUrl) {
    const providerCode =
      Number.isFinite(Number(body.code))
        ? String(Math.trunc(Number(body.code)))
        : "unknown";
    await db.billingOrder.update({
      where: { id: created.id },
      data: {
        status: "FAILED",
        createResponse: body,
        paymentStatusRaw: `http_${response.status}`
      }
    });
    const providerMessage = extractCcpayProviderMessage(body);
    console.warn("[billing] ccpayment createInvoiceUrl failed", {
      orderId,
      userId: params.userId,
      packageId: anchorPackageId,
      httpStatus: response.status,
      providerCode,
      providerMessage: providerMessage ?? null
    });
    const messageSuffix = providerMessage ? `:provider_msg_${providerMessage}` : "";
    throw new Error(
      `ccpayment_error:http_${response.status}:provider_code_${providerCode}${messageSuffix}`
    );
  }

  const updated = await db.billingOrder.update({
    where: { id: created.id },
    data: {
      payUrl: String(invoiceUrl),
      createResponse: body
    },
    include: {
      pkg: true,
      items: {
        include: {
          pkg: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });

  return {
    order: updated,
    payUrl: String(invoiceUrl),
    mode: "redirect"
  };
}

function extractCcpayProviderMessage(body: CcpayCreateInvoiceResponse): string | null {
  const candidates = [
    body.msg,
    body.message,
    body.error,
    body.data?.msg,
    body.data?.message,
    body.data?.error
  ];
  for (const item of candidates) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().replace(/\s+/g, " ");
    if (!normalized) continue;
    return normalized.slice(0, 180);
  }
  return null;
}

export async function recordWebhookEvent(params: {
  recordId: string;
  merchantOrderId: string;
  payload: unknown;
}): Promise<"created" | "duplicate"> {
  try {
    await db.billingWebhookEvent.create({
      data: {
        provider: "CCPAYMENT",
        recordId: params.recordId,
        merchantOrderId: params.merchantOrderId,
        payload: params.payload
      }
    });
    return "created";
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "P2002") return "duplicate";
    throw error;
  }
}

export async function markOrderFailed(merchantOrderId: string, statusRaw: string): Promise<void> {
  const order = await db.billingOrder.findUnique({ where: { merchantOrderId } });
  if (!order) return;
  if (order.status === "PAID") return;
  await db.billingOrder.update({
    where: { id: order.id },
    data: {
      status: statusRaw === "expired" ? "EXPIRED" : "FAILED",
      paymentStatusRaw: statusRaw
    }
  });
}

type ApplyPackageData = {
  id: string;
  code: string;
  name: string;
  kind: "PLAN" | "AI_TOPUP" | "ENTITLEMENT_TOPUP";
  plan: "FREE" | "PRO" | null;
  billingMonths: number;
  maxRunningBots: number | null;
  maxBotsTotal: number | null;
  maxRunningPredictionsAi: number | null;
  maxPredictionsAiTotal: number | null;
  maxRunningPredictionsComposite: number | null;
  maxPredictionsCompositeTotal: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: bigint;
  topupAiTokens: bigint;
  topupRunningBots: number | null;
  topupBotsTotal: number | null;
  topupRunningPredictionsAi: number | null;
  topupPredictionsAiTotal: number | null;
  topupRunningPredictionsComposite: number | null;
  topupPredictionsCompositeTotal: number | null;
};

type ApplyOrderLine = {
  quantity: number;
  pkg: ApplyPackageData;
};

function toDbBillingPackageKind(value: unknown): "PLAN" | "AI_TOPUP" | "ENTITLEMENT_TOPUP" {
  if (value === "AI_TOPUP") return "AI_TOPUP";
  if (value === "ENTITLEMENT_TOPUP") return "ENTITLEMENT_TOPUP";
  return "PLAN";
}

function normalizeApplyPackageData(params: {
  snapshot: Record<string, unknown>;
  pkg: any;
  kindFallback: BillingPackageKind;
}): ApplyPackageData {
  const read = (key: string): unknown =>
    params.snapshot[key] !== undefined ? params.snapshot[key] : params.pkg?.[key];
  const fallbackKind =
    params.kindFallback === "ai_topup"
      ? "AI_TOPUP"
      : params.kindFallback === "entitlement_topup"
        ? "ENTITLEMENT_TOPUP"
        : "PLAN";
  const rawKind = read("kind");
  const kind = rawKind === "AI_TOPUP" || rawKind === "ENTITLEMENT_TOPUP" || rawKind === "PLAN"
    ? rawKind
    : fallbackKind;

  const rawPlan = read("plan");
  const plan = rawPlan === "PRO" || rawPlan === "FREE" ? rawPlan : null;

  return {
    id: String(read("id") ?? params.pkg?.id ?? ""),
    code: String(read("code") ?? params.pkg?.code ?? ""),
    name: String(read("name") ?? params.pkg?.name ?? ""),
    kind: toDbBillingPackageKind(kind),
    plan,
    billingMonths: normalizeInt(read("billingMonths"), normalizeInt(params.pkg?.billingMonths, 1, 1), 1),
    maxRunningBots: normalizeNullableInt(read("maxRunningBots"), params.pkg?.maxRunningBots ?? null, 0),
    maxBotsTotal: normalizeNullableInt(read("maxBotsTotal"), params.pkg?.maxBotsTotal ?? null, 0),
    maxRunningPredictionsAi: normalizeNullableInt(
      read("maxRunningPredictionsAi"),
      params.pkg?.maxRunningPredictionsAi ?? null,
      0
    ),
    maxPredictionsAiTotal: normalizeNullableInt(
      read("maxPredictionsAiTotal"),
      params.pkg?.maxPredictionsAiTotal ?? null,
      0
    ),
    maxRunningPredictionsComposite: normalizeNullableInt(
      read("maxRunningPredictionsComposite"),
      params.pkg?.maxRunningPredictionsComposite ?? null,
      0
    ),
    maxPredictionsCompositeTotal: normalizeNullableInt(
      read("maxPredictionsCompositeTotal"),
      params.pkg?.maxPredictionsCompositeTotal ?? null,
      0
    ),
    allowedExchanges: normalizeStringArray(read("allowedExchanges"), ["*"]),
    monthlyAiTokens: toBigInt(read("monthlyAiTokens")),
    topupAiTokens: toBigInt(read("topupAiTokens")),
    topupRunningBots: normalizeNullableInt(read("topupRunningBots"), params.pkg?.topupRunningBots ?? null, 0),
    topupBotsTotal: normalizeNullableInt(read("topupBotsTotal"), params.pkg?.topupBotsTotal ?? null, 0),
    topupRunningPredictionsAi: normalizeNullableInt(
      read("topupRunningPredictionsAi"),
      params.pkg?.topupRunningPredictionsAi ?? null,
      0
    ),
    topupPredictionsAiTotal: normalizeNullableInt(
      read("topupPredictionsAiTotal"),
      params.pkg?.topupPredictionsAiTotal ?? null,
      0
    ),
    topupRunningPredictionsComposite: normalizeNullableInt(
      read("topupRunningPredictionsComposite"),
      params.pkg?.topupRunningPredictionsComposite ?? null,
      0
    ),
    topupPredictionsCompositeTotal: normalizeNullableInt(
      read("topupPredictionsCompositeTotal"),
      params.pkg?.topupPredictionsCompositeTotal ?? null,
      0
    )
  };
}

function buildApplyOrderLines(order: any): ApplyOrderLine[] {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map((item: any) => {
      const quantity = normalizeInt(item.quantity, 1, 1);
      const kindFallback = mapBillingPackageKind(item.kindSnapshot ?? item.pkg?.kind);
      const snapshot = asRecord(item.packageSnapshot);
      return {
        quantity,
        pkg: normalizeApplyPackageData({
          snapshot,
          pkg: item.pkg ?? null,
          kindFallback
        })
      };
    });
  }

  return [
    {
      quantity: 1,
      pkg: normalizeApplyPackageData({
        snapshot: {},
        pkg: order.pkg ?? null,
        kindFallback: mapBillingPackageKind(order.pkg?.kind)
      })
    }
  ];
}

export async function applyPaidOrder(merchantOrderId: string, statusRaw: string): Promise<void> {
  const order = await db.billingOrder.findUnique({
    where: { merchantOrderId },
    include: {
      pkg: true,
      items: {
        include: {
          pkg: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });
  if (!order) return;
  if (order.status === "PAID") return;

  const applyLines = buildApplyOrderLines(order).sort((a, b) => {
    const aRank = a.pkg.kind === "PLAN" ? 0 : 1;
    const bRank = b.pkg.kind === "PLAN" ? 0 : 1;
    return aRank - bRank;
  });

  const now = new Date();
  await db.$transaction(async (tx: any) => {
    const existingSub = await getOrCreateSubscription(order.userId, tx);

    let nextPlan: EffectivePlan = formatPlan(existingSub.effectivePlan);
    let nextValidUntil = existingSub.proValidUntil as Date | null;
    let nextStatus = existingSub.status === "ACTIVE" ? "ACTIVE" : "INACTIVE";
    let nextMaxRunning = normalizeInt(existingSub.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0);
    let nextMaxTotal = normalizeInt(existingSub.maxBotsTotal, FREE_MAX_BOTS_TOTAL, 0);
    let nextMaxRunningPredictionsAi = normalizeNullableInt(
      existingSub.maxRunningPredictionsAi,
      FREE_MAX_RUNNING_PREDICTIONS_AI,
      0
    );
    let nextMaxPredictionsAiTotal = normalizeNullableInt(
      existingSub.maxPredictionsAiTotal,
      FREE_MAX_PREDICTIONS_AI_TOTAL,
      0
    );
    let nextMaxRunningPredictionsComposite = normalizeNullableInt(
      existingSub.maxRunningPredictionsComposite,
      FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      0
    );
    let nextMaxPredictionsCompositeTotal = normalizeNullableInt(
      existingSub.maxPredictionsCompositeTotal,
      FREE_MAX_PREDICTIONS_COMPOSITE_TOTAL,
      0
    );
    let nextAllowedExchanges = normalizeStringArray(existingSub.allowedExchanges, ["*"]);
    let nextMonthlyTokens = toBigInt(existingSub.monthlyAiTokensIncluded);
    const currentBalance = toBigInt(existingSub.aiTokenBalance);
    let balanceCursor = currentBalance;
    const ledgerEntries: Array<{
      reason: "MONTHLY_GRANT" | "TOPUP";
      delta: bigint;
      balanceAfter: bigint;
      packageId: string;
      packageCode: string;
      quantity: number;
    }> = [];

    for (const line of applyLines) {
      const pkg = line.pkg;
      const quantity = normalizeInt(line.quantity, 1, 1);

      if (pkg.kind === "PLAN") {
        const packagePlan: EffectivePlan = pkg.plan === "FREE" ? "free" : "pro";
        nextPlan = packagePlan;
        nextStatus = "ACTIVE";
        nextMaxRunning =
          packagePlan === "pro"
            ? normalizeInt(pkg.maxRunningBots, 3, 0)
            : normalizeInt(pkg.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0);
        nextMaxTotal =
          packagePlan === "pro"
            ? normalizeInt(pkg.maxBotsTotal, 10, 0)
            : normalizeInt(pkg.maxBotsTotal, FREE_MAX_BOTS_TOTAL, 0);
        nextAllowedExchanges = normalizeStringArray(pkg.allowedExchanges, ["*"]);
        nextMonthlyTokens = toBigInt(pkg.monthlyAiTokens);
        nextMaxRunningPredictionsAi =
          packagePlan === "pro"
            ? normalizeNullableInt(
              pkg.maxRunningPredictionsAi,
              PRO_MAX_RUNNING_PREDICTIONS_AI,
              0
            )
            : normalizeNullableInt(
              pkg.maxRunningPredictionsAi,
              FREE_MAX_RUNNING_PREDICTIONS_AI,
              0
            );
        nextMaxPredictionsAiTotal =
          packagePlan === "pro"
            ? normalizeNullableInt(
              pkg.maxPredictionsAiTotal,
              PRO_MAX_PREDICTIONS_AI_TOTAL,
              0
            )
            : normalizeNullableInt(
              pkg.maxPredictionsAiTotal,
              FREE_MAX_PREDICTIONS_AI_TOTAL,
              0
            );
        nextMaxRunningPredictionsComposite =
          packagePlan === "pro"
            ? normalizeNullableInt(
              pkg.maxRunningPredictionsComposite,
              PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE,
              0
            )
            : normalizeNullableInt(
              pkg.maxRunningPredictionsComposite,
              FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
              0
            );
        nextMaxPredictionsCompositeTotal =
          packagePlan === "pro"
            ? normalizeNullableInt(
              pkg.maxPredictionsCompositeTotal,
              PRO_MAX_PREDICTIONS_COMPOSITE_TOTAL,
              0
            )
            : normalizeNullableInt(
              pkg.maxPredictionsCompositeTotal,
              FREE_MAX_PREDICTIONS_COMPOSITE_TOTAL,
              0
            );

        if (packagePlan === "pro") {
          const startAt =
            nextValidUntil instanceof Date && nextValidUntil.getTime() > now.getTime()
              ? nextValidUntil
              : now;
          const monthsToAdd = normalizeInt(pkg.billingMonths, 1, 1) * quantity;
          nextValidUntil = addMonths(startAt, monthsToAdd);
          const delta = toBigInt(pkg.monthlyAiTokens) * BigInt(quantity);
          if (delta !== 0n) {
            balanceCursor += delta;
            ledgerEntries.push({
              reason: "MONTHLY_GRANT",
              delta,
              balanceAfter: balanceCursor,
              packageId: pkg.id,
              packageCode: pkg.code,
              quantity
            });
          }
        } else {
          nextValidUntil = null;
          const before = balanceCursor;
          balanceCursor = balanceCursor < nextMonthlyTokens ? nextMonthlyTokens : balanceCursor;
          const delta = balanceCursor - before;
          if (delta !== 0n) {
            ledgerEntries.push({
              reason: "MONTHLY_GRANT",
              delta,
              balanceAfter: balanceCursor,
              packageId: pkg.id,
              packageCode: pkg.code,
              quantity
            });
          }
        }
        continue;
      }

      if (pkg.kind === "AI_TOPUP") {
        const delta = toBigInt(pkg.topupAiTokens) * BigInt(quantity);
        if (delta !== 0n) {
          balanceCursor += delta;
          ledgerEntries.push({
            reason: "TOPUP",
            delta,
            balanceAfter: balanceCursor,
            packageId: pkg.id,
            packageCode: pkg.code,
            quantity
          });
        }
        continue;
      }

      const validUntil =
        nextPlan === "pro"
        && nextValidUntil instanceof Date
        && nextValidUntil.getTime() > now.getTime()
          ? nextValidUntil
          : null;
      if (!validUntil) {
        throw new Error("paid_plan_required_for_capacity_topup");
      }

      await tx.subscriptionCapacityGrant.create({
        data: {
          userId: order.userId,
          subscriptionId: existingSub.id,
          orderId: order.id,
          planScope: "PRO",
          deltaRunningBots: normalizeCapacityDelta(pkg.topupRunningBots) * quantity,
          deltaBotsTotal: normalizeCapacityDelta(pkg.topupBotsTotal) * quantity,
          deltaRunningPredictionsAi: normalizeCapacityDelta(pkg.topupRunningPredictionsAi) * quantity,
          deltaPredictionsAiTotal: normalizeCapacityDelta(pkg.topupPredictionsAiTotal) * quantity,
          deltaRunningPredictionsComposite: normalizeCapacityDelta(
            pkg.topupRunningPredictionsComposite
          ) * quantity,
          deltaPredictionsCompositeTotal: normalizeCapacityDelta(
            pkg.topupPredictionsCompositeTotal
          ) * quantity,
          validUntil
        }
      });
    }

    const nextBalance = balanceCursor;

    const updatedSub = await tx.userSubscription.update({
      where: { id: existingSub.id },
      data: {
        effectivePlan: nextPlan === "pro" ? "PRO" : "FREE",
        status: nextStatus,
        proValidUntil: nextValidUntil,
        maxRunningBots: nextMaxRunning,
        maxBotsTotal: nextMaxTotal,
        maxRunningPredictionsAi: nextMaxRunningPredictionsAi,
        maxPredictionsAiTotal: nextMaxPredictionsAiTotal,
        maxRunningPredictionsComposite: nextMaxRunningPredictionsComposite,
        maxPredictionsCompositeTotal: nextMaxPredictionsCompositeTotal,
        allowedExchanges: nextAllowedExchanges,
        aiTokenBalance: nextBalance,
        monthlyAiTokensIncluded: nextMonthlyTokens
      }
    });

    await tx.billingOrder.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paidAt: now,
        paymentStatusRaw: statusRaw,
        subscriptionId: updatedSub.id
      }
    });

    for (const entry of ledgerEntries) {
      await tx.aiTokenLedger.create({
        data: {
          userId: order.userId,
          subscriptionId: updatedSub.id,
          orderId: order.id,
          reason: entry.reason,
          deltaTokens: entry.delta,
          balanceAfter: entry.balanceAfter,
          meta: {
            packageId: entry.packageId,
            packageCode: entry.packageCode,
            quantity: entry.quantity,
            merchantOrderId
          }
        }
      });
    }
  });

  const resolved = await resolveEffectivePlanForUser(order.userId);
  await syncPrimaryWorkspaceEntitlementsForUser({
    userId: order.userId,
    effectivePlan: resolved.plan
  });
}

export async function getSubscriptionSummary(userId: string): Promise<{
  plan: EffectivePlan;
  status: "active" | "inactive";
  proValidUntil: string | null;
  limits: {
    maxRunningBots: number;
    maxBotsTotal: number;
    allowedExchanges: string[];
    bots: {
      maxRunning: number;
      maxTotal: number;
    };
    predictions: {
      local: {
        maxRunning: number | null;
        maxTotal: number | null;
      };
      ai: {
        maxRunning: number | null;
        maxTotal: number | null;
      };
      composite: {
        maxRunning: number | null;
        maxTotal: number | null;
      };
    };
  };
  usage: {
    totalBots: number;
    runningBots: number;
    bots: {
      running: number;
      total: number;
    };
    predictions: {
      local: {
        running: number;
        total: number;
      };
      ai: {
        running: number;
        total: number;
      };
      composite: {
        running: number;
        total: number;
      };
    };
  };
  ai: { tokenBalance: string; tokenUsedLifetime: string; monthlyIncluded: string; billingEnabled: boolean };
  packages: any[];
  orders: any[];
}> {
  await ensureBillingDefaults();
  const resolved = await resolveEffectivePlanForUser(userId);
  const [limits, usage, packages, orders] = await Promise.all([
    resolveEffectiveQuotaForUser(userId),
    resolveQuotaUsageForUser(userId),
    listActiveBillingPackages(),
    db.billingOrder.findMany({
      where: { userId },
      include: {
        pkg: {
          select: {
            id: true,
            code: true,
            name: true,
            kind: true
          }
        },
        items: {
          include: {
            pkg: {
              select: {
                id: true,
                code: true,
                name: true,
                kind: true
              }
            }
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);

  return {
    plan: resolved.plan,
    status: resolved.status,
    proValidUntil: resolved.proValidUntil,
    limits: {
      maxRunningBots: limits.bots.maxRunning,
      maxBotsTotal: limits.bots.maxTotal,
      allowedExchanges: resolved.allowedExchanges,
      bots: limits.bots,
      predictions: limits.predictions
    },
    usage: {
      totalBots: usage.bots.total,
      runningBots: usage.bots.running,
      bots: usage.bots,
      predictions: usage.predictions
    },
    ai: {
      tokenBalance: resolved.aiTokenBalance.toString(),
      tokenUsedLifetime: resolved.aiTokenUsedLifetime.toString(),
      monthlyIncluded: resolved.monthlyAiTokensIncluded.toString(),
      billingEnabled: await isAiTokenBillingEnabled()
    },
    packages,
    orders
  };
}

export async function listSubscriptionOrders(userId: string): Promise<any[]> {
  return db.billingOrder.findMany({
    where: { userId },
    include: {
      pkg: {
        select: {
          id: true,
          code: true,
          name: true,
          kind: true
        }
      },
      items: {
        include: {
          pkg: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}

export async function getEntitlementsForBotStart(
  userId: string,
  caps?: EffectiveQuotaCaps | null
): Promise<{
  maxRunningBots: number;
  maxBotsTotal: number;
  allowedExchanges: string[];
}> {
  const [quota, resolved] = await Promise.all([
    resolveEffectiveQuotaForUser(userId, caps),
    resolveEffectivePlanForUser(userId)
  ]);
  return {
    maxRunningBots: quota.bots.maxRunning,
    maxBotsTotal: quota.bots.maxTotal,
    allowedExchanges: resolved.allowedExchanges
  };
}

export async function checkAiTokenAccess(userId: string): Promise<{
  allowed: boolean;
  reason: "ok" | "billing_disabled" | "pro_required" | "token_exhausted";
  balance: bigint;
  plan: EffectivePlan;
}> {
  if (!(await isAiTokenBillingEnabled())) {
    return {
      allowed: true,
      reason: "billing_disabled",
      balance: 0n,
      plan: "free"
    };
  }

  const resolved = await resolveEffectivePlanForUser(userId);
  const freeHasIncludedTokens =
    resolved.plan === "free" && toBigInt(resolved.monthlyAiTokensIncluded) > 0n;
  if (resolved.plan !== "pro" && !freeHasIncludedTokens) {
    return {
      allowed: false,
      reason: "pro_required",
      balance: resolved.aiTokenBalance,
      plan: resolved.plan
    };
  }
  if (resolved.aiTokenBalance <= 0n) {
    return {
      allowed: false,
      reason: "token_exhausted",
      balance: resolved.aiTokenBalance,
      plan: resolved.plan
    };
  }
  return {
    allowed: true,
    reason: "ok",
    balance: resolved.aiTokenBalance,
    plan: resolved.plan
  };
}

export async function debitAiTokens(params: {
  userId: string;
  tokens: number;
  scope: string;
  meta?: Record<string, unknown>;
}): Promise<{
  charged: boolean;
  remainingBalance: bigint;
  reason: "ok" | "billing_disabled" | "pro_required" | "token_exhausted";
}> {
  const parsedTokens = normalizeInt(params.tokens, 0, 0);
  if (!(await isAiTokenBillingEnabled())) {
    return {
      charged: false,
      remainingBalance: 0n,
      reason: "billing_disabled"
    };
  }

  const access = await checkAiTokenAccess(params.userId);
  if (!access.allowed) {
    return {
      charged: false,
      remainingBalance: access.balance,
      reason: access.reason
    };
  }

  if (parsedTokens <= 0) {
    return {
      charged: false,
      remainingBalance: access.balance,
      reason: "ok"
    };
  }

  return db.$transaction(async (tx: any) => {
    const sub = await getOrCreateSubscription(params.userId, tx);
    const currentBalance = toBigInt(sub.aiTokenBalance);
    const debit = BigInt(parsedTokens);
    if (currentBalance < debit) {
      return {
        charged: false,
        remainingBalance: currentBalance,
        reason: "token_exhausted" as const
      };
    }
    const nextBalance = currentBalance - debit;
    const usedLifetime = toBigInt(sub.aiTokenUsedLifetime) + debit;

    await tx.userSubscription.update({
      where: { id: sub.id },
      data: {
        aiTokenBalance: nextBalance,
        aiTokenUsedLifetime: usedLifetime
      }
    });

    await tx.aiTokenLedger.create({
      data: {
        userId: params.userId,
        subscriptionId: sub.id,
        reason: "USAGE_DEBIT",
        deltaTokens: -debit,
        balanceAfter: nextBalance,
        meta: {
          scope: params.scope,
          ...(params.meta ?? {})
        }
      }
    });

    return {
      charged: true,
      remainingBalance: nextBalance,
      reason: "ok" as const
    };
  });
}

export async function adjustAiTokenBalanceByAdmin(params: {
  userId: string;
  deltaTokens: number;
  note?: string;
  actorUserId?: string | null;
}): Promise<{ balance: bigint }> {
  const delta = BigInt(Math.trunc(params.deltaTokens));

  return db.$transaction(async (tx: any) => {
    const sub = await getOrCreateSubscription(params.userId, tx);
    const current = toBigInt(sub.aiTokenBalance);
    const next = current + delta < 0n ? 0n : current + delta;
    const appliedDelta = next - current;

    const updated = await tx.userSubscription.update({
      where: { id: sub.id },
      data: {
        aiTokenBalance: next
      }
    });

    if (appliedDelta !== 0n) {
      await tx.aiTokenLedger.create({
        data: {
          userId: params.userId,
          subscriptionId: sub.id,
          reason: "ADMIN_ADJUST",
          deltaTokens: appliedDelta,
          balanceAfter: next,
          meta: {
            note: params.note ?? null,
            actorUserId: params.actorUserId ?? null
          }
        }
      });
    }

    return {
      balance: toBigInt(updated.aiTokenBalance)
    };
  });
}

export async function downgradeExpiredSubscriptions(limit = 500): Promise<number> {
  const now = new Date();
  const rows = await db.userSubscription.findMany({
    where: {
      effectivePlan: "PRO",
      proValidUntil: {
        lte: now
      }
    },
    select: {
      userId: true
    },
    take: Math.max(1, limit)
  });

  if (rows.length === 0) return 0;

  let updated = 0;
  for (const row of rows) {
    const userId = typeof row.userId === "string" ? row.userId.trim() : "";
    if (!userId) continue;
    await resolveEffectivePlanForUser(userId);
    await syncPrimaryWorkspaceEntitlementsForUser({
      userId,
      effectivePlan: "free"
    });
    updated += 1;
  }

  return updated;
}

export async function upsertBillingPackage(params: {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  kind: BillingPackageKind;
  isActive: boolean;
  sortOrder: number;
  currency: string;
  priceCents: number;
  billingMonths: number;
  plan: EffectivePlan | null;
  maxRunningBots: number | null;
  maxBotsTotal: number | null;
  maxRunningPredictionsAi: number | null;
  maxPredictionsAiTotal: number | null;
  maxRunningPredictionsComposite: number | null;
  maxPredictionsCompositeTotal: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: number;
  topupAiTokens: number;
  topupRunningBots: number | null;
  topupBotsTotal: number | null;
  topupRunningPredictionsAi: number | null;
  topupPredictionsAiTotal: number | null;
  topupRunningPredictionsComposite: number | null;
  topupPredictionsCompositeTotal: number | null;
  meta?: Record<string, unknown> | null;
}): Promise<any> {
  const data = {
    code: params.code.trim(),
    name: params.name.trim(),
    description: params.description ?? null,
    kind:
      params.kind === "ai_topup"
        ? "AI_TOPUP"
        : params.kind === "entitlement_topup"
          ? "ENTITLEMENT_TOPUP"
          : "PLAN",
    isActive: Boolean(params.isActive),
    sortOrder: normalizeInt(params.sortOrder, 0, 0),
    currency: (params.currency || "USD").trim().toUpperCase(),
    priceCents: normalizeInt(params.priceCents, 0, 0),
    billingMonths: normalizeInt(params.billingMonths, 1, 1),
    plan: params.plan === "pro" ? "PRO" : params.plan === "free" ? "FREE" : null,
    maxRunningBots:
      params.maxRunningBots === null ? null : normalizeInt(params.maxRunningBots, 0, 0),
    maxBotsTotal:
      params.maxBotsTotal === null ? null : normalizeInt(params.maxBotsTotal, 0, 0),
    maxRunningPredictionsAi:
      params.maxRunningPredictionsAi === null
        ? null
        : normalizeInt(params.maxRunningPredictionsAi, 0, 0),
    maxPredictionsAiTotal:
      params.maxPredictionsAiTotal === null
        ? null
        : normalizeInt(params.maxPredictionsAiTotal, 0, 0),
    maxRunningPredictionsComposite:
      params.maxRunningPredictionsComposite === null
        ? null
        : normalizeInt(params.maxRunningPredictionsComposite, 0, 0),
    maxPredictionsCompositeTotal:
      params.maxPredictionsCompositeTotal === null
        ? null
        : normalizeInt(params.maxPredictionsCompositeTotal, 0, 0),
    allowedExchanges: normalizeStringArray(params.allowedExchanges, ["*"]),
    monthlyAiTokens: BigInt(Math.max(0, Math.trunc(params.monthlyAiTokens))),
    topupAiTokens: BigInt(Math.max(0, Math.trunc(params.topupAiTokens))),
    topupRunningBots:
      params.topupRunningBots === null ? null : normalizeInt(params.topupRunningBots, 0, 0),
    topupBotsTotal:
      params.topupBotsTotal === null ? null : normalizeInt(params.topupBotsTotal, 0, 0),
    topupRunningPredictionsAi:
      params.topupRunningPredictionsAi === null
        ? null
        : normalizeInt(params.topupRunningPredictionsAi, 0, 0),
    topupPredictionsAiTotal:
      params.topupPredictionsAiTotal === null
        ? null
        : normalizeInt(params.topupPredictionsAiTotal, 0, 0),
    topupRunningPredictionsComposite:
      params.topupRunningPredictionsComposite === null
        ? null
        : normalizeInt(params.topupRunningPredictionsComposite, 0, 0),
    topupPredictionsCompositeTotal:
      params.topupPredictionsCompositeTotal === null
        ? null
        : normalizeInt(params.topupPredictionsCompositeTotal, 0, 0),
    meta: params.meta ?? null
  };

  if (params.id) {
    const updated = await db.billingPackage.update({
      where: { id: params.id },
      data
    });
    await syncPlanPackageToSubscriptions(updated);
    return updated;
  }

  const created = await db.billingPackage.create({ data });
  await syncPlanPackageToSubscriptions(created);
  return created;
}

export async function deleteBillingPackage(id: string): Promise<void> {
  await db.billingPackage.delete({ where: { id } });
}
