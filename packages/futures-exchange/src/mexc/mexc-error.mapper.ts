import { ExchangeError, type ExchangeErrorCode } from "../core/exchange-error.types.js";
import {
  MexcApiError,
  MexcAuthError,
  MexcInvalidParamsError,
  MexcMaintenanceError,
  MexcRateLimitError
} from "./mexc.errors.js";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown MEXC error");
}

function toLowerMessage(error: unknown): string {
  return toMessage(error).toLowerCase();
}

function toStatus(error: unknown, fallback: number): number {
  const value =
    (error as { options?: { status?: unknown }; status?: unknown })?.options?.status
    ?? (error as { status?: unknown })?.status;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 400 && parsed < 600) return parsed;
  return fallback;
}

export function classifyMexcErrorCode(error: unknown): ExchangeErrorCode {
  if (error instanceof MexcAuthError) return "EX_AUTH";
  if (error instanceof MexcRateLimitError) return "EX_RATE_LIMIT";
  if (error instanceof MexcMaintenanceError) return "EX_UPSTREAM_UNAVAILABLE";
  if (error instanceof MexcInvalidParamsError) {
    const text = toLowerMessage(error);
    if (text.includes("order not found") || text.includes("order not exist")) return "EX_ORDER_NOT_FOUND";
    if (text.includes("reduceonly") || text.includes("reduce only")) return "EX_REDUCE_ONLY_REJECTED";
    if (text.includes("position mode") || text.includes("unilateral") || text.includes("one-way") || text.includes("hedge")) {
      return "EX_POSITION_MODE_MISMATCH";
    }
    if (text.includes("tick") || text.includes("step") || text.includes("precision") || text.includes("price")) {
      return "EX_PRECISION_INVALID";
    }
    return "EX_INVALID_PARAMS";
  }

  const text = toLowerMessage(error);
  if (text.includes("network") || text.includes("fetch failed") || text.includes("econn")) return "EX_NETWORK";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) return "EX_TIMEOUT";
  if (text.includes("rate limit") || text.includes("too many") || text.includes("429")) return "EX_RATE_LIMIT";
  if (text.includes("maintenance") || text.includes("upstream")) return "EX_UPSTREAM_UNAVAILABLE";
  if (text.includes("tick") || text.includes("step") || text.includes("precision") || text.includes("price")) {
    return "EX_PRECISION_INVALID";
  }
  if (text.includes("param") || text.includes("invalid")) return "EX_INVALID_PARAMS";
  return "EX_UNKNOWN";
}

export function mapMexcError(error: unknown): ExchangeError {
  if (error instanceof ExchangeError) return error;
  const code = classifyMexcErrorCode(error);
  const retryable =
    code === "EX_NETWORK"
    || code === "EX_TIMEOUT"
    || code === "EX_RATE_LIMIT"
    || code === "EX_UPSTREAM_UNAVAILABLE";

  return new ExchangeError({
    exchange: "mexc",
    code,
    message: toMessage(error),
    retryable,
    httpStatus: toStatus(
      error,
      code === "EX_AUTH" ? 401 : retryable ? 502 : code === "EX_ORDER_NOT_FOUND" ? 404 : 400
    ),
    details: error instanceof MexcApiError ? { mexc: error.options } : undefined,
    cause: error
  });
}
