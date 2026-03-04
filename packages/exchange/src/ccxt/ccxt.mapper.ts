import { normalizeSymbol } from "@mm/core";

const KNOWN_QUOTES = [
  "USDT",
  "USDC",
  "BUSD",
  "TUSD",
  "USDP",
  "USD",
  "DAI",
  "BTC",
  "ETH",
  "BNB",
  "EUR",
  "GBP",
  "JPY"
];

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toCcxtSymbol(input: string): string {
  return normalizeSymbol(input);
}

export function fromCcxtSymbol(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("symbol_empty");
  }
  if (raw.includes("/")) return normalizeSymbol(raw);
  if (raw.includes("_")) return normalizeSymbol(raw.replace("_", "/"));
  if (raw.includes("-")) return normalizeSymbol(raw.replace("-", "/"));

  const upper = raw.toUpperCase();
  for (const quote of KNOWN_QUOTES) {
    if (!upper.endsWith(quote) || upper.length <= quote.length) continue;
    return normalizeSymbol(`${upper.slice(0, -quote.length)}/${quote}`);
  }
  return normalizeSymbol(upper);
}

export function toApiSymbol(input: string): string {
  return fromCcxtSymbol(input).replace("/", "");
}

export function precisionToStep(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  if (numeric <= 0) return null;

  // CCXT precision can be decimals (e.g. 6) or direct step (e.g. 0.001).
  if (numeric >= 1 && Number.isInteger(numeric)) {
    const step = 1 / Math.pow(10, numeric);
    return Number.isFinite(step) ? step : null;
  }

  return numeric;
}

export type CcxtMappedMarket = {
  symbol: string;
  exchangeSymbol: string;
  status: string;
  tradable: boolean;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  baseAsset: string | null;
  quoteAsset: string | null;
};

export function mapCcxtMarketRow(row: Record<string, unknown>): CcxtMappedMarket | null {
  const rawSymbol = String(row.symbol ?? row.id ?? "").trim();
  if (!rawSymbol) return null;

  let canonical: string;
  try {
    canonical = fromCcxtSymbol(rawSymbol);
  } catch {
    return null;
  }

  const limits = (row.limits ?? {}) as Record<string, unknown>;
  const amount = (limits.amount ?? {}) as Record<string, unknown>;
  const precision = (row.precision ?? {}) as Record<string, unknown>;

  const active = row.active;
  const tradable = typeof active === "boolean" ? active : true;
  const status = tradable ? "online" : "offline";
  const baseAsset = String(row.base ?? "").trim().toUpperCase() || null;
  const quoteAsset = String(row.quote ?? "").trim().toUpperCase() || null;

  return {
    symbol: canonical.replace("/", ""),
    exchangeSymbol: rawSymbol,
    status,
    tradable,
    tickSize: precisionToStep(precision.price),
    stepSize: precisionToStep(precision.amount),
    minQty: toNumber(amount.min),
    maxQty: toNumber(amount.max),
    baseAsset,
    quoteAsset
  };
}

export function mapCcxtStatus(value: unknown): "open" | "filled" | "canceled" | "rejected" | "unknown" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (["open", "new", "live", "partially_filled"].includes(normalized)) return "open";
  if (["closed", "filled"].includes(normalized)) return "filled";
  if (["canceled", "cancelled"].includes(normalized)) return "canceled";
  if (["rejected", "expired"].includes(normalized)) return "rejected";
  return "unknown";
}
