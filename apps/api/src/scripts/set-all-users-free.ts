import "dotenv/config";
import { prisma } from "@mm/db";
import { ensureBillingDefaults, setUserToFreePlan } from "../billing/service.js";

type Summary = {
  scanned: number;
  updated: number;
  failed: number;
  dryRun: boolean;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  npm -w apps/api run set-all-users-free -- [--dry-run]",
      "",
      "Examples:",
      "  npm -w apps/api run set-all-users-free -- --dry-run",
      "  npm -w apps/api run set-all-users-free"
    ].join("\n")
  );
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  const dryRun = hasFlag("--dry-run");
  const summary: Summary = {
    scanned: 0,
    updated: 0,
    failed: 0,
    dryRun
  };

  await ensureBillingDefaults();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true
    },
    orderBy: { createdAt: "asc" }
  });

  summary.scanned = users.length;

  for (const user of users) {
    try {
      if (!dryRun) {
        const resolved = await setUserToFreePlan({
          userId: user.id,
          syncWorkspaceEntitlements: true
        });
        // eslint-disable-next-line no-console
        console.log("[set-all-users-free] updated", {
          userId: user.id,
          email: user.email,
          plan: resolved.plan,
          status: resolved.status,
          aiTokenBalance: resolved.aiTokenBalance.toString()
        });
      } else {
        // eslint-disable-next-line no-console
        console.log("[set-all-users-free] would_update", {
          userId: user.id,
          email: user.email
        });
      }
      summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      // eslint-disable-next-line no-console
      console.error("[set-all-users-free] failed", {
        userId: user.id,
        email: user.email,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("[set-all-users-free] summary", summary);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[set-all-users-free] fatal", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
