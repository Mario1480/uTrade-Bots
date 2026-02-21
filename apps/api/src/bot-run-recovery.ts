import { enqueueBotRun } from "./orchestration.js";

type RecoveryLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

type RecoverRunningBotJobsParams = {
  db: any;
  enqueueBotRunFn?: (botId: string) => Promise<{ jobId: string; queued: boolean }>;
  logger?: RecoveryLogger;
};

export type RecoverRunningBotJobsResult = {
  scanned: number;
  enqueued: number;
  alreadyQueued: number;
  failed: number;
};

const defaultLogger: RecoveryLogger = {
  info: (message, meta) => {
    // eslint-disable-next-line no-console
    console.log(`[bot-queue-recovery] ${message}`, meta ?? {});
  },
  warn: (message, meta) => {
    // eslint-disable-next-line no-console
    console.warn(`[bot-queue-recovery] ${message}`, meta ?? {});
  }
};

export async function recoverRunningBotJobs(
  params: RecoverRunningBotJobsParams
): Promise<RecoverRunningBotJobsResult> {
  const enqueue = params.enqueueBotRunFn ?? enqueueBotRun;
  const logger = params.logger ?? defaultLogger;

  const rowsRaw = await params.db.bot.findMany({
    where: { status: "running" },
    select: { id: true }
  });
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];

  const result: RecoverRunningBotJobsResult = {
    scanned: rows.length,
    enqueued: 0,
    alreadyQueued: 0,
    failed: 0
  };

  for (const row of rows) {
    const botId = String((row as any)?.id ?? "").trim();
    if (!botId) continue;
    try {
      const queueResult = await enqueue(botId);
      if (queueResult.queued) {
        result.enqueued += 1;
      } else {
        result.alreadyQueued += 1;
      }
    } catch (error) {
      result.failed += 1;
      logger.warn("requeue_failed", {
        botId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return result;
}
