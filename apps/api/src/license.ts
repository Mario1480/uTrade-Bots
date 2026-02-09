import { z } from "zod";

export type Entitlements = {
  maxRunningBots: number;
  maxBotsTotal: number;
  allowedExchanges: string[];
};

export type LicenseDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "enforcement_off"
    | "max_bots_total_exceeded"
    | "max_running_bots_exceeded"
    | "exchange_not_allowed"
    | "license_server_unreachable";
};

const entitlementsSchema = z.object({
  maxRunningBots: z.number().int().nonnegative(),
  maxBotsTotal: z.number().int().nonnegative(),
  allowedExchanges: z.array(z.string().trim().min(1))
});

const cache = new Map<string, { expiresAt: number; entitlements: Entitlements }>();

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function includesExchange(list: string[], exchange: string): boolean {
  const normalized = normalize(exchange);
  return list.some((entry) => normalize(entry) === "*" || normalize(entry) === normalized);
}

export function isLicenseEnforcementEnabled(raw: string | null | undefined = process.env.LICENSE_ENFORCEMENT): boolean {
  const normalized = normalize(raw);
  return normalized === "" || normalized === "on" || normalized === "true" || normalized === "1";
}

export function isLicenseStubEnabled(raw: string | null | undefined = process.env.LICENSE_STUB_ENABLED): boolean {
  const normalized = normalize(raw);
  if (normalized === "") return process.env.NODE_ENV !== "production";
  return normalized === "on" || normalized === "true" || normalized === "1";
}

export function getLicenseCacheTtlSeconds(): number {
  const ttl = Number(process.env.LICENSE_CACHE_TTL_SECONDS ?? "600");
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 600;
}

function getLicenseServerBaseUrl(): string {
  const configured = process.env.LICENSE_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const apiPort = Number(process.env.API_PORT ?? "4000");
  return `http://127.0.0.1:${apiPort}/license-server-stub`;
}

export function getStubEntitlements(): Entitlements {
  const maxRunningBots = Number(process.env.LICENSE_STUB_MAX_RUNNING_BOTS ?? "3");
  const maxBotsTotal = Number(process.env.LICENSE_STUB_MAX_BOTS_TOTAL ?? "10");
  const allowedExchanges = (process.env.LICENSE_STUB_ALLOWED_EXCHANGES ?? "mexc,binance")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    maxRunningBots: Number.isFinite(maxRunningBots) ? Math.max(0, Math.floor(maxRunningBots)) : 3,
    maxBotsTotal: Number.isFinite(maxBotsTotal) ? Math.max(0, Math.floor(maxBotsTotal)) : 10,
    allowedExchanges: allowedExchanges.length > 0 ? allowedExchanges : ["*"]
  };
}

export async function fetchEntitlements(userId: string): Promise<Entitlements> {
  const cacheHit = cache.get(userId);
  const now = Date.now();
  if (cacheHit && cacheHit.expiresAt > now) {
    return cacheHit.entitlements;
  }

  const base = getLicenseServerBaseUrl();
  const url = `${base}/entitlements?userId=${encodeURIComponent(userId)}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    throw new Error("license_server_unreachable");
  }
  if (!response.ok) {
    throw new Error("license_server_unreachable");
  }

  const parsed = entitlementsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("license_server_unreachable");
  }

  const ttlMs = getLicenseCacheTtlSeconds() * 1000;
  cache.set(userId, {
    entitlements: parsed.data,
    expiresAt: now + ttlMs
  });
  return parsed.data;
}

export async function enforceBotStartLicense(params: {
  userId: string;
  exchange: string;
  totalBots: number;
  runningBots: number;
  isAlreadyRunning: boolean;
}): Promise<LicenseDecision> {
  if (!isLicenseEnforcementEnabled()) {
    return { allowed: true, reason: "enforcement_off" };
  }

  let entitlements: Entitlements;
  try {
    entitlements = await fetchEntitlements(params.userId);
  } catch {
    return { allowed: false, reason: "license_server_unreachable" };
  }

  if (params.totalBots > entitlements.maxBotsTotal) {
    return { allowed: false, reason: "max_bots_total_exceeded" };
  }

  if (!params.isAlreadyRunning && params.runningBots >= entitlements.maxRunningBots) {
    return { allowed: false, reason: "max_running_bots_exceeded" };
  }

  if (!includesExchange(entitlements.allowedExchanges, params.exchange)) {
    return { allowed: false, reason: "exchange_not_allowed" };
  }

  return { allowed: true, reason: "ok" };
}

export function resetLicenseCache() {
  cache.clear();
}
