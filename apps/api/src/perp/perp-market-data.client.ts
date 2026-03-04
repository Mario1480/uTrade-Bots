import {
  type BitgetFuturesAdapter,
  type HyperliquidFuturesAdapter,
  type MexcFuturesAdapter
} from "@mm/futures-exchange";
import {
  createFuturesAdapter,
  ManualTradingError,
  type PerpPriceReader,
  type TradingAccount
} from "../trading.js";

type SupportedFuturesAdapter = BitgetFuturesAdapter | HyperliquidFuturesAdapter | MexcFuturesAdapter;

type PerpSymbolItem = {
  symbol: string;
  exchangeSymbol: string;
  status: string;
  tradable: boolean;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  quoteAsset: string | null;
  baseAsset: string | null;
};

export type PerpMarketDataClient = PerpPriceReader & {
  listSymbols(): Promise<PerpSymbolItem[]>;
  getCandles(params: {
    symbol: string;
    timeframe?: string;
    granularity?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown>;
  getTicker(symbol: string): Promise<{
    symbol: string;
    last: number | null;
    mark: number | null;
    bid: number | null;
    ask: number | null;
    ts: number | null;
    raw: unknown;
  }>;
  getDepth(
    symbol: string,
    limit?: number
  ): Promise<{
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    ts: number | null;
    raw: unknown;
  }>;
  getTrades(
    symbol: string,
    limit?: number
  ): Promise<Array<{
    symbol: string;
    price: number | null;
    qty: number | null;
    side: string | null;
    ts: number | null;
    raw: unknown;
  }>>;
  close(): Promise<void>;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const parsed = toNumber(record[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizeCanonicalSymbol(value: string): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function toTimeframeGranularity(value?: string | null): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1m") return "1m";
  if (normalized === "5m") return "5m";
  if (normalized === "15m") return "15m";
  if (normalized === "1h" || normalized === "1hutc") return "1H";
  if (normalized === "4h" || normalized === "4hutc") return "4H";
  if (normalized === "1d" || normalized === "1dutc") return "1D";
  return "15m";
}

function toBinanceInterval(value?: string | null): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1m") return "1m";
  if (normalized === "5m") return "5m";
  if (normalized === "15m") return "15m";
  if (normalized === "1h" || normalized === "1hutc") return "1h";
  if (normalized === "4h" || normalized === "4hutc") return "4h";
  if (normalized === "1d" || normalized === "1dutc") return "1d";
  return "15m";
}

class FuturesAdapterPerpMarketDataClient implements PerpMarketDataClient {
  constructor(private readonly adapter: SupportedFuturesAdapter) {}

  async listSymbols(): Promise<PerpSymbolItem[]> {
    await this.adapter.contractCache.warmup();
    return this.adapter.contractCache.snapshot()
      .map((contract) => {
        const contractSize =
          Number.isFinite(Number(contract.contractSize)) && Number(contract.contractSize) > 0
            ? Number(contract.contractSize)
            : 1;
        return {
        symbol: contract.canonicalSymbol,
        exchangeSymbol: contract.mexcSymbol,
        status: contract.apiAllowed ? "online" : "offline",
        tradable: contract.apiAllowed,
        tickSize: contract.tickSize,
        stepSize:
          contract.stepSize !== null && contract.stepSize !== undefined
            ? Number((Number(contract.stepSize) * contractSize).toFixed(8))
            : contract.stepSize,
        minQty:
          contract.minVol !== null && contract.minVol !== undefined
            ? Number((Number(contract.minVol) * contractSize).toFixed(8))
            : contract.minVol,
        maxQty:
          contract.maxVol !== null && contract.maxVol !== undefined
            ? Number((Number(contract.maxVol) * contractSize).toFixed(8))
            : contract.maxVol,
        quoteAsset: contract.quoteAsset ?? null,
        baseAsset: contract.baseAsset ?? null
      };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getCandles(params: {
    symbol: string;
    timeframe?: string;
    granularity?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown> {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(params.symbol);
    const granularity = params.granularity ?? toTimeframeGranularity(params.timeframe);
    return this.adapter.marketApi.getCandles({
      symbol: exchangeSymbol,
      productType: this.adapter.productType as any,
      granularity,
      startTime: params.startTime,
      endTime: params.endTime,
      limit: params.limit ?? 500
    });
  }

  async getTicker(symbol: string) {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(symbol);
    const raw = await this.adapter.marketApi.getTicker(exchangeSymbol, this.adapter.productType as any);
    const row = Array.isArray(raw) ? toRecord(raw[0] ?? null) : toRecord(raw);
    const last = pickNumber(row, ["lastPr", "last", "price", "close", "lastPrice"]);
    const mark = pickNumber(row, ["markPrice", "mark", "indexPrice", "markPx", "oraclePx", "fairPrice"]) ?? last;
    return {
      symbol: normalizeCanonicalSymbol(symbol),
      last,
      mark,
      bid: pickNumber(row, ["bidPr", "bidPrice", "bid", "bestBid", "bid1"]),
      ask: pickNumber(row, ["askPr", "askPrice", "ask", "bestAsk", "ask1"]),
      ts: pickNumber(row, ["ts", "timestamp", "time", "t"]),
      raw
    };
  }

  async getDepth(symbol: string, limit = 50) {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(symbol);
    const raw = await this.adapter.marketApi.getDepth(exchangeSymbol, limit, this.adapter.productType as any);
    const row = toRecord(raw) ?? {};
    const parseLevels = (value: unknown): Array<[number, number]> => {
      if (!Array.isArray(value)) return [];
      return value
        .map((level) => {
          if (!Array.isArray(level)) return null;
          const price = toNumber(level[0]);
          const qty = toNumber(level[1]);
          if (price === null || qty === null) return null;
          return [price, qty] as [number, number];
        })
        .filter((level): level is [number, number] => level !== null);
    };
    return {
      bids: parseLevels(row.bids),
      asks: parseLevels(row.asks),
      ts: pickNumber(row, ["ts", "timestamp", "time", "t", "uTime"]),
      raw
    };
  }

  async getTrades(symbol: string, limit = 60) {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(symbol);
    const raw = await this.adapter.marketApi.getTrades(exchangeSymbol, limit, this.adapter.productType as any);
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((entry) => {
      const row = toRecord(entry);
      return {
        symbol: normalizeCanonicalSymbol(symbol),
        price: pickNumber(row, ["price", "px", "fillPrice", "p"]),
        qty: pickNumber(row, ["size", "qty", "q", "fillSize", "sz", "amount", "v"]),
        side: row?.side ? String(row.side).toLowerCase() : row?.S ? String(row.S).toLowerCase() : null,
        ts: pickNumber(row, ["ts", "timestamp", "cTime", "time", "t", "T"]),
        raw: entry
      };
    });
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    try {
      const ticker = await this.getTicker(symbol);
      const direct = ticker.mark ?? ticker.last;
      if (Number.isFinite(Number(direct)) && Number(direct) > 0) {
        return Number(direct);
      }
    } catch {
      // fallback below
    }
    try {
      const candles = await this.getCandles({
        symbol,
        granularity: "1m",
        limit: 3
      });
      if (!Array.isArray(candles)) return null;
      const rows = candles.slice().reverse();
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const close = toNumber(row[4]);
        if (close !== null && close > 0) return close;
      }
      return null;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}

class BinanceUsdMPerpClient implements PerpMarketDataClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
  }

  private async fetchJson(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const search = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        search.set(key, String(value));
      }
    }
    const url = `${this.baseUrl}${path}${search.size > 0 ? `?${search.toString()}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if (!response.ok) {
        throw new ManualTradingError(
          `binance_perp_market_data_http_${response.status}`,
          response.status >= 500 ? 502 : 400,
          "binance_perp_market_data_failed"
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof ManualTradingError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ManualTradingError(
          "binance_perp_market_data_timeout",
          504,
          "binance_perp_market_data_timeout"
        );
      }
      throw new ManualTradingError(
        "binance_perp_market_data_network_error",
        502,
        "binance_perp_market_data_network_error"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async listSymbols(): Promise<PerpSymbolItem[]> {
    const payload = await this.fetchJson("/fapi/v1/exchangeInfo");
    const record = toRecord(payload);
    const symbols = Array.isArray(record?.symbols) ? record?.symbols : [];
    return symbols
      .map((entry) => {
        const row = toRecord(entry);
        const symbol = normalizeCanonicalSymbol(String(row?.symbol ?? ""));
        const contractType = String(row?.contractType ?? "").toUpperCase();
        const status = String(row?.status ?? "");
        const quoteAsset = row?.quoteAsset ? String(row.quoteAsset).toUpperCase() : null;
        const baseAsset = row?.baseAsset ? String(row.baseAsset).toUpperCase() : null;
        const filters = Array.isArray(row?.filters) ? row.filters : [];
        let tickSize: number | null = null;
        let stepSize: number | null = null;
        let minQty: number | null = null;
        let maxQty: number | null = null;
        for (const filterRaw of filters) {
          const filter = toRecord(filterRaw);
          const filterType = String(filter?.filterType ?? "");
          if (filterType === "PRICE_FILTER") {
            tickSize = toNumber(filter?.tickSize);
          } else if (filterType === "LOT_SIZE" || filterType === "MARKET_LOT_SIZE") {
            stepSize = toNumber(filter?.stepSize) ?? stepSize;
            minQty = toNumber(filter?.minQty) ?? minQty;
            maxQty = toNumber(filter?.maxQty) ?? maxQty;
          }
        }
        return {
          symbol,
          exchangeSymbol: symbol,
          status,
          tradable: status.toUpperCase() === "TRADING",
          tickSize,
          stepSize,
          minQty,
          maxQty,
          quoteAsset,
          baseAsset,
          contractType
        };
      })
      .filter((row) => row.symbol.length > 0 && row.contractType === "PERPETUAL")
      .map(({ contractType: _ignored, ...row }) => row)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getCandles(params: {
    symbol: string;
    timeframe?: string;
    granularity?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown> {
    const symbol = normalizeCanonicalSymbol(params.symbol);
    const interval = toBinanceInterval(params.granularity ?? params.timeframe);
    const payload = await this.fetchJson("/fapi/v1/klines", {
      symbol,
      interval,
      limit: Math.max(20, Math.min(1000, Math.trunc(params.limit ?? 500))),
      startTime: params.startTime,
      endTime: params.endTime
    });
    return Array.isArray(payload) ? payload : [];
  }

  async getTicker(symbol: string) {
    const normalized = normalizeCanonicalSymbol(symbol);
    const raw = await this.fetchJson("/fapi/v1/ticker/bookTicker", {
      symbol: normalized
    });
    const row = toRecord(raw);
    const bid = toNumber(row?.bidPrice ?? row?.bid);
    const ask = toNumber(row?.askPrice ?? row?.ask);
    const last = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    return {
      symbol: normalized,
      last,
      mark: last,
      bid,
      ask,
      ts: Date.now(),
      raw
    };
  }

  async getDepth(symbol: string, limit = 50) {
    const normalized = normalizeCanonicalSymbol(symbol);
    const raw = await this.fetchJson("/fapi/v1/depth", {
      symbol: normalized,
      limit: Math.max(5, Math.min(200, Math.trunc(limit)))
    });
    const row = toRecord(raw);
    const parseLevels = (value: unknown): Array<[number, number]> => {
      if (!Array.isArray(value)) return [];
      return value
        .map((level) => {
          if (!Array.isArray(level)) return null;
          const price = toNumber(level[0]);
          const qty = toNumber(level[1]);
          if (price === null || qty === null) return null;
          return [price, qty] as [number, number];
        })
        .filter((level): level is [number, number] => level !== null);
    };
    return {
      bids: parseLevels(row?.bids),
      asks: parseLevels(row?.asks),
      ts: toNumber(row?.E ?? row?.T ?? row?.lastUpdateId ?? Date.now()),
      raw
    };
  }

  async getTrades(symbol: string, limit = 60) {
    const normalized = normalizeCanonicalSymbol(symbol);
    const raw = await this.fetchJson("/fapi/v1/trades", {
      symbol: normalized,
      limit: Math.max(1, Math.min(1000, Math.trunc(limit)))
    });
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((entry) => {
      const row = toRecord(entry);
      const isBuyerMaker = Boolean(row?.isBuyerMaker ?? row?.m);
      return {
        symbol: normalized,
        price: toNumber(row?.price ?? row?.p),
        qty: toNumber(row?.qty ?? row?.q),
        side: isBuyerMaker ? "sell" : "buy",
        ts: toNumber(row?.time ?? row?.T),
        raw: entry
      };
    });
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const normalized = normalizeCanonicalSymbol(symbol);
    try {
      const raw = await this.fetchJson("/fapi/v1/ticker/price", { symbol: normalized });
      const row = toRecord(raw);
      const direct = toNumber(row?.price);
      if (direct !== null && direct > 0) return direct;
    } catch {
      // Fallback below.
    }
    const ticker = await this.getTicker(normalized);
    return Number.isFinite(Number(ticker.last)) && Number(ticker.last) > 0 ? Number(ticker.last) : null;
  }

  async close(): Promise<void> {
    // public REST client has no persistent resources
  }
}

export function createPerpMarketDataClient(account: TradingAccount): PerpMarketDataClient {
  const exchange = String(account.exchange ?? "").trim().toLowerCase();
  if (exchange === "binance") {
    return new BinanceUsdMPerpClient();
  }
  return new FuturesAdapterPerpMarketDataClient(createFuturesAdapter(account));
}
