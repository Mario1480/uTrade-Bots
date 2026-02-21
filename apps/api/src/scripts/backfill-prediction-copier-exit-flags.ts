import "dotenv/config";
import { prisma } from "@mm/db";

type Summary = {
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readPredictionCopierRootConfig(paramsJson: unknown): {
  params: Record<string, unknown>;
  root: Record<string, unknown>;
  nested: boolean;
} {
  const params = asRecord(paramsJson);
  const nested = asRecord(params.predictionCopier);
  if (Object.keys(nested).length > 0) {
    return { params, root: nested, nested: true };
  }
  return { params, root: params, nested: false };
}

function writePredictionCopierRootConfig(
  params: Record<string, unknown>,
  root: Record<string, unknown>,
  forceNested: boolean
): Record<string, unknown> {
  if (forceNested || Object.prototype.hasOwnProperty.call(params, "predictionCopier")) {
    return {
      ...params,
      predictionCopier: root
    };
  }
  return {
    ...params,
    ...root
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const summary: Summary = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    dryRun
  };

  const rows = await prisma.futuresBotConfig.findMany({
    where: { strategyKey: "prediction_copier" },
    select: {
      id: true,
      botId: true,
      paramsJson: true
    }
  });

  summary.scanned = rows.length;

  for (const row of rows) {
    try {
      const { params, root, nested } = readPredictionCopierRootConfig(row.paramsJson);
      const exit = asRecord(root.exit);

      const hasOnSignalFlip = typeof exit.onSignalFlip === "boolean";
      const hasOnConfidenceDrop = typeof exit.onConfidenceDrop === "boolean";
      if (hasOnSignalFlip && hasOnConfidenceDrop) {
        summary.skipped += 1;
        continue;
      }

      const nextRoot: Record<string, unknown> = {
        ...root,
        exit: {
          ...exit,
          onSignalFlip: hasOnSignalFlip ? exit.onSignalFlip : false,
          onConfidenceDrop: hasOnConfidenceDrop ? exit.onConfidenceDrop : false
        }
      };
      const nextParamsJson = writePredictionCopierRootConfig(params, nextRoot, nested);

      if (!dryRun) {
        await prisma.futuresBotConfig.update({
          where: { id: row.id },
          data: { paramsJson: nextParamsJson as any }
        });
      }
      summary.updated += 1;
      // eslint-disable-next-line no-console
      console.log(
        `[backfill-prediction-copier-exit-flags] ${dryRun ? "would_update" : "updated"} botId=${row.botId}`
      );
    } catch (error) {
      summary.failed += 1;
      // eslint-disable-next-line no-console
      console.error("[backfill-prediction-copier-exit-flags] failed", {
        botId: row.botId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("[backfill-prediction-copier-exit-flags] summary", summary);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[backfill-prediction-copier-exit-flags] fatal", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
