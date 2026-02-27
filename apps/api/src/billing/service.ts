import crypto from "node:crypto";
import { prisma } from "@mm/db";
import {
  formatUsdCents,
  getCcpayBaseUrl,
  isCcpayConfigured,
  makeCcpayHeaders
} from "./ccpayment.js";

const db = prisma as any;

export type EffectivePlan = "free" | "pro";
export type BillingPackageKind = "plan" | "ai_topup";
export type BillingOrderStatus = "pending" | "paid" | "failed" | "expired";
export type AiLedgerReason = "monthly_grant" | "topup" | "usage_debit" | "admin_adjust";
export type BillingFeatureFlags = {
  billingEnabled: boolean;
  billingWebhookEnabled: boolean;
  aiTokenBillingEnabled: boolean;
};

type CcpayCreateInvoiceResponse = {
  code?: number;
  data?: {
    invoiceUrl?: string;
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

function getWebBaseUrl(): string {
  const base = (process.env.WEB_BASE_URL ?? process.env.PANEL_BASE_URL ?? "http://localhost:3000").trim();
  return base.replace(/\/$/, "");
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
      allowedExchanges: [...FREE_ALLOWED_EXCHANGES],
      monthlyAiTokens: 0n,
      topupAiTokens: 0n
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
      allowedExchanges: ["*"],
      monthlyAiTokens: proMonthlyTokens,
      topupAiTokens: 0n
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
      allowedExchanges: ["*"],
      monthlyAiTokens: 0n,
      topupAiTokens: topupTokens
    }
  });
}

async function getOrCreateSubscription(userId: string, tx: any = db): Promise<any> {
  const existing = await tx.userSubscription.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.userSubscription.create({
    data: {
      userId,
      effectivePlan: "FREE",
      status: "INACTIVE",
      maxRunningBots: FREE_MAX_RUNNING_BOTS,
      maxBotsTotal: FREE_MAX_BOTS_TOTAL,
      allowedExchanges: [...FREE_ALLOWED_EXCHANGES],
      aiTokenBalance: 0n,
      aiTokenUsedLifetime: 0n,
      monthlyAiTokensIncluded: 0n
    }
  });
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
  const isFree = plan === "free";

  await db.licenseEntitlement.upsert({
    where: { workspaceId },
    update: {
      plan,
      allowedStrategyKinds: isFree ? ["local"] : ["local", "ai", "composite"],
      allowedStrategyIds: [],
      maxCompositeNodes: isFree ? 0 : 12,
      aiAllowedModels: isFree ? [] : [],
      aiMonthlyBudgetUsd: null
    },
    create: {
      workspaceId,
      plan,
      allowedStrategyKinds: isFree ? ["local"] : ["local", "ai", "composite"],
      allowedStrategyIds: [],
      maxCompositeNodes: isFree ? 0 : 12,
      aiAllowedModels: isFree ? [] : [],
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
      allowedExchanges: normalizeStringArray(row.allowedExchanges, ["*"]),
      aiTokenBalance: toBigInt(row.aiTokenBalance),
      aiTokenUsedLifetime: toBigInt(row.aiTokenUsedLifetime),
      monthlyAiTokensIncluded: toBigInt(row.monthlyAiTokensIncluded)
    };
  }

  if (row.effectivePlan === "PRO") {
    const downgraded = await db.userSubscription.update({
      where: { userId },
      data: {
        effectivePlan: "FREE",
        status: "INACTIVE",
        maxRunningBots: FREE_MAX_RUNNING_BOTS,
        maxBotsTotal: FREE_MAX_BOTS_TOTAL,
        allowedExchanges: [...FREE_ALLOWED_EXCHANGES],
        monthlyAiTokensIncluded: 0n
      }
    });
    await syncPrimaryWorkspaceEntitlementsForUser({ userId, effectivePlan: "free" });
    return {
      userId,
      plan: "free",
      status: "inactive",
      proValidUntil: downgraded.proValidUntil ? downgraded.proValidUntil.toISOString() : null,
      maxRunningBots: FREE_MAX_RUNNING_BOTS,
      maxBotsTotal: FREE_MAX_BOTS_TOTAL,
      allowedExchanges: [...FREE_ALLOWED_EXCHANGES],
      aiTokenBalance: toBigInt(downgraded.aiTokenBalance),
      aiTokenUsedLifetime: toBigInt(downgraded.aiTokenUsedLifetime),
      monthlyAiTokensIncluded: 0n
    };
  }

  return {
    userId,
    plan: "free",
    status: "inactive",
    proValidUntil: row.proValidUntil ? row.proValidUntil.toISOString() : null,
    maxRunningBots: FREE_MAX_RUNNING_BOTS,
    maxBotsTotal: FREE_MAX_BOTS_TOTAL,
    allowedExchanges: [...FREE_ALLOWED_EXCHANGES],
    aiTokenBalance: toBigInt(row.aiTokenBalance),
    aiTokenUsedLifetime: toBigInt(row.aiTokenUsedLifetime),
    monthlyAiTokensIncluded: 0n
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

export async function createBillingCheckout(params: {
  userId: string;
  packageId: string;
}): Promise<{ order: any; payUrl: string }> {
  if (!(await isBillingEnabled())) throw new Error("billing_disabled");
  if (!isCcpayConfigured()) throw new Error("ccpay_not_configured");

  await ensureBillingDefaults();

  const pkg = await db.billingPackage.findUnique({ where: { id: params.packageId } });
  if (!pkg || !pkg.isActive) throw new Error("package_not_found");

  const kind: BillingPackageKind = pkg.kind === "AI_TOPUP" ? "ai_topup" : "plan";

  const resolved = await resolveEffectivePlanForUser(params.userId);
  if (kind === "ai_topup" && resolved.plan !== "pro") {
    throw new Error("pro_required_for_topup");
  }

  const orderId = `UTRADE_${crypto.randomUUID()}`;
  const product = kind === "plan" ? `${pkg.name} (${pkg.billingMonths} month)` : pkg.name;
  const amountCents = normalizeInt(pkg.priceCents, 0, 0);
  const returnUrl = new URL("/settings/subscription", getWebBaseUrl());
  returnUrl.searchParams.set("checkout", "success");
  returnUrl.searchParams.set("order", orderId);

  const closeUrl = new URL("/settings/subscription", getWebBaseUrl());
  closeUrl.searchParams.set("checkout", "cancel");
  closeUrl.searchParams.set("order", orderId);

  const payload = {
    orderId,
    product,
    price: formatUsdCents(amountCents),
    priceFiatId: (process.env.CCPAY_PRICE_FIAT_ID ?? "1033").trim() || "1033",
    returnUrl: returnUrl.toString(),
    closeUrl: closeUrl.toString()
  };

  const created = await db.billingOrder.create({
    data: {
      provider: "CCPAYMENT",
      userId: params.userId,
      packageId: pkg.id,
      status: "PENDING",
      amountCents,
      currency: "USD",
      merchantOrderId: orderId,
      createPayload: payload
    }
  });

  const rawBody = JSON.stringify(payload);
  const headers = makeCcpayHeaders(rawBody);
  const response = await fetch(`${getCcpayBaseUrl()}/ccpayment/v2/createInvoiceUrl`, {
    method: "POST",
    headers,
    body: rawBody
  });

  const body = (await response
    .json()
    .catch(() => ({}))) as CcpayCreateInvoiceResponse;
  const invoiceUrl = body.data?.invoiceUrl;
  if (!response.ok || body.code !== 10000 || !invoiceUrl) {
    await db.billingOrder.update({
      where: { id: created.id },
      data: {
        status: "FAILED",
        createResponse: body,
        paymentStatusRaw: `http_${response.status}`
      }
    });
    throw new Error("ccpayment_error");
  }

  const updated = await db.billingOrder.update({
    where: { id: created.id },
    data: {
      payUrl: String(invoiceUrl),
      createResponse: body
    }
  });

  return {
    order: updated,
    payUrl: String(invoiceUrl)
  };
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

export async function applyPaidOrder(merchantOrderId: string, statusRaw: string): Promise<void> {
  const order = await db.billingOrder.findUnique({
    where: { merchantOrderId },
    include: {
      pkg: true
    }
  });
  if (!order) return;
  if (order.status === "PAID") return;

  const now = new Date();
  await db.$transaction(async (tx: any) => {
    const pkg = order.pkg;
    const existingSub = await getOrCreateSubscription(order.userId, tx);

    let nextPlan: EffectivePlan = formatPlan(existingSub.effectivePlan);
    let nextValidUntil = existingSub.proValidUntil as Date | null;
    let nextStatus = existingSub.status === "ACTIVE" ? "ACTIVE" : "INACTIVE";
    let nextMaxRunning = normalizeInt(existingSub.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0);
    let nextMaxTotal = normalizeInt(existingSub.maxBotsTotal, FREE_MAX_BOTS_TOTAL, 0);
    let nextAllowedExchanges = normalizeStringArray(existingSub.allowedExchanges, ["*"]);
    let nextMonthlyTokens = toBigInt(existingSub.monthlyAiTokensIncluded);

    let delta = 0n;
    let reason: "MONTHLY_GRANT" | "TOPUP" = "TOPUP";

    if (pkg.kind === "PLAN") {
      const startAt =
        existingSub.proValidUntil instanceof Date && existingSub.proValidUntil.getTime() > now.getTime()
          ? existingSub.proValidUntil
          : now;
      nextPlan = "pro";
      nextStatus = "ACTIVE";
      nextValidUntil = addMonths(startAt, normalizeInt(pkg.billingMonths, 1, 1));
      nextMaxRunning = normalizeInt(pkg.maxRunningBots, 3, 0);
      nextMaxTotal = normalizeInt(pkg.maxBotsTotal, 10, 0);
      nextAllowedExchanges = normalizeStringArray(pkg.allowedExchanges, ["*"]);
      nextMonthlyTokens = toBigInt(pkg.monthlyAiTokens);
      delta = toBigInt(pkg.monthlyAiTokens);
      reason = "MONTHLY_GRANT";
    } else {
      delta = toBigInt(pkg.topupAiTokens);
      reason = "TOPUP";
    }

    const nextBalance = toBigInt(existingSub.aiTokenBalance) + delta;

    const updatedSub = await tx.userSubscription.update({
      where: { id: existingSub.id },
      data: {
        effectivePlan: nextPlan === "pro" ? "PRO" : "FREE",
        status: nextStatus,
        proValidUntil: nextValidUntil,
        maxRunningBots: nextMaxRunning,
        maxBotsTotal: nextMaxTotal,
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

    if (delta !== 0n) {
      await tx.aiTokenLedger.create({
        data: {
          userId: order.userId,
          subscriptionId: updatedSub.id,
          orderId: order.id,
          reason,
          deltaTokens: delta,
          balanceAfter: nextBalance,
          meta: {
            packageId: pkg.id,
            packageCode: pkg.code,
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
  limits: { maxRunningBots: number; maxBotsTotal: number; allowedExchanges: string[] };
  usage: { totalBots: number; runningBots: number };
  ai: { tokenBalance: string; tokenUsedLifetime: string; monthlyIncluded: string; billingEnabled: boolean };
  packages: any[];
  orders: any[];
}> {
  await ensureBillingDefaults();
  const resolved = await resolveEffectivePlanForUser(userId);
  const [totalBots, runningBots, packages, orders] = await Promise.all([
    db.bot.count({ where: { userId } }),
    db.bot.count({ where: { userId, status: "running" } }),
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
      maxRunningBots: resolved.maxRunningBots,
      maxBotsTotal: resolved.maxBotsTotal,
      allowedExchanges: resolved.allowedExchanges
    },
    usage: {
      totalBots,
      runningBots
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
      }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}

export async function getEntitlementsForBotStart(userId: string): Promise<{
  maxRunningBots: number;
  maxBotsTotal: number;
  allowedExchanges: string[];
}> {
  const resolved = await resolveEffectivePlanForUser(userId);
  return {
    maxRunningBots: resolved.maxRunningBots,
    maxBotsTotal: resolved.maxBotsTotal,
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
  if (resolved.plan !== "pro") {
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
  allowedExchanges: string[];
  monthlyAiTokens: number;
  topupAiTokens: number;
  meta?: Record<string, unknown> | null;
}): Promise<any> {
  const data = {
    code: params.code.trim(),
    name: params.name.trim(),
    description: params.description ?? null,
    kind: params.kind === "ai_topup" ? "AI_TOPUP" : "PLAN",
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
    allowedExchanges: normalizeStringArray(params.allowedExchanges, ["*"]),
    monthlyAiTokens: BigInt(Math.max(0, Math.trunc(params.monthlyAiTokens))),
    topupAiTokens: BigInt(Math.max(0, Math.trunc(params.topupAiTokens))),
    meta: params.meta ?? null
  };

  if (params.id) {
    return db.billingPackage.update({
      where: { id: params.id },
      data
    });
  }

  return db.billingPackage.create({ data });
}

export async function deleteBillingPackage(id: string): Promise<void> {
  await db.billingPackage.delete({ where: { id } });
}
