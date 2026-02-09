import {
  RUN_BOT_JOB_NAME,
  type RedisConnection,
  createRedisConnection,
  getBotJobAttempts,
  getBotJobBackoffDelayMs,
  getOrchestrationMode,
  getQueue,
  getQueueRuntimeConfigFromEnv,
  toBotJobId
} from "@mm/orchestrator";

let queueConnection: RedisConnection | null = null;
let botQueue: ReturnType<typeof getQueue> | null = null;

function isQueueMode(): boolean {
  return getOrchestrationMode() === "queue";
}

async function ensureBotQueue(): Promise<ReturnType<typeof getQueue> | null> {
  if (!isQueueMode()) return null;
  if (botQueue) return botQueue;

  const cfg = getQueueRuntimeConfigFromEnv();
  queueConnection = createRedisConnection(cfg.redisUrl);

  botQueue = getQueue(queueConnection, cfg.queuePrefix, cfg.botQueueName, {
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });

  await botQueue.waitUntilReady();
  return botQueue;
}

export function getRuntimeOrchestrationMode(): "queue" | "poll" {
  return getOrchestrationMode();
}

export async function enqueueBotRun(botId: string): Promise<{ jobId: string; queued: boolean }> {
  if (!isQueueMode()) return { jobId: toBotJobId(botId), queued: false };

  const queue = await ensureBotQueue();
  if (!queue) throw new Error("queue_not_initialized");

  const jobId = toBotJobId(botId);
  await queue.add(
    RUN_BOT_JOB_NAME,
    { botId },
    {
      jobId,
      attempts: getBotJobAttempts(),
      backoff: {
        type: "exponential",
        delay: getBotJobBackoffDelayMs()
      }
    }
  );

  return { jobId, queued: true };
}

export async function cancelBotRun(botId: string): Promise<{ jobId: string; removed: boolean }> {
  const jobId = toBotJobId(botId);
  if (!isQueueMode()) return { jobId, removed: false };

  const queue = await ensureBotQueue();
  if (!queue) return { jobId, removed: false };

  const job = await queue.getJob(jobId);
  if (!job) return { jobId, removed: false };

  try {
    await job.remove();
    return { jobId, removed: true };
  } catch {
    // Active jobs cannot always be removed; worker exits via DB status check.
    return { jobId, removed: false };
  }
}

export async function getQueueMetrics(): Promise<Record<string, unknown>> {
  if (!isQueueMode()) {
    return {
      mode: "poll",
      queueEnabled: false
    };
  }

  const queue = await ensureBotQueue();
  if (!queue) {
    return {
      mode: "queue",
      queueEnabled: false
    };
  }

  const counts = await queue.getJobCounts(
    "active",
    "waiting",
    "delayed",
    "failed",
    "completed",
    "paused"
  );

  return {
    mode: "queue",
    queueEnabled: true,
    ...counts
  };
}

export async function closeOrchestration(): Promise<void> {
  await Promise.allSettled([botQueue?.close()]);
  botQueue = null;
  queueConnection = null;
}
