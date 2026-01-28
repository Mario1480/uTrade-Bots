import crypto from "node:crypto";
import type { Balance, MidPrice, Order, Quote, MyTrade } from "@mm/core";
import { nowMs, normalizeSymbol } from "@mm/core";
import { toExchangeSymbol, fromExchangeSymbol } from "../symbols.js";
import {
  checkMins,
  normalizePrice,
  normalizeQty,
  roundDownToPrecision,
  type SymbolMeta
} from "./pionex.meta.js";

type PionexResponse<T> = {
  result: boolean;
  data?: T;
  code?: string | number;
  message?: string;
  timestamp?: number;
};

type RequestOpts = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  params?: Record<string, string | number | undefined>;
  body?: any;
  auth?: "NONE" | "SIGNED";
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withJitter(ms: number) {
  return Math.floor(ms * (0.8 + Math.random() * 0.4));
}

function isHtmlResponse(text: string) {
  return /<html/i.test(text) || /<!DOCTYPE html/i.test(text);
}

function detectWaf(res: Response, text: string) {
  const server = res.headers.get("server") || "";
  if (/cloudflare/i.test(server)) return true;
  if (/just a moment/i.test(text)) return true;
  return false;
}

function sanitizeClientOrderId(input?: string): string | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[^a-zA-Z0-9-]/g, "");
  if (!cleaned) return undefined;
  if (cleaned.length <= 64) return cleaned;
  const hash = crypto.createHash("sha256").update(cleaned).digest("hex").slice(0, 8);
  return `${cleaned.slice(0, 55)}${hash}`;
}

function buildQueryParams(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => {
    if (v === undefined || v === null || v === "") return false;
    if (typeof v === "number" && v === 0) return false;
    return true;
  });
  entries.sort(([a], [b]) => a.localeCompare(b));
  const pairs = entries.map(([k, v]) => `${k}=${v}`);
  return { entries, query: pairs.join("&") };
}

export function buildPionexSignature(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export class PionexRestClient {
  private static lastRequestAt = 0;
  private static readonly minGapMs = 1500;
  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();
  private readonly symbolCache = new Map<string, { symbols: any[]; ts: number }>();
  private readonly symbolCacheTtlMs = 15 * 60_000;
  private static lastSymbolsErrorAt = 0;
  private static lastSymbolsError: Error | null = null;
  private readonly openOrdersCache = new Map<string, { orders: Order[]; ts: number }>();
  private readonly openOrdersTtlMs = 10_000;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private async parseJson(res: Response, label: string): Promise<any> {
    const text = await res.text();
    if (!text) return {};
    if (isHtmlResponse(text)) {
      if (detectWaf(res, text)) {
        throw new Error("[pionex] IP_NOT_WHITELISTED_OR_WAF_BLOCK");
      }
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`[pionex] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`[pionex] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private async request<T>(opts: RequestOpts): Promise<PionexResponse<T>> {
    const { method, path, params = {}, body, auth = "NONE" } = opts;
    const paramsWithTs = { ...params };
    if (auth === "SIGNED") {
      paramsWithTs.timestamp = nowMs();
    }

    const { entries, query } = buildQueryParams(paramsWithTs);
    const pathUrl = query ? `${path}?${query}` : path;
    const bodyStr = body && (method === "POST" || method === "DELETE") ? JSON.stringify(body) : "";
    // Per Pionex auth docs: signature = METHOD + PATH_URL (+ body for POST/DELETE).
    const signPayload = `${method}${pathUrl}${
      bodyStr && (method === "POST" || method === "DELETE") ? bodyStr : ""
    }`;

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

    if (auth === "SIGNED") {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error("[pionex] missing api credentials");
      }
      headers["PIONEX-KEY"] = this.apiKey;
      headers["PIONEX-SIGNATURE"] = buildPionexSignature(signPayload, this.apiSecret);
    }

    const maxRetries = 4;
    let attempt = 0;
    while (true) {
      const now = Date.now();
      const gap = now - PionexRestClient.lastRequestAt;
      if (gap < PionexRestClient.minGapMs) {
        await sleep(PionexRestClient.minGapMs - gap);
      }
      PionexRestClient.lastRequestAt = Date.now();

      const res = await fetch(url, {
        method,
        headers,
        body: method === "POST" || method === "DELETE" ? bodyStr : undefined
      });

      if (res.status === 404) {
        throw new Error("[pionex] BASE_URL_OR_PATH_INVALID");
      }

      const json = await this.parseJson(res, `${method} ${path}`);
      if (!res.ok || json?.result === false) {
        const msg = json?.message || json?.msg || res.statusText || "request_failed";
        const err = new Error(`Pionex API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt));
          await sleep(withJitter(backoff));
          attempt += 1;
          continue;
        }
        throw err;
      }
      return json as PionexResponse<T>;
    }
  }

  async sanityCheck(): Promise<void> {
    await this.request({
      method: "GET",
      path: "/api/v1/common/symbols",
      params: { type: "SPOT" },
      auth: "NONE"
    });
    if (this.apiKey && this.apiSecret) {
      await this.getBalances();
    }
  }

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const s = toExchangeSymbol("pionex", symbol);
    const cached = this.metaCache.get(s);
    if (cached && Date.now() - cached.ts < 10 * 60_000) return cached.meta;

    const list = await this.listSymbolsRaw();
    const row = list.find((x) => String(x.symbol).toUpperCase() === s.toUpperCase());
    if (!row) return undefined;

    const meta: SymbolMeta = {
      symbol: s,
      pricePrecision: Number(row.quotePrecision ?? row.pricePrecision ?? row.price_precision) || undefined,
      qtyPrecision: Number(row.basePrecision ?? row.qtyPrecision ?? row.quantity_precision) || undefined,
      amountPrecision: Number(row.amountPrecision ?? row.amount_precision) || undefined,
      minQty: Number(row.minTradeSize ?? row.minSize ?? row.minQty) || undefined,
      minNotional: Number(row.minAmount ?? row.minNotional ?? row.min_amount) || undefined,
      minAmount: Number(row.minAmount ?? row.min_amount) || undefined,
      minTradeDumping: Number(row.minTradeDumping ?? row.min_trade_dumping) || undefined
    };
    this.metaCache.set(s, { meta, ts: Date.now() });
    return meta;
  }

  private async listSymbolsRaw(): Promise<any[]> {
    if (PionexRestClient.lastSymbolsErrorAt && Date.now() - PionexRestClient.lastSymbolsErrorAt < 60_000) {
      if (PionexRestClient.lastSymbolsError) throw PionexRestClient.lastSymbolsError;
    }
    const cached = this.symbolCache.get("symbols");
    if (cached && Date.now() - cached.ts < this.symbolCacheTtlMs) return cached.symbols;

    let json: any;
    try {
      json = await this.request<any>({
        method: "GET",
        path: "/api/v1/common/symbols",
        params: { type: "SPOT" },
        auth: "NONE"
      });
      PionexRestClient.lastSymbolsErrorAt = 0;
      PionexRestClient.lastSymbolsError = null;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      PionexRestClient.lastSymbolsErrorAt = Date.now();
      PionexRestClient.lastSymbolsError = e;
      throw e;
    }
    const list: any[] = Array.isArray(json?.data?.symbols) ? json.data.symbols : [];
    this.symbolCache.set("symbols", { symbols: list, ts: Date.now() });
    return list;
  }

  async listSymbols(): Promise<string[]> {
    const list = await this.listSymbolsRaw();
    return list
      .filter((s) => {
        const type = String(s?.type ?? s?.symbolType ?? "").toUpperCase();
        const state = String(s?.state ?? s?.status ?? "").toUpperCase();
        if (type && type !== "SPOT") return false;
        if (state && !["ONLINE", "TRADING", "ENABLED", "ACTIVE"].includes(state)) return false;
        return true;
      })
      .map((s) => fromExchangeSymbol("pionex", String(s.symbol)))
      .filter(Boolean);
  }

  // ---------- Public ----------

  async getTicker(symbol: string): Promise<MidPrice> {
    const s = toExchangeSymbol("pionex", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v1/market/bookTickers",
      params: { symbol: s, type: "SPOT" },
      auth: "NONE"
    });
    const list: any[] = Array.isArray(json?.data?.tickers) ? json.data.tickers : [];
    const row = list.find((t) => String(t.symbol ?? t.symbolId ?? t.tradingPair ?? t.trading_pair) === s) ?? list[0] ?? {};
    let bid = Number(row.bidPrice ?? row.bid ?? row.bestBid ?? 0);
    let ask = Number(row.askPrice ?? row.ask ?? row.bestAsk ?? 0);
    if (!bid || !ask) {
      const fallback = await this.request<any>({
        method: "GET",
        path: "/api/v1/market/tickers",
        params: { symbol: s, type: "SPOT" },
        auth: "NONE"
      });
      const rows: any[] = Array.isArray(fallback?.data?.tickers) ? fallback.data.tickers : [];
      const t = rows.find((x) => String(x.symbol) === s) ?? rows[0] ?? {};
      const last = Number(t.close ?? t.last ?? t.lastPrice ?? 0);
      return { mid: last || bid || ask || 0, bid, ask, last, ts: nowMs() };
    }
    const mid = (bid + ask) / 2;
    return { mid, bid, ask, ts: nowMs() };
  }

  // ---------- Private ----------

  async getBalances(): Promise<Balance[]> {
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v1/account/balances",
      auth: "SIGNED"
    });
    const list: any[] = Array.isArray(json?.data?.balances) ? json.data.balances : [];
    return list.map((b) => ({
      asset: String(b.coin ?? b.asset ?? b.currency ?? ""),
      free: Number(b.free ?? b.available ?? b.balance ?? 0),
      locked: Number(b.locked ?? b.hold ?? b.frozen ?? 0)
    }));
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const s = toExchangeSymbol("pionex", symbol);
    const cached = this.openOrdersCache.get(s);
    if (cached && Date.now() - cached.ts < this.openOrdersTtlMs) {
      return cached.orders;
    }
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v1/trade/openOrders",
      params: { symbol: s },
      auth: "SIGNED"
    });
    const list: any[] = Array.isArray(json?.data?.orders) ? json.data.orders : [];
    const orders = list.map((o) => {
      const price = Number(o.price ?? o.orderPrice ?? o.avgPrice ?? 0);
      const qty = Number(o.size ?? o.quantity ?? o.amount ?? 0);
      const status = String(o.status ?? o.state ?? "").toUpperCase();
      let mapped: Order["status"] = "unknown";
      if (status === "OPEN" || status === "OPENED" || status === "PARTIALLY_FILLED") mapped = "open";
      else if (status === "CLOSED" || status === "FILLED") mapped = "filled";
      else if (status === "CANCELED" || status === "CANCELLED") mapped = "canceled";
      const side: Order["side"] =
        String(o.side ?? "").toLowerCase() === "sell" ? "sell" : "buy";
      return {
        id: String(o.orderId ?? o.id ?? ""),
        symbol: fromExchangeSymbol("pionex", String(o.symbol ?? s)),
        side,
        price,
        qty,
        status: mapped,
        clientOrderId: o.clientOrderId ? String(o.clientOrderId) : undefined
      };
    });
    this.openOrdersCache.set(s, { orders, ts: Date.now() });
    return orders;
  }

  async placeOrder(q: Quote): Promise<Order> {
    const symbol = normalizeSymbol(q.symbol);
    const s = toExchangeSymbol("pionex", symbol);
    const meta = await this.getSymbolMeta(symbol);

    const clientOrderId = sanitizeClientOrderId(q.clientOrderId);
    const isMarket = q.type === "market";
    const isBuy = q.side === "buy";

    let price = q.price ?? 0;
    let qty = q.qty;

    const body: any = {
      symbol: s,
      side: q.side.toUpperCase(),
      type: q.type.toUpperCase()
    };

    if (!isMarket) {
      if (!Number.isFinite(price) || price <= 0) throw new Error("[pionex] limit order requires price");
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("[pionex] limit order requires qty");

      const price0 = price;
      const qty0 = qty;
      price = normalizePrice(price0, meta);
      qty = normalizeQty(qty0, meta);

      const mins = checkMins({ price, qty, meta });
      if (!mins.ok) throw new Error(`[pionex] order below minimums: ${mins.reason}`);

      body.price = String(price);
      body.size = String(qty);
    } else {
      if (isBuy) {
        let amount = Number.isFinite(q.quoteQty) ? (q.quoteQty as number) : 0;
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("[pionex] market buy requires quoteQty");
        if (meta?.amountPrecision) {
          amount = roundDownToPrecision(amount, meta.amountPrecision);
        }
        if (meta?.minAmount && amount < meta.minAmount) {
          throw new Error(`[pionex] market buy below minAmount: ${amount} < ${meta.minAmount}`);
        }
        body.amount = String(amount);
      } else {
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("[pionex] market sell requires qty");
        const qty0 = qty;
        qty = normalizeQty(qty0, meta);
        if (meta?.minTradeDumping && qty < meta.minTradeDumping) {
          throw new Error(`[pionex] market sell below minTradeDumping: ${qty} < ${meta.minTradeDumping}`);
        }
        if (meta?.minQty && qty < meta.minQty) {
          throw new Error(`[pionex] market sell below minQty: ${qty} < ${meta.minQty}`);
        }
        body.size = String(qty);
      }
    }

    if (clientOrderId) body.clientOrderId = clientOrderId;

    const json: any = await this.request<any>({
      method: "POST",
      path: "/api/v1/trade/order",
      body,
      auth: "SIGNED"
    });
    const data = json?.data ?? {};
    const orderId = String(data.orderId ?? data.id ?? "");
    return {
      id: orderId || clientOrderId || `${Date.now()}`,
      symbol,
      side: q.side,
      price: price || 0,
      qty: isMarket && isBuy ? Number(q.quoteQty ?? 0) : qty,
      status: "open",
      clientOrderId
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const s = toExchangeSymbol("pionex", symbol);
    const orderIdNum = Number(orderId);
    if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
      throw new Error(`[pionex] invalid orderId: ${orderId}`);
    }
    await this.request<any>({
      method: "DELETE",
      path: "/api/v1/trade/order",
      body: { symbol: s, orderId: orderIdNum },
      auth: "SIGNED"
    });
  }

  async cancelAll(symbol?: string): Promise<void> {
    if (!symbol) return;
    const orders = await this.getOpenOrders(symbol);
    for (const o of orders) {
      try {
        await this.cancelOrder(symbol, o.id);
      } catch {
        // ignore individual cancel failures
      }
    }
  }

  async getMyTrades(
    symbol: string,
    params?: { startTimeMs?: number; limit?: number }
  ): Promise<MyTrade[]> {
    const s = toExchangeSymbol("pionex", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v1/trade/fills",
      params: {
        symbol: s,
        startTime: params?.startTimeMs,
        limit: params?.limit
      },
      auth: "SIGNED"
    });
    const list: any[] = Array.isArray(json?.data?.fills) ? json.data.fills : [];
    return list.map((t) => {
      const price = Number(t.price ?? 0);
      const qty = Number(t.size ?? t.amount ?? 0);
      const notional =
        Number(t.amount ?? t.quoteQty ?? t.notional) ||
        (price > 0 && qty > 0 ? price * qty : 0);
      const timestamp = Number(t.timestamp ?? t.time ?? t.createdAt ?? nowMs());
      return {
        id: String(t.id ?? t.tradeId ?? `${timestamp}`),
        orderId: t.orderId ? String(t.orderId) : undefined,
        clientOrderId: t.clientOrderId ? String(t.clientOrderId) : undefined,
        side: String(t.side ?? "").toLowerCase() === "sell" ? "sell" : "buy",
        price,
        qty,
        notional,
        timestamp
      };
    });
  }
}
