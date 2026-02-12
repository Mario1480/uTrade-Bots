import crypto from "node:crypto";
import {
  DEFAULT_INDICATOR_SETTINGS,
  mergeIndicatorSettings,
  normalizeIndicatorSettingsPatch,
  type IndicatorScopeType,
  type IndicatorSettingsConfig
} from "../dto/indicatorSettings.dto.js";

type AnyDb = any;

type IndicatorSettingRow = {
  id: string;
  scopeType: IndicatorScopeType;
  exchange: string | null;
  accountId: string | null;
  symbol: string | null;
  timeframe: string | null;
  configJson: unknown;
  updatedAt: Date;
  createdAt: Date;
};

export type IndicatorSettingsResolution = {
  config: IndicatorSettingsConfig;
  hash: string;
  breakdown: Array<{
    id: string;
    scopeType: IndicatorScopeType;
    exchange: string | null;
    accountId: string | null;
    symbol: string | null;
    timeframe: string | null;
    updatedAt: string;
  }>;
};

type ResolveParams = {
  db: AnyDb;
  exchange?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  cacheTtlMs?: number;
  skipCache?: boolean;
};

const cache = new Map<string, { expiresAt: number; value: IndicatorSettingsResolution }>();
const DEFAULT_TTL_MS = Math.max(60, Number(process.env.INDICATOR_SETTINGS_CACHE_TTL_SEC ?? "120")) * 1000;

function normExchange(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normAccount(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normSymbol(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normTimeframe(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function cacheKey(params: Omit<ResolveParams, "db" | "cacheTtlMs" | "skipCache">): string {
  return [
    "indset",
    normExchange(params.exchange) ?? "*",
    normAccount(params.accountId) ?? "*",
    normSymbol(params.symbol) ?? "*",
    normTimeframe(params.timeframe) ?? "*"
  ].join(":");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashConfig(config: IndicatorSettingsConfig): string {
  return crypto.createHash("sha256").update(stableStringify(config)).digest("hex").slice(0, 24);
}

function matches(row: IndicatorSettingRow, target: {
  exchange: string | null;
  accountId: string | null;
  symbol: string | null;
  timeframe: string | null;
}): boolean {
  const rowExchange = normExchange(row.exchange);
  const rowAccount = normAccount(row.accountId);
  const rowSymbol = normSymbol(row.symbol);
  const rowTimeframe = normTimeframe(row.timeframe);

  if (rowExchange && rowExchange !== target.exchange) return false;
  if (rowAccount && rowAccount !== target.accountId) return false;
  if (rowSymbol && rowSymbol !== target.symbol) return false;
  if (rowTimeframe && rowTimeframe !== target.timeframe) return false;
  return true;
}

function specificityScore(row: IndicatorSettingRow): number {
  let score = 0;
  if (row.exchange && row.exchange.trim()) score += 1;
  if (row.accountId && row.accountId.trim()) score += 1;
  if (row.symbol && row.symbol.trim()) score += 1;
  if (row.timeframe && row.timeframe.trim()) score += 1;
  return score;
}

function pickBest(rows: IndicatorSettingRow[]): IndicatorSettingRow | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const bySpecificity = specificityScore(b) - specificityScore(a);
    if (bySpecificity !== 0) return bySpecificity;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  return sorted[0] ?? null;
}

export function clearIndicatorSettingsCache(): void {
  cache.clear();
}

export async function resolveIndicatorSettings(params: ResolveParams): Promise<IndicatorSettingsResolution> {
  const normalized = {
    exchange: normExchange(params.exchange),
    accountId: normAccount(params.accountId),
    symbol: normSymbol(params.symbol),
    timeframe: normTimeframe(params.timeframe)
  };

  const key = cacheKey(normalized);
  const now = Date.now();
  const ttlMs = Math.max(30_000, Math.trunc(params.cacheTtlMs ?? DEFAULT_TTL_MS));

  if (!params.skipCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }
  }

  if (!params.db?.indicatorSetting || typeof params.db.indicatorSetting.findMany !== "function") {
    const fallback: IndicatorSettingsResolution = {
      config: DEFAULT_INDICATOR_SETTINGS,
      hash: hashConfig(DEFAULT_INDICATOR_SETTINGS),
      breakdown: []
    };
    cache.set(key, { value: fallback, expiresAt: now + ttlMs });
    return fallback;
  }

  const rows = (await params.db.indicatorSetting.findMany({
    orderBy: { updatedAt: "desc" }
  })) as IndicatorSettingRow[];

  const matching = rows.filter((row) => matches(row, normalized));

  const globalRow = pickBest(matching.filter((row) => row.scopeType === "global"));
  const accountRow = pickBest(matching.filter((row) => row.scopeType === "account"));
  const symbolRow = pickBest(matching.filter((row) => row.scopeType === "symbol"));
  const symbolTfRow = pickBest(matching.filter((row) => row.scopeType === "symbol_tf"));

  let merged = DEFAULT_INDICATOR_SETTINGS;
  const chosen = [globalRow, accountRow, symbolRow, symbolTfRow].filter(
    (row): row is IndicatorSettingRow => Boolean(row)
  );

  for (const row of chosen) {
    merged = mergeIndicatorSettings(merged, normalizeIndicatorSettingsPatch(row.configJson));
  }

  const resolution: IndicatorSettingsResolution = {
    config: merged,
    hash: hashConfig(merged),
    breakdown: chosen.map((row) => ({
      id: row.id,
      scopeType: row.scopeType,
      exchange: row.exchange,
      accountId: row.accountId,
      symbol: row.symbol,
      timeframe: row.timeframe,
      updatedAt: row.updatedAt.toISOString()
    }))
  };

  cache.set(key, { value: resolution, expiresAt: now + ttlMs });
  return resolution;
}
