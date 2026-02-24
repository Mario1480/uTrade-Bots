import { logger } from "../../logger.js";
import { decryptSecret } from "../../secret-crypto.js";
import { fetchFmpCryptoNews, fetchFmpCryptoNewsSearch, fetchFmpGeneralNews } from "./providers/fmp.js";
import type {
  ListNewsParams,
  ListNewsResult,
  NewsFeed,
  NewsItemNormalized,
  NewsItemView,
  NewsMode
} from "./types.js";

type RedisClientLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSec: number): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

type AnyDb = any;

const NEWS_CACHE_TTL_SEC = Math.max(15, Number(process.env.NEWS_CACHE_TTL_SEC ?? "120"));
const ALL_MODE_MAX_PROVIDER_PAGES = Math.max(
  1,
  Number(process.env.ALL_MODE_MAX_PROVIDER_PAGES ?? "8")
);
const MEMORY_CACHE = new Map<string, { expiresAt: number; value: unknown }>();
let redisClient: RedisClientLike | null = null;
let redisInitDone = false;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseStoredFmpApiKeyEnc(value: unknown): string | null {
  const record = asRecord(value);
  const raw = record.fmpApiKeyEnc;
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
      // ignore, keep in-memory cache fallback
    });
    return redisClient;
  } catch {
    redisClient = null;
    return null;
  }
}

async function cacheGet<T>(key: string): Promise<T | null> {
  const now = Date.now();
  const inMem = MEMORY_CACHE.get(key);
  if (inMem && inMem.expiresAt > now) {
    return inMem.value as T;
  }

  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    MEMORY_CACHE.set(key, { value: parsed, expiresAt: now + NEWS_CACHE_TTL_SEC * 1000 });
    return parsed;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  const expiresAt = Date.now() + NEWS_CACHE_TTL_SEC * 1000;
  MEMORY_CACHE.set(key, { value, expiresAt });

  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", NEWS_CACHE_TTL_SEC);
  } catch {
    // ignore
  }
}

function normalizeSymbols(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const out = new Set<string>();
  for (const raw of values) {
    const symbol = String(raw ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!symbol) continue;
    out.add(symbol.slice(0, 32));
  }
  return [...out].slice(0, 30);
}

function normalizeQuery(value: string | null | undefined): string | null {
  const query = String(value ?? "").trim();
  if (!query) return null;
  return query.slice(0, 120);
}

function filterCryptoBySymbols(items: NewsItemNormalized[], symbols: string[]): NewsItemNormalized[] {
  if (symbols.length === 0) return items;
  return items.filter((item) => {
    if (item.feed !== "crypto") return true;
    const haystacks = [
      item.symbol ?? "",
      item.title ?? "",
      item.text ?? ""
    ].map((entry) => entry.toUpperCase());
    return symbols.some((symbol) => haystacks.some((value) => value.includes(symbol)));
  });
}

function filterCryptoByQuery(items: NewsItemNormalized[], query: string | null): NewsItemNormalized[] {
  if (!query) return items;
  const queryUpper = query.toUpperCase();
  return items.filter((item) => {
    if (item.feed !== "crypto") return true;
    const haystacks = [
      item.symbol ?? "",
      item.title ?? "",
      item.text ?? ""
    ].map((entry) => entry.toUpperCase());
    return haystacks.some((value) => value.includes(queryUpper));
  });
}

function filterGeneralByQuery(items: NewsItemNormalized[], query: string | null): NewsItemNormalized[] {
  if (!query) return items;
  const queryUpper = query.toUpperCase();
  return items.filter((item) => {
    if (item.feed !== "general") return true;
    const haystacks = [item.title ?? "", item.text ?? "", item.site ?? ""].map((entry) =>
      entry.toUpperCase()
    );
    return haystacks.some((value) => value.includes(queryUpper));
  });
}

function parseIsoTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function filterByPublishedAtRange(
  items: NewsItemNormalized[],
  fromTs: Date | null,
  toTs: Date | null
): NewsItemNormalized[] {
  if (!fromTs && !toTs) return items;
  const fromTime = fromTs?.getTime() ?? Number.NEGATIVE_INFINITY;
  const toTime = toTs?.getTime() ?? Number.POSITIVE_INFINITY;
  return items.filter((item) => {
    const ts = item.publishedAt.getTime();
    return ts >= fromTime && ts <= toTime;
  });
}

function dedupNews(items: NewsItemNormalized[]): NewsItemNormalized[] {
  const out = new Map<string, NewsItemNormalized>();
  for (const item of items) {
    const key = item.url || `${item.feed}|${item.title}|${item.publishedAt.toISOString()}`;
    if (!out.has(key)) {
      out.set(key, item);
      continue;
    }
    const existing = out.get(key)!;
    if (item.publishedAt.getTime() > existing.publishedAt.getTime()) {
      out.set(key, item);
    }
  }
  return [...out.values()].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

function toView(items: NewsItemNormalized[]): NewsItemView[] {
  return items.map((item) => ({
    id: item.id,
    source: item.source,
    feed: item.feed,
    title: item.title,
    url: item.url,
    site: item.site,
    publishedAt: item.publishedAt.toISOString(),
    imageUrl: item.imageUrl,
    symbol: item.symbol,
    text: item.text
  }));
}

function buildCacheKey(params: {
  mode: NewsMode;
  page: number;
  limit: number;
  q: string | null;
  symbols: string[];
  from?: string | null;
  to?: string | null;
  fromTs?: string | null;
  toTs?: string | null;
}): string {
  const symbolsKey = params.symbols.join(",");
  return [
    "news",
    "fmp",
    params.mode,
    String(params.page),
    String(params.limit),
    params.q ?? "",
    params.from ?? "",
    params.to ?? "",
    params.fromTs ?? "",
    params.toTs ?? "",
    symbolsKey
  ].join(":");
}

function splitFeedsByMode(mode: NewsMode): NewsFeed[] {
  if (mode === "crypto") return ["crypto"];
  if (mode === "general") return ["general"];
  return ["crypto", "general"];
}

function applyNewsFilters(params: {
  items: NewsItemNormalized[];
  query: string | null;
  symbols: string[];
  fromTs: Date | null;
  toTs: Date | null;
}): NewsItemNormalized[] {
  const queryFiltered = filterGeneralByQuery(filterCryptoByQuery(params.items, params.query), params.query);
  const symbolFiltered = filterCryptoBySymbols(queryFiltered, params.symbols);
  return filterByPublishedAtRange(symbolFiltered, params.fromTs, params.toTs);
}

async function fetchFeedBatch(params: {
  feed: NewsFeed;
  apiKey: string;
  page: number;
  limit: number;
  query: string | null;
  from?: string | null;
  to?: string | null;
  mode: NewsMode;
  markSearchFallback: () => void;
}): Promise<NewsItemNormalized[]> {
  if (params.feed === "crypto") {
    if (params.query) {
      try {
        const searched = await fetchFmpCryptoNewsSearch({
          apiKey: params.apiKey,
          page: params.page,
          limit: params.limit,
          query: params.query,
          from: params.from,
          to: params.to
        });
        if (searched.length > 0) {
          return searched;
        }
      } catch (error) {
        params.markSearchFallback();
        logger.warn("news_search_fallback_crypto_feed", {
          reason: String(error),
          mode: params.mode
        });
      }
    }
    return fetchFmpCryptoNews({
      apiKey: params.apiKey,
      page: params.page,
      limit: params.limit,
      from: params.from,
      to: params.to
    });
  }
  return fetchFmpGeneralNews({
    apiKey: params.apiKey,
    page: params.page,
    limit: params.limit,
    from: params.from,
    to: params.to
  });
}

export async function listNews(params: ListNewsParams): Promise<ListNewsResult> {
  const page = Math.max(1, Math.trunc(Number(params.page) || 1));
  const query = normalizeQuery(params.q);
  const queryApplies = Boolean(query);
  const symbols = normalizeSymbols(params.symbols);
  const fromTs = parseIsoTimestamp(params.fromTs);
  const toTs = parseIsoTimestamp(params.toTs);
  const key = buildCacheKey({
    mode: params.mode,
    page,
    limit: params.limit,
    q: query,
    symbols,
    from: params.from,
    to: params.to,
    fromTs: params.fromTs,
    toTs: params.toTs
  });
  const cached = await cacheGet<ListNewsResult>(key);
  if (cached) {
    return {
      ...cached,
      meta: {
        ...cached.meta,
        cache: "hit"
      }
    };
  }

  const apiKey = await resolveEffectiveFmpApiKey(params.db);
  if (!apiKey) {
    throw new Error("fmp_api_key_missing");
  }

  const feeds = splitFeedsByMode(params.mode);
  const allMode = params.mode === "all";
  const fetchLimit = params.limit;
  const targetCount = allMode ? page * params.limit : params.limit;
  let searchFallbackUsed = false;
  let partial = false;
  const collected: NewsItemNormalized[] = [];

  if (allMode) {
    for (let providerPage = 0; providerPage < ALL_MODE_MAX_PROVIDER_PAGES; providerPage += 1) {
      const settled = await Promise.allSettled(
        feeds.map((feed) =>
          fetchFeedBatch({
            feed,
            apiKey,
            page: providerPage,
            limit: fetchLimit,
            query,
            from: params.from,
            to: params.to,
            mode: params.mode,
            markSearchFallback: () => {
              searchFallbackUsed = true;
            }
          })
        )
      );

      let fulfilledCount = 0;
      let addedCount = 0;
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status === "fulfilled") {
          fulfilledCount += 1;
          collected.push(...result.value);
          addedCount += result.value.length;
          continue;
        }
        partial = true;
        logger.warn("news_fetch_partial_failure", {
          feed: feeds[index],
          reason: String(result.reason),
          providerPage
        });
      }

      const filteredCount = dedupNews(
        applyNewsFilters({
          items: collected,
          query,
          symbols,
          fromTs,
          toTs
        })
      ).length;

      if (filteredCount >= targetCount) {
        break;
      }
      if (fulfilledCount === 0 || addedCount === 0) {
        break;
      }
    }
  } else {
    const settled = await Promise.allSettled(
      feeds.map((feed) =>
        fetchFeedBatch({
          feed,
          apiKey,
          page: page - 1,
          limit: fetchLimit,
          query,
          from: params.from,
          to: params.to,
          mode: params.mode,
          markSearchFallback: () => {
            searchFallbackUsed = true;
          }
        })
      )
    );

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === "fulfilled") {
        collected.push(...result.value);
        continue;
      }
      partial = true;
      logger.warn("news_fetch_partial_failure", {
        feed: feeds[index],
        reason: String(result.reason)
      });
    }
  }

  if (collected.length === 0) {
    throw new Error("news_provider_unavailable");
  }

  const merged = dedupNews(
    applyNewsFilters({
      items: collected,
      query,
      symbols,
      fromTs,
      toTs
    })
  );
  const start = allMode ? (page - 1) * params.limit : 0;
  const sliced = merged.slice(start, start + params.limit);

  const payload: ListNewsResult = {
    items: toView(sliced),
    meta: {
      mode: params.mode,
      page,
      limit: params.limit,
      cache: "miss",
      fetchedAt: new Date().toISOString(),
      ...(query ? { searchQuery: query, searchApplied: queryApplies } : {}),
      ...(query && searchFallbackUsed ? { searchFallback: true } : {}),
      ...(partial ? { partial: true } : {})
    }
  };

  await cacheSet(key, payload);
  return payload;
}
