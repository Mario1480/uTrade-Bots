import { computeIndicators } from "../../market/indicators.js";
import { computeAdvancedIndicators } from "../../market/indicators/advancedIndicators.js";
import type { Candle, Timeframe } from "../../market/timeframe.js";

export type BinanceMarketType = "spot" | "perp";

export type OhlcvRow = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const DEFAULT_SPOT_BASE_URL = "https://api.binance.com";
const DEFAULT_PERP_BASE_URL = "https://fapi.binance.com";

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function resolveBinanceBaseUrl(marketType: BinanceMarketType): string {
  if (marketType === "spot") {
    return (process.env.AI_BINANCE_SPOT_BASE_URL ?? DEFAULT_SPOT_BASE_URL).trim();
  }
  return (process.env.AI_BINANCE_PERP_BASE_URL ?? DEFAULT_PERP_BASE_URL).trim();
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const timer = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: timer.signal
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      throw new Error(`binance_http_${response.status}:${String(text).slice(0, 240)}`);
    }

    return payload;
  } finally {
    timer.clear();
  }
}

function parseKlinesPayload(payload: unknown): OhlcvRow[] {
  if (!Array.isArray(payload)) return [];
  const out: OhlcvRow[] = [];
  for (const row of payload) {
    if (!Array.isArray(row)) continue;
    const ts = toFiniteNumber(row[0]);
    const open = toFiniteNumber(row[1]);
    const high = toFiniteNumber(row[2]);
    const low = toFiniteNumber(row[3]);
    const close = toFiniteNumber(row[4]);
    const volume = toFiniteNumber(row[5]);
    if (
      ts === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue;
    }
    out.push({
      ts: Math.trunc(ts),
      open,
      high,
      low,
      close,
      volume
    });
  }
  return out;
}

function parseTickerPayload(symbol: string, payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const bid = toFiniteNumber(record.bidPrice ?? record.bid);
  const ask = toFiniteNumber(record.askPrice ?? record.ask);
  const last = toFiniteNumber(record.lastPrice ?? record.price ?? record.last);
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  return {
    symbol,
    bid,
    ask,
    mid,
    last,
    ts: Date.now()
  };
}

function parseOrderbookPayload(symbol: string, payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const parseLevels = (value: unknown) => {
    if (!Array.isArray(value)) return [] as Array<{ price: number; qty: number }>;
    const out: Array<{ price: number; qty: number }> = [];
    for (const row of value) {
      if (!Array.isArray(row)) continue;
      const price = toFiniteNumber(row[0]);
      const qty = toFiniteNumber(row[1]);
      if (price === null || qty === null) continue;
      out.push({ price, qty });
    }
    return out;
  };

  return {
    symbol,
    bids: parseLevels(record.bids),
    asks: parseLevels(record.asks),
    ts: toFiniteNumber(record.E ?? record.T ?? record.lastUpdateId ?? Date.now())
  };
}

function rowsToCandles(rows: OhlcvRow[]): Candle[] {
  return rows.map((row) => ({
    ts: row.ts,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume
  }));
}

function normalizeIndicatorSelection(value: string[] | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const out = new Set<string>();
  for (const raw of value) {
    const normalized = String(raw ?? "").trim().toLowerCase();
    if (!normalized) continue;
    out.add(normalized);
  }
  return [...out];
}

function pickSelectedIndicators(
  selection: string[],
  indicators: Record<string, unknown>,
  advancedIndicators: Record<string, unknown>
): Record<string, unknown> {
  if (selection.length === 0) {
    return {
      indicators,
      advancedIndicators
    };
  }

  const out: Record<string, unknown> = {};
  const include = (key: string, value: unknown) => {
    if (selection.includes(key)) {
      out[key] = value;
    }
  };

  include("rsi", indicators.rsi_14);
  include("macd", indicators.macd);
  include("bollinger", indicators.bb);
  include("vwap", indicators.vwap);
  include("adx", indicators.adx);
  include("stochrsi", indicators.stochrsi);
  include("volume", indicators.volume);
  include("fvg", indicators.fvg);
  include("atr_pct", indicators.atr_pct);
  include("vumanchu", indicators.vumanchu);
  include("breakerblocks", indicators.breakerBlocks);
  include("superorderblockfvgbos", indicators.superOrderBlockFvgBos);

  include("emas", advancedIndicators.emas);
  include("cloud", advancedIndicators.cloud);
  include("levels", advancedIndicators.levels);
  include("ranges", advancedIndicators.ranges);
  include("sessions", advancedIndicators.sessions);
  include("pvsra", advancedIndicators.pvsra);
  include("smc", advancedIndicators.smartMoneyConcepts);
  include("liquiditysweeps", advancedIndicators.liquiditySweeps);

  return out;
}

export async function getBinanceOhlcv(input: {
  symbol: string;
  interval: Timeframe;
  limit: number;
  marketType: BinanceMarketType;
  timeoutMs: number;
}) {
  const symbol = normalizeSymbol(input.symbol);
  const baseUrl = resolveBinanceBaseUrl(input.marketType);
  const path = input.marketType === "spot" ? "/api/v3/klines" : "/fapi/v1/klines";
  const params = new URLSearchParams({
    symbol,
    interval: input.interval,
    limit: String(input.limit)
  });
  const payload = await fetchJson(`${baseUrl}${path}?${params.toString()}`, input.timeoutMs);
  const bars = parseKlinesPayload(payload);

  return {
    symbol,
    interval: input.interval,
    marketType: input.marketType,
    count: bars.length,
    bars
  };
}

export async function getBinanceTicker(input: {
  symbol: string;
  marketType: BinanceMarketType;
  timeoutMs: number;
}) {
  const symbol = normalizeSymbol(input.symbol);
  const baseUrl = resolveBinanceBaseUrl(input.marketType);
  const path = input.marketType === "spot" ? "/api/v3/ticker/bookTicker" : "/fapi/v1/ticker/bookTicker";
  const params = new URLSearchParams({ symbol });
  const payload = await fetchJson(`${baseUrl}${path}?${params.toString()}`, input.timeoutMs);

  return parseTickerPayload(symbol, payload);
}

export async function getBinanceOrderbook(input: {
  symbol: string;
  limit: number;
  marketType: BinanceMarketType;
  timeoutMs: number;
}) {
  const symbol = normalizeSymbol(input.symbol);
  const baseUrl = resolveBinanceBaseUrl(input.marketType);
  const path = input.marketType === "spot" ? "/api/v3/depth" : "/fapi/v1/depth";
  const params = new URLSearchParams({
    symbol,
    limit: String(input.limit)
  });
  const payload = await fetchJson(`${baseUrl}${path}?${params.toString()}`, input.timeoutMs);

  return parseOrderbookPayload(symbol, payload);
}

export async function getBinanceIndicators(input: {
  symbol: string;
  interval: Timeframe;
  lookback: number;
  indicators?: string[];
  marketType: BinanceMarketType;
  timeoutMs: number;
}) {
  const ohlcv = await getBinanceOhlcv({
    symbol: input.symbol,
    interval: input.interval,
    limit: input.lookback,
    marketType: input.marketType,
    timeoutMs: input.timeoutMs
  });

  const candles = rowsToCandles(ohlcv.bars);
  const indicatorsSnapshot = computeIndicators(candles, input.interval, {
    exchange: "binance",
    symbol: ohlcv.symbol,
    marketType: input.marketType,
    logVwapMetrics: false
  }) as Record<string, unknown>;

  const advancedIndicatorsSnapshot = computeAdvancedIndicators(candles, input.interval, {}) as Record<string, unknown>;

  const selection = normalizeIndicatorSelection(input.indicators);
  return {
    symbol: ohlcv.symbol,
    interval: input.interval,
    marketType: input.marketType,
    lookback: input.lookback,
    count: candles.length,
    data: pickSelectedIndicators(selection, indicatorsSnapshot, advancedIndicatorsSnapshot)
  };
}
