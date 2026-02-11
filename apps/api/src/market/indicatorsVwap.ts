import { logger } from "../logger.js";
import {
  bucketCandlesWithMeta,
  timeframeToMs,
  type Candle,
  type IntradayTF
} from "./timeframe.js";

type VwapNullReason = "zero_volume" | "insufficient_data" | "nan_guard";

type CacheEntry = {
  expiresAt: number;
  value: SessionVWAPResult;
};

type ComputeSessionVWAPOptions = {
  exchange?: string;
  symbol?: string;
  marketType?: "spot" | "perp";
  cacheTtlMs?: number;
  logMetrics?: boolean;
  sessionGapThreshold?: number;
};

export type SessionVWAPResult = {
  value: number | null;
  dist_pct: number | null;
  sessionStartUtcMs: number;
  latestBucketStart: number | null;
  mode: "session_utc";
  cacheHit: boolean;
  candleBucketed: boolean;
  bucketMismatchCount: number;
  sessionGapRatio: number;
  dataGap: boolean;
  vwapNullReason: VwapNullReason | null;
};

const sessionVwapCache = new Map<string, CacheEntry>();
const SESSION_VWAP_CACHE_TTL_MS = Math.max(1_000, Number(process.env.VWAP_SESSION_CACHE_TTL_MS ?? 120_000));
const SESSION_VWAP_GAP_THRESHOLD = Math.max(0, Math.min(1, Number(process.env.VWAP_SESSION_GAP_THRESHOLD ?? 0.03)));

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function sessionStartFromTs(tsMs: number): number {
  const date = new Date(tsMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  );
}

function cleanupExpiredCache(nowMs: number): void {
  if (sessionVwapCache.size <= 256) return;
  for (const [key, entry] of sessionVwapCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      sessionVwapCache.delete(key);
    }
  }
}

function buildSessionCacheKey(parts: {
  exchange: string;
  symbol: string;
  marketType: "spot" | "perp";
  tf: IntradayTF;
  sessionStartUtcMs: number;
  latestBucketStart: number;
}): string {
  return [
    "vwap:session",
    parts.exchange,
    parts.symbol,
    parts.marketType,
    parts.tf,
    String(parts.sessionStartUtcMs),
    String(parts.latestBucketStart)
  ].join(":");
}

function withLog(
  event: string,
  options: ComputeSessionVWAPOptions,
  payload: Record<string, unknown>
): void {
  if (options.logMetrics === false) return;
  logger.info(event, payload);
}

export function computeSessionVWAP(
  candles: Candle[],
  tf: IntradayTF,
  options: ComputeSessionVWAPOptions = {}
): SessionVWAPResult {
  const startedAt = Date.now();
  const cacheTtlMs = options.cacheTtlMs ?? SESSION_VWAP_CACHE_TTL_MS;
  const gapThreshold = options.sessionGapThreshold ?? SESSION_VWAP_GAP_THRESHOLD;
  const exchange = (options.exchange ?? "unknown").toLowerCase();
  const symbol = (options.symbol ?? "unknown").toUpperCase();
  const marketType = options.marketType ?? "perp";

  const bucketedMeta = bucketCandlesWithMeta(candles, tf);
  const bucketed = bucketedMeta.candles;
  const latestBucketStart = bucketed[bucketed.length - 1]?.ts ?? null;

  if (latestBucketStart === null) {
    const result: SessionVWAPResult = {
      value: null,
      dist_pct: null,
      sessionStartUtcMs: 0,
      latestBucketStart: null,
      mode: "session_utc",
      cacheHit: false,
      candleBucketed: bucketedMeta.candleBucketed,
      bucketMismatchCount: bucketedMeta.bucketMismatchCount,
      sessionGapRatio: 1,
      dataGap: true,
      vwapNullReason: "insufficient_data"
    };
    withLog("vwap_session_computed", options, {
      exchange,
      symbol,
      marketType,
      timeframe: tf,
      vwap_cache_hit: false,
      vwap_compute_ms: Date.now() - startedAt,
      candle_bucketed: bucketedMeta.candleBucketed,
      bucket_mismatch_count: bucketedMeta.bucketMismatchCount,
      session_start_utc: null,
      vwap_null_reason: result.vwapNullReason
    });
    return result;
  }

  const sessionStartUtcMs = sessionStartFromTs(latestBucketStart);
  const cacheKey = buildSessionCacheKey({
    exchange,
    symbol,
    marketType,
    tf,
    sessionStartUtcMs,
    latestBucketStart
  });
  const nowMs = Date.now();
  const cached = sessionVwapCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    withLog("vwap_session_computed", options, {
      exchange,
      symbol,
      marketType,
      timeframe: tf,
      vwap_cache_hit: true,
      vwap_compute_ms: Date.now() - startedAt,
      candle_bucketed: cached.value.candleBucketed,
      bucket_mismatch_count: cached.value.bucketMismatchCount,
      session_start_utc: new Date(cached.value.sessionStartUtcMs).toISOString(),
      vwap_null_reason: cached.value.vwapNullReason
    });
    return {
      ...cached.value,
      cacheHit: true
    };
  }

  const sessionCandles = bucketed.filter((row) => row.ts >= sessionStartUtcMs && row.ts <= latestBucketStart);
  if (!sessionCandles.length) {
    const result: SessionVWAPResult = {
      value: null,
      dist_pct: null,
      sessionStartUtcMs,
      latestBucketStart,
      mode: "session_utc",
      cacheHit: false,
      candleBucketed: bucketedMeta.candleBucketed,
      bucketMismatchCount: bucketedMeta.bucketMismatchCount,
      sessionGapRatio: 1,
      dataGap: true,
      vwapNullReason: "insufficient_data"
    };
    sessionVwapCache.set(cacheKey, { value: result, expiresAt: nowMs + cacheTtlMs });
    cleanupExpiredCache(nowMs);
    withLog("vwap_session_computed", options, {
      exchange,
      symbol,
      marketType,
      timeframe: tf,
      vwap_cache_hit: false,
      vwap_compute_ms: Date.now() - startedAt,
      candle_bucketed: bucketedMeta.candleBucketed,
      bucket_mismatch_count: bucketedMeta.bucketMismatchCount,
      session_start_utc: new Date(sessionStartUtcMs).toISOString(),
      vwap_null_reason: result.vwapNullReason
    });
    return result;
  }

  let sumPV = 0;
  let sumV = 0;
  for (const row of sessionCandles) {
    const volume = Number(row.volume);
    if (!Number.isFinite(volume) || volume <= 0) continue;
    const tp = (row.high + row.low + row.close) / 3;
    if (!Number.isFinite(tp)) continue;
    sumPV += tp * volume;
    sumV += volume;
  }

  const tfMs = timeframeToMs(tf);
  const expectedBucketCount = Math.max(1, Math.floor((latestBucketStart - sessionStartUtcMs) / tfMs) + 1);
  const missingBuckets = Math.max(0, expectedBucketCount - sessionCandles.length);
  const sessionGapRatio = expectedBucketCount > 0 ? missingBuckets / expectedBucketCount : 1;

  let value: number | null = null;
  let distPct: number | null = null;
  let nullReason: VwapNullReason | null = null;
  if (sumV <= 0) {
    nullReason = "zero_volume";
  } else {
    const raw = sumPV / sumV;
    if (!Number.isFinite(raw)) {
      nullReason = "nan_guard";
    } else {
      value = raw;
      const latestClose = sessionCandles[sessionCandles.length - 1]?.close;
      if (Number.isFinite(latestClose) && latestClose > 0) {
        distPct = ((latestClose / raw) - 1) * 100;
      }
    }
  }

  const result: SessionVWAPResult = {
    value: round(value, 6),
    dist_pct: round(distPct, 6),
    sessionStartUtcMs,
    latestBucketStart,
    mode: "session_utc",
    cacheHit: false,
    candleBucketed: bucketedMeta.candleBucketed,
    bucketMismatchCount: bucketedMeta.bucketMismatchCount,
    sessionGapRatio: round(sessionGapRatio, 6) ?? 0,
    dataGap: sessionGapRatio > gapThreshold || nullReason !== null,
    vwapNullReason: nullReason
  };

  sessionVwapCache.set(cacheKey, {
    value: result,
    expiresAt: nowMs + cacheTtlMs
  });
  cleanupExpiredCache(nowMs);

  withLog("vwap_session_computed", options, {
    exchange,
    symbol,
    marketType,
    timeframe: tf,
    vwap_cache_hit: false,
    vwap_compute_ms: Date.now() - startedAt,
    candle_bucketed: result.candleBucketed,
    bucket_mismatch_count: result.bucketMismatchCount,
    session_start_utc: new Date(sessionStartUtcMs).toISOString(),
    vwap_null_reason: result.vwapNullReason
  });
  return result;
}

export function computeRollingVWAP(candles: Candle[], len: number): number | null {
  if (!candles.length || len <= 0) return null;
  const source = candles.slice(-len);
  let sumPV = 0;
  let sumV = 0;
  for (const row of source) {
    const volume = Number(row.volume);
    if (!Number.isFinite(volume) || volume <= 0) continue;
    const tp = (row.high + row.low + row.close) / 3;
    if (!Number.isFinite(tp)) continue;
    sumPV += tp * volume;
    sumV += volume;
  }
  if (sumV <= 0) return null;
  const value = sumPV / sumV;
  if (!Number.isFinite(value)) return null;
  return round(value, 6);
}

export function clearSessionVwapCache(): void {
  sessionVwapCache.clear();
}
