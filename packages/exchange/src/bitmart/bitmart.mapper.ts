import { normalizeSymbol as normalizeCanonical, splitSymbol as splitCanonical } from "@mm/core";

// Bitmart uses symbols like BTC_USDT (underscore).
export function normalizeSymbol(symbol: string): string {
  const canonical = normalizeCanonical(symbol);
  const { base, quote } = splitCanonical(canonical);
  return `${base}_${quote}`;
}

export function splitSymbol(symbolUnderscore: string): { base: string; quote: string } {
  const canonical = normalizeCanonical(symbolUnderscore);
  return splitCanonical(canonical);
}
