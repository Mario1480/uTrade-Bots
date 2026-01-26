import { normalizeSymbol, splitSymbol } from "@mm/core";

export interface SymbolAdapter {
  toExchangeSymbol(canonical: string): string;
  fromExchangeSymbol(exchangeSymbol: string): string;
}

export const BitmartSymbolAdapter: SymbolAdapter = {
  toExchangeSymbol(canonical: string): string {
    const { base, quote } = splitSymbol(canonical);
    return `${base}_${quote}`;
  },
  fromExchangeSymbol(exchangeSymbol: string): string {
    return normalizeSymbol(exchangeSymbol.replace("_", "/"));
  }
};

export const BinanceSymbolAdapter: SymbolAdapter = {
  toExchangeSymbol(canonical: string): string {
    const { base, quote } = splitSymbol(canonical);
    return `${base}${quote}`;
  },
  fromExchangeSymbol(exchangeSymbol: string): string {
    return normalizeSymbol(exchangeSymbol);
  }
};

export const KucoinSymbolAdapter: SymbolAdapter = {
  toExchangeSymbol(canonical: string): string {
    const { base, quote } = splitSymbol(canonical);
    return `${base}-${quote}`;
  },
  fromExchangeSymbol(exchangeSymbol: string): string {
    return normalizeSymbol(exchangeSymbol.replace("-", "/"));
  }
};

export const MexcSymbolAdapter: SymbolAdapter = {
  toExchangeSymbol(canonical: string): string {
    const { base, quote } = splitSymbol(canonical);
    return `${base}_${quote}`;
  },
  fromExchangeSymbol(exchangeSymbol: string): string {
    return normalizeSymbol(exchangeSymbol.replace("_", "/"));
  }
};

export const CoinstoreSymbolAdapter: SymbolAdapter = {
  toExchangeSymbol(canonical: string): string {
    const { base, quote } = splitSymbol(canonical);
    return `${base}${quote}`;
  },
  fromExchangeSymbol(exchangeSymbol: string): string {
    return normalizeSymbol(exchangeSymbol);
  }
};

export const PionexSymbolAdapter: SymbolAdapter = {
  toExchangeSymbol(canonical: string): string {
    const { base, quote } = splitSymbol(canonical);
    return `${base}_${quote}`;
  },
  fromExchangeSymbol(exchangeSymbol: string): string {
    return normalizeSymbol(exchangeSymbol.replace("_", "/"));
  }
};

export function getSymbolAdapter(exchange: string): SymbolAdapter {
  const key = exchange.toLowerCase();
  switch (key) {
    case "bitmart":
      return BitmartSymbolAdapter;
    case "binance":
      return BinanceSymbolAdapter;
    case "kucoin":
      return KucoinSymbolAdapter;
    case "mexc":
      return MexcSymbolAdapter;
    case "coinstore":
      return CoinstoreSymbolAdapter;
    case "pionex":
      return PionexSymbolAdapter;
    default:
      return {
        toExchangeSymbol: (canonical) => normalizeSymbol(canonical).replace("/", "_"),
        fromExchangeSymbol: (exchangeSymbol) => normalizeSymbol(exchangeSymbol)
      };
  }
}

export function toExchangeSymbol(exchange: string, canonical: string): string {
  return getSymbolAdapter(exchange).toExchangeSymbol(canonical);
}

export function fromExchangeSymbol(exchange: string, exchangeSymbol: string): string {
  return getSymbolAdapter(exchange).fromExchangeSymbol(exchangeSymbol);
}
