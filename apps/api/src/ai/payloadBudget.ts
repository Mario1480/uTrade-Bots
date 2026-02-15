import { logger } from "../logger.js";
import { hashStableObject } from "./analyzer.js";
import { trimHistoryContextForAi, type HistoryContextV1 } from "./historyContext.js";

export type AiPayloadBudgetOptions = {
  maxPayloadBytes?: number;
  maxHistoryBytes?: number;
};

export type AiPayloadBudgetMetrics = {
  bytes: number;
  estimatedTokens: number;
  trimFlags: string[];
  maxPayloadBytes: number;
  maxHistoryBytes: number;
  toolCallsUsed: number;
  historyContextHash: string | null;
  overBudget: boolean;
};

type TelemetryState = {
  trimTimestamps: number[];
  highWaterConsecutive: number;
  lastHighWaterAt: number | null;
  totalBudgetCalls: number;
  totalCacheChecks: number;
  cacheHits: number;
  lastMetrics: AiPayloadBudgetMetrics | null;
  lastMetricsAt: number | null;
};

const telemetry: TelemetryState = {
  trimTimestamps: [],
  highWaterConsecutive: 0,
  lastHighWaterAt: null,
  totalBudgetCalls: 0,
  totalCacheChecks: 0,
  cacheHits: 0,
  lastMetrics: null,
  lastMetricsAt: null
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function estimateTokensByBytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4));
}

function normalizeMaxPayloadBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12 * 1024;
  return Math.max(512, Math.min(256 * 1024, Math.trunc(parsed)));
}

function normalizeMaxHistoryBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8 * 1024;
  return Math.max(512, Math.min(128 * 1024, Math.trunc(parsed)));
}

function normalizeTrimAlertPerHour(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(10000, Math.trunc(parsed)));
}

function normalizeHighWaterConsecutive(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(1000, Math.trunc(parsed)));
}

const PAYLOAD_TRIM_ALERT_PER_HOUR = normalizeTrimAlertPerHour(
  process.env.AI_PAYLOAD_TRIM_ALERT_PER_HOUR
);
const PAYLOAD_HIGHWATER_CONSECUTIVE = normalizeHighWaterConsecutive(
  process.env.AI_PAYLOAD_HIGHWATER_CONSECUTIVE
);

function pruneTrimWindow(now: number): void {
  const threshold = now - (60 * 60 * 1000);
  while (telemetry.trimTimestamps.length > 0 && telemetry.trimTimestamps[0] < threshold) {
    telemetry.trimTimestamps.shift();
  }
}

function getHistoryContext(payload: Record<string, unknown>): HistoryContextV1 | null {
  const featureSnapshot = asObject(payload.featureSnapshot);
  if (!featureSnapshot) return null;
  const history = asObject(featureSnapshot.historyContext);
  if (!history || Number(history.v) !== 1) return null;
  return history as unknown as HistoryContextV1;
}

function setHistoryContext(payload: Record<string, unknown>, history: HistoryContextV1 | null): void {
  const featureSnapshot = asObject(payload.featureSnapshot);
  if (!featureSnapshot) return;
  if (!history) {
    delete featureSnapshot.historyContext;
    return;
  }
  featureSnapshot.historyContext = history as unknown as Record<string, unknown>;
}

function ensurePayloadMeta(payload: Record<string, unknown>): Record<string, unknown> {
  const existing = asObject(payload.meta);
  if (existing) return existing;
  const created: Record<string, unknown> = {};
  payload.meta = created;
  return created;
}

function uniqueFlags(flags: string[]): string[] {
  const set = new Set<string>();
  for (const flag of flags) {
    const normalized = String(flag ?? "").trim();
    if (!normalized) continue;
    set.add(normalized);
  }
  return [...set];
}

function historyHashForTelemetry(history: HistoryContextV1 | null): string | null {
  if (!history) return null;
  const clone = deepClone(history) as HistoryContextV1;
  if (clone.bud && typeof clone.bud === "object") {
    clone.bud.bytes = 0;
  }
  return hashStableObject(clone);
}

function trimPayloadForBudget(payload: Record<string, unknown>, maxPayloadBytes: number): {
  payload: Record<string, unknown>;
  flags: string[];
  overBudget: boolean;
} {
  const flags: string[] = [];
  let current = payload;

  const run = (label: string, mutator: (history: HistoryContextV1) => HistoryContextV1 | null): boolean => {
    const history = getHistoryContext(current);
    if (!history) return false;
    const next = mutator(history);
    if (next === history) return false;
    setHistoryContext(current, next);
    flags.push(label);
    return true;
  };

  const payloadBytes = () => bytesOf(current);
  if (payloadBytes() <= maxPayloadBytes) {
    return { payload: current, flags, overBudget: false };
  }

  run("history_ev_trimmed_10", (history) => {
    if (history.ev.length <= 10) return history;
    const next = deepClone(history);
    next.ev = next.ev.slice(0, 10);
    return next;
  });
  if (payloadBytes() <= maxPayloadBytes) {
    return { payload: current, flags, overBudget: false };
  }

  run("history_ev_dropped", (history) => {
    if (history.ev.length === 0) return history;
    const next = deepClone(history);
    next.ev = [];
    return next;
  });
  if (payloadBytes() <= maxPayloadBytes) {
    return { payload: current, flags, overBudget: false };
  }

  run("history_lastbars_trimmed_10", (history) => {
    const rows = history.lastBars?.ohlc ?? [];
    if (rows.length <= 10) return history;
    const next = deepClone(history);
    next.lastBars.ohlc = rows.slice(-10);
    next.lastBars.n = next.lastBars.ohlc.length;
    return next;
  });
  if (payloadBytes() <= maxPayloadBytes) {
    return { payload: current, flags, overBudget: false };
  }

  run("history_lastbars_dropped", (history) => {
    const rows = history.lastBars?.ohlc ?? [];
    if (rows.length === 0) return history;
    const next = deepClone(history);
    delete (next as unknown as Record<string, unknown>).lastBars;
    return next;
  });
  if (payloadBytes() <= maxPayloadBytes) {
    return { payload: current, flags, overBudget: false };
  }

  run("history_context_dropped", () => null);
  return {
    payload: current,
    flags,
    overBudget: payloadBytes() > maxPayloadBytes
  };
}

export function applyAiPayloadBudget(
  rawPayload: Record<string, unknown>,
  options: AiPayloadBudgetOptions = {}
): { payload: Record<string, unknown>; metrics: AiPayloadBudgetMetrics } {
  const maxPayloadBytes = normalizeMaxPayloadBytes(
    options.maxPayloadBytes ?? process.env.AI_MAX_PAYLOAD_BYTES
  );
  const maxHistoryBytes = normalizeMaxHistoryBytes(
    options.maxHistoryBytes ?? process.env.AI_MAX_HISTORY_BYTES
  );

  const payload = deepClone(rawPayload);
  const trimFlags: string[] = [];

  const initialHistory = getHistoryContext(payload);
  if (initialHistory) {
    const historyBytes = bytesOf(initialHistory);
    if (historyBytes > maxHistoryBytes) {
      const trimmed = trimHistoryContextForAi(initialHistory, {
        maxEvents: 30,
        lastBars: 30,
        maxBytes: maxHistoryBytes
      });
      setHistoryContext(payload, trimmed);
      trimFlags.push("history_bytes_trimmed");
      for (const nested of trimmed.bud.trim ?? []) {
        trimFlags.push(`history_${nested}`);
      }
    }
  }

  const budgetTrimmed = trimPayloadForBudget(payload, maxPayloadBytes);
  trimFlags.push(...budgetTrimmed.flags);

  let workingPayload = budgetTrimmed.payload;
  let mergedTrimFlags = uniqueFlags(trimFlags);
  let bytes = bytesOf(workingPayload);
  let overBudget = budgetTrimmed.overBudget || bytes > maxPayloadBytes;
  let estimatedTokens = estimateTokensByBytes(bytes);
  let meta = ensurePayloadMeta(workingPayload);
  meta.trim = uniqueFlags([...(Array.isArray(meta.trim) ? (meta.trim as string[]) : []), ...mergedTrimFlags]);
  meta.payloadBytes = bytes;
  meta.estimatedTokens = estimatedTokens;

  bytes = bytesOf(workingPayload);
  if (bytes > maxPayloadBytes) {
    const secondPass = trimPayloadForBudget(workingPayload, maxPayloadBytes);
    workingPayload = secondPass.payload;
    mergedTrimFlags = uniqueFlags([...mergedTrimFlags, ...secondPass.flags]);
    bytes = bytesOf(workingPayload);
    overBudget = secondPass.overBudget || bytes > maxPayloadBytes;
    estimatedTokens = estimateTokensByBytes(bytes);
    meta = ensurePayloadMeta(workingPayload);
    meta.trim = uniqueFlags([...(Array.isArray(meta.trim) ? (meta.trim as string[]) : []), ...mergedTrimFlags]);
    meta.payloadBytes = bytes;
    meta.estimatedTokens = estimatedTokens;
  }

  if (overBudget) {
    mergedTrimFlags = uniqueFlags([...mergedTrimFlags, "payload_budget_exceeded"]);
    meta = ensurePayloadMeta(workingPayload);
    meta.trim = uniqueFlags([...(Array.isArray(meta.trim) ? (meta.trim as string[]) : []), ...mergedTrimFlags]);
  }

  const historyHash = historyHashForTelemetry(getHistoryContext(workingPayload));

  return {
    payload: workingPayload,
    metrics: {
      bytes,
      estimatedTokens,
      trimFlags: mergedTrimFlags,
      maxPayloadBytes,
      maxHistoryBytes,
      toolCallsUsed: 0,
      historyContextHash: historyHash,
      overBudget
    }
  };
}

export function recordAiPayloadBudgetTelemetry(metrics: AiPayloadBudgetMetrics): void {
  const now = Date.now();
  telemetry.totalBudgetCalls += 1;
  telemetry.lastMetrics = { ...metrics };
  telemetry.lastMetricsAt = now;

  if (metrics.trimFlags.length > 0) {
    telemetry.trimTimestamps.push(now);
  }
  pruneTrimWindow(now);

  const highWaterThreshold = Math.floor(metrics.maxPayloadBytes * 0.9);
  if (metrics.bytes >= highWaterThreshold) {
    telemetry.highWaterConsecutive += 1;
    telemetry.lastHighWaterAt = now;
  } else {
    telemetry.highWaterConsecutive = 0;
  }

  logger.info("ai_payload_budget", {
    ai_prompt_bytes: metrics.bytes,
    ai_prompt_est_tokens: metrics.estimatedTokens,
    trim_flags: metrics.trimFlags,
    tool_calls_used: metrics.toolCallsUsed,
    max_payload_bytes: metrics.maxPayloadBytes,
    max_history_bytes: metrics.maxHistoryBytes,
    history_context_hash: metrics.historyContextHash,
    ai_payload_over_budget: metrics.overBudget,
    trim_events_last_hour: telemetry.trimTimestamps.length,
    high_water_consecutive: telemetry.highWaterConsecutive
  });
}

export function recordAiExplainerCacheTelemetry(cacheHit: boolean): { total: number; hit: number; ratePct: number } {
  telemetry.totalCacheChecks += 1;
  if (cacheHit) telemetry.cacheHits += 1;
  const total = telemetry.totalCacheChecks;
  const hit = telemetry.cacheHits;
  const ratePct = total > 0 ? Number(((hit / total) * 100).toFixed(2)) : 0;
  logger.info("ai_explainer_cache", {
    ai_cache_hit: cacheHit,
    ai_cache_total: total,
    ai_cache_hits: hit,
    ai_cache_hit_rate_pct: ratePct
  });
  return { total, hit, ratePct };
}

export function getAiPayloadBudgetAlertSnapshot(): {
  trimCountLastHour: number;
  trimAlertThresholdPerHour: number;
  trimAlert: boolean;
  highWaterConsecutive: number;
  highWaterConsecutiveThreshold: number;
  highWaterAlert: boolean;
  lastHighWaterAt: string | null;
} {
  const now = Date.now();
  pruneTrimWindow(now);
  const trimCountLastHour = telemetry.trimTimestamps.length;
  const trimAlert = trimCountLastHour >= PAYLOAD_TRIM_ALERT_PER_HOUR;
  const highWaterAlert = telemetry.highWaterConsecutive >= PAYLOAD_HIGHWATER_CONSECUTIVE;
  return {
    trimCountLastHour,
    trimAlertThresholdPerHour: PAYLOAD_TRIM_ALERT_PER_HOUR,
    trimAlert,
    highWaterConsecutive: telemetry.highWaterConsecutive,
    highWaterConsecutiveThreshold: PAYLOAD_HIGHWATER_CONSECUTIVE,
    highWaterAlert,
    lastHighWaterAt: telemetry.lastHighWaterAt ? new Date(telemetry.lastHighWaterAt).toISOString() : null
  };
}

export function getAiPayloadBudgetTelemetrySnapshot(): {
  totalBudgetCalls: number;
  totalCacheChecks: number;
  cacheHits: number;
  cacheHitRatePct: number;
  trimCountLastHour: number;
  trimAlertThresholdPerHour: number;
  trimAlert: boolean;
  highWaterConsecutive: number;
  highWaterConsecutiveThreshold: number;
  highWaterAlert: boolean;
  lastHighWaterAt: string | null;
  lastUpdatedAt: string | null;
  lastMetrics: {
    bytes: number;
    estimatedTokens: number;
    trimFlags: string[];
    maxPayloadBytes: number;
    maxHistoryBytes: number;
    toolCallsUsed: number;
    historyContextHash: string | null;
    overBudget: boolean;
  } | null;
} {
  const alert = getAiPayloadBudgetAlertSnapshot();
  const totalCacheChecks = telemetry.totalCacheChecks;
  const cacheHits = telemetry.cacheHits;
  const cacheHitRatePct = totalCacheChecks > 0
    ? Number(((cacheHits / totalCacheChecks) * 100).toFixed(2))
    : 0;
  return {
    totalBudgetCalls: telemetry.totalBudgetCalls,
    totalCacheChecks,
    cacheHits,
    cacheHitRatePct,
    trimCountLastHour: alert.trimCountLastHour,
    trimAlertThresholdPerHour: alert.trimAlertThresholdPerHour,
    trimAlert: alert.trimAlert,
    highWaterConsecutive: alert.highWaterConsecutive,
    highWaterConsecutiveThreshold: alert.highWaterConsecutiveThreshold,
    highWaterAlert: alert.highWaterAlert,
    lastHighWaterAt: alert.lastHighWaterAt,
    lastUpdatedAt: telemetry.lastMetricsAt ? new Date(telemetry.lastMetricsAt).toISOString() : null,
    lastMetrics: telemetry.lastMetrics
      ? {
        bytes: telemetry.lastMetrics.bytes,
        estimatedTokens: telemetry.lastMetrics.estimatedTokens,
        trimFlags: [...telemetry.lastMetrics.trimFlags],
        maxPayloadBytes: telemetry.lastMetrics.maxPayloadBytes,
        maxHistoryBytes: telemetry.lastMetrics.maxHistoryBytes,
        toolCallsUsed: telemetry.lastMetrics.toolCallsUsed,
        historyContextHash: telemetry.lastMetrics.historyContextHash,
        overBudget: telemetry.lastMetrics.overBudget
      }
      : null
  };
}

export function resetAiPayloadBudgetTelemetry(): void {
  telemetry.trimTimestamps.length = 0;
  telemetry.highWaterConsecutive = 0;
  telemetry.lastHighWaterAt = null;
  telemetry.totalBudgetCalls = 0;
  telemetry.totalCacheChecks = 0;
  telemetry.cacheHits = 0;
  telemetry.lastMetrics = null;
  telemetry.lastMetricsAt = null;
}
