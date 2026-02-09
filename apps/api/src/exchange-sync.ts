import crypto from "node:crypto";

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

export async function syncExchangeAccount(input: ExchangeSyncInput): Promise<ExchangeSyncResult> {
  const exchange = input.exchange.trim().toLowerCase();
  if (exchange === "bitget") {
    return syncBitgetAccount(input);
  }

  throw new ExchangeSyncError(
    `Live sync is not implemented for exchange '${exchange}'.`,
    501,
    "exchange_sync_not_supported"
  );
}
