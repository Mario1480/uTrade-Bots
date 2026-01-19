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
  "JPY",
  "CHF",
  "AUD",
  "CAD",
  "BRL",
  "RUB",
  "TRY",
  "IDR",
  "VND",
  "PHP",
  "MXN",
  "SGD",
  "HKD",
  "KRW"
];

export function normalizeSymbol(input: string): string {
  const raw = String(input ?? "").trim().toUpperCase();
  if (!raw) throw new Error("symbol_empty");

  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
  }

  if (raw.includes("_") || raw.includes("-")) {
    const parts = raw.split(/[_-]/).filter(Boolean);
    if (parts.length >= 2) {
      const base = parts.slice(0, -1).join("");
      const quote = parts[parts.length - 1];
      return `${base}/${quote}`;
    }
  }

  for (const quote of KNOWN_QUOTES) {
    if (raw.endsWith(quote) && raw.length > quote.length) {
      const base = raw.slice(0, -quote.length);
      return `${base}/${quote}`;
    }
  }

  throw new Error(`symbol_unrecognized:${input}`);
}

export function splitSymbol(canonical: string): { base: string; quote: string } {
  const normalized = normalizeSymbol(canonical);
  const [base, quote] = normalized.split("/");
  return { base, quote };
}
