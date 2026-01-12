import crypto from "node:crypto";
import type { Balance, MidPrice, Order, Quote } from "@mm/core";
import { nowMs } from "@mm/core";
import { normalizeSymbol } from "./bitmart.mapper.js";
import { checkMins, normalizePrice, normalizeQty, type SymbolMeta } from "./bitmart.meta.js";

/**
 * Bitmart Spot docs: base url and signature:
 * X-BM-SIGN = HMAC_SHA256(secret, `${timestamp}#${memo}#${body}`)
 * Headers: X-BM-KEY, X-BM-TIMESTAMP, X-BM-SIGN
 */
export class BitmartRestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly apiMemo: string
  ) {}

  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const s = normalizeSymbol(symbol);

    const cached = this.metaCache.get(s);
    if (cached && Date.now() - cached.ts < 10 * 60_000) return cached.meta;

    const candidates = [
      "/spot/v1/symbols/details",
      "/spot/v1/symbols"
    ];

    for (const path of candidates) {
      try {
        const url = new URL(path, this.baseUrl);
        const res = await fetch(url, { method: "GET" });
        const json: any = await res.json();

        if (!res.ok || (json?.code && json.code !== 1000)) continue;

        const list: any[] =
          json?.data?.symbols ??
          json?.data?.symbol_details ??
          json?.data ??
          [];

        const row = list.find((x) => (x.symbol ?? x.symbol_id ?? x.trading_pair) === s);
        if (!row) continue;

        const meta: SymbolMeta = {
          symbol: s,
          priceStep: Number(row.price_increment ?? row.price_min_increment ?? row.price_step ?? row.tick_size) || undefined,
          qtyStep: Number(row.base_increment ?? row.size_increment ?? row.qty_step ?? row.lot_size) || undefined,
          pricePrecision: Number(row.price_precision ?? row.pricePrecision) || undefined,
          qtyPrecision: Number(row.base_precision ?? row.basePrecision ?? row.size_precision ?? row.amount_precision) || undefined,
          minQty: Number(row.min_size ?? row.min_order_size ?? row.min_amount ?? row.minQty) || undefined,
          minNotional: Number(row.min_value ?? row.min_notional ?? row.minOrderValue ?? row.minBuyValue) || undefined
        };

        this.metaCache.set(s, { meta, ts: Date.now() });
        return meta;
      } catch {
        // try next endpoint
      }
    }

    return undefined;
  }

  private signBody(body: string, timestamp: number): string {
    const payload = `${timestamp}#${this.apiMemo}#${body}`;
    return crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    bodyObj?: any,
    auth: "NONE" | "KEYED" | "SIGNED" = "NONE"
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    let body = "";
    if (bodyObj && (method === "POST")) {
      body = JSON.stringify(bodyObj);
    }

    if (auth === "KEYED" || auth === "SIGNED") {
      headers["X-BM-KEY"] = this.apiKey;
    }
    if (auth === "SIGNED") {
      const ts = nowMs();
      headers["X-BM-TIMESTAMP"] = String(ts);
      headers["X-BM-SIGN"] = this.signBody(body || "{}", ts);
      // Note: many Bitmart examples sign exact JSON string body. We keep "{}" if empty.
      if (!body) body = "{}";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? body : undefined
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json?.code && json.code !== 1000)) {
      const msg = json?.message || json?.msg || res.statusText;
      throw new Error(`Bitmart API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
    }
    return json as T;
  }

  // ---------- Public ----------

  async getTicker(symbol: string): Promise<MidPrice> {
    const s = normalizeSymbol(symbol);
    // /spot/quotation/v3/ticker?symbol=BTC_USDT
    const url = new URL("/spot/quotation/v3/ticker", this.baseUrl);
    url.searchParams.set("symbol", s);

    const res = await fetch(url, { method: "GET" });
    const json: any = await res.json();
    if (!res.ok || json?.code !== 1000) {
      throw new Error(`Ticker failed: ${json?.message || res.statusText}`);
    }
    const data = json.data;
    const bid = Number(data.best_bid);
    const ask = Number(data.best_ask);
    const mid = (bid + ask) / 2;
    return { bid, ask, mid, ts: nowMs() };
  }

  // ---------- Private ----------

  async getBalances(): Promise<Balance[]> {
    // Spot wallet balance is KEYED in Bitmart docs; endpoint commonly:
    // /account/v1/wallet (KEYED). Some accounts use /account/v1/wallet (or /account/v2/wallet)
    // We'll use /account/v1/wallet and fail fast if differs.
    const json: any = await this.request("GET", "/account/v1/wallet", undefined, "KEYED");
    const arr: any[] = json.data?.wallet ?? json.data ?? [];
    return arr.map((x) => ({
      asset: String(x.id || x.currency || x.coin_name || x.symbol),
      free: Number(x.available || x.available_balance || x.available_amount || 0),
      locked: Number(x.frozen || x.frozen_balance || x.frozen_amount || 0)
    }));
  }

  async placeOrder(q: Quote): Promise<Order> {
    const symbol = normalizeSymbol(q.symbol);
    const meta = await this.getSymbolMeta(symbol);
    if (q.type !== "limit" && q.type !== "market") {
      throw new Error("Unsupported order type");
    }

    // Bitmart spot: /spot/v2/submit_order (SIGNED)
    // body fields (typical): symbol, side, type, price, size
    const body: any = {
      symbol,
      side: q.side,
      type: q.type
    };
    if (q.type === "limit") {
      if (!q.price) throw new Error("limit order requires price");

      const price0 = q.price;
      const qty0 = q.qty;

      const price = normalizePrice(price0, meta);
      const qty = normalizeQty(qty0, meta);

      if (meta && (price !== price0 || qty !== qty0)) {
        console.warn(`[bitmart] normalized ${symbol} ${q.side} price ${price0}→${price}, qty ${qty0}→${qty}`);
      }

      const mins = checkMins({ price, qty, meta });
      if (!mins.ok) {
        throw new Error(`[bitmart] order below minimums: ${mins.reason}`);
      }

      body.price = String(price);
      body.size = String(qty);
    } else {
      const qty0 = q.qty;
      const qty = normalizeQty(qty0, meta);

      if (meta && qty !== qty0) {
        console.warn(`[bitmart] normalized ${symbol} market ${q.side} qty ${qty0}→${qty}`);
      }

      if (meta?.minQty && qty < meta.minQty) {
        throw new Error(`[bitmart] market order below minQty: ${qty} < ${meta.minQty}`);
      }

      body.size = String(qty);
    }

    // Post-only: Bitmart uses `post_only` or `postOnly` depending on version.
    // We'll include both defensively (server ignores unknown).
    if (q.postOnly) {
      body.post_only = true;
      body.postOnly = true;
    }
    if (q.clientOrderId) body.client_order_id = q.clientOrderId;

    const json: any = await this.request("POST", "/spot/v2/submit_order", body, "SIGNED");
    const orderId = String(json.data?.order_id ?? json.data?.orderId ?? "");
    return {
      id: orderId,
      symbol,
      side: q.side,
      price: q.price ?? 0,
      qty: q.qty,
      status: "open",
      clientOrderId: q.clientOrderId
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const s = normalizeSymbol(symbol);
    // Bitmart cancel v3: /spot/v3/cancel_order (SIGNED)
    await this.request("POST", "/spot/v3/cancel_order", { symbol: s, order_id: orderId }, "SIGNED");
  }

  async cancelAll(symbol?: string, side?: "buy" | "sell"): Promise<void> {
    // /spot/v4/cancel_all (SIGNED)
    const body: any = {};
    if (symbol) body.symbol = normalizeSymbol(symbol);
    if (side) body.side = side;
    await this.request("POST", "/spot/v4/cancel_all", body, "SIGNED");
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const s = normalizeSymbol(symbol);
    // v4 open orders: POST /spot/v4/query/open-orders (SIGNED)
    const now = nowMs();
    const json: any = await this.request(
      "POST",
      "/spot/v4/query/open-orders",
      {
        symbol: s,
        orderMode: "spot",
        startTime: now - 60_000,
        endTime: now + 1_000,
        limit: 50,
        recvWindow: 5000
      },
      "SIGNED"
    );

    const list: any[] = json.data?.orders ?? json.data ?? [];
    return list.map((x) => ({
      id: String(x.orderId ?? x.order_id ?? x.id),
      symbol: s,
      side: (String(x.side).toLowerCase() === "buy" ? "buy" : "sell"),
      price: Number(x.price),
      qty: Number(x.size ?? x.qty ?? x.amount ?? 0),
      status: "open",
      clientOrderId: x.clientOrderId
    }));
  }
}