function normalizedSymbol(symbol: string): string {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function symbolToMacroCurrency(symbol: string): string {
  const normalized = normalizedSymbol(symbol);
  if (!normalized) return "USD";
  if (normalized.endsWith("USDT") || normalized.endsWith("USDC") || normalized.endsWith("USD")) {
    return "USD";
  }
  if (normalized.endsWith("EURT") || normalized.endsWith("EUR")) {
    return "EUR";
  }
  return "USD";
}
