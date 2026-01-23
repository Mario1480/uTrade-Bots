import {
  type LicenseVerifyResponse,
  type LicenseError,
  type LicenseErrorCode,
  mapLicenseErrorFromStatus,
  signLicenseBody,
  shouldAllowGrace,
  enforceLicense,
  type LicenseEnforcementResult
} from "@mm/core";
import { log } from "./logger.js";
import { loadLicenseConfig } from "./db.js";

export type LicenseState = {
  ok: boolean;
  lastOkAt: number;
  lastCheckAt: number;
  lastResponse: LicenseVerifyResponse | null;
  lastError: LicenseError | null;
  grace: boolean;
  enforce?: LicenseEnforcementResult;
};

const DEFAULT_BASE_URL = "https://license-server.uliquid.vip";
const DEFAULT_VERIFY_MIN = 15;
const DEFAULT_GRACE_MIN = 120;
const DEFAULT_TIMEOUT_MS = 8000;

function envOptional(key: string): string | null {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : null;
}

function numEnv(key: string, fallback: number): number {
  const v = envOptional(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyLicenseOnce(params: {
  licenseKey: string;
  instanceId: string;
  version?: string | null;
}): Promise<LicenseVerifyResponse> {
  const base = envOptional("LICENSE_SERVER_URL") ?? DEFAULT_BASE_URL;
  const url = base.endsWith("/api/license/verify")
    ? base
    : `${base.replace(/\\/$/, "")}/api/license/verify`;
  const secret = envOptional("LICENSE_SERVER_SECRET") ?? "";
  const timeoutMs = numEnv("LICENSE_VERIFY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

  const body = JSON.stringify({
    licenseKey: params.licenseKey,
    instanceId: params.instanceId,
    ...(params.version ? { version: params.version } : {})
  });

  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (secret) {
    headers["x-uliquid-signature"] = await signLicenseBody(body, secret);
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, { method: "POST", headers, body }, timeoutMs);
  } catch (err) {
    const e: LicenseError = {
      code: "NETWORK_ERROR",
      message: String(err)
    };
    throw e;
  }

  if (!resp.ok) {
    const code = mapLicenseErrorFromStatus(resp.status);
    let message: string | undefined;
    try {
      const json = (await resp.json()) as { error?: string };
      if (json?.error) message = json.error;
    } catch {}
    const err: LicenseError = { code, status: resp.status, message };
    throw err;
  }

  return (await resp.json()) as LicenseVerifyResponse;
}

export function createLicenseManager() {
  const state: LicenseState = {
    ok: false,
    lastOkAt: 0,
    lastCheckAt: 0,
    lastResponse: null,
    lastError: null,
    grace: false
  };

  const version = envOptional("APP_VERSION");
  const verifyMin = numEnv("LICENSE_VERIFY_INTERVAL_MIN", DEFAULT_VERIFY_MIN);
  const graceMin = numEnv("LICENSE_GRACE_MIN", DEFAULT_GRACE_MIN);

  async function checkOnce(meta: { botCount: number; cexCount: number; usePriceSupport: boolean; usePriceFollow: boolean; useAiRecommendations: boolean }) {
    const now = Date.now();
    state.lastCheckAt = now;

    try {
      const cfg = await loadLicenseConfig();
      const licenseKey = cfg.licenseKey ?? envOptional("LICENSE_KEY");
      const instanceId = cfg.instanceId ?? envOptional("LICENSE_INSTANCE_ID");
      if (!licenseKey || !instanceId) {
        const err: LicenseError = {
          code: "INVALID_REQUEST",
          message: "Missing licenseKey or instanceId"
        };
        throw err;
      }

      const response = await verifyLicenseOnce({ licenseKey, instanceId, version });
      state.lastResponse = response;
      state.lastError = null;
      state.ok = response.status === "ACTIVE";
      if (state.ok) {
        state.lastOkAt = now;
        state.grace = false;
      }
      state.enforce = enforceLicense({
        response,
        botCount: meta.botCount,
        cexCount: meta.cexCount,
        usePriceSupport: meta.usePriceSupport,
        usePriceFollow: meta.usePriceFollow,
        useAiRecommendations: meta.useAiRecommendations
      });
      if (!state.enforce.allowed) {
        state.ok = false;
      }
      log.info(
        {
          status: response.status,
          validUntil: response.validUntil,
          limits: state.enforce?.limits,
          features: response.features
        },
        "license verify success"
      );
      return state;
    } catch (err) {
      const error = err as LicenseError;
      state.lastError = error;
      const graceAllowed = shouldAllowGrace({
        lastOkAt: state.lastOkAt,
        now,
        graceMin,
        errorCode: error.code
      });
      state.grace = graceAllowed;
      state.ok = graceAllowed;
      if (!graceAllowed) {
        state.ok = false;
      }
      const graceRemainingMs = Math.max(0, graceMin * 60_000 - (now - state.lastOkAt));
      log.warn(
        {
          code: error.code,
          status: error.status,
          message: error.message,
          grace: graceAllowed,
          graceRemainingSec: Math.floor(graceRemainingMs / 1000)
        },
        "license verify failed"
      );
      return state;
    }
  }

  return {
    state,
    verifyIntervalMs: verifyMin * 60_000,
    graceMin,
    checkOnce
  };
}
