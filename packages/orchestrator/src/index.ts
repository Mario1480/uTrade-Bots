import {
  Queue,
  QueueEvents,
  Worker,
  type ConnectionOptions,
  type Processor,
  type QueueOptions,
  type QueueEventsOptions,
  type WorkerOptions
} from "bullmq";

export type OrchestrationMode = "queue" | "poll";

export type QueueRuntimeConfig = {
  redisUrl: string;
  queuePrefix: string;
  botQueueName: string;
};

export type RunBotJobData = {
  botId: string;
};

export type RedisConnection = ConnectionOptions;

const RUN_BOT_JOB_PREFIX = "bot-";
export const RUN_BOT_JOB_NAME = "runBot";

function normalize(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

function readPositiveInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function getOrchestrationMode(
  raw: string | null | undefined = process.env.ORCHESTRATION_MODE,
  nodeEnv: string | null | undefined = process.env.NODE_ENV
): OrchestrationMode {
  const normalized = normalize(raw);
  if (normalized === "queue") return "queue";
  if (normalized === "poll") return "poll";
  return normalize(nodeEnv) === "production" ? "queue" : "poll";
}

export function getQueueRuntimeConfigFromEnv(): QueueRuntimeConfig {
  return {
    redisUrl: process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    queuePrefix: process.env.QUEUE_PREFIX?.trim() || "utradevip",
    botQueueName: process.env.BOT_QUEUE_NAME?.trim() || "bots"
  };
}

export function getWorkerConcurrency(): number {
  return readPositiveInt(process.env.WORKER_CONCURRENCY, 10);
}

export function getWorkerLockDurationMs(): number {
  return readPositiveInt(process.env.WORKER_LOCK_DURATION_MS, 60_000);
}

export function getWorkerStalledIntervalMs(): number {
  return readPositiveInt(process.env.WORKER_STALLED_INTERVAL_MS, 30_000);
}

export function getWorkerMaxStalledCount(): number {
  return readPositiveInt(process.env.WORKER_MAX_STALLED_COUNT, 2);
}

export function getBotRateLimitMax(): number {
  return readPositiveInt(process.env.BOT_RATE_LIMIT_MAX, 50);
}

export function getBotRateLimitDurationMs(): number {
  return readPositiveInt(process.env.BOT_RATE_LIMIT_DURATION_MS, 1_000);
}

export function getBotJobAttempts(): number {
  return readPositiveInt(process.env.BOT_JOB_ATTEMPTS, 5);
}

export function getBotJobBackoffDelayMs(): number {
  return readPositiveInt(process.env.BOT_JOB_BACKOFF_MS, 1_000);
}

export function createRedisConnection(redisUrl: string): RedisConnection {
  const url = new URL(redisUrl);
  const dbRaw = url.pathname.replace("/", "").trim();
  const db = dbRaw ? Number(dbRaw) : 0;

  const connection: Record<string, unknown> = {
    host: url.hostname,
    port: Number(url.port || "6379"),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    db: Number.isFinite(db) ? db : 0
  };

  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  if (url.protocol === "rediss:") connection.tls = {};

  return connection as RedisConnection;
}

export function getQueue(
  connection: RedisConnection,
  prefix: string,
  queueName: string,
  options: Omit<QueueOptions, "connection" | "prefix"> = {}
): Queue {
  return new Queue(queueName, {
    connection,
    prefix,
    ...options
  });
}

export function getQueueEvents(
  connection: RedisConnection,
  prefix: string,
  queueName: string,
  options: Omit<QueueEventsOptions, "connection" | "prefix"> = {}
): QueueEvents {
  return new QueueEvents(queueName, {
    connection,
    prefix,
    ...options
  });
}

export function getWorker<DataType = unknown, ResultType = unknown, NameType extends string = string>(
  connection: RedisConnection,
  prefix: string,
  queueName: string,
  processor: Processor<DataType, ResultType, NameType>,
  options: Omit<WorkerOptions, "connection" | "prefix"> = {} as Omit<WorkerOptions, "connection" | "prefix">
): Worker<DataType, ResultType, NameType> {
  return new Worker<DataType, ResultType, NameType>(queueName, processor, {
    connection,
    prefix,
    ...options
  });
}

export function toBotJobId(botId: string): string {
  return `${RUN_BOT_JOB_PREFIX}${botId}`;
}

export function botIdFromJobId(jobId: string | undefined | null): string | null {
  if (!jobId) return null;
  if (!jobId.startsWith(RUN_BOT_JOB_PREFIX)) return null;
  const botId = jobId.slice(RUN_BOT_JOB_PREFIX.length).trim();
  return botId.length > 0 ? botId : null;
}
