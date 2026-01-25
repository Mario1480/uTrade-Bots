import crypto from "node:crypto";
import type { Balance, MidPrice, Order, Quote, MyTrade } from "@mm/core";
import { nowMs, normalizeSymbol } from "@mm/core";
import { toExchangeSymbol, fromExchangeSymbol } from "../symbols.js";
import { checkMins, normalizePrice, normalizeQty, type SymbolMeta } from "./coinstore.meta.js";

type CoinstoreResponse<T> = {
  code?: string | number;
  message?: string;
  data?: T;
};

type RequestOpts = {
  method: "GET" | "POST";
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

function normalizeTickerSymbol(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function pickNumber(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function buildCoinstoreSignature(payload: string, secret: string, expiresMs: number) {
  const bucket = Math.floor(expiresMs / 30000).toString();
  const key = crypto.createHmac("sha256", secret).update(bucket).digest("hex");
  const sign = crypto.createHmac("sha256", key).update(payload).digest("hex");
  return { key, sign };
}

export class CoinstoreRestClient {
  private static lastRequestAt = 0;
  private static readonly minGapMs = Number(process.env.COINSTORE_MIN_GAP_MS || "1500");
  private readonly tickerTtlMs = Number(process.env.COINSTORE_TICKER_TTL_MS || "15000");
  private readonly tickerCache = new Map<string, { mid: MidPrice; ts: number }>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();

  private async parseJson(res: Response, label: string): Promise<any> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`[coinstore] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private async request<T>(opts: RequestOpts): Promise<CoinstoreResponse<T>> {
    const { method, path, params, body, auth = "NONE" } = opts;
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }
    const query = url.searchParams.toString();
    const bodyStr = body && method === "POST" ? JSON.stringify(body) : "";
    const payload = query && bodyStr ? `${query}&${bodyStr}` : query || bodyStr;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "*/*",
      Connection: "keep-alive",
      "User-Agent": "Mozilla/5.0 (compatible; uLiquidBot/1.0)"
    };

    if (auth === "SIGNED") {
      const expires = nowMs();
      const { sign } = buildCoinstoreSignature(payload, this.apiSecret, expires);
      headers["X-CS-APIKEY"] = this.apiKey;
      headers["X-CS-EXPIRES"] = String(expires);
      headers["X-CS-SIGN"] = sign;
      headers["exch-language"] = "en_US";
    }

    const maxRetries = 2;
    let attempt = 0;
    while (true) {
      try {
        const now = Date.now();
        const gap = now - CoinstoreRestClient.lastRequestAt;
        if (gap < CoinstoreRestClient.minGapMs) {
          await sleep(CoinstoreRestClient.minGapMs - gap);
        }
        CoinstoreRestClient.lastRequestAt = Date.now();

        const res = await fetch(url, {
          method,
          headers,
          body: method === "POST" ? bodyStr : undefined
        });

        const json = await this.parseJson(res, `${method} ${path}`);
        if (!res.ok || (json?.code !== undefined && String(json.code) !== "0")) {
          const msg = json?.message || json?.msg || res.statusText || "request_failed";
          const err = new Error(`Coinstore API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            await sleep(withJitter(800 * Math.pow(2, attempt)));
            attempt += 1;
            continue;
          }
          throw err;
        }
        return json as CoinstoreResponse<T>;
      } catch (e: any) {
        if (attempt < maxRetries && (e?.name === "AbortError" || e?.message?.includes("fetch"))) {
          await sleep(withJitter(800 * Math.pow(2, attempt)));
          attempt += 1;
          continue;
        }
        throw e;
      }
    }
  }

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const s = toExchangeSymbol("coinstore", symbol);
    const cached = this.metaCache.get(s);
    if (cached && Date.now() - cached.ts < 10 * 60_000) return cached.meta;

    const json = await this.request<any>({
      method: "POST",
      path: "/api/v2/public/config/spot/symbols",
      body: {},
      auth: "NONE"
    });
    const list: any[] = Array.isArray(json?.data) ? json.data : json?.data?.symbols ?? [];
    const row = list.find((x) => {
      const code = x?.symbolCode ?? x?.symbol ?? x?.symbolId ?? x?.tradeSymbol ?? x?.trading_pair;
      return String(code ?? "") === s;
    });
    if (!row) return undefined;

    const meta: SymbolMeta = {
      symbol: s,
      priceStep: Number(
        row.tickSz ??
          row.priceTick ??
          row.price_step ??
          row.tickSize ??
          row.priceIncrement ??
          row.price_increment ??
          row.priceStep
      ) || undefined,
      qtyStep: Number(
        row.lotSz ??
          row.qtyStep ??
          row.quantityStep ??
          row.baseStep ??
          row.amountStep ??
          row.lotSize ??
          row.lot_size
      ) || undefined,
      pricePrecision: Number(
        row.pricePrecision ??
          row.priceScale ??
          row.priceDigits ??
          row.price_precision
      ) || undefined,
      qtyPrecision: Number(
        row.quantityPrecision ??
          row.amountPrecision ??
          row.qtyPrecision ??
          row.amountScale ??
          row.baseScale ??
          row.quantityScale ??
          row.quantity_precision
      ) || undefined,
      minQty: Number(
        row.minLmtSz ??
          row.minQty ??
          row.minQuantity ??
          row.minAmount ??
          row.minSize ??
          row.min_trade_amount
      ) || undefined,
      minNotional: Number(
        row.minMktVa ??
          row.minNotional ??
          row.minValue ??
          row.minQuote ??
          row.minTradeValue ??
          row.min_trade_value
      ) || undefined
    };

    this.metaCache.set(s, { meta, ts: Date.now() });
    return meta;
  }

  async listSymbols(): Promise<string[]> {
    const json = await this.request<any>({
      method: "POST",
      path: "/api/v2/public/config/spot/symbols",
      body: {},
      auth: "NONE"
    });
    const list: any[] = Array.isArray(json?.data) ? json.data : json?.data?.symbols ?? [];
    return list
      .map((s) => s?.symbolCode ?? s?.symbol ?? s?.symbolId ?? s?.tradeSymbol ?? s?.trading_pair)
      .filter(Boolean)
      .map((s) => {
        try {
          return fromExchangeSymbol("coinstore", String(s));
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[];
  }

  async getTicker(symbol: string): Promise<MidPrice> {
    const s = toExchangeSymbol("coinstore", symbol);
    const cached = this.tickerCache.get(s);
    const now = Date.now();
    if (cached && now - cached.ts < this.tickerTtlMs) {
      return cached.mid;
    }
    const symbolLower = s.toLowerCase();
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v1/ticker/price",
      params: { symbol: symbolLower },
      auth: "NONE"
    });
    const list: any[] = Array.isArray(json?.data) ? json.data : json?.data?.tickers ?? [];
    const target = normalizeTickerSymbol(s);
    const row = list.find((x) => {
      const raw = String(x?.symbol ?? x?.symbolId ?? "");
      return normalizeTickerSymbol(raw) === target || raw.toLowerCase() === symbolLower;
    });
    if (!row) {
      throw new Error(`Ticker missing symbol ${s}`);
    }
    const last = Number(row.price ?? row.last ?? row.close ?? 0);
    let bid = last;
    let ask = last;
    const mid = last > 0 ? last : NaN;
    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`Ticker missing prices for ${s}`);
    }
    const result = { bid, ask, mid, last, ts: nowMs() };
    this.tickerCache.set(s, { mid: result, ts: now });
    return result;
  }

  async getBalances(): Promise<Balance[]> {
    const json = await this.request<any>({
      method: "POST",
      path: "/api/spot/accountList",
      body: {},
      auth: "SIGNED"
    });
    const list: any[] = Array.isArray(json?.data)
      ? json.data
      : json?.data?.list ?? json?.data?.accountList ?? json?.data?.balances ?? [];
    const byAsset = new Map<string, { free: number; locked: number }>();
    for (const x of list) {
      const asset = String(x.coin ?? x.asset ?? x.currency ?? x.symbol ?? x.name ?? "").toUpperCase();
      if (!asset) continue;
      const free = pickNumber(x, [
        "available",
        "availableAmount",
        "available_balance",
        "availableBalance",
        "free",
        "usable",
        "balance",
        "total",
        "totalAmount"
      ]);
      const locked = pickNumber(x, [
        "frozen",
        "locked",
        "frozenAmount",
        "freezeAmount",
        "hold",
        "holdAmount"
      ]);
      const prev = byAsset.get(asset) ?? { free: 0, locked: 0 };
      prev.free += free;
      prev.locked += locked;
      byAsset.set(asset, prev);
    }
    return Array.from(byAsset.entries()).map(([asset, v]) => ({
      asset,
      free: v.free,
      locked: v.locked
    }));
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const s = toExchangeSymbol("coinstore", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v2/trade/order/active",
      params: { symbol: s.toLowerCase() },
      auth: "SIGNED"
    });
    const list: any[] = Array.isArray(json?.data) ? json.data : json?.data?.list ?? [];
    if (process.env.COINSTORE_OPEN_ORDERS_DEBUG === "1") {
      const rawSample = list.slice(0, 3);
      // eslint-disable-next-line no-console
      console.warn("[coinstore] openOrders raw", JSON.stringify(rawSample, null, 2));
    }
    const orders = list.map((o) => {
      const sideRaw = String(o.side ?? o.direction ?? o.tradeSide ?? "").toLowerCase();
      const side: "buy" | "sell" = sideRaw === "sell" ? "sell" : "buy";
      return {
      id: String(
        o.orderId ??
          o.order_id ??
          o.id ??
          o.entrustId ??
          o.entrust_id ??
          o.orderNo ??
          o.orderSn ??
          o.clOrdId ??
          o.clientOrderId ??
          ""
      ),
      symbol: fromExchangeSymbol("coinstore", String(o.symbol ?? s)),
      side,
      price: pickNumber(o, [
        "price",
        "entrustPrice",
        "entrust_price",
        "orderPrice",
        "order_price",
        "priceAvg",
        "avgPrice",
        "dealPrice",
        "matchPrice",
        "tradePrice"
      ]),
      qty: pickNumber(o, [
        "quantity",
        "qty",
        "entrustQty",
        "entrust_qty",
        "origQty",
        "orderQty",
        "order_qty",
        "amount",
        "size",
        "volume",
        "totalQty",
        "number",
        "entrustAmount",
        "baseQty",
        "baseAmount",
        "baseVolume",
        "tradeQty"
      ]),
      status: "open" as const,
      clientOrderId: o.clientOrderId ?? o.client_order_id ?? o.clOrdId ?? undefined
      };
    });
    if (process.env.COINSTORE_OPEN_ORDERS_DEBUG === "1") {
      const sample = orders.slice(0, 3).map((o) => ({
        id: o.id,
        side: o.side,
        price: o.price,
        qty: o.qty,
        clientOrderId: o.clientOrderId
      }));
      // eslint-disable-next-line no-console
      console.warn("[coinstore] openOrders sample", sample);
    }
    return orders;
  }

  async placeOrder(q: Quote): Promise<Order> {
    const s = toExchangeSymbol("coinstore", q.symbol);
    const meta = await this.getSymbolMeta(q.symbol);
    let price = q.price ?? 0;
    let qty = q.qty ?? 0;

    if (q.type === "market" && q.side === "buy" && (!qty || qty <= 0) && q.quoteQty) {
      const mid = await this.getTicker(q.symbol);
      qty = q.quoteQty / (mid.last ?? mid.mid);
    }

    if (q.type === "limit") {
      if (!q.price || !Number.isFinite(q.price)) throw new Error("limit order requires price");
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("limit order requires qty");
      price = normalizePrice(price, meta);
      qty = normalizeQty(qty, meta);
      const mins = checkMins({ price, qty, meta });
      if (!mins.ok) throw new Error(`[coinstore] min check failed: ${mins.reason}`);
    } else {
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("market order requires qty");
      qty = normalizeQty(qty, meta);
    }

    const body: Record<string, string> = {
      symbol: s,
      side: q.side.toUpperCase(),
      orderType: q.type.toUpperCase(),
      quantity: String(qty)
    };
    if (q.type === "limit") body.price = String(price);
    if (q.clientOrderId) body.clientOrderId = q.clientOrderId;
    if (q.postOnly) {
      (body as any).postOnly = "true";
    }

    const json = await this.request<any>({
      method: "POST",
      path: "/api/trade/order/place",
      body,
      auth: "SIGNED"
    });

    const data = json?.data ?? {};
    const orderId = String(data.orderId ?? data.order_id ?? data.id ?? "");
    return {
      id: orderId || q.clientOrderId || `${Date.now()}`,
      symbol: normalizeSymbol(q.symbol),
      side: q.side,
      price: q.type === "market" ? price : price,
      qty,
      status: "open",
      clientOrderId: q.clientOrderId
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const s = toExchangeSymbol("coinstore", symbol);
    await this.request<any>({
      method: "POST",
      path: "/api/trade/order/cancel",
      body: { symbol: s, orderId },
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
        // continue
      }
    }
  }

  async getMyTrades(
    symbol: string,
    params?: { startTimeMs?: number; limit?: number }
  ): Promise<MyTrade[]> {
    const s = toExchangeSymbol("coinstore", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/trade/match/accountMatches",
      params: {
        symbol: s,
        limit: params?.limit,
        startTime: params?.startTimeMs
      },
      auth: "SIGNED"
    });
    const list: any[] = Array.isArray(json?.data) ? json.data : json?.data?.list ?? [];
    return list.map((t) => {
      const price = Number(t.price ?? t.matchPrice ?? 0);
      const qty = Number(t.quantity ?? t.qty ?? t.matchQty ?? 0);
      const notional =
        Number(t.amount ?? t.quoteQty ?? t.notional) ||
        (price > 0 && qty > 0 ? price * qty : 0);
      const timestamp = Number(t.timestamp ?? t.time ?? t.matchTime ?? t.createTime ?? nowMs());
      const clientOrderId = t.clientOrderId ?? t.client_order_id ?? undefined;
      return {
        id: String(t.tradeId ?? t.id ?? t.matchId ?? `${timestamp}`),
        orderId: t.orderId ?? t.order_id ?? undefined,
        clientOrderId: clientOrderId ? String(clientOrderId) : undefined,
        side: String(t.side ?? t.direction ?? t.tradeSide ?? "").toLowerCase() === "sell" ? "sell" : "buy",
        price,
        qty,
        notional,
        timestamp
      };
    });
  }
}
