import { SymbolRegistry } from "@mm/futures-core";

export function normalizeCanonicalSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function normalizeBitgetSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function toBitgetSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toMexcSymbol(symbol);
}

export function fromBitgetSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toCanonicalSymbol(symbol);
}

export function splitBaseQuote(symbol: string): { baseAsset?: string; quoteAsset?: string } {
  const normalized = normalizeBitgetSymbol(symbol);
  const knownQuotes = ["USDT", "USDC", "USD", "BTC", "ETH"];

  for (const quote of knownQuotes) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return {
        baseAsset: normalized.slice(0, normalized.length - quote.length),
        quoteAsset: quote
      };
    }
  }

  return {};
}
