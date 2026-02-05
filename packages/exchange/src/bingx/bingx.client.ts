import crypto from "node:crypto";
import type { Balance, MidPrice, MyTrade, Order, Quote } from "@mm/core";
import { nowMs } from "@mm/core";
import { fromExchangeSymbol, toExchangeSymbol } from "../symbols.js";
import { checkMins, normalizePrice, normalizeQty, type SymbolMeta } from "./bingx.meta.js";

type RequestOpts = {
  method: "GET" | "POST";
  path: string;
  params?: Record<string, string | number | undefined>;
  auth?: "NONE" | "SIGNED";
};

type BingxResponse<T> = {
  code?: number;
  msg?: string;
  debugMsg?: string;
  data?: T;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withJitter(ms: number) {
  return Math.floor(ms * (0.8 + Math.random() * 0.4));
}

function parseNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toMs(ts: number): number {
  if (!Number.isFinite(ts)) return Date.now();
  return ts < 1e12 ? ts * 1000 : ts;
}

function buildParamStrings(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  entries.sort(([a], [b]) => a.localeCompare(b));
  const paramsStr = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const urlParamsStr = entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return { paramsStr, urlParamsStr };
}

function mapOrderStatus(status: string): Order["status"] {
  const s = String(status || "").toUpperCase();
  if (s === "NEW" || s === "PENDING" || s === "PARTIALLY_FILLED") return "open";
  if (s === "FILLED") return "filled";
  if (s === "CANCELED" || s === "FAILED") return "canceled";
  return "unknown";
}

function sideFromValue(value: unknown): "buy" | "sell" {
  return String(value || "").toUpperCase() === "SELL" ? "sell" : "buy";
}

export function buildBingxSignature(paramsStr: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(paramsStr).digest("hex");
}

export class BingxRestClient {
  private static queue: Promise<unknown> = Promise.resolve();
  private static lastRequestAt = 0;
  private static readonly minGapMs = Number(process.env.BINGX_MIN_GAP_MS || "120");
  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();
  private readonly metaTtlMs = 10 * 60_000;
  private readonly symbolCache = new Map<string, { symbols: string[]; ts: number }>();
  private readonly symbolCacheTtlMs = 15 * 60_000;
  private readonly recvWindow = Number(process.env.BINGX_RECV_WINDOW || "60000");

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private static async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = BingxRestClient.queue.then(fn, fn);
    BingxRestClient.queue = run.catch(() => undefined);
    return run;
  }

  private async parseJson(res: Response, label: string): Promise<BingxResponse<any>> {
    const text = await res.text();
    if (!text) return {};
    if (text.includes("Just a moment") || text.includes("cf-browser-verification")) {
      throw new Error("IP_NOT_WHITELISTED_OR_WAF_BLOCK");
    }
    try {
      return JSON.parse(text) as BingxResponse<any>;
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`[bingx] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private async request<T>(opts: RequestOpts): Promise<BingxResponse<T>> {
    return BingxRestClient.enqueue(async () => {
      const { method, path, params = {}, auth = "NONE" } = opts;
      const url = new URL(path, this.baseUrl);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json"
      };

      let signedParams = { ...params };
      if (auth === "SIGNED") {
        if (!this.apiKey || !this.apiSecret) {
          throw new Error("[bingx] missing api credentials");
        }
        signedParams = {
          ...signedParams,
          recvWindow: signedParams.recvWindow ?? this.recvWindow,
          timestamp: nowMs()
        };
      }

      const { paramsStr, urlParamsStr } = buildParamStrings(signedParams);
      let query = urlParamsStr;
      if (auth === "SIGNED") {
        const signature = buildBingxSignature(paramsStr, this.apiSecret);
        query = query ? `${query}&signature=${signature}` : `signature=${signature}`;
        headers["X-BX-APIKEY"] = this.apiKey;
      }
      if (query) url.search = query;

      const maxRetries = 2;
      let attempt = 0;
      while (true) {
        const now = Date.now();
        const gap = now - BingxRestClient.lastRequestAt;
        if (gap < BingxRestClient.minGapMs) {
          await sleep(BingxRestClient.minGapMs - gap);
        }
        BingxRestClient.lastRequestAt = Date.now();

        const res = await fetch(url, { method, headers });
        if (res.status === 404) {
          throw new Error("BASE_URL_OR_PATH_INVALID");
        }

        const json = await this.parseJson(res, `${method} ${path}`);
        const code = Number(json?.code ?? 0);
        if (!res.ok || (Number.isFinite(code) && code !== 0)) {
          const msg = json?.msg || json?.debugMsg || res.statusText || "request_failed";
          const err = new Error(`BingX API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt));
            await sleep(withJitter(backoff));
            attempt += 1;
            continue;
          }
          throw err;
        }

        return json as BingxResponse<T>;
      }
    });
  }

  private parseSymbolMeta(row: any): SymbolMeta {
    return {
      symbol: String(row?.symbol || ""),
      priceStep: parseNumber(row?.tickSize) || undefined,
      qtyStep: parseNumber(row?.stepSize) || undefined,
      minQty: parseNumber(row?.minQty) || undefined,
      minNotional: parseNumber(row?.minNotional) || undefined
    };
  }

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const cached = this.metaCache.get(exSymbol);
    if (cached && Date.now() - cached.ts < this.metaTtlMs) {
      return cached.meta;
    }

    const json = await this.request<{ symbols: any[] }>({
      method: "GET",
      path: "/openApi/spot/v1/common/symbols",
      params: { symbol: exSymbol },
      auth: "NONE"
    });
    const list = Array.isArray(json?.data?.symbols) ? json.data.symbols : [];
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

    const json = await this.request<{ symbols: any[] }>({
      method: "GET",
      path: "/openApi/spot/v1/common/symbols",
      auth: "NONE"
    });
    const list = Array.isArray(json?.data?.symbols) ? json.data.symbols : [];
    const symbols = list
      .filter((x: any) => Number(x?.status ?? 0) === 1)
      .map((x: any) => fromExchangeSymbol("bingx", String(x?.symbol || "")))
      .filter(Boolean);

    this.symbolCache.set("symbols", { symbols, ts: Date.now() });
    return symbols;
  }

  async getTicker(symbol: string): Promise<MidPrice> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v1/ticker/bookTicker",
      params: { symbol: exSymbol },
      auth: "NONE"
    });
    const row = json?.data ?? json ?? {};
    const bid = parseNumber(row?.bidPrice);
    const ask = parseNumber(row?.askPrice);
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
    const json = await this.request<{ balances: any[] }>({
      method: "GET",
      path: "/openApi/spot/v1/account/balance",
      auth: "SIGNED"
    });
    const list = Array.isArray(json?.data?.balances) ? json.data.balances : [];
    return list
      .map((b: any) => ({
        asset: String(b?.asset || "").toUpperCase(),
        free: parseNumber(b?.free),
        locked: parseNumber(b?.locked)
      }))
      .filter((b: Balance) => Boolean(b.asset));
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const json = await this.request<{ orders: any[] }>({
      method: "GET",
      path: "/openApi/spot/v1/trade/openOrders",
      params: { symbol: exSymbol },
      auth: "SIGNED"
    });
    const orders = Array.isArray(json?.data?.orders) ? json.data.orders : [];
    return orders.map((row: any) => {
      const qty = parseNumber(row?.origQty);
      const executed = parseNumber(row?.executedQty);
      const left = qty > executed ? qty - executed : qty;
      const price = parseNumber(row?.price);
      return {
        id: String(row?.orderId ?? row?.orderID ?? ""),
        symbol,
        side: sideFromValue(row?.side),
        price,
        qty: Number.isFinite(left) && left > 0 ? left : qty,
        status: mapOrderStatus(row?.status),
        clientOrderId: row?.clientOrderID ? String(row.clientOrderID) : undefined
      } as Order;
    });
  }

  async placeOrder(q: Quote): Promise<Order> {
    const exSymbol = toExchangeSymbol("bingx", q.symbol);
    const meta = await this.getSymbolMeta(q.symbol);
    const side = q.side.toUpperCase();
    const isMarket = String(q.type).toLowerCase() === "market";
    const price = q.price ? normalizePrice(q.price, meta) : undefined;
    const qty = normalizeQty(q.qty, meta);

    if (!isMarket && price !== undefined) {
      const mins = checkMins({ price, qty, meta });
      if (!mins.ok) {
        throw new Error(`[bingx] order rejected: ${mins.reason}`);
      }
    }

    const params: Record<string, string | number | undefined> = {
      symbol: exSymbol,
      side,
      type: isMarket ? "MARKET" : "LIMIT",
      newClientOrderId: q.clientOrderId
    };

    if (isMarket) {
      if (side === "BUY") {
        params.quoteOrderQty = q.quoteQty ?? undefined;
        if (!params.quoteOrderQty) {
          params.quantity = qty;
        }
      } else {
        params.quantity = qty;
      }
    } else {
      params.price = price;
      params.quantity = qty;
      params.timeInForce = q.postOnly ? "PostOnly" : "GTC";
    }

    const json = await this.request<any>({
      method: "POST",
      path: "/openApi/spot/v1/trade/order",
      params,
      auth: "SIGNED"
    });
    const row = json?.data ?? json ?? {};
    const orderId = String(row?.orderId ?? row?.orderID ?? "");
    return {
      id: orderId,
      symbol: q.symbol,
      side: q.side,
      price: parseNumber(row?.price ?? price),
      qty: parseNumber(row?.origQty ?? qty),
      status: mapOrderStatus(row?.status),
      clientOrderId: row?.clientOrderID ? String(row.clientOrderID) : q.clientOrderId
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    await this.request({
      method: "POST",
      path: "/openApi/spot/v1/trade/cancel",
      params: { symbol: exSymbol, orderId },
      auth: "SIGNED"
    });
  }

  async cancelAll(symbol?: string): Promise<void> {
    const params: Record<string, string | number | undefined> = {};
    if (symbol) {
      params.symbol = toExchangeSymbol("bingx", symbol);
    }
    await this.request({
      method: "POST",
      path: "/openApi/spot/v1/trade/cancelOpenOrders",
      params,
      auth: "SIGNED"
    });
  }

  async getMyTrades(symbol: string, params?: { startTimeMs?: number; limit?: number }): Promise<MyTrade[]> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const pageSize = Math.min(Math.max(params?.limit ?? 100, 1), 100);
    const query: Record<string, string | number | undefined> = {
      symbol: exSymbol,
      pageIndex: 1,
      pageSize
    };
    if (params?.startTimeMs) {
      query.startTime = params.startTimeMs;
    }

    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v1/trade/historyOrders",
      params: query,
      auth: "SIGNED"
    });

    const orders = Array.isArray(json?.data?.orders)
      ? json.data.orders
      : Array.isArray(json?.data?.list)
        ? json.data.list
        : Array.isArray(json?.data)
          ? json.data
          : [];

    return orders
      .map((row: any) => {
        const executed = parseNumber(row?.executedQty);
        if (!Number.isFinite(executed) || executed <= 0) return null;
        const notional = parseNumber(row?.cummulativeQuoteQty);
        let price = parseNumber(row?.avgPrice ?? row?.price);
        if ((!price || !Number.isFinite(price)) && notional > 0 && executed > 0) {
          price = notional / executed;
        }
        const tsRaw = parseNumber(row?.updateTime ?? row?.time ?? row?.transactTime);
        const ts = toMs(tsRaw);
        const orderId = row?.orderId ? String(row.orderId) : undefined;
        return {
          id: orderId ?? `${exSymbol}-${ts}`,
          orderId,
          clientOrderId: row?.clientOrderID ? String(row.clientOrderID) : undefined,
          side: sideFromValue(row?.side),
          price: price || 0,
          qty: executed,
          notional: notional || price * executed,
          timestamp: ts
        } as MyTrade;
      })
      .filter(Boolean) as MyTrade[];
  }
}
