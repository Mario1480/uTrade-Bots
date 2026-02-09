import crypto from "node:crypto";
import { logger } from "../logger.js";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const aiCache = new Map<string, CacheEntry<unknown>>();
const aiRateWindow: number[] = [];

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function nowMs() {
  return Date.now();
}

function pruneWindow(now: number) {
  const threshold = now - 60_000;
  while (aiRateWindow.length > 0 && aiRateWindow[0] < threshold) {
    aiRateWindow.shift();
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(",")}}`;
}

export function hashStableObject(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function resetAiAnalyzerState() {
  aiCache.clear();
  aiRateWindow.length = 0;
}

export type AiAnalyzeOptions<T> = {
  cacheKey: string;
  compute: () => Promise<T>;
  fallback: () => T | Promise<T>;
  ttlSec?: number;
  rateLimitPerMin?: number;
  aiModel?: string;
};

export type AiAnalyzeResult<T> = {
  value: T;
  cacheHit: boolean;
  fallbackUsed: boolean;
  rateLimited: boolean;
};

export async function analyzeWithAiGuards<T>(options: AiAnalyzeOptions<T>): Promise<AiAnalyzeResult<T>> {
  const ttlSec = options.ttlSec ?? toNumber(process.env.AI_CACHE_TTL_SEC, 300);
  const rateLimitPerMin = options.rateLimitPerMin ?? toNumber(process.env.AI_RATE_LIMIT_PER_MIN, 60);
  const now = nowMs();
  const cached = aiCache.get(options.cacheKey) as CacheEntry<T> | undefined;

  if (cached && cached.expiresAt > now) {
    logger.info("ai_cache_hit", {
      ai_cache_hit: true,
      ai_model: options.aiModel ?? process.env.AI_MODEL ?? "unknown"
    });
    return {
      value: cached.value,
      cacheHit: true,
      fallbackUsed: false,
      rateLimited: false
    };
  }

  pruneWindow(now);
  if (aiRateWindow.length >= rateLimitPerMin) {
    const fallbackValue = await options.fallback();
    aiCache.set(options.cacheKey, {
      value: fallbackValue,
      expiresAt: now + ttlSec * 1000
    });
    logger.warn("ai_rate_limited_fallback", {
      ai_fallback_used: true,
      ai_model: options.aiModel ?? process.env.AI_MODEL ?? "unknown"
    });
    return {
      value: fallbackValue,
      cacheHit: false,
      fallbackUsed: true,
      rateLimited: true
    };
  }

  aiRateWindow.push(now);
  const startedAt = nowMs();

  try {
    const value = await options.compute();
    aiCache.set(options.cacheKey, {
      value,
      expiresAt: nowMs() + ttlSec * 1000
    });
    logger.info("ai_call_ok", {
      ai_call_ms: nowMs() - startedAt,
      ai_cache_hit: false,
      ai_model: options.aiModel ?? process.env.AI_MODEL ?? "unknown",
      ai_fallback_used: false
    });
    return {
      value,
      cacheHit: false,
      fallbackUsed: false,
      rateLimited: false
    };
  } catch (error) {
    const fallbackValue = await options.fallback();
    aiCache.set(options.cacheKey, {
      value: fallbackValue,
      expiresAt: nowMs() + ttlSec * 1000
    });
    logger.warn("ai_call_failed_fallback", {
      ai_call_ms: nowMs() - startedAt,
      ai_model: options.aiModel ?? process.env.AI_MODEL ?? "unknown",
      ai_fallback_used: true,
      reason: String(error)
    });
    return {
      value: fallbackValue,
      cacheHit: false,
      fallbackUsed: true,
      rateLimited: false
    };
  }
}

