import crypto from "node:crypto";
import type { Balance, MidPrice, MyTrade, Order, Quote } from "@mm/core";
import { nowMs, normalizeSymbol } from "@mm/core";
import { fromExchangeSymbol, toExchangeSymbol } from "../symbols.js";
import { checkMins, normalizePrice, normalizeQty, type SymbolMeta } from "./mexc.meta.js";

type RequestOpts = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  params?: Record<string, string | number | undefined>;
  auth?: "NONE" | "SIGNED";
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms: number) {
  return Math.floor(ms * (0.8 + Math.random() * 0.4));
}

function parseNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  entries.sort(([a], [b]) => a.localeCompare(b));
  const pairs: [string, string][] = entries.map(([k, v]) => [k, String(v)]);
  return new URLSearchParams(pairs).toString();
}

function mapOrderStatus(status: string): Order["status"] {
  const s = String(status || "").toUpperCase();
  if (s === "NEW" || s === "PARTIALLY_FILLED") return "open";
  if (s === "FILLED") return "filled";
  if (s === "CANCELED" || s === "PENDING_CANCEL") return "canceled";
  if (s === "REJECTED" || s === "EXPIRED") return "rejected";
  return "unknown";
}

function sideFromValue(value: unknown): "buy" | "sell" {
  return String(value || "").toUpperCase() === "SELL" ? "sell" : "buy";
}

function sanitizeMexcClientOrderId(input?: string): string | undefined {
  if (!input) return undefined;
  const cleaned = String(input).replace(/[^0-9a-zA-Z_-]/g, "");
  if (!cleaned) return undefined;
  if (cleaned.length <= 32) return cleaned;
  const hash = crypto.createHash("sha256").update(cleaned).digest("hex").slice(0, 8);
  // MEXC allows max 32 chars; keep prefix (mm-/vol/man_) and add hash suffix for uniqueness.
  return `${cleaned.slice(0, 23)}_${hash}`;
}

export function buildMexcSignature(query: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

export class MexcRestClient {
  private static queue: Promise<unknown> = Promise.resolve();
  private static lastRequestAt = 0;
  private static readonly minGapMs = Number(process.env.MEXC_MIN_GAP_MS || "120");
  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();
  private readonly metaTtlMs = 10 * 60_000;
  private readonly symbolCache = new Map<string, { symbols: string[]; ts: number }>();
  private readonly symbolCacheTtlMs = 15 * 60_000;
  private readonly recvWindow = Number(process.env.MEXC_RECV_WINDOW || "5000");

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private static async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = MexcRestClient.queue.then(fn, fn);
    MexcRestClient.queue = run.catch(() => undefined);
    return run;
  }

  private async parseJson(res: Response, label: string): Promise<any> {
    const text = await res.text();
    if (!text) return {};
    if (text.includes("Just a moment") || text.includes("cf-browser-verification")) {
      throw new Error("IP_NOT_WHITELISTED_OR_WAF_BLOCK");
    }
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`[mexc] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private async request<T>(opts: RequestOpts): Promise<T> {
    return MexcRestClient.enqueue(async () => {
      const { method, path, params = {}, auth = "NONE" } = opts;
      const url = new URL(path, this.baseUrl);

      let query = buildQuery(params);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json"
      };

      if (auth === "SIGNED") {
        if (!this.apiKey || !this.apiSecret) {
          throw new Error("[mexc] missing api credentials");
        }
        const signedParams: Record<string, string | number> = {
          ...params,
          timestamp: nowMs(),
          recvWindow: this.recvWindow
        };
        query = buildQuery(signedParams);
        const signature = buildMexcSignature(query, this.apiSecret);
        query = `${query}&signature=${signature}`;
        headers["X-MEXC-APIKEY"] = this.apiKey;
      }

      if (query) url.search = query;

      const maxRetries = 2;
      let attempt = 0;
      while (true) {
        const now = Date.now();
        const gap = now - MexcRestClient.lastRequestAt;
        if (gap < MexcRestClient.minGapMs) {
          await sleep(MexcRestClient.minGapMs - gap);
        }
        MexcRestClient.lastRequestAt = Date.now();

        const res = await fetch(url, {
          method,
          headers,
          body: undefined
        });

        if (res.status === 404) {
          throw new Error("BASE_URL_OR_PATH_INVALID");
        }

        const json = await this.parseJson(res, `${method} ${path}`);
        const hasApiError = json && typeof json === "object" && (json.code !== undefined || json.msg !== undefined);
        const code = hasApiError ? Number(json.code) : 0;
        if (!res.ok || (hasApiError && Number.isFinite(code) && code !== 0)) {
          const msg = json?.msg || json?.message || res.statusText || "request_failed";
          const err = new Error(`MEXC API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt));
            await sleep(withJitter(backoff));
            attempt += 1;
            continue;
          }
          throw err;
        }

        return json as T;
      }
    });
  }

  private async getExchangeInfo(): Promise<any> {
    return this.request<any>({ method: "GET", path: "/api/v3/exchangeInfo", auth: "NONE" });
  }

  private parseSymbolMeta(row: any): SymbolMeta {
    const filters = Array.isArray(row?.filters) ? row.filters : [];
    const priceFilter = filters.find((f: any) => f?.filterType === "PRICE_FILTER") ?? {};
    const lotSize = filters.find((f: any) => f?.filterType === "LOT_SIZE") ?? {};
    const minNotionalFilter =
      filters.find((f: any) => f?.filterType === "MIN_NOTIONAL") ??
      filters.find((f: any) => f?.filterType === "NOTIONAL") ??
      {};

    return {
      symbol: String(row?.symbol || ""),
      priceStep: parseNumber(priceFilter?.tickSize) || undefined,
      qtyStep: parseNumber(lotSize?.stepSize) || undefined,
      minQty: parseNumber(lotSize?.minQty) || undefined,
      minNotional:
        parseNumber(minNotionalFilter?.minNotional) || parseNumber(minNotionalFilter?.notional) || undefined,
      pricePrecision: Number(row?.quotePrecision ?? row?.baseAssetPrecision ?? 8),
      qtyPrecision: Number(row?.baseAssetPrecision ?? 8)
    };
  }

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const exSymbol = toExchangeSymbol("mexc", symbol);
    const cached = this.metaCache.get(exSymbol);
    if (cached && Date.now() - cached.ts < this.metaTtlMs) {
      return cached.meta;
    }

    const info = await this.getExchangeInfo();
    const list = Array.isArray(info?.symbols) ? info.symbols : [];
    const row = list.find((x: any) => String(x?.symbol || "").toUpperCase() === exSymbol.toUpperCase());
    if (!row) return undefined;
    const meta = this.parseSymbolMeta(row);
    this.metaCache.set(exSymbol, { meta, ts: Date.now() });
    return meta;
  }

  async listSymbols(): Promise<string[]> {
    const cached = this.symbolCache.get("symbols");
    if (cached && Date.now() - cached.ts < this.symbolCacheTtlMs) {
      return cached.symbols;
    }

    const info = await this.getExchangeInfo();
    const list = Array.isArray(info?.symbols) ? info.symbols : [];
    const symbols = list
      .filter((x: any) => {
        const statusRaw = String(x?.status ?? "").trim();
        if (!statusRaw) return true;
        const status = statusRaw.toUpperCase();
        // MEXC commonly returns status "1" for tradable spot symbols.
        return status === "TRADING" || status === "ENABLED" || status === "1";
      })
      .map((x: any) => {
        const base = String(x?.baseAsset || "").trim();
        const quote = String(x?.quoteAsset || "").trim();
        if (base && quote) {
          try {
            return normalizeSymbol(`${base}/${quote}`);
          } catch {
            return "";
          }
        }
        try {
          return fromExchangeSymbol("mexc", String(x.symbol || ""));
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    this.symbolCache.set("symbols", { symbols, ts: Date.now() });
    return symbols;
  }

  async getTicker(symbol: string): Promise<MidPrice> {
    const exSymbol = toExchangeSymbol("mexc", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v3/ticker/bookTicker",
      params: { symbol: exSymbol },
      auth: "NONE"
    });

    const bid = parseNumber(json?.bidPrice);
    const ask = parseNumber(json?.askPrice);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;

    return {
      mid,
      bid,
      ask,
      last: mid,
      ts: Date.now()
    };
  }

  async getBalances(): Promise<Balance[]> {
    const json = await this.request<any>({ method: "GET", path: "/api/v3/account", auth: "SIGNED" });
    const list = Array.isArray(json?.balances) ? json.balances : [];
    return list
      .map((b: any) => ({
        asset: String(b?.asset || "").toUpperCase(),
        free: parseNumber(b?.free),
        locked: parseNumber(b?.locked)
      }))
      .filter((b: Balance) => Boolean(b.asset));
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const exSymbol = toExchangeSymbol("mexc", symbol);
    const json = await this.request<any[]>({
      method: "GET",
      path: "/api/v3/openOrders",
      params: { symbol: exSymbol },
      auth: "SIGNED"
    });

    const rows = Array.isArray(json) ? json : [];
    return rows.map((row: any) => {
      const qty = parseNumber(row.origQty);
      const executed = parseNumber(row.executedQty);
      const left = qty > executed ? qty - executed : qty;
      return {
        id: String(row.orderId ?? ""),
        symbol: fromExchangeSymbol("mexc", row.symbol || exSymbol),
        side: sideFromValue(row.side),
        price: parseNumber(row.price),
        qty: left,
        status: mapOrderStatus(String(row.status || "NEW")),
        clientOrderId: row.clientOrderId ? String(row.clientOrderId) : undefined
      } as Order;
    });
  }

  async placeOrder(q: Quote): Promise<Order> {
    const exSymbol = toExchangeSymbol("mexc", q.symbol);
    const meta = await this.getSymbolMeta(q.symbol);

    const params: Record<string, string | number | undefined> = {
      symbol: exSymbol,
      side: q.side.toUpperCase(),
      newClientOrderId: sanitizeMexcClientOrderId(q.clientOrderId)
    };

    let normalizedPrice = 0;
    let normalizedQty = 0;

    if (q.type === "market") {
      params.type = "MARKET";
      if (q.side === "buy" && q.quoteQty && q.quoteQty > 0) {
        params.quoteOrderQty = q.quoteQty;
      } else {
        normalizedQty = normalizeQty(q.qty ?? 0, meta);
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
          throw new Error("[mexc] QTY_NORMALIZED_TO_ZERO");
        }
        params.quantity = normalizedQty;
      }
    } else {
      normalizedPrice = normalizePrice(q.price ?? 0, meta);
      normalizedQty = normalizeQty(q.qty ?? 0, meta);

      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        throw new Error("[mexc] PRICE_NORMALIZED_TO_ZERO");
      }
      if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
        throw new Error("[mexc] QTY_NORMALIZED_TO_ZERO");
      }

      const minCheck = checkMins({ price: normalizedPrice, qty: normalizedQty, meta });
      if (!minCheck.ok) {
        throw new Error(`[mexc] min check failed: ${minCheck.reason}`);
      }

      if (q.postOnly) {
        params.type = "LIMIT_MAKER";
      } else {
        params.type = "LIMIT";
        params.timeInForce = "GTC";
      }
      params.price = normalizedPrice;
      params.quantity = normalizedQty;
    }

    const json = await this.request<any>({ method: "POST", path: "/api/v3/order", params, auth: "SIGNED" });
    return {
      id: String(json?.orderId ?? ""),
      symbol: q.symbol,
      side: q.side,
      price: normalizedPrice || parseNumber(q.price),
      qty: normalizedQty || parseNumber(q.qty),
      status: "open",
      clientOrderId: String(json?.clientOrderId ?? params.newClientOrderId ?? "") || undefined
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const exSymbol = toExchangeSymbol("mexc", symbol);
    await this.request({
      method: "DELETE",
      path: "/api/v3/order",
      params: { symbol: exSymbol, orderId },
      auth: "SIGNED"
    });
  }

  async cancelAll(symbol?: string): Promise<void> {
    if (!symbol) return;
    const exSymbol = toExchangeSymbol("mexc", symbol);
    await this.request({
      method: "DELETE",
      path: "/api/v3/openOrders",
      params: { symbol: exSymbol },
      auth: "SIGNED"
    });
  }

  async getMyTrades(symbol: string, params?: { startTimeMs?: number; limit?: number }): Promise<MyTrade[]> {
    const exSymbol = toExchangeSymbol("mexc", symbol);
    const limit = Math.min(1000, Math.max(1, params?.limit ?? 500));
    const json = await this.request<any[]>({
      method: "GET",
      path: "/api/v3/myTrades",
      params: {
        symbol: exSymbol,
        startTime: params?.startTimeMs,
        limit
      },
      auth: "SIGNED"
    });

    const rows = Array.isArray(json) ? json : [];
    return rows.map((row: any) => {
      const price = parseNumber(row.price);
      const qty = parseNumber(row.qty);
      const notional = parseNumber(row.quoteQty) || price * qty;
      return {
        id: String(row.id ?? `${row.orderId}-${row.time}`),
        orderId: row.orderId !== undefined ? String(row.orderId) : undefined,
        clientOrderId: row.clientOrderId ? String(row.clientOrderId) : undefined,
        side: row.isBuyer === false ? "sell" : "buy",
        price,
        qty,
        notional,
        timestamp: parseNumber(row.time)
      } as MyTrade;
    });
  }
}
