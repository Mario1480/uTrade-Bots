import crypto from "node:crypto";
import { prisma } from "@mm/db";
import { decryptSecret } from "../secret-crypto.js";

const db = prisma as any;

const DEFAULT_BASE_URL = "https://ccpayment.com";
const DEFAULT_PRICE_FIAT_ID = "1033";
const DEFAULT_WEB_BASE_URL = "http://localhost:3000";
const API_KEYS_GLOBAL_SETTING_KEY = "admin.apiKeys";
const CCPAY_CACHE_TTL_MS =
  Math.max(5, Number(process.env.CCPAY_CONFIG_CACHE_TTL_SEC ?? "30")) * 1000;

type CcpaySource = "db" | "env" | "default" | "none";

type StoredCcpaySettings = {
  appIdEnc: string | null;
  appSecretEnc: string | null;
  baseUrl: string | null;
  priceFiatId: string | null;
  webBaseUrl: string | null;
};

export type ResolvedCcpayConfig = {
  appId: string | null;
  appSecret: string | null;
  baseUrl: string;
  priceFiatId: string;
  webBaseUrl: string;
  appIdSource: CcpaySource;
  appSecretSource: CcpaySource;
  baseUrlSource: CcpaySource;
  priceFiatIdSource: CcpaySource;
  webBaseUrlSource: CcpaySource;
  source: "db" | "env" | "default";
  decryptError: boolean;
  isConfigured: boolean;
};

let dbCcpayCacheUntil = 0;
let dbCcpayCached: StoredCcpaySettings | null = null;
let dbCcpayInFlight: Promise<StoredCcpaySettings> | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\/$/, "");
}

function normalizePriceFiatId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function parseStoredCcpaySettings(value: unknown): StoredCcpaySettings {
  const record = asRecord(value);
  const ccpayRecord = asRecord(record.ccpay);

  return {
    appIdEnc:
      toNonEmptyString(ccpayRecord.appIdEnc)
      ?? toNonEmptyString(record.ccpayAppIdEnc),
    appSecretEnc:
      toNonEmptyString(ccpayRecord.appSecretEnc)
      ?? toNonEmptyString(record.ccpayAppSecretEnc),
    baseUrl:
      normalizeUrl(toNonEmptyString(ccpayRecord.baseUrl))
      ?? normalizeUrl(toNonEmptyString(record.ccpayBaseUrl)),
    priceFiatId:
      normalizePriceFiatId(toNonEmptyString(ccpayRecord.priceFiatId))
      ?? normalizePriceFiatId(toNonEmptyString(record.ccpayPriceFiatId)),
    webBaseUrl:
      normalizeUrl(toNonEmptyString(ccpayRecord.webBaseUrl))
      ?? normalizeUrl(toNonEmptyString(record.ccpayWebBaseUrl))
  };
}

async function loadDbCcpaySettings(): Promise<StoredCcpaySettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: API_KEYS_GLOBAL_SETTING_KEY },
    select: { value: true }
  });
  return parseStoredCcpaySettings(row?.value);
}

async function resolveDbCcpaySettings(): Promise<StoredCcpaySettings> {
  const now = Date.now();
  if (now < dbCcpayCacheUntil && dbCcpayCached) {
    return dbCcpayCached;
  }

  if (!dbCcpayInFlight) {
    dbCcpayInFlight = (async () => {
      try {
        return await loadDbCcpaySettings();
      } catch {
        return {
          appIdEnc: null,
          appSecretEnc: null,
          baseUrl: null,
          priceFiatId: null,
          webBaseUrl: null
        } satisfies StoredCcpaySettings;
      } finally {
        dbCcpayInFlight = null;
      }
    })();
  }

  dbCcpayCached = await dbCcpayInFlight;
  dbCcpayCacheUntil = Date.now() + CCPAY_CACHE_TTL_MS;
  return dbCcpayCached;
}

function decryptStoredSecret(
  encrypted: string | null
): { value: string | null; source: CcpaySource; decryptError: boolean } {
  if (!encrypted) return { value: null, source: "none", decryptError: false };
  try {
    const decrypted = decryptSecret(encrypted).trim();
    return {
      value: decrypted.length > 0 ? decrypted : null,
      source: "db",
      decryptError: false
    };
  } catch {
    return {
      value: null,
      source: "db",
      decryptError: true
    };
  }
}

function resolveOverallSource(input: {
  appIdSource: CcpaySource;
  appSecretSource: CcpaySource;
  baseUrlSource: CcpaySource;
  priceFiatIdSource: CcpaySource;
  webBaseUrlSource: CcpaySource;
}): "db" | "env" | "default" {
  const all = [
    input.appIdSource,
    input.appSecretSource,
    input.baseUrlSource,
    input.priceFiatIdSource,
    input.webBaseUrlSource
  ];
  if (all.includes("db")) return "db";
  if (all.includes("env")) return "env";
  return "default";
}

export function invalidateCcpayConfigCache() {
  dbCcpayCacheUntil = 0;
  dbCcpayCached = null;
  dbCcpayInFlight = null;
}

export async function resolveCcpayConfig(): Promise<ResolvedCcpayConfig> {
  const dbSettings = await resolveDbCcpaySettings();

  const appIdResolved = decryptStoredSecret(dbSettings.appIdEnc);
  const appSecretResolved = decryptStoredSecret(dbSettings.appSecretEnc);

  const envAppId = toNonEmptyString(process.env.CCPAY_APP_ID);
  const envAppSecret = toNonEmptyString(process.env.CCPAY_APP_SECRET);

  const appId = appIdResolved.source === "db"
    ? appIdResolved.value
    : (envAppId ?? null);
  const appSecret = appSecretResolved.source === "db"
    ? appSecretResolved.value
    : (envAppSecret ?? null);

  const appIdSource: CcpaySource =
    appIdResolved.source === "db"
      ? "db"
      : envAppId
        ? "env"
        : "none";
  const appSecretSource: CcpaySource =
    appSecretResolved.source === "db"
      ? "db"
      : envAppSecret
        ? "env"
        : "none";

  const envBaseUrl = normalizeUrl(toNonEmptyString(process.env.CCPAY_BASE_URL));
  const baseUrl = dbSettings.baseUrl ?? envBaseUrl ?? DEFAULT_BASE_URL;
  const baseUrlSource: CcpaySource = dbSettings.baseUrl
    ? "db"
    : envBaseUrl
      ? "env"
      : "default";

  const envPriceFiatId = normalizePriceFiatId(toNonEmptyString(process.env.CCPAY_PRICE_FIAT_ID));
  const priceFiatId = dbSettings.priceFiatId ?? envPriceFiatId ?? DEFAULT_PRICE_FIAT_ID;
  const priceFiatIdSource: CcpaySource = dbSettings.priceFiatId
    ? "db"
    : envPriceFiatId
      ? "env"
      : "default";

  const envWebBaseUrl =
    normalizeUrl(toNonEmptyString(process.env.WEB_BASE_URL))
    ?? normalizeUrl(toNonEmptyString(process.env.PANEL_BASE_URL));
  const webBaseUrl = dbSettings.webBaseUrl ?? envWebBaseUrl ?? DEFAULT_WEB_BASE_URL;
  const webBaseUrlSource: CcpaySource = dbSettings.webBaseUrl
    ? "db"
    : envWebBaseUrl
      ? "env"
      : "default";

  const decryptError = appIdResolved.decryptError || appSecretResolved.decryptError;
  const isConfigured = Boolean(appId && appSecret && !decryptError);

  return {
    appId,
    appSecret,
    baseUrl,
    priceFiatId,
    webBaseUrl,
    appIdSource,
    appSecretSource,
    baseUrlSource,
    priceFiatIdSource,
    webBaseUrlSource,
    source: resolveOverallSource({
      appIdSource,
      appSecretSource,
      baseUrlSource,
      priceFiatIdSource,
      webBaseUrlSource
    }),
    decryptError,
    isConfigured
  };
}

export async function getCcpayBaseUrl(): Promise<string> {
  const resolved = await resolveCcpayConfig();
  return resolved.baseUrl;
}

export async function getCcpayWebBaseUrl(): Promise<string> {
  const resolved = await resolveCcpayConfig();
  return resolved.webBaseUrl;
}

export async function getCcpayPriceFiatId(): Promise<string> {
  const resolved = await resolveCcpayConfig();
  return resolved.priceFiatId;
}

export async function isCcpayConfigured(): Promise<boolean> {
  const resolved = await resolveCcpayConfig();
  return resolved.isConfigured;
}

export async function makeCcpayHeaders(bodyJsonString: string): Promise<Record<string, string>> {
  const resolved = await resolveCcpayConfig();
  if (!resolved.appId || !resolved.appSecret || resolved.decryptError) {
    throw new Error("ccpay_not_configured");
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = crypto
    .createHmac("sha256", resolved.appSecret)
    .update(`${resolved.appId}${timestamp}${bodyJsonString}`)
    .digest("hex");

  return {
    Appid: resolved.appId,
    Timestamp: timestamp,
    Sign: sign,
    "Content-Type": "application/json"
  };
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  key: string
): string {
  if (typeof (headers as Headers).get === "function") {
    return ((headers as Headers).get(key) ?? "").trim();
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const direct = record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()];
  if (Array.isArray(direct)) return String(direct[0] ?? "").trim();
  return String(direct ?? "").trim();
}

export async function verifyCcpayWebhook(
  rawBody: string,
  headers: Headers | Record<string, string | string[] | undefined>
): Promise<boolean> {
  const resolved = await resolveCcpayConfig();
  if (!resolved.appId || !resolved.appSecret || resolved.decryptError) return false;

  const headerAppId = readHeader(headers, "Appid") || readHeader(headers, "appid");
  const timestamp = readHeader(headers, "Timestamp") || readHeader(headers, "timestamp");
  const signature = readHeader(headers, "Sign") || readHeader(headers, "sign");
  if (!headerAppId || !timestamp || !signature) return false;
  if (headerAppId !== resolved.appId) return false;

  const expected = crypto
    .createHmac("sha256", resolved.appSecret)
    .update(`${resolved.appId}${timestamp}${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const signatureBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export function formatUsdCents(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}
