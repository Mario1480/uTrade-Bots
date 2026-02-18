import crypto from "node:crypto";
import type { NewsFeed, NewsItemNormalized } from "../types.js";

const DEFAULT_FMP_BASE_URL = "https://financialmodelingprep.com";

type FmpNewsRaw = Record<string, unknown>;

function asTrimmedString(value: unknown, maxLen = 2000): string {
  return String(value ?? "")
    .trim()
    .slice(0, maxLen);
}

function parsePublishedAt(raw: FmpNewsRaw): Date | null {
  const candidates = [
    raw.publishedDate,
    raw.publishedAt,
    raw.date,
    raw.datetime,
    raw.createdAt,
    raw.timestamp
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) return candidate;

    if (typeof candidate === "number") {
      const ts = candidate > 1e12 ? candidate : candidate * 1000;
      const parsed = new Date(ts);
      if (Number.isFinite(parsed.getTime())) return parsed;
      continue;
    }

    const text = String(candidate).trim();
    if (!text) continue;
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      const ts = numeric > 1e12 ? numeric : numeric * 1000;
      const parsed = new Date(ts);
      if (Number.isFinite(parsed.getTime())) return parsed;
      continue;
    }

    const isoCandidate =
      /[zZ]|[+-]\d{2}:\d{2}$/.test(text) || text.includes("T")
        ? text
        : `${text.replace(" ", "T")}Z`;
    const parsed = new Date(isoCandidate);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }

  return null;
}

function parsePayloadRows(payload: unknown): FmpNewsRaw[] {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is FmpNewsRaw => Boolean(entry && typeof entry === "object"));
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const containerCandidates = [record.content, record.items, record.data, record.results, record.articles];
  for (const candidate of containerCandidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (entry): entry is FmpNewsRaw => Boolean(entry && typeof entry === "object")
      );
    }
  }
  return [];
}

function normalizeNewsItem(raw: FmpNewsRaw, feed: NewsFeed): NewsItemNormalized | null {
  const url = asTrimmedString(raw.url ?? raw.link, 1024);
  const title = asTrimmedString(raw.title ?? raw.headline ?? raw.name, 300);
  const publishedAt = parsePublishedAt(raw);
  if (!url || !title || !publishedAt) return null;

  const siteCandidate = asTrimmedString(raw.site ?? raw.source ?? raw.publisher, 120);
  const symbolCandidate = asTrimmedString(raw.symbol ?? raw.ticker, 32).toUpperCase();
  const imageCandidate = asTrimmedString(
    raw.image ?? raw.imageUrl ?? raw.image_url ?? raw.thumbnail ?? raw.photo,
    1024
  );
  const textCandidate = asTrimmedString(
    raw.text ?? raw.body ?? raw.content ?? raw.description ?? raw.summary,
    1200
  );

  const explicitId = asTrimmedString(raw.id ?? raw.newsId ?? raw.uuid ?? raw.slug, 191);
  const id = explicitId
    ? explicitId
    : crypto
      .createHash("sha1")
      .update(`${feed}|${url}|${publishedAt.toISOString()}`)
      .digest("hex");

  return {
    id,
    source: "fmp",
    feed,
    title,
    url,
    site: siteCandidate || null,
    publishedAt,
    imageUrl: imageCandidate || null,
    symbol: symbolCandidate || null,
    text: textCandidate || null
  };
}

function toUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchFirstSuccessfulArray(params: {
  candidates: string[];
  allowEmpty?: boolean;
  signal?: AbortSignal;
}): Promise<FmpNewsRaw[]> {
  let lastError: string | null = null;

  for (const url of params.candidates) {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: params.signal
      });
      if (!response.ok) {
        lastError = `http_${response.status}`;
        continue;
      }
      const payload = await response.json();
      const rows = parsePayloadRows(payload);
      if (rows.length === 0 && !params.allowEmpty) {
        lastError = "invalid_payload";
        continue;
      }
      return rows;
    } catch (error) {
      lastError = String(error);
    }
  }

  throw new Error(lastError ?? "fmp_news_fetch_failed");
}

function normalizeBatch(rows: FmpNewsRaw[], feed: NewsFeed): NewsItemNormalized[] {
  const out: NewsItemNormalized[] = [];
  for (const row of rows) {
    const normalized = normalizeNewsItem(row, feed);
    if (normalized) out.push(normalized);
  }
  out.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return out;
}

function buildCommonQuery(params: {
  apiKey: string;
  page: number;
  limit: number;
  from?: string | null;
  to?: string | null;
}): Record<string, string> {
  const query: Record<string, string> = {
    apikey: params.apiKey,
    page: String(Math.max(0, params.page)),
    limit: String(Math.max(1, params.limit))
  };
  if (params.from) query.from = params.from;
  if (params.to) query.to = params.to;
  return query;
}

export async function fetchFmpCryptoNews(params: {
  apiKey: string;
  page: number;
  limit: number;
  from?: string | null;
  to?: string | null;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<NewsItemNormalized[]> {
  const apiKey = asTrimmedString(params.apiKey, 500);
  if (!apiKey) throw new Error("fmp_api_key_missing");

  const baseUrl = asTrimmedString(
    params.baseUrl ?? process.env.FMP_BASE_URL ?? DEFAULT_FMP_BASE_URL,
    300
  ).replace(/\/+$/, "");
  const query = buildCommonQuery(params);

  const candidates = [
    toUrl(baseUrl, "/stable/crypto-news", query),
    toUrl(baseUrl, "/stable/news/crypto", query),
    toUrl(baseUrl, "/api/v4/crypto_news", query)
  ];

  const rows = await fetchFirstSuccessfulArray({
    candidates,
    signal: params.signal
  });
  return normalizeBatch(rows, "crypto");
}

export async function fetchFmpCryptoNewsSearch(params: {
  apiKey: string;
  page: number;
  limit: number;
  query: string;
  from?: string | null;
  to?: string | null;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<NewsItemNormalized[]> {
  const apiKey = asTrimmedString(params.apiKey, 500);
  if (!apiKey) throw new Error("fmp_api_key_missing");

  const searchQuery = asTrimmedString(params.query, 120);
  if (!searchQuery) {
    return fetchFmpCryptoNews(params);
  }

  const baseUrl = asTrimmedString(
    params.baseUrl ?? process.env.FMP_BASE_URL ?? DEFAULT_FMP_BASE_URL,
    300
  ).replace(/\/+$/, "");
  const commonQuery = buildCommonQuery(params);
  const searchQueryParams = {
    ...commonQuery,
    query: searchQuery,
    symbols: searchQuery
  };
  const symbolsQuery = {
    ...commonQuery,
    symbols: searchQuery
  };

  const candidates = [
    toUrl(baseUrl, "/stable/search-crypto-news", searchQueryParams),
    toUrl(baseUrl, "/stable/news/crypto", symbolsQuery),
    toUrl(baseUrl, "/api/v4/crypto_news", symbolsQuery)
  ];

  const rows = await fetchFirstSuccessfulArray({
    candidates,
    allowEmpty: true,
    signal: params.signal
  });
  return normalizeBatch(rows, "crypto");
}

export async function fetchFmpGeneralNews(params: {
  apiKey: string;
  page: number;
  limit: number;
  from?: string | null;
  to?: string | null;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<NewsItemNormalized[]> {
  const apiKey = asTrimmedString(params.apiKey, 500);
  if (!apiKey) throw new Error("fmp_api_key_missing");

  const baseUrl = asTrimmedString(
    params.baseUrl ?? process.env.FMP_BASE_URL ?? DEFAULT_FMP_BASE_URL,
    300
  ).replace(/\/+$/, "");
  const query = buildCommonQuery(params);

  const candidates = [
    toUrl(baseUrl, "/stable/general-news", query),
    toUrl(baseUrl, "/stable/news/general-latest", query),
    toUrl(baseUrl, "/api/v3/fmp/articles", query)
  ];

  const rows = await fetchFirstSuccessfulArray({
    candidates,
    signal: params.signal
  });
  return normalizeBatch(rows, "general");
}
