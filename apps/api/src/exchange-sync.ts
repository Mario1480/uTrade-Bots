import {
  FuturesAdapterFactoryError,
  HyperliquidFuturesAdapter,
  MexcFuturesAdapter,
  createFuturesAdapter as createSharedFuturesAdapter
} from "@mm/futures-exchange";
import { CcxtSpotClient, CcxtSpotError } from "@mm/exchange";
import {
  BitgetHttpError,
  requestBitgetApi,
  type BitgetHttpMethod
} from "./bitget/bitget-http.js";


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

function envEnabled(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
}

const MEXC_SPOT_ENABLED = envEnabled("MEXC_SPOT_ENABLED", true);
const MEXC_FUTURES_ENABLED_LEGACY = envEnabled("MEXC_FUTURES_ENABLED", false);
const MEXC_PERP_ENABLED = envEnabled(
  "MEXC_PERP_ENABLED",
  MEXC_FUTURES_ENABLED_LEGACY
);
const BINANCE_SPOT_ENABLED = envEnabled("BINANCE_SPOT_ENABLED", true);
const BINANCE_PERP_ENABLED = envEnabled("BINANCE_PERP_ENABLED", true);

type SyncExchange = "bitget" | "mexc" | "hyperliquid" | "binance";
type SyncErrorKind = "auth_failed" | "rate_limited" | "timeout" | "network_error" | "sync_failed";

function exchangeLabel(exchange: SyncExchange): string {
  if (exchange === "mexc") return "MEXC";
  if (exchange === "bitget") return "Bitget";
  if (exchange === "hyperliquid") return "Hyperliquid";
  return "Binance";
}

function codeForKind(exchange: SyncExchange, kind: SyncErrorKind): string {
  return `${exchange}_${kind}`;
}

function statusForKind(kind: SyncErrorKind): number {
  if (kind === "auth_failed") return 401;
  if (kind === "rate_limited") return 429;
  if (kind === "timeout") return 504;
  if (kind === "network_error") return 502;
  return 502;
}

function parseStatus(error: unknown): number {
  const direct = Number((error as { status?: unknown })?.status);
  if (Number.isFinite(direct) && direct >= 400 && direct <= 599) return direct;
  const nested = Number((error as { options?: { status?: unknown } })?.options?.status);
  if (Number.isFinite(nested) && nested >= 400 && nested <= 599) return nested;
  return 0;
}

function classifyGenericSyncError(error: unknown): SyncErrorKind {
  if (error instanceof CcxtSpotError) {
    if (error.code === "ccxt_spot_auth_failed") return "auth_failed";
    if (error.code === "ccxt_spot_rate_limited") return "rate_limited";
    if (error.code === "ccxt_spot_timeout") return "timeout";
  }

  if (error instanceof BitgetHttpError) {
    if (error.code === "bitget_auth_failed") return "auth_failed";
    if (error.code === "bitget_rate_limited") return "rate_limited";
    if (error.code === "bitget_timeout") return "timeout";
    if (error.code === "bitget_network_error") return "network_error";
    return "sync_failed";
  }

  const status = parseStatus(error);
  const lower = String(error ?? "").toLowerCase();
  const isAuth =
    status === 401 ||
    status === 403 ||
    /auth|signature|apikey|api key|permission|forbidden|invalid|private key|wallet/.test(lower);
  if (isAuth) return "auth_failed";
  const isRateLimited = status === 429 || /rate limit|too many requests|429/.test(lower);
  if (isRateLimited) return "rate_limited";
  const isTimeout = /timeout|timed out|abort|deadline exceeded/.test(lower);
  if (isTimeout) return "timeout";
  const isNetwork = /network|fetch failed|econn|socket hang up/.test(lower);
  if (isNetwork) return "network_error";
  return "sync_failed";
}

export function toExchangeSyncError(params: {
  exchange: SyncExchange;
  error: unknown;
  fallbackMessage: string;
}): ExchangeSyncError {
  if (params.error instanceof ExchangeSyncError) return params.error;
  const kind = classifyGenericSyncError(params.error);
  const status = statusForKind(kind);
  const code = codeForKind(params.exchange, kind);
  const messageRaw = params.error instanceof Error ? params.error.message : String(params.error ?? "").trim();
  const message = messageRaw ? `${exchangeLabel(params.exchange)} sync failed: ${messageRaw}` : params.fallbackMessage;
  return new ExchangeSyncError(message, status, code);
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
    method?: BitgetHttpMethod;
    query?: Record<string, unknown>;
  }): Promise<T> {
    try {
      return await requestBitgetApi<T>({
        baseUrl,
        path: params.endpoint,
        method: params.method ?? "GET",
        query: params.query,
        auth: {
          apiKey: input.apiKey,
          apiSecret: input.apiSecret,
          apiPassphrase: bitgetPassphrase
        },
        timeoutMs: 12_000,
        retryMode: "safe_get",
        maxAttempts: 2
      });
    } catch (error) {
      throw toExchangeSyncError({
        exchange: "bitget",
        error,
        fallbackMessage: "Bitget sync failed due to network error."
      });
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
    throw toExchangeSyncError({
      exchange: "bitget",
      error,
      fallbackMessage: "Bitget sync failed due to network error."
    });
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

  const adapter = createSharedFuturesAdapter({
    exchange: "hyperliquid",
    apiKey: input.apiKey.trim(),
    apiSecret: input.apiSecret.trim(),
    passphrase: input.passphrase?.trim() || undefined
  }) as HyperliquidFuturesAdapter;

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
    throw toExchangeSyncError({
      exchange: "hyperliquid",
      error,
      fallbackMessage: "Hyperliquid sync failed."
    });
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

async function syncMexcFuturesAccount(input: ExchangeSyncInput): Promise<ExchangeSyncResult> {
  let adapter: MexcFuturesAdapter;
  try {
    adapter = createSharedFuturesAdapter(
      {
        exchange: "mexc",
        apiKey: input.apiKey.trim(),
        apiSecret: input.apiSecret.trim()
      },
      { allowMexcPerp: MEXC_PERP_ENABLED }
    ) as MexcFuturesAdapter;
  } catch (error) {
    if (error instanceof FuturesAdapterFactoryError && error.code === "mexc_perp_disabled") {
      throw new ExchangeSyncError("MEXC futures sync is disabled.", 400, "mexc_perp_disabled");
    }
    throw error;
  }

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
    throw toExchangeSyncError({
      exchange: "mexc",
      error,
      fallbackMessage: "MEXC sync failed."
    });
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

async function syncMexcSpotAccount(input: ExchangeSyncInput): Promise<ExchangeSyncResult> {
  const client = new CcxtSpotClient({
    exchangeId: "mexc",
    apiKey: input.apiKey.trim(),
    apiSecret: input.apiSecret.trim(),
    apiPassphrase: input.passphrase?.trim() || undefined
  });

  try {
    const balances = await client.getBalances();
    const preferred =
      balances.find((row) => String(row.asset ?? "").toUpperCase() === "USDT") ??
      balances.find((row) => {
        const free = Number(row.free ?? 0);
        const locked = Number(row.locked ?? 0);
        return Number.isFinite(free + locked) && free + locked > 0;
      }) ??
      null;

    const available = preferred ? toNumber(preferred.free) : null;
    const locked = preferred ? toNumber(preferred.locked) : null;
    const total =
      available === null && locked === null
        ? null
        : Number(((available ?? 0) + (locked ?? 0)).toFixed(8));
    const currency = preferred?.asset ? String(preferred.asset).toUpperCase() : "USDT";

    return {
      syncedAt: new Date(),
      spotBudget: {
        total,
        available,
        currency
      },
      futuresBudget: {
        equity: null,
        availableMargin: null,
        marginCoin: null
      },
      pnlTodayUsd: null,
      details: {
        exchange: "mexc",
        endpoint: "ccxt.fetchBalance",
        productType: "spot"
      }
    };
  } catch (error) {
    throw toExchangeSyncError({
      exchange: "mexc",
      error,
      fallbackMessage: "MEXC spot sync failed."
    });
  }
}

async function syncBinanceMarketDataAccount(): Promise<ExchangeSyncResult> {
  const spotBaseUrl = (process.env.BINANCE_SPOT_BASE_URL ?? "https://api.binance.com").replace(/\/+$/, "");
  const perpBaseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const [spotPing, perpPing] = await Promise.all([
      fetch(`${spotBaseUrl}/api/v3/ping`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      }),
      fetch(`${perpBaseUrl}/fapi/v1/ping`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      })
    ]);

    if (!spotPing.ok || !perpPing.ok) {
      throw new ExchangeSyncError(
        "Binance public market data endpoint not reachable.",
        502,
        "binance_market_data_unreachable"
      );
    }

    return {
      syncedAt: new Date(),
      spotBudget: null,
      futuresBudget: {
        equity: null,
        availableMargin: null,
        marginCoin: null
      },
      pnlTodayUsd: null,
      details: {
        exchange: "binance",
        endpoint: "public:/api/v3/ping + /fapi/v1/ping",
        productType: "market_data_only"
      }
    };
  } catch (error) {
    if (error instanceof ExchangeSyncError) throw error;
    throw toExchangeSyncError({
      exchange: "binance",
      error,
      fallbackMessage: "Binance market-data reachability check failed."
    });
  } finally {
    clearTimeout(timeout);
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
    if (MEXC_PERP_ENABLED) {
      return syncMexcFuturesAccount(input);
    }
    if (!MEXC_SPOT_ENABLED) {
      throw new ExchangeSyncError(
        "MEXC integration is disabled by runtime flag.",
        403,
        "mexc_disabled"
      );
    }
    return syncMexcSpotAccount(input);
  }
  if (exchange === "binance") {
    if (!BINANCE_SPOT_ENABLED && !BINANCE_PERP_ENABLED) {
      throw new ExchangeSyncError(
        "Binance integration is disabled by runtime flag.",
        403,
        "binance_disabled"
      );
    }
    return syncBinanceMarketDataAccount();
  }

  throw new ExchangeSyncError(
    `Live sync is not implemented for exchange '${exchange}'.`,
    501,
    "exchange_sync_not_supported"
  );
}
