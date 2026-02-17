import crypto from "node:crypto";
import { logger } from "../../logger.js";
import { decryptSecret } from "../../secret-crypto.js";
import { evaluateNewsBlackout } from "./blackout.js";
import { fetchFmpEconomicEvents } from "./providers/fmp.js";
import { symbolToMacroCurrency } from "./symbolCurrency.js";
import type {
  EconomicBlackoutResult,
  EconomicCalendarConfigSnapshot,
  EconomicCalendarConfigUpdate,
  EconomicEventNormalized,
  EconomicEventView,
  EconomicImpact,
  EconomicNextSummary
} from "./types.js";

const DEFAULT_CONFIG_KEY = "default";
const DEFAULT_CURRENCIES = "USD,EUR";
const DEFAULT_IMPACT: EconomicImpact = "high";
const DEFAULT_PRE_MINUTES = 30;
const DEFAULT_POST_MINUTES = 30;
const DEFAULT_PROVIDER = "fmp";

const REDIS_EVENTS_TTL_SEC = Math.max(300, Number(process.env.ECON_REDIS_EVENTS_TTL_SEC ?? "21600"));
const REDIS_NEXT_TTL_SEC = Math.max(30, Number(process.env.ECON_REDIS_NEXT_TTL_SEC ?? "300"));
const REDIS_BLACKOUT_TTL_SEC = Math.max(30, Number(process.env.ECON_REDIS_BLACKOUT_TTL_SEC ?? "120"));
const ECON_NEWS_RISK_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.ECON_NEWS_RISK_ENABLED ?? "1").trim().toLowerCase()
);

const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();
type RedisClientLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSec: number): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

let redisClient: RedisClientLike | null = null;
let redisInitDone = false;

type AnyDb = any;

function hasCalendarModels(db: AnyDb): boolean {
  return Boolean(
    db &&
      db.economicCalendarConfig &&
      typeof db.economicCalendarConfig.upsert === "function" &&
      db.economicEvent &&
      typeof db.economicEvent.findMany === "function"
  );
}

function parseStoredFmpApiKeyEnc(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).fmpApiKeyEnc;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveEffectiveFmpApiKey(db: AnyDb): Promise<string | null> {
  const envApiKey = String(process.env.FMP_API_KEY ?? "").trim();
  if (envApiKey) return envApiKey;
  try {
    const row = await db.globalSetting?.findUnique?.({
      where: { key: "admin.apiKeys" },
      select: { value: true }
    });
    const keyEnc = parseStoredFmpApiKeyEnc(row?.value);
    if (!keyEnc) return null;
    const decrypted = decryptSecret(keyEnc).trim();
    return decrypted.length > 0 ? decrypted : null;
  } catch {
    return null;
  }
}

function impactWeight(value: EconomicImpact): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function normalizeImpact(value: unknown): EconomicImpact {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function normalizeCurrenciesCsv(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const tokens = String(value)
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 16);
  if (tokens.length === 0) return null;
  return tokens.join(",");
}

function parseDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDateFromDateKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toEventView(event: {
  id?: string;
  sourceId: string;
  ts: Date;
  country: string;
  currency: string;
  title: string;
  impact: string;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  source: string;
}): EconomicEventView {
  return {
    id: String(event.id ?? event.sourceId),
    sourceId: String(event.sourceId),
    ts: event.ts.toISOString(),
    country: String(event.country),
    currency: String(event.currency).toUpperCase(),
    title: String(event.title),
    impact: normalizeImpact(event.impact),
    forecast: Number.isFinite(Number(event.forecast)) ? Number(event.forecast) : null,
    previous: Number.isFinite(Number(event.previous)) ? Number(event.previous) : null,
    actual: Number.isFinite(Number(event.actual)) ? Number(event.actual) : null,
    source: String(event.source || "fmp") as "fmp"
  };
}

function normalizeConfigRow(row: any): EconomicCalendarConfigSnapshot {
  return {
    key: String(row?.key ?? DEFAULT_CONFIG_KEY),
    enabled: typeof row?.enabled === "boolean" ? row.enabled : true,
    impactMin: normalizeImpact(row?.impactMin ?? DEFAULT_IMPACT),
    currencies: normalizeCurrenciesCsv(row?.currencies ?? DEFAULT_CURRENCIES),
    preMinutes: Math.max(0, Math.trunc(Number(row?.preMinutes ?? DEFAULT_PRE_MINUTES))),
    postMinutes: Math.max(0, Math.trunc(Number(row?.postMinutes ?? DEFAULT_POST_MINUTES))),
    provider: DEFAULT_PROVIDER,
    createdAt: row?.createdAt instanceof Date ? row.createdAt : new Date(),
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt : new Date()
  };
}

function parseCurrencies(config: EconomicCalendarConfigSnapshot): string[] {
  const csv = normalizeCurrenciesCsv(config.currencies ?? DEFAULT_CURRENCIES) ?? DEFAULT_CURRENCIES;
  return csv
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function dayEventCacheKey(dateKey: string): string {
  return `econ:events:${dateKey}`;
}

function nextCacheKey(currency: string, impact: EconomicImpact): string {
  return `econ:next:${currency.toUpperCase()}:${impact}`;
}

function blackoutCacheKey(currency: string): string {
  return `econ:blackout:${currency.toUpperCase()}`;
}

async function getRedisClient(): Promise<RedisClientLike | null> {
  if (redisInitDone) return redisClient;
  redisInitDone = true;
  const redisUrl = String(process.env.REDIS_URL ?? "").trim();
  if (!redisUrl) return null;
  try {
    const mod = await import("ioredis");
    const RedisCtor = (mod.default ?? mod) as unknown as new (url: string) => RedisClientLike;
    redisClient = new RedisCtor(redisUrl);
    redisClient.on("error", () => {
      // ignore, fallback to db/memory cache
    });
    return redisClient;
  } catch {
    redisClient = null;
    return null;
  }
}

async function redisGetJson<T>(key: string): Promise<T | null> {
  const now = Date.now();
  const inMem = memoryCache.get(key);
  if (inMem && inMem.expiresAt > now) return inMem.value as T;

  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    memoryCache.set(key, { value: parsed, expiresAt: now + 60_000 });
    return parsed;
  } catch {
    return null;
  }
}

async function redisSetJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  const expiresAt = Date.now() + ttlSec * 1000;
  memoryCache.set(key, { value, expiresAt });
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  } catch {
    // ignore
  }
}

export async function getEconomicCalendarConfig(db: AnyDb): Promise<EconomicCalendarConfigSnapshot> {
  if (!hasCalendarModels(db)) {
    const now = new Date();
    return {
      key: DEFAULT_CONFIG_KEY,
      enabled: true,
      impactMin: DEFAULT_IMPACT,
      currencies: DEFAULT_CURRENCIES,
      preMinutes: DEFAULT_PRE_MINUTES,
      postMinutes: DEFAULT_POST_MINUTES,
      provider: DEFAULT_PROVIDER,
      createdAt: now,
      updatedAt: now
    };
  }
  const row = await db.economicCalendarConfig.upsert({
    where: { key: DEFAULT_CONFIG_KEY },
    update: {},
    create: {
      key: DEFAULT_CONFIG_KEY,
      enabled: true,
      impactMin: DEFAULT_IMPACT,
      currencies: DEFAULT_CURRENCIES,
      preMinutes: DEFAULT_PRE_MINUTES,
      postMinutes: DEFAULT_POST_MINUTES,
      provider: DEFAULT_PROVIDER
    }
  });
  return normalizeConfigRow(row);
}

export async function updateEconomicCalendarConfig(
  db: AnyDb,
  patch: EconomicCalendarConfigUpdate
): Promise<EconomicCalendarConfigSnapshot> {
  if (!hasCalendarModels(db)) {
    throw new Error("economic_calendar_schema_not_ready");
  }
  const current = await getEconomicCalendarConfig(db);
  const next = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    impactMin: normalizeImpact(patch.impactMin ?? current.impactMin),
    currencies: normalizeCurrenciesCsv(patch.currencies ?? current.currencies),
    preMinutes:
      patch.preMinutes !== undefined && patch.preMinutes !== null
        ? Math.max(0, Math.trunc(Number(patch.preMinutes)))
        : current.preMinutes,
    postMinutes:
      patch.postMinutes !== undefined && patch.postMinutes !== null
        ? Math.max(0, Math.trunc(Number(patch.postMinutes)))
        : current.postMinutes,
    provider: DEFAULT_PROVIDER
  };
  const row = await db.economicCalendarConfig.update({
    where: { key: DEFAULT_CONFIG_KEY },
    data: next
  });
  return normalizeConfigRow(row);
}

async function listEventsFromDb(params: {
  db: AnyDb;
  from: Date;
  to: Date;
  currency?: string;
  impactMin?: EconomicImpact;
  impacts?: EconomicImpact[];
}): Promise<EconomicEventView[]> {
  if (!hasCalendarModels(params.db)) return [];
  const where: Record<string, unknown> = {
    ts: {
      gte: params.from,
      lte: params.to
    }
  };
  if (params.currency) {
    where.currency = params.currency.toUpperCase();
  }

  const rows = await params.db.economicEvent.findMany({
    where,
    orderBy: [{ ts: "asc" }]
  });
  const minWeight = impactWeight(normalizeImpact(params.impactMin ?? "low"));
  const impactAllowlist = params.impacts && params.impacts.length > 0
    ? new Set(params.impacts.map((entry) => normalizeImpact(entry)))
    : null;
  return rows
    .map((row: any) => toEventView({
      ...row,
      sourceId: row.sourceId,
      ts: row.ts
    }))
    .filter((event: EconomicEventView) => impactWeight(event.impact) >= minWeight)
    .filter((event: EconomicEventView) => !impactAllowlist || impactAllowlist.has(event.impact));
}

function dateRangeFromInput(params: {
  from?: string | null;
  to?: string | null;
  defaultDays: number;
}): { from: Date; to: Date } {
  const now = new Date();
  const parsedFrom = parseDateInput(params.from ?? null);
  const parsedTo = parseDateInput(params.to ?? null);

  const from = parsedFrom ?? toDateFromDateKey(parseDateKey(now));
  const toBase = parsedTo ?? plusDays(from, params.defaultDays);
  const to = new Date(`${parseDateKey(toBase)}T23:59:59.999Z`);
  return { from, to };
}

export async function listEconomicEvents(params: {
  db: AnyDb;
  from?: string | null;
  to?: string | null;
  currency?: string | null;
  impactMin?: EconomicImpact | null;
  impacts?: EconomicImpact[] | null;
}): Promise<EconomicEventView[]> {
  const range = dateRangeFromInput({
    from: params.from ?? null,
    to: params.to ?? null,
    defaultDays: 3
  });

  const currency = params.currency ? params.currency.trim().toUpperCase() : undefined;
  const impact = params.impactMin ? normalizeImpact(params.impactMin) : "low";
  const impacts = (params.impacts ?? [])
    .map((entry) => normalizeImpact(entry))
    .filter((entry, index, list) => list.indexOf(entry) === index);
  return listEventsFromDb({
    db: params.db,
    from: range.from,
    to: range.to,
    currency,
    impactMin: impact,
    impacts
  });
}

function resultHash(result: EconomicBlackoutResult): string {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        n: result.newsRisk,
        c: result.currency,
        a: result.activeWindow?.from,
        b: result.activeWindow?.to,
        e: result.activeWindow?.event?.sourceId,
        nx: result.nextEvent?.sourceId
      })
    )
    .digest("hex");
}

export function applyNewsRiskToFeatureSnapshot(
  featureSnapshot: Record<string, unknown>,
  blackout: EconomicBlackoutResult
): Record<string, unknown> {
  const snapshot = { ...featureSnapshot };
  const tags = Array.isArray(snapshot.tags)
    ? snapshot.tags.map((entry) => String(entry).trim()).filter(Boolean)
    : [];

  const filtered = tags.filter((tag) => tag !== "news_risk");
  if (blackout.newsRisk) {
    filtered.unshift("news_risk");
  }

  snapshot.newsRisk = blackout.newsRisk;
  snapshot.newsBlackout = {
    active: blackout.newsRisk,
    currency: blackout.currency,
    from: blackout.activeWindow?.from ?? null,
    to: blackout.activeWindow?.to ?? null,
    eventTitle: blackout.activeWindow?.event?.title ?? null,
    eventTs: blackout.activeWindow?.event?.ts ?? blackout.nextEvent?.ts ?? null,
    nextEventTitle: blackout.nextEvent?.title ?? null,
    nextEventTs: blackout.nextEvent?.ts ?? null
  };
  snapshot.tags = filtered.slice(0, 5);
  return snapshot;
}

export async function getEconomicCalendarNextSummary(params: {
  db: AnyDb;
  currency: string;
  impact?: EconomicImpact;
  now?: Date;
}): Promise<EconomicNextSummary> {
  const now = params.now ?? new Date();
  const config = await getEconomicCalendarConfig(params.db);
  const currency = params.currency.trim().toUpperCase() || "USD";
  const impactMin = normalizeImpact(params.impact ?? config.impactMin);

  if (!ECON_NEWS_RISK_ENABLED || !config.enabled) {
    return {
      currency,
      impactMin,
      blackoutActive: false,
      activeWindow: null,
      nextEvent: null,
      asOf: now.toISOString()
    };
  }

  const apiKey = await resolveEffectiveFmpApiKey(params.db);
  if (!apiKey) {
    return {
      currency,
      impactMin,
      blackoutActive: false,
      activeWindow: null,
      nextEvent: null,
      asOf: now.toISOString()
    };
  }

  const cacheKey = nextCacheKey(currency, impactMin);
  const cached = await redisGetJson<EconomicNextSummary>(cacheKey);
  if (cached) return cached;

  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  if (!hasCalendarModels(params.db)) {
    const fallbackSummary: EconomicNextSummary = {
      currency,
      impactMin,
      blackoutActive: false,
      activeWindow: null,
      nextEvent: null,
      asOf: now.toISOString()
    };
    await redisSetJson(cacheKey, fallbackSummary, REDIS_NEXT_TTL_SEC);
    return fallbackSummary;
  }

  const rows = await params.db.economicEvent.findMany({
    where: {
      currency,
      ts: {
        gte: from,
        lte: to
      }
    },
    orderBy: [{ ts: "asc" }]
  });
  const normalized: EconomicEventNormalized[] = rows.map((row: any) => ({
    sourceId: String(row.sourceId),
    ts: row.ts instanceof Date ? row.ts : new Date(row.ts),
    country: String(row.country ?? ""),
    currency: String(row.currency ?? currency).toUpperCase(),
    title: String(row.title ?? ""),
    impact: normalizeImpact(row.impact),
    forecast: Number.isFinite(Number(row.forecast)) ? Number(row.forecast) : null,
    previous: Number.isFinite(Number(row.previous)) ? Number(row.previous) : null,
    actual: Number.isFinite(Number(row.actual)) ? Number(row.actual) : null,
    source: "fmp"
  }));

  const blackout = evaluateNewsBlackout({
    now,
    currency,
    events: normalized,
    config: {
      enabled: config.enabled,
      impactMin,
      preMinutes: config.preMinutes,
      postMinutes: config.postMinutes,
      currencies: config.currencies
    }
  });

  const summary: EconomicNextSummary = {
    currency,
    impactMin,
    blackoutActive: blackout.newsRisk,
    activeWindow: blackout.activeWindow,
    nextEvent: blackout.nextEvent,
    asOf: now.toISOString()
  };

  await redisSetJson(cacheKey, summary, REDIS_NEXT_TTL_SEC);
  await redisSetJson(blackoutCacheKey(currency), {
    ...blackout,
    asOf: now.toISOString(),
    hash: resultHash(blackout)
  }, REDIS_BLACKOUT_TTL_SEC);
  return summary;
}

export async function evaluateNewsRiskForSymbol(params: {
  db: AnyDb;
  symbol: string;
  now?: Date;
}): Promise<EconomicBlackoutResult> {
  const now = params.now ?? new Date();
  const currency = symbolToMacroCurrency(params.symbol);
  if (!ECON_NEWS_RISK_ENABLED) {
    return {
      newsRisk: false,
      currency,
      nextEvent: null,
      activeWindow: null
    };
  }
  const apiKey = await resolveEffectiveFmpApiKey(params.db);
  if (!apiKey) {
    return {
      newsRisk: false,
      currency,
      nextEvent: null,
      activeWindow: null
    };
  }
  try {
    const summary = await getEconomicCalendarNextSummary({
      db: params.db,
      currency,
      now
    });
    return {
      newsRisk: summary.blackoutActive,
      currency: summary.currency,
      nextEvent: summary.nextEvent,
      activeWindow: summary.activeWindow
    };
  } catch (error) {
    logger.warn("economic_calendar_news_risk_fallback", {
      symbol: params.symbol,
      currency,
      reason: String(error)
    });
    return {
      newsRisk: false,
      currency,
      nextEvent: null,
      activeWindow: null
    };
  }
}

export async function refreshEconomicCalendarData(params: {
  db: AnyDb;
  now?: Date;
}): Promise<{
  fetchedCount: number;
  upsertedCount: number;
  windowFrom: string;
  windowTo: string;
  currencies: string[];
}> {
  const now = params.now ?? new Date();
  if (!hasCalendarModels(params.db)) {
    logger.warn("economic_calendar_schema_not_ready", {
      reason: "prisma_client_missing_models_or_migration_not_applied"
    });
    return {
      fetchedCount: 0,
      upsertedCount: 0,
      windowFrom: parseDateKey(now),
      windowTo: parseDateKey(plusDays(now, 3)),
      currencies: DEFAULT_CURRENCIES.split(",")
    };
  }
  const config = await getEconomicCalendarConfig(params.db);
  const currencies = parseCurrencies(config);
  const windowFromDate = toDateFromDateKey(parseDateKey(now));
  const windowToDate = plusDays(windowFromDate, 3);
  const windowFrom = parseDateKey(windowFromDate);
  const windowTo = parseDateKey(windowToDate);

  if (!ECON_NEWS_RISK_ENABLED || !config.enabled) {
    return {
      fetchedCount: 0,
      upsertedCount: 0,
      windowFrom,
      windowTo,
      currencies
    };
  }

  const apiKey = await resolveEffectiveFmpApiKey(params.db);
  if (!apiKey) {
    logger.info("economic_calendar_refresh_skipped_no_api_key", {
      window_from: windowFrom,
      window_to: windowTo
    });
    return {
      fetchedCount: 0,
      upsertedCount: 0,
      windowFrom,
      windowTo,
      currencies
    };
  }

  let fetched: EconomicEventNormalized[] = [];
  try {
    fetched = await fetchFmpEconomicEvents({
      apiKey,
      baseUrl: process.env.FMP_BASE_URL,
      from: windowFrom,
      to: windowTo,
      currencies
    });
  } catch (error) {
    const reason = String(error ?? "");
    if (reason.includes("http_402") || reason.includes("http_403")) {
      logger.warn("economic_calendar_refresh_disabled_provider_access", {
        reason,
        window_from: windowFrom,
        window_to: windowTo
      });
      return {
        fetchedCount: 0,
        upsertedCount: 0,
        windowFrom,
        windowTo,
        currencies
      };
    }
    throw error;
  }

  let upsertedCount = 0;
  for (const event of fetched) {
    await params.db.economicEvent.upsert({
      where: {
        source_sourceId: {
          source: event.source,
          sourceId: event.sourceId
        }
      },
      create: {
        sourceId: event.sourceId,
        ts: event.ts,
        country: event.country,
        currency: event.currency,
        title: event.title,
        impact: event.impact,
        forecast: event.forecast,
        previous: event.previous,
        actual: event.actual,
        source: event.source
      },
      update: {
        ts: event.ts,
        country: event.country,
        currency: event.currency,
        title: event.title,
        impact: event.impact,
        forecast: event.forecast,
        previous: event.previous,
        actual: event.actual
      }
    });
    upsertedCount += 1;
  }

  const groupedByDay = new Map<string, EconomicEventView[]>();
  for (const event of fetched) {
    const key = parseDateKey(event.ts);
    const current = groupedByDay.get(key) ?? [];
    current.push(toEventView({
      sourceId: event.sourceId,
      ts: event.ts,
      country: event.country,
      currency: event.currency,
      title: event.title,
      impact: event.impact,
      forecast: event.forecast,
      previous: event.previous,
      actual: event.actual,
      source: event.source
    }));
    groupedByDay.set(key, current);
  }

  for (const [dateKey, events] of groupedByDay.entries()) {
    await redisSetJson(dayEventCacheKey(dateKey), events, REDIS_EVENTS_TTL_SEC);
  }

  for (const currency of currencies) {
    const summary = await getEconomicCalendarNextSummary({
      db: params.db,
      currency,
      impact: config.impactMin,
      now
    });
    await redisSetJson(nextCacheKey(currency, config.impactMin), summary, REDIS_NEXT_TTL_SEC);
  }

  await redisSetJson("econ:last_refresh_ts", { ts: now.toISOString() }, REDIS_EVENTS_TTL_SEC);

  logger.info("economic_calendar_refresh_done", {
    fetched_count: fetched.length,
    upserted_count: upsertedCount,
    currencies: currencies.join(","),
    from: windowFrom,
    to: windowTo
  });

  return {
    fetchedCount: fetched.length,
    upsertedCount,
    windowFrom,
    windowTo,
    currencies
  };
}
