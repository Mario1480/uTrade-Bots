import { isExchangeError, type ExchangeErrorCode, type ExchangeId } from "@mm/futures-exchange";
import { ManualTradingError } from "./trading.js";

function inferExchangeErrorCode(params: {
  status: number;
  code: string;
  message: string;
}): ExchangeErrorCode {
  const message = params.message.toLowerCase();
  const code = params.code.toLowerCase();

  if (
    params.status === 401 ||
    params.status === 403 ||
    code === "40001" ||
    code === "40002" ||
    code === "40003" ||
    message.includes("unauthorized") ||
    message.includes("invalid signature") ||
    message.includes("api key")
  ) {
    return "EX_AUTH";
  }
  if (
    params.status === 429 ||
    message.includes("rate limit") ||
    message.includes("too many")
  ) {
    return "EX_RATE_LIMIT";
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("deadline exceeded")
  ) {
    return "EX_TIMEOUT";
  }
  if (
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("econn") ||
    message.includes("socket hang up")
  ) {
    return "EX_NETWORK";
  }
  if (
    message.includes("position mode") ||
    message.includes("one-way") ||
    message.includes("hedge") ||
    message.includes("unilateral")
  ) {
    return "EX_POSITION_MODE_MISMATCH";
  }
  if (message.includes("reduce only") || message.includes("reduceonly")) {
    return "EX_REDUCE_ONLY_REJECTED";
  }
  if (message.includes("order not found") || message.includes("order not exist")) {
    return "EX_ORDER_NOT_FOUND";
  }
  if (
    message.includes("precision") ||
    message.includes("tick size") ||
    message.includes("step size") ||
    message.includes("price filter")
  ) {
    return "EX_PRECISION_INVALID";
  }
  if (
    message.includes("not tradable") ||
    message.includes("symbol status") ||
    message.includes("restrictedapi")
  ) {
    return "EX_SYMBOL_NOT_TRADABLE";
  }
  if (params.status >= 502 || message.includes("maintenance") || message.includes("upstream")) {
    return "EX_UPSTREAM_UNAVAILABLE";
  }
  if (params.status >= 400 && params.status < 500) {
    return "EX_INVALID_PARAMS";
  }
  return "EX_UNKNOWN";
}

function inferExchangeId(error: unknown): ExchangeId | "unknown" {
  const explicit = (error as { exchange?: unknown })?.exchange;
  if (
    explicit === "bitget" ||
    explicit === "mexc" ||
    explicit === "hyperliquid" ||
    explicit === "paper" ||
    explicit === "binance"
  ) {
    return explicit;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (message.includes("bitget")) return "bitget";
  if (message.includes("mexc")) return "mexc";
  if (message.includes("hyperliquid")) return "hyperliquid";
  if (message.includes("binance")) return "binance";
  return "unknown";
}

function isRetryableExchangeCode(code: ExchangeErrorCode): boolean {
  return code === "EX_RATE_LIMIT"
    || code === "EX_TIMEOUT"
    || code === "EX_NETWORK"
    || code === "EX_UPSTREAM_UNAVAILABLE";
}

export function buildManualTradingErrorResponse(error: unknown): {
  status: number;
  payload: Record<string, unknown>;
} {
  if (isExchangeError(error)) {
    return {
      status: error.httpStatus,
      payload: {
        error: "exchange_error",
        code: error.code,
        message: error.message,
        exchange: error.exchange,
        retryable: error.retryable
      }
    };
  }

  if (error instanceof ManualTradingError) {
    return {
      status: error.status,
      payload: {
        error: error.message,
        code: error.code,
        message: error.message
      }
    };
  }

  const unknown = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    options?: {
      status?: unknown;
      code?: unknown;
      message?: unknown;
    };
  };

  const rawStatus = Number(unknown?.status ?? unknown?.options?.status);
  const status = Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus < 600
    ? rawStatus
    : 500;

  const code =
    typeof unknown?.code === "string" && unknown.code.trim()
      ? unknown.code
      : typeof unknown?.options?.code === "string" && unknown.options.code.trim()
        ? unknown.options.code
        : "manual_trading_unexpected_error";

  const message =
    error instanceof Error
      ? error.message
      : typeof unknown?.options?.message === "string" && unknown.options.message.trim()
        ? unknown.options.message
        : "Unexpected manual trading failure.";

  const standardizedCode = /^EX_[A-Z_]+$/.test(code)
    ? (code as ExchangeErrorCode)
    : inferExchangeErrorCode({ status, code, message });
  const retryable =
    typeof unknown.retryable === "boolean"
      ? Boolean(unknown.retryable)
      : isRetryableExchangeCode(standardizedCode);
  const exchange = inferExchangeId(error);

  return {
    status,
    payload: {
      error: "exchange_error",
      code: standardizedCode,
      message,
      exchange,
      retryable
    }
  };
}
