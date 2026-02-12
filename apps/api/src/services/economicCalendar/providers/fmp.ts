import crypto from "node:crypto";
import type { EconomicEventNormalized, EconomicImpact } from "../types.js";

const DEFAULT_FMP_BASE_URL = "https://financialmodelingprep.com";

type FmpRawEvent = Record<string, unknown>;

function normalizeImpact(value: unknown): EconomicImpact {
  if (typeof value === "number") {
    if (value >= 3) return "high";
    if (value >= 2) return "medium";
    return "low";
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "low";
  if (normalized.includes("high") || normalized === "3") return "high";
  if (normalized.includes("med") || normalized === "2") return "medium";
  return "low";
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/,/g, "")
    .replace(/[^\d.+-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(raw: FmpRawEvent): Date | null {
  const candidates = [
    raw.date,
    raw.datetime,
    raw.time,
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

function normalizeCountry(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 32) || "N/A";
}

function normalizeCurrency(raw: FmpRawEvent): string {
  const direct = String(raw.currency ?? "")
    .trim()
    .toUpperCase();
  if (direct) return direct.slice(0, 16);

  const country = normalizeCountry(raw.country);
  if (country === "US" || country === "USA") return "USD";
  if (country === "EU" || country === "EUR" || country === "EUROZONE") return "EUR";
  return "USD";
}

function normalizeTitle(raw: FmpRawEvent): string {
  const candidate = raw.event ?? raw.title ?? raw.name ?? raw.indicator;
  return String(candidate ?? "")
    .trim()
    .slice(0, 255);
}

function deriveSourceId(raw: FmpRawEvent, ts: Date, country: string, currency: string, title: string): string {
  const explicit = String(raw.id ?? raw.eventId ?? raw.uid ?? "").trim();
  if (explicit) return explicit.slice(0, 191);
  const payload = `${ts.toISOString()}|${country}|${currency}|${title}`;
  return crypto.createHash("sha1").update(payload).digest("hex");
}

export function normalizeFmpEventsPayload(payload: unknown): EconomicEventNormalized[] {
  if (!Array.isArray(payload)) return [];
  const out: EconomicEventNormalized[] = [];

  for (const item of payload) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as FmpRawEvent;
    const ts = parseTimestamp(raw);
    if (!ts) continue;

    const title = normalizeTitle(raw);
    if (!title) continue;

    const country = normalizeCountry(raw.country);
    const currency = normalizeCurrency(raw);
    const sourceId = deriveSourceId(raw, ts, country, currency, title);

    out.push({
      sourceId,
      ts,
      country,
      currency,
      title,
      impact: normalizeImpact(raw.impact ?? raw.importance),
      forecast: parseNumeric(raw.forecast ?? raw.consensus),
      previous: parseNumeric(raw.previous ?? raw.prev),
      actual: parseNumeric(raw.actual),
      source: "fmp"
    });
  }

  out.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return out;
}

function toUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function fetchFmpEconomicEvents(params: {
  apiKey: string;
  from: string;
  to: string;
  currencies?: string[];
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<EconomicEventNormalized[]> {
  const apiKey = String(params.apiKey ?? "").trim();
  if (!apiKey) {
    throw new Error("fmp_api_key_missing");
  }

  const baseUrl = String(params.baseUrl ?? process.env.FMP_BASE_URL ?? DEFAULT_FMP_BASE_URL)
    .trim()
    .replace(/\/+$/, "");

  const query: Record<string, string> = {
    from: params.from,
    to: params.to,
    apikey: apiKey
  };
  if (params.currencies && params.currencies.length > 0) {
    query.countries = params.currencies.join(",");
  }

  const candidates = [
    toUrl(baseUrl, "/stable/economic-calendar", query),
    toUrl(baseUrl, "/api/v3/economic_calendar", query)
  ];

  let lastError: string | null = null;
  for (const url of candidates) {
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
      const normalized = normalizeFmpEventsPayload(payload);
      if (normalized.length > 0) return normalized;
      if (Array.isArray(payload)) return [];
      lastError = "invalid_payload";
    } catch (error) {
      lastError = String(error);
    }
  }

  throw new Error(lastError ?? "fmp_fetch_failed");
}
