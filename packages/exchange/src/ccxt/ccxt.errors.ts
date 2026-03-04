export class CcxtSpotError extends Error {
  readonly code: string;
  readonly status: number;
  readonly causeValue: unknown;

  constructor(message: string, code = "ccxt_spot_error", status = 400, causeValue?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.causeValue = causeValue;
  }
}

function extractMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error ?? "unknown_error");
}

export function mapCcxtError(error: unknown): CcxtSpotError {
  const message = extractMessage(error);
  const lower = message.toLowerCase();
  const name = String((error as { name?: unknown })?.name ?? "").toLowerCase();

  if (name.includes("authentication") || lower.includes("api key") || lower.includes("signature")) {
    return new CcxtSpotError(message, "ccxt_spot_auth_failed", 401, error);
  }
  if (name.includes("ratelimit") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return new CcxtSpotError(message, "ccxt_spot_rate_limited", 429, error);
  }
  if (name.includes("requesttimeout") || lower.includes("timeout")) {
    return new CcxtSpotError(message, "ccxt_spot_timeout", 504, error);
  }
  if (name.includes("badrequest") || lower.includes("precision") || lower.includes("minimum") || lower.includes("min notional")) {
    return new CcxtSpotError(message, "ccxt_spot_bad_request", 400, error);
  }
  if (name.includes("exchangenotavailable") || lower.includes("not available")) {
    return new CcxtSpotError(message, "ccxt_spot_exchange_unavailable", 502, error);
  }

  return new CcxtSpotError(message, "ccxt_spot_request_failed", 400, error);
}
