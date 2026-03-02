import crypto from "node:crypto";
import { HyperliquidFuturesAdapter, MexcFuturesAdapter } from "@mm/futures-exchange";

type HttpMethod = "GET" | "POST" | "DELETE";

type BitgetApiEnvelope<T> = {
  code?: string;
  msg?: string;
  data?: T;
};

type BitgetAccountRow = {
  marginCoin?: string;
  available?: string;
  accountEquity?: string;
  crossAvailable?: string;
  crossedMaxAvailable?: string;
  isolatedMaxAvailable?: string;
};

type BitgetSpotAssetRow = {
  coin?: string;
  available?: string;
  frozen?: string;
  locked?: string;
  lock?: string;
};

type BitgetPositionRow = {
  unrealizedPL?: string;
};

type ExchangeSyncInput = {
  exchange: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
};

export type ExchangeSyncResult = {
  syncedAt: Date;
  spotBudget: {
    total: number | null;
    available: number | null;
    currency: string | null;
  } | null;
  futuresBudget: {
    equity: number | null;
    availableMargin: number | null;
    marginCoin: string | null;
  };
  pnlTodayUsd: number | null;
  details: {
    exchange: string;
    endpoint: string;
    productType?: string;
  };
};

export class ExchangeSyncError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "sync_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);

  const encode = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((item) => encode(item));
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input).sort()) {
        const val = (input as Record<string, unknown>)[key];
        if (val === undefined) continue;
        out[key] = encode(val);
      }
      return out;
    }
    return input;
  };

  return JSON.stringify(encode(value));
}

function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function signBitgetRequest(params: {
  timestamp: string;
  method: HttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  secretKey: string;
}): string {
  const queryString = buildQueryString(params.query);
  const bodyString = params.method === "POST" ? stableStringify(params.body) : "";
  const prehash = `${params.timestamp}${params.method}${params.path}${queryString ? `?${queryString}` : ""}${bodyString}`;
  return crypto.createHmac("sha256", params.secretKey).update(prehash).digest("base64");
}

async function syncBitgetAccount(input: ExchangeSyncInput): Promise<ExchangeSyncResult> {
  if (!input.passphrase?.trim()) {
    throw new ExchangeSyncError(
      "Bitget passphrase is required for private API sync.",
      400,
      "bitget_passphrase_required"
    );
  }
  const bitgetPassphrase = input.passphrase.trim();

  const productType = (process.env.BITGET_PRODUCT_TYPE ?? "USDT-FUTURES").trim();
  const marginCoin = (process.env.BITGET_MARGIN_COIN ?? "USDT").trim();
  const baseUrl = (process.env.BITGET_REST_BASE_URL ?? "https://api.bitget.com").replace(/\/+$/, "");
  const futuresAccountsEndpoint = "/api/v2/mix/account/accounts";
  async function requestBitgetPrivate<T>(params: {
    endpoint: string;
    method?: HttpMethod;
    query?: Record<string, unknown>;
  }): Promise<T> {
    const method = params.method ?? "GET";
    const timestamp = String(Date.now());
    const queryString = buildQueryString(params.query);
    const signature = signBitgetRequest({
      timestamp,
      method,
      path: params.endpoint,
      query: params.query,
      secretKey: input.apiSecret
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${baseUrl}${params.endpoint}${queryString ? `?${queryString}` : ""}`, {
        method,
        headers: {
          "ACCESS-KEY": input.apiKey,
          "ACCESS-SIGN": signature,
          "ACCESS-TIMESTAMP": timestamp,
          "ACCESS-PASSPHRASE": bitgetPassphrase,
          "Content-Type": "application/json"
        },
        signal: controller.signal
      });

      const text = await response.text();
      let payload: BitgetApiEnvelope<T> = {};
      if (text) {
        try {
          payload = JSON.parse(text) as BitgetApiEnvelope<T>;
        } catch {
          throw new ExchangeSyncError("Bitget returned an invalid JSON response.", 502, "bitget_bad_response");
        }
      }

      if (!response.ok || String(payload.code ?? "") !== "00000") {
        const message = String(payload.msg ?? `HTTP ${response.status}`);
        const isAuthError =
          response.status === 401 ||
          /auth|signature|apikey|api key|passphrase|permission|invalid/i.test(message);
        throw new ExchangeSyncError(
          `Bitget sync failed: ${message}`,
          isAuthError ? 401 : 502,
          isAuthError ? "bitget_auth_failed" : "bitget_sync_failed"
        );
      }

      return payload.data as T;
    } catch (error) {
      if (error instanceof ExchangeSyncError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ExchangeSyncError("Bitget sync timed out.", 504, "bitget_timeout");
      }
      throw new ExchangeSyncError("Bitget sync failed due to network error.", 502, "bitget_network_error");
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const rows = await requestBitgetPrivate<BitgetAccountRow[]>({
      endpoint: futuresAccountsEndpoint,
      query: { productType }
    });
    const preferred =
      rows.find((row) => String(row.marginCoin ?? "").toUpperCase() === "USDT") ??
      rows[0] ??
      null;

    let spotBudget: ExchangeSyncResult["spotBudget"] = null;
    try {
      const spotAssets = await requestBitgetPrivate<BitgetSpotAssetRow[]>({
        endpoint: "/api/v2/spot/account/assets"
      });
      const all = Array.isArray(spotAssets) ? spotAssets : [];
      const preferredSpot =
        all.find((row) => String(row.coin ?? "").toUpperCase() === "USDT") ??
        all[0] ??
        null;
      if (preferredSpot) {
        const available = toNumber(preferredSpot.available);
        const frozen =
          toNumber(preferredSpot.frozen) ??
          toNumber(preferredSpot.locked) ??
          toNumber(preferredSpot.lock);
        const total =
          available === null && frozen === null
            ? null
            : (available ?? 0) + (frozen ?? 0);
        spotBudget = {
          total,
          available,
          currency: preferredSpot.coin ? String(preferredSpot.coin).toUpperCase() : null
        };
      }
    } catch {
      // Spot budget is optional for futures-only credentials.
      spotBudget = null;
    }

    let pnlTodayUsd: number | null = null;
    try {
      const positions = await requestBitgetPrivate<BitgetPositionRow[]>({
        endpoint: "/api/v2/mix/position/all-position",
        query: { productType, marginCoin }
      });
      const all = Array.isArray(positions) ? positions : [];
      let sum = 0;
      let hasValue = false;
      for (const row of all) {
        const value = toNumber(row.unrealizedPL);
        if (value === null) continue;
        sum += value;
        hasValue = true;
      }
      pnlTodayUsd = hasValue ? sum : null;
    } catch {
      // Keep sync successful even if pnl endpoint is temporarily unavailable.
      pnlTodayUsd = null;
    }

    return {
      syncedAt: new Date(),
      spotBudget,
      futuresBudget: {
        equity: toNumber(preferred?.accountEquity),
        availableMargin:
          toNumber(preferred?.available) ??
          toNumber(preferred?.crossAvailable) ??
          toNumber(preferred?.crossedMaxAvailable) ??
          toNumber(preferred?.isolatedMaxAvailable),
        marginCoin: preferred?.marginCoin ? String(preferred.marginCoin).toUpperCase() : null
      },
      pnlTodayUsd,
      details: {
        exchange: "bitget",
        endpoint: futuresAccountsEndpoint,
        productType
      }
    };
  } catch (error) {
    if (error instanceof ExchangeSyncError) throw error;
    throw new ExchangeSyncError("Bitget sync failed due to network error.", 502, "bitget_network_error");
  }
}

function isLikelyEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

async function syncHyperliquidAccount(input: ExchangeSyncInput): Promise<ExchangeSyncResult> {
  if (!isLikelyEvmAddress(input.apiKey)) {
    throw new ExchangeSyncError(
      "Hyperliquid wallet address is invalid (expected 0x + 40 hex chars).",
      400,
      "hyperliquid_wallet_invalid"
    );
  }

  const adapter = new HyperliquidFuturesAdapter({
    apiKey: input.apiKey.trim(),
    apiSecret: input.apiSecret.trim(),
    apiPassphrase: input.passphrase?.trim() || undefined,
    restBaseUrl: process.env.HYPERLIQUID_REST_BASE_URL,
    marginCoin: process.env.HYPERLIQUID_MARGIN_COIN ?? "USDC"
  });

  try {
    const [accountState, positions] = await Promise.all([
      adapter.getAccountState(),
      adapter.getPositions().catch(() => [])
    ]);

    const pnlTodayUsd =
      positions.length > 0
        ? positions.reduce((sum, row) => sum + (Number(row.unrealizedPnl) || 0), 0)
        : null;

    return {
      syncedAt: new Date(),
      spotBudget: null,
      futuresBudget: {
        equity: Number.isFinite(Number(accountState.equity)) ? Number(accountState.equity) : null,
        availableMargin:
          accountState.availableMargin !== undefined && Number.isFinite(Number(accountState.availableMargin))
            ? Number(accountState.availableMargin)
            : null,
        marginCoin: process.env.HYPERLIQUID_MARGIN_COIN ?? "USDC"
      },
      pnlTodayUsd,
      details: {
        exchange: "hyperliquid",
        endpoint: "/info",
        productType: "perps"
      }
    };
  } catch (error) {
    const message = String(error ?? "");
    const isAuthError = /auth|signature|private key|wallet|forbidden|permission|invalid/i.test(message);
    throw new ExchangeSyncError(
      `Hyperliquid sync failed: ${message}`,
      isAuthError ? 401 : 502,
      isAuthError ? "hyperliquid_auth_failed" : "hyperliquid_sync_failed"
    );
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

async function syncMexcAccount(input: ExchangeSyncInput): Promise<ExchangeSyncResult> {
  const adapter = new MexcFuturesAdapter({
    apiKey: input.apiKey.trim(),
    apiSecret: input.apiSecret.trim(),
    restBaseUrl: process.env.MEXC_REST_BASE_URL,
    wsUrl: process.env.MEXC_WS_URL,
    marginCoin: process.env.MEXC_MARGIN_COIN ?? "USDT",
    productType: process.env.MEXC_PRODUCT_TYPE ?? "USDT-FUTURES"
  });

  try {
    const [accountState, positions] = await Promise.all([
      adapter.getAccountState(),
      adapter.getPositions().catch(() => [])
    ]);

    const pnlTodayUsd =
      positions.length > 0
        ? positions.reduce((sum, row) => sum + (Number(row.unrealizedPnl) || 0), 0)
        : null;

    return {
      syncedAt: new Date(),
      spotBudget: null,
      futuresBudget: {
        equity: Number.isFinite(Number(accountState.equity)) ? Number(accountState.equity) : null,
        availableMargin:
          accountState.availableMargin !== undefined && Number.isFinite(Number(accountState.availableMargin))
            ? Number(accountState.availableMargin)
            : null,
        marginCoin: adapter.marginCoin ?? null
      },
      pnlTodayUsd,
      details: {
        exchange: "mexc",
        endpoint: "/api/v1/private/account/assets",
        productType: adapter.productType
      }
    };
  } catch (error) {
    const message = String(error ?? "");
    const lower = message.toLowerCase();
    const status = Number((error as { options?: { status?: unknown } })?.options?.status ?? 0);
    const isAuthError =
      status === 401 ||
      /auth|signature|apikey|api key|permission|forbidden|invalid/.test(lower);
    const isRateLimit = status === 429 || /rate limit|too many requests|429/.test(lower);
    const isNetwork = /network|timeout|timed out|fetch failed/.test(lower);
    throw new ExchangeSyncError(
      `MEXC sync failed: ${message}`,
      isAuthError ? 401 : isRateLimit ? 429 : isNetwork ? 504 : 502,
      isAuthError
        ? "mexc_auth_failed"
        : isRateLimit
          ? "mexc_rate_limited"
          : isNetwork
            ? "mexc_network_error"
            : "mexc_sync_failed"
    );
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

export async function syncExchangeAccount(input: ExchangeSyncInput): Promise<ExchangeSyncResult> {
  const exchange = input.exchange.trim().toLowerCase();
  if (exchange === "bitget") {
    return syncBitgetAccount(input);
  }
  if (exchange === "hyperliquid") {
    return syncHyperliquidAccount(input);
  }
  if (exchange === "mexc") {
    return syncMexcAccount(input);
  }

  throw new ExchangeSyncError(
    `Live sync is not implemented for exchange '${exchange}'.`,
    501,
    "exchange_sync_not_supported"
  );
}
