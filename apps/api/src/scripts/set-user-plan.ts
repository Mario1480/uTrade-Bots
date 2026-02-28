import "dotenv/config";
import { prisma } from "@mm/db";
import {
  ensureBillingDefaults,
  resolveEffectivePlanForUser,
  syncPrimaryWorkspaceEntitlementsForUser
} from "../billing/service.js";

type PlanArg = "free" | "pro";

const FREE_DEFAULTS = {
  maxRunningBots: 1,
  maxBotsTotal: 2,
  allowedExchanges: ["*"]
};

const PRO_DEFAULTS = {
  maxRunningBots: 3,
  maxBotsTotal: 10,
  allowedExchanges: ["*"],
  billingMonths: 1,
  monthlyAiTokens: 1_000_000n
};

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  npm -w apps/api run set-user-plan -- --email <user@email> [--plan free|pro] [--months 1] [--token-grant 1000000] [--skip-sync]",
      "",
      "Examples:",
      "  npm -w apps/api run set-user-plan -- --email admin@utrade.vip --plan free",
      "  npm -w apps/api run set-user-plan -- --email admin@utrade.vip --plan pro --months 1",
      "  npm -w apps/api run set-user-plan -- --email admin@utrade.vip --plan pro --token-grant 0"
    ].join("\n")
  );
}

function readArg(name: string): string | undefined {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    const next = process.argv[index + 1];
    if (next && !next.startsWith("--")) return next.trim();
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parsePlan(value: string | undefined): PlanArg {
  const normalized = String(value ?? "free").trim().toLowerCase();
  return normalized === "pro" ? "pro" : "free";
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function toBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function toNonNegativeBigInt(value: string | undefined, fallback: bigint): bigint {
  if (!value) return fallback;
  const parsed = toBigInt(value, fallback);
  return parsed < 0n ? 0n : parsed;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return out.length > 0 ? out : [...fallback];
}

function addMonths(base: Date, months: number): Date {
  const next = new Date(base);
  next.setMonth(next.getMonth() + Math.max(1, months));
  return next;
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  const email = (readArg("--email") ?? "").trim();
  if (!email) {
    printUsage();
    throw new Error("missing_required_arg_email");
  }

  const plan = parsePlan(readArg("--plan"));
  const skipSync = hasFlag("--skip-sync");

  await ensureBillingDefaults();

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive"
      }
    },
    select: {
      id: true,
      email: true
    }
  });

  if (!user) {
    throw new Error(`user_not_found:${email}`);
  }

  const [freePkg, proPkg] = await Promise.all([
    prisma.billingPackage.findUnique({ where: { code: "free" } }),
    prisma.billingPackage.findUnique({ where: { code: "pro_monthly" } })
  ]);

  if (plan === "free") {
    const freeRunning = toPositiveInt(freePkg?.maxRunningBots, FREE_DEFAULTS.maxRunningBots);
    const freeTotal = toPositiveInt(freePkg?.maxBotsTotal, FREE_DEFAULTS.maxBotsTotal);
    const freeExchanges = normalizeStringArray(freePkg?.allowedExchanges, FREE_DEFAULTS.allowedExchanges);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.userSubscription.findUnique({
        where: { userId: user.id },
        select: {
          aiTokenBalance: true,
          aiTokenUsedLifetime: true
        }
      });
      const balance = toBigInt(existing?.aiTokenBalance);
      const usedLifetime = toBigInt(existing?.aiTokenUsedLifetime);

      await tx.userSubscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          effectivePlan: "FREE",
          status: "ACTIVE",
          proValidUntil: null,
          maxRunningBots: freeRunning,
          maxBotsTotal: freeTotal,
          allowedExchanges: freeExchanges,
          aiTokenBalance: balance,
          aiTokenUsedLifetime: usedLifetime,
          monthlyAiTokensIncluded: 0n
        },
        update: {
          effectivePlan: "FREE",
          status: "ACTIVE",
          proValidUntil: null,
          maxRunningBots: freeRunning,
          maxBotsTotal: freeTotal,
          allowedExchanges: freeExchanges,
          monthlyAiTokensIncluded: 0n
        }
      });
    });
  } else {
    const proRunning = toPositiveInt(proPkg?.maxRunningBots, PRO_DEFAULTS.maxRunningBots);
    const proTotal = toPositiveInt(proPkg?.maxBotsTotal, PRO_DEFAULTS.maxBotsTotal);
    const proExchanges = normalizeStringArray(proPkg?.allowedExchanges, PRO_DEFAULTS.allowedExchanges);
    const monthlyIncluded = toBigInt(proPkg?.monthlyAiTokens, PRO_DEFAULTS.monthlyAiTokens);
    const defaultMonths = toPositiveInt(proPkg?.billingMonths, PRO_DEFAULTS.billingMonths);
    const months = toPositiveInt(readArg("--months"), defaultMonths);
    const tokenGrant = toNonNegativeBigInt(readArg("--token-grant"), monthlyIncluded);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const existing = await tx.userSubscription.findUnique({
        where: { userId: user.id },
        select: {
          id: true,
          proValidUntil: true,
          aiTokenBalance: true,
          aiTokenUsedLifetime: true
        }
      });

      const currentBalance = toBigInt(existing?.aiTokenBalance);
      const usedLifetime = toBigInt(existing?.aiTokenUsedLifetime);
      const startAt =
        existing?.proValidUntil instanceof Date && existing.proValidUntil.getTime() > now.getTime()
          ? existing.proValidUntil
          : now;
      const nextValidUntil = addMonths(startAt, months);
      const nextBalance = currentBalance + tokenGrant;

      const updated = await tx.userSubscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          effectivePlan: "PRO",
          status: "ACTIVE",
          proValidUntil: nextValidUntil,
          maxRunningBots: proRunning,
          maxBotsTotal: proTotal,
          allowedExchanges: proExchanges,
          aiTokenBalance: nextBalance,
          aiTokenUsedLifetime: usedLifetime,
          monthlyAiTokensIncluded: monthlyIncluded
        },
        update: {
          effectivePlan: "PRO",
          status: "ACTIVE",
          proValidUntil: nextValidUntil,
          maxRunningBots: proRunning,
          maxBotsTotal: proTotal,
          allowedExchanges: proExchanges,
          aiTokenBalance: nextBalance,
          monthlyAiTokensIncluded: monthlyIncluded
        }
      });

      if (tokenGrant > 0n) {
        await tx.aiTokenLedger.create({
          data: {
            userId: user.id,
            subscriptionId: updated.id,
            reason: "ADMIN_ADJUST",
            deltaTokens: tokenGrant,
            balanceAfter: nextBalance,
            meta: {
              source: "set-user-plan-script",
              email: user.email,
              plan,
              months
            }
          }
        });
      }
    });
  }

  if (!skipSync) {
    await syncPrimaryWorkspaceEntitlementsForUser({
      userId: user.id,
      effectivePlan: plan
    });
  }

  const [resolved, primaryMembership] = await Promise.all([
    resolveEffectivePlanForUser(user.id),
    prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true }
    })
  ]);

  const entitlement = primaryMembership?.workspaceId
    ? await prisma.licenseEntitlement.findUnique({
        where: { workspaceId: primaryMembership.workspaceId },
        select: {
          plan: true,
          allowedStrategyKinds: true,
          maxCompositeNodes: true
        }
      })
    : null;

  // eslint-disable-next-line no-console
  console.log("[set-user-plan] done", {
    userId: user.id,
    email: user.email,
    requestedPlan: plan,
    effectivePlan: resolved.plan,
    status: resolved.status,
    proValidUntil: resolved.proValidUntil,
    maxRunningBots: resolved.maxRunningBots,
    maxBotsTotal: resolved.maxBotsTotal,
    allowedExchanges: resolved.allowedExchanges,
    aiTokenBalance: resolved.aiTokenBalance.toString(),
    monthlyAiTokensIncluded: resolved.monthlyAiTokensIncluded.toString(),
    workspaceId: primaryMembership?.workspaceId ?? null,
    entitlementPlan: entitlement?.plan ?? null,
    entitlementKinds: entitlement?.allowedStrategyKinds ?? [],
    entitlementMaxCompositeNodes: entitlement?.maxCompositeNodes ?? null,
    syncApplied: !skipSync
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[set-user-plan] fatal", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
