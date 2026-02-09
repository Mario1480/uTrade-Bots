import "dotenv/config";
import { createServer } from "node:http";
import os from "node:os";
import {
  botIdFromJobId,
  createRedisConnection,
  getBotRateLimitDurationMs,
  getBotRateLimitMax,
  getOrchestrationMode,
  getQueueEvents,
  getQueueRuntimeConfigFromEnv,
  getWorker,
  getWorkerConcurrency,
  getWorkerLockDurationMs,
  getWorkerMaxStalledCount,
  getWorkerStalledIntervalMs,
  type RunBotJobData
} from "@mm/orchestrator";
import {
  applyCircuitBreakerOutcome,
  getCircuitBreakerConfigFromEnv,
  toCircuitBreakerState
} from "./circuit-breaker.js";
import {
  getBotRuntimeCircuitBreakerState,
  getBotStatus,
  getRunnerBotCounters,
  loadActiveFuturesBots,
  loadBotForExecution,
  markBotAsError,
  markRunnerHeartbeat,
  upsertBotRuntime,
  writeRiskEvent
} from "./db.js";
import { log } from "./logger.js";
import { loopOnce } from "./loop.js";

let shutdownRequested = false;
const workerId = `${os.hostname()}:${process.pid}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishRunnerHeartbeat() {
  const counters = await getRunnerBotCounters();
  await markRunnerHeartbeat(counters);
}

function getBotIdFromJobData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const botId = (data as { botId?: unknown }).botId;
  if (typeof botId !== "string") return null;
  const trimmed = botId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function applyCircuitBreakerError(params: {
  botId: string;
  errorMessage: string;
}) {
  const cbConfig = getCircuitBreakerConfigFromEnv();
  const currentStateRaw = await getBotRuntimeCircuitBreakerState(params.botId);
  const currentState = toCircuitBreakerState(currentStateRaw);
  const outcome = applyCircuitBreakerOutcome({
    outcome: "error",
    state: currentState,
    config: cbConfig,
    now: new Date(),
    errorMessage: params.errorMessage
  });

  if (outcome.tripped) {
    const reason = `circuit_breaker_tripped:${params.errorMessage}`;
    await Promise.allSettled([
      markBotAsError(params.botId, reason),
      upsertBotRuntime({
        botId: params.botId,
        status: "error",
        reason,
        lastError: reason,
        workerId,
        lastHeartbeatAt: new Date(),
        consecutiveErrors: outcome.state.consecutiveErrors,
        errorWindowStartAt: outcome.state.errorWindowStartAt,
        lastErrorAt: outcome.state.lastErrorAt,
        lastErrorMessage: outcome.state.lastErrorMessage
      }),
      writeRiskEvent({
        botId: params.botId,
        type: "CIRCUIT_BREAKER_TRIPPED",
        message: reason,
        meta: {
          maxErrors: cbConfig.maxErrors,
          windowSeconds: cbConfig.windowSeconds,
          action: cbConfig.action,
          observedErrors: outcome.state.consecutiveErrors
        }
      })
    ]);

    return { tripped: true };
  }

  await Promise.allSettled([
    upsertBotRuntime({
      botId: params.botId,
      status: "running",
      reason: `bot_error_retry:${params.errorMessage}`,
      lastError: params.errorMessage,
      workerId,
      lastHeartbeatAt: new Date(),
      consecutiveErrors: outcome.state.consecutiveErrors,
      errorWindowStartAt: outcome.state.errorWindowStartAt,
      lastErrorAt: outcome.state.lastErrorAt,
      lastErrorMessage: outcome.state.lastErrorMessage
    }),
    writeRiskEvent({
      botId: params.botId,
      type: "BOT_ERROR",
      message: params.errorMessage,
      meta: {
        consecutiveErrors: outcome.state.consecutiveErrors,
        windowSeconds: cbConfig.windowSeconds
      }
    })
  ]);

  return { tripped: false };
}

async function processRunBotJob(data: RunBotJobData | unknown) {
  const botId = getBotIdFromJobData(data);
  if (!botId) throw new Error("invalid_job_payload");

  let ticks = 0;
  await upsertBotRuntime({
    botId,
    status: "running",
    reason: "job_active",
    workerId,
    lastHeartbeatAt: new Date()
  });

  while (!shutdownRequested) {
    const status = await getBotStatus(botId);
    if (!status) {
      await upsertBotRuntime({
        botId,
        status: "stopped",
        reason: "bot_not_found",
        workerId,
        lastHeartbeatAt: new Date()
      });
      return { stopped: true, reason: "bot_not_found" };
    }

    if (status !== "running") {
      await upsertBotRuntime({
        botId,
        status,
        reason: "stop_requested",
        workerId,
        lastHeartbeatAt: new Date()
      });
      return { stopped: true, reason: "stop_requested" };
    }

    const bot = await loadBotForExecution(botId);
    if (!bot) {
      const reason = "bot_config_incomplete";
      await markBotAsError(botId, reason);
      await upsertBotRuntime({
        botId,
        status: "error",
        reason,
        lastError: reason,
        workerId,
        lastHeartbeatAt: new Date()
      });
      return { stopped: true, reason };
    }

    try {
      const tickResult = await loopOnce(bot, workerId);
      ticks += 1;
      await upsertBotRuntime({
        botId,
        status: "running",
        reason: tickResult.reason,
        workerId,
        lastHeartbeatAt: new Date(),
        lastTickAt: new Date(),
        stateJson: { ticks, outcome: tickResult.outcome }
      });
    } catch (error) {
      const reason = String(error);
      const cbState = await applyCircuitBreakerError({ botId, errorMessage: reason });
      if (cbState.tripped) {
        return { stopped: true, reason: "circuit_breaker_tripped" };
      }
    }

    await sleep(bot.tickMs);
  }

  await upsertBotRuntime({
    botId,
    status: "running",
    reason: "shutdown_requested",
    workerId,
    lastHeartbeatAt: new Date()
  });
  return { stopped: true, reason: "shutdown_requested" };
}

async function runPollSupervisor() {
  const scanMs = Number(process.env.RUNNER_SCAN_MS ?? "500");
  const lastTickByBot = new Map<string, number>();

  while (!shutdownRequested) {
    try {
      const now = Date.now();
      const bots = await loadActiveFuturesBots();
      const activeIds = new Set(bots.map((bot) => bot.id));

      for (const botId of lastTickByBot.keys()) {
        if (!activeIds.has(botId)) lastTickByBot.delete(botId);
      }

      let errored = 0;
      await Promise.all(
        bots.map(async (bot) => {
          const lastTick = lastTickByBot.get(bot.id) ?? 0;
          if (now - lastTick < bot.tickMs) return;

          lastTickByBot.set(bot.id, now);
          try {
            const tickResult = await loopOnce(bot, workerId);
            await upsertBotRuntime({
              botId: bot.id,
              status: "running",
              reason: tickResult.reason,
              workerId,
              lastHeartbeatAt: new Date(),
              lastTickAt: new Date()
            });
          } catch (error) {
            errored += 1;
            const reason = String(error);
            log.warn({ botId: bot.id, err: reason }, "bot tick failed");
            await applyCircuitBreakerError({ botId: bot.id, errorMessage: reason });
          }
        })
      );

      await markRunnerHeartbeat({
        botsRunning: bots.length,
        botsErrored: errored
      });
    } catch (error) {
      log.warn({ err: String(error) }, "runner supervisor tick failed");
    }

    await sleep(scanMs);
  }
}

async function runQueueWorker() {
  const cfg = getQueueRuntimeConfigFromEnv();
  const workerConnection = createRedisConnection(cfg.redisUrl);
  const eventsConnection = createRedisConnection(cfg.redisUrl);

  const queueEvents = getQueueEvents(eventsConnection, cfg.queuePrefix, cfg.botQueueName);
  await queueEvents.waitUntilReady();

  const worker = getWorker<RunBotJobData, unknown>(
    workerConnection,
    cfg.queuePrefix,
    cfg.botQueueName,
    async (job: { data: RunBotJobData }) => processRunBotJob(job.data),
    {
      concurrency: getWorkerConcurrency(),
      limiter: {
        max: getBotRateLimitMax(),
        duration: getBotRateLimitDurationMs()
      },
      lockDuration: getWorkerLockDurationMs(),
      stalledInterval: getWorkerStalledIntervalMs(),
      maxStalledCount: getWorkerMaxStalledCount()
    }
  );

  worker.on("error", (error: unknown) => {
    log.error({ err: String(error) }, "queue worker error");
  });

  queueEvents.on("active", ({ jobId }: { jobId?: string }) => {
    const botId = botIdFromJobId(jobId);
    if (!botId) return;
    void upsertBotRuntime({
      botId,
      status: "running",
      reason: "queue_active",
      workerId,
      lastHeartbeatAt: new Date()
    });
  });

  queueEvents.on("completed", ({ jobId }: { jobId?: string }) => {
    const botId = botIdFromJobId(jobId);
    if (!botId) return;
    void (async () => {
      const status = await getBotStatus(botId);
      await upsertBotRuntime({
        botId,
        status: status === "error" ? "error" : "stopped",
        reason: status === "error" ? "circuit_breaker_tripped" : "queue_completed",
        workerId,
        lastHeartbeatAt: new Date()
      });
    })();
  });

  queueEvents.on("failed", ({ jobId, failedReason }: { jobId?: string; failedReason?: string }) => {
    const botId = botIdFromJobId(jobId);
    if (!botId) return;
    const reason = failedReason || "queue_failed";
    void markBotAsError(botId, reason);
    void writeRiskEvent({
      botId,
      type: "BOT_ERROR",
      message: reason,
      meta: { source: "queue_failed_event" }
    });
    void upsertBotRuntime({
      botId,
      status: "error",
      reason,
      lastError: reason,
      workerId,
      lastHeartbeatAt: new Date()
    });
  });

  queueEvents.on("stalled", ({ jobId }: { jobId?: string }) => {
    const botId = botIdFromJobId(jobId);
    if (!botId) return;
    void upsertBotRuntime({
      botId,
      status: "running",
      reason: "queue_stalled",
      workerId,
      lastHeartbeatAt: new Date()
    });
  });

  const heartbeatInterval = setInterval(() => {
    void publishRunnerHeartbeat();
  }, 5_000);

  await publishRunnerHeartbeat();

  await new Promise<void>((resolve) => {
    let closing = false;

    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      shutdownRequested = true;
      log.info({ signal }, "queue worker shutdown requested");

      clearInterval(heartbeatInterval);
      await Promise.allSettled([worker.close(), queueEvents.close()]);
      await publishRunnerHeartbeat();
      resolve();
    };

    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });
  });
}

async function main() {
  const mode = getOrchestrationMode();
  const port = Number(process.env.RUNNER_PORT ?? "8091");

  const server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, service: "runner", mode }));
  });

  server.listen(port, "0.0.0.0", () => {
    log.info({ port, mode }, "runner health server listening");
  });

  if (mode === "queue") {
    await runQueueWorker();
    return;
  }

  process.once("SIGTERM", () => {
    shutdownRequested = true;
  });
  process.once("SIGINT", () => {
    shutdownRequested = true;
  });

  await runPollSupervisor();
}

main().catch((error) => {
  log.error({ err: String(error) }, "runner crashed");
  process.exit(1);
});
