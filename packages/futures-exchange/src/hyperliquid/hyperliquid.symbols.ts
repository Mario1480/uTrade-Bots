import { SymbolRegistry } from "@mm/futures-core";

export function normalizeCanonicalSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function normalizeHyperliquidSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function toInternalPerpSymbol(coin: string): string {
  return `${normalizeHyperliquidSymbol(coin)}-PERP`;
}

export function coinToCanonicalSymbol(coin: string): string {
  return `${normalizeHyperliquidSymbol(coin)}USDT`;
}

export function parseCoinFromAnySymbol(symbol: string): string {
  const trimmed = normalizeHyperliquidSymbol(symbol);

  if (trimmed.endsWith("-PERP")) {
    return trimmed.slice(0, -5);
  }
  if (trimmed.endsWith("-SPOT")) {
    return trimmed.slice(0, -5);
  }

  const normalized = normalizeCanonicalSymbol(symbol);
  if (normalized.endsWith("USDT") && normalized.length > 4) {
    return normalized.slice(0, -4);
  }
  if (normalized.endsWith("USDC") && normalized.length > 4) {
    return normalized.slice(0, -4);
  }
  if (normalized.endsWith("PERP") && normalized.length > 4) {
    return normalized.slice(0, -4);
  }
  return normalized;
}

export function toHyperliquidSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toMexcSymbol(symbol);
}

export function fromHyperliquidSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toCanonicalSymbol(symbol);
}
