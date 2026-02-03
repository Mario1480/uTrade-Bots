import crypto from "node:crypto";
import type { Balance, MidPrice, Order, Quote, MyTrade } from "@mm/core";
import { nowMs } from "@mm/core";
import { toExchangeSymbol, fromExchangeSymbol } from "../symbols.js";
import { checkMins, normalizePrice, normalizeQty, type SymbolMeta } from "./p2b.meta.js";

type P2BResponse<T> = {
  success?: boolean;
  result?: T;
  error?: string;
  message?: string;
};

type RequestOpts = {
  method: "GET" | "POST";
  path: string;
  params?: Record<string, string | number | undefined>;
  body?: Record<string, string | number | undefined>;
  auth?: "NONE" | "SIGNED";
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withJitter(ms: number) {
  return Math.floor(ms * (0.8 + Math.random() * 0.4));
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  entries.sort(([a], [b]) => a.localeCompare(b));
  const query = entries.map(([k, v]) => `${k}=${v}`).join("&");
  return { entries, query };
}

function parseNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toMs(ts: number): number {
  if (!Number.isFinite(ts)) return Date.now();
  return ts < 1e12 ? ts * 1000 : ts;
}

function splitCanonical(symbol: string) {
  const parts = String(symbol).toUpperCase().split(/[/_-]/);
  return { base: parts[0] || "", quote: parts[1] || "" };
}

export function buildP2BSignature(payloadBase64: string, secret: string) {
  return crypto.createHmac("sha512", secret).update(payloadBase64).digest("hex");
}

export class P2BRestClient {
  private static lastRequestAt = 0;
  private static readonly minGapMs = 120;
  private static queue: Promise<unknown> = Promise.resolve();
  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();
  private readonly metaTtlMs = 10 * 60_000;
  private readonly symbolCache = new Map<string, { symbols: any[]; ts: number }>();
  private readonly symbolCacheTtlMs = 15 * 60_000;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private static async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = P2BRestClient.queue.then(fn, fn);
    P2BRestClient.queue = run.catch(() => undefined);
    return run;
  }

  private async parseJson(res: Response, label: string): Promise<P2BResponse<any>> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as P2BResponse<any>;
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`[p2b] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private async request<T>(opts: RequestOpts): Promise<P2BResponse<T>> {
    return P2BRestClient.enqueue(async () => {
      const { method, path, params = {}, body = {}, auth = "NONE" } = opts;
      const { entries, query } = buildQuery(params);
      const url = new URL(path, this.baseUrl);
      if (entries.length > 0) {
        const sp = new URLSearchParams();
        for (const [k, v] of entries) {
          sp.set(k, String(v));
        }
        url.search = sp.toString();
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; uLiquidBot/1.0)"
      };

      let payloadStr = "";
      if (auth === "SIGNED") {
        if (!this.apiKey || !this.apiSecret) {
          throw new Error("[p2b] missing api credentials");
        }
        const payload = { request: path, nonce: String(nowMs()), ...body };
        payloadStr = JSON.stringify(payload);
        const payloadBase64 = Buffer.from(payloadStr).toString("base64");
        headers["X-TXC-APIKEY"] = this.apiKey;
        headers["X-TXC-PAYLOAD"] = payloadBase64;
        headers["X-TXC-SIGNATURE"] = buildP2BSignature(payloadBase64, this.apiSecret);
      } else {
        payloadStr = Object.keys(body).length ? JSON.stringify(body) : "";
      }

      const maxRetries = 2;
      let attempt = 0;
      while (true) {
        const now = Date.now();
        const gap = now - P2BRestClient.lastRequestAt;
        if (gap < P2BRestClient.minGapMs) {
          await sleep(P2BRestClient.minGapMs - gap);
        }
        P2BRestClient.lastRequestAt = Date.now();

        const res = await fetch(url, {
          method,
          headers,
          body: method === "POST" ? payloadStr : undefined
        });

        if (res.status === 404) {
          throw new Error("[p2b] BASE_URL_OR_PATH_INVALID");
        }

        if (res.status === 429) {
          if (path === "/api/v2/public/markets") {
            const cached = this.symbolCache.get("markets");
            if (cached && Date.now() - cached.ts < this.symbolCacheTtlMs) {
              return { success: true, result: cached.symbols } as P2BResponse<T>;
            }
          }
        }

        const json = await this.parseJson(res, `${method} ${path}${query ? `?${query}` : ""}`);
        if (!res.ok || json?.success === false) {
          const msg = json?.message || json?.error || res.statusText || "request_failed";
          const err = new Error(`P2B API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt));
            await sleep(withJitter(backoff));
            attempt += 1;
            continue;
          }
          throw err;
        }
        return json as P2BResponse<T>;
      }
    });
  }

  async listSymbols(): Promise<string[]> {
    const list = await this.listMarketsRaw();
    return list
      .map((m) => String(m.name || m.market || m.symbol || ""))
      .filter((s) => s.length > 0);
  }

  private async listMarketsRaw(): Promise<any[]> {
    const cached = this.symbolCache.get("markets");
    if (cached && Date.now() - cached.ts < this.symbolCacheTtlMs) {
      return cached.symbols;
    }
    const json = await this.request<any[]>({ method: "GET", path: "/api/v2/public/markets" });
    const result = json?.result ?? json;
    let list: any[] = [];
    if (Array.isArray(result)) {
      list = result;
    } else if (result && typeof result === "object") {
      list = Object.entries(result).map(([name, row]) => ({
        name,
        ...(row as Record<string, any>)
      }));
    }
    this.symbolCache.set("markets", { symbols: list, ts: Date.now() });
    return list;
  }

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const s = toExchangeSymbol("p2b", symbol);
    const cached = this.metaCache.get(s);
    if (cached && Date.now() - cached.ts < this.metaTtlMs) return cached.meta;

    const list = await this.listMarketsRaw();
    const { base, quote } = splitCanonical(symbol);
    const row = list.find((x) => {
      const name = String(x.name || x.market || x.symbol || "");
      if (name && name.toUpperCase() === s.toUpperCase()) return true;
      const stock = String(
        x.stock || x.base || x.baseCurrency || x.base_currency || x.baseAsset || ""
      ).toUpperCase();
      const money = String(
        x.money || x.quote || x.quoteCurrency || x.quote_currency || x.quoteAsset || ""
      ).toUpperCase();
      return stock === base && money === quote;
    });
    if (!row) return undefined;

    const meta: SymbolMeta = {
      symbol: s,
      pricePrecision: Number(row?.precision?.money ?? row?.price_precision) || undefined,
      qtyPrecision: Number(row?.precision?.stock ?? row?.amount_precision) || undefined,
      priceStep: parseNumber(row?.limits?.tick_size),
      qtyStep: parseNumber(row?.limits?.step_size),
      minQty: parseNumber(row?.limits?.min_amount ?? row?.min_amount),
      minNotional: parseNumber(row?.limits?.min_total ?? row?.min_total)
    };
    this.metaCache.set(s, { meta, ts: Date.now() });
    return meta;
  }

  private async resolveMarketSymbol(
    symbol: string
  ): Promise<{ symbol: string; known: boolean }> {
    const fallback = toExchangeSymbol("p2b", symbol);
    const { base, quote } = splitCanonical(symbol);
    const list = await this.listMarketsRaw();
    const row = list.find((x) => {
      const name = String(x.name || x.market || x.symbol || "");
      if (name && name.toUpperCase() === fallback.toUpperCase()) return true;
      const stock = String(
        x.stock || x.base || x.baseCurrency || x.base_currency || x.baseAsset || ""
      ).toUpperCase();
      const money = String(
        x.money || x.quote || x.quoteCurrency || x.quote_currency || x.quoteAsset || ""
      ).toUpperCase();
      return stock === base && money === quote;
    });
    const resolved = row?.name || row?.market || row?.symbol;
    if (resolved) return { symbol: String(resolved), known: true };
    return { symbol: fallback, known: false };
  }

  async getTicker(symbol: string): Promise<MidPrice> {
    const { symbol: exSymbol } = await this.resolveMarketSymbol(symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v2/public/ticker",
      params: { market: exSymbol }
    });
    const row = json?.result;
    const bid = parseNumber(row?.bid);
    const ask = parseNumber(row?.ask);
    const last = parseNumber(row?.last);
    const mid = bid && ask ? (bid + ask) / 2 : last || 0;
    return { mid, bid, ask, last, ts: Date.now() };
  }

  async getBalances(): Promise<Balance[]> {
    const json = await this.request<any>({ method: "POST", path: "/api/v2/account/balances", auth: "SIGNED" });
    const result = json?.result ?? json;
    if (Array.isArray(result)) {
      return result
        .map((b: any) => ({
          asset: String(b.currency || b.asset || "").toUpperCase(),
          free: parseNumber(b.available),
          locked: parseNumber(b.freeze)
        }))
        .filter((b: Balance) => b.asset);
    }

    if (result && typeof result === "object") {
      return Object.entries(result).map(([asset, b]: any) => ({
        asset: String(asset).toUpperCase(),
        free: parseNumber(b?.available),
        locked: parseNumber(b?.freeze)
      }));
    }

    return [];
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const { symbol: exSymbol, known } = await this.resolveMarketSymbol(symbol);
    let rows: any[] = [];
    try {
      const json = await this.request<any>({
        method: "POST",
        path: "/api/v2/orders",
        auth: "SIGNED",
        body: known ? { market: exSymbol } : {}
      });
      rows = this.extractOrderRows(json, exSymbol);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (!msg.includes("Unknown market")) {
        throw err;
      }
    }

    if (rows.length === 0) {
      const jsonAll = await this.request<any>({
        method: "POST",
        path: "/api/v2/orders",
        auth: "SIGNED",
        body: {}
      });
      rows = this.extractOrderRows(jsonAll, exSymbol);
    }

    if (rows.length > 0) {
      const canon = fromExchangeSymbol("p2b", exSymbol).toUpperCase();
      const exUpper = exSymbol.toUpperCase();
      rows = rows.filter((row) => {
        const m = String(row.market ?? "").toUpperCase();
        if (!m) return true;
        if (m === exUpper) return true;
        return fromExchangeSymbol("p2b", m).toUpperCase() === canon;
      });
    }
    return rows.map((row: any) => ({
      id: String(row.id ?? row.orderId ?? row.order_id ?? row.trade_id ?? ""),
      symbol: fromExchangeSymbol("p2b", row.market || exSymbol),
      side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
      price: parseNumber(row.price),
      qty: parseNumber(row.left ?? row.amount),
      status: "open",
      clientOrderId: undefined
    }));
  }

  private extractOrderRows(json: any, exSymbol: string): any[] {
    const result = json?.result ?? json;
    if (Array.isArray(result?.result)) return result.result;
    if (Array.isArray(result)) return result;
    if (result && typeof result === "object") {
      const byMarket =
        (result as any)[exSymbol] ||
        (result as any)[exSymbol.toUpperCase()] ||
        (result as any)[exSymbol.toLowerCase()];
      if (Array.isArray(byMarket)) return byMarket;
    }
    return [];
  }

  async placeOrder(q: Quote): Promise<Order> {
    const { symbol: exSymbol } = await this.resolveMarketSymbol(q.symbol);
    if (q.type && q.type !== "limit") {
      throw new Error("[p2b] market orders not supported");
    }
    const meta = await this.getSymbolMeta(q.symbol);
    const price = normalizePrice(q.price ?? 0, meta);
    const qty = normalizeQty(q.qty ?? 0, meta);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("[p2b] price normalized to zero");
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("[p2b] qty normalized to zero");
    }
    const minCheck = checkMins({ price, qty, meta });
    if (!minCheck.ok) {
      throw new Error(`[p2b] min check failed: ${minCheck.reason}`);
    }
    const json = await this.request<any>({
      method: "POST",
      path: "/api/v2/order/new",
      auth: "SIGNED",
      body: {
        market: exSymbol,
        side: q.side,
        amount: String(qty),
        price: String(price)
      }
    });
    const row = json?.result ?? {};
    const left = parseNumber(row.left ?? qty);
    return {
      id: String(row.id ?? row.orderId ?? row.order_id ?? ""),
      symbol: q.symbol,
      side: q.side,
      price,
      qty,
      status: left > 0 ? "open" : "filled",
      clientOrderId: undefined
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const { symbol: exSymbol } = await this.resolveMarketSymbol(symbol);
    await this.request({
      method: "POST",
      path: "/api/v2/order/cancel",
      auth: "SIGNED",
      body: { market: exSymbol, orderId }
    });
  }

  async cancelAll(symbol?: string): Promise<void> {
    if (!symbol) return;
    const orders = await this.getOpenOrders(symbol);
    for (const order of orders) {
      await this.cancelOrder(symbol, order.id);
    }
  }

  async getMyTrades(
    symbol: string,
    params?: { startTimeMs?: number; limit?: number }
  ): Promise<MyTrade[]> {
    const { symbol: exSymbol } = await this.resolveMarketSymbol(symbol);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 100));
    const json = await this.request<any>({
      method: "POST",
      path: "/api/v2/account/executed_history",
      auth: "SIGNED",
      body: { market: exSymbol, limit }
    });
    const result = json?.result ?? json;
    let rows: any[] = [];
    if (Array.isArray(result?.result)) {
      rows = result.result;
    } else if (Array.isArray(result)) {
      rows = result;
    } else if (result && typeof result === "object") {
      const byMarket =
        (result as any)[exSymbol] ||
        (result as any)[exSymbol.toUpperCase()] ||
        (result as any)[exSymbol.toLowerCase()];
      if (Array.isArray(byMarket)) rows = byMarket;
    }
    return rows
      .map((row: any) => {
        const price = parseNumber(row.price);
        const qty = parseNumber(row.amount);
        const notional = parseNumber(row.deal) || price * qty;
        const ts = toMs(parseNumber(row.created_at ?? row.time));
        if (!ts || !qty) return null;
        return {
          id: String(row.id ?? `${row.order_id ?? row.orderId ?? "trade"}-${ts}`),
          orderId: row.order_id ? String(row.order_id) : row.orderId ? String(row.orderId) : undefined,
          clientOrderId: undefined,
          side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
          price,
          qty,
          notional,
          timestamp: ts
        } as MyTrade;
      })
      .filter(Boolean) as MyTrade[];
  }
}
