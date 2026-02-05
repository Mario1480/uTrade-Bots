import crypto from "node:crypto";
import type { Balance, MidPrice, MyTrade, Order, Quote } from "@mm/core";
import { nowMs } from "@mm/core";
import { fromExchangeSymbol, toExchangeSymbol } from "../symbols.js";
import { checkMins, normalizePrice, normalizeQty, type SymbolMeta } from "./xt.meta.js";

type RequestOpts = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  params?: Record<string, string | number | undefined>;
  body?: Record<string, string | number | undefined>;
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
  if (s === "NEW" || s === "PARTIALLY_FILLED" || s === "OPEN") return "open";
  if (s === "FILLED" || s === "DONE") return "filled";
  if (s === "CANCELED" || s === "CANCELLED") return "canceled";
  if (s === "REJECTED") return "rejected";
  return "unknown";
}

function sideFromValue(value: unknown): "buy" | "sell" {
  return String(value || "").toUpperCase() === "SELL" ? "sell" : "buy";
}

function extractList(json: any): any[] {
  const result = json?.result ?? json?.data ?? json;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.symbols)) return result.symbols;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.list)) return result.list;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function pick<T>(row: Record<string, any>, keys: string[]): T | undefined {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key] as T;
  }
  return undefined;
}

export function buildXtSignature(original: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(original).digest("hex");
}

export class XtRestClient {
  private static queue: Promise<unknown> = Promise.resolve();
  private static lastRequestAt = 0;
  private static readonly minGapMs = Number(process.env.XT_MIN_GAP_MS || "120");
  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();
  private readonly metaTtlMs = 10 * 60_000;
  private readonly symbolCache = new Map<string, { symbols: string[]; ts: number }>();
  private readonly symbolCacheTtlMs = 15 * 60_000;
  private readonly recvWindow = Number(process.env.XT_RECV_WINDOW || "5000");

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private static async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = XtRestClient.queue.then(fn, fn);
    XtRestClient.queue = run.catch(() => undefined);
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
      throw new Error(`[xt] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private buildSignedHeaders(method: string, path: string, query: string, body: string) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("[xt] missing api credentials");
    }
    const timestamp = String(nowMs());
    const headers: Record<string, string> = {
      "validate-algorithms": "HmacSHA256",
      "validate-appkey": this.apiKey,
      "validate-recvwindow": String(this.recvWindow),
      "validate-timestamp": timestamp
    };
    const headerKeys = Object.keys(headers).sort();
    const X = headerKeys.map((k) => `${k}=${headers[k]}`).join("&");
    const Y = `#${method}#${path}#${query}#${body}`;
    const original = X + Y;
    const signature = buildXtSignature(original, this.apiSecret);
    headers["validate-signature"] = signature;
    return headers;
  }

  private async request<T>(opts: RequestOpts): Promise<T> {
    return XtRestClient.enqueue(async () => {
      const { method, path, params = {}, body = {}, auth = "NONE" } = opts;
      const url = new URL(path, this.baseUrl);
      const query = buildQuery(params);
      if (query) url.search = query;
      const bodyStr = Object.keys(body).length > 0 ? JSON.stringify(body) : "";

      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json"
      };
      if (auth === "SIGNED") {
        Object.assign(headers, this.buildSignedHeaders(method, path, query, bodyStr));
      }

      const maxRetries = 2;
      let attempt = 0;
      while (true) {
        const now = Date.now();
        const gap = now - XtRestClient.lastRequestAt;
        if (gap < XtRestClient.minGapMs) {
          await sleep(XtRestClient.minGapMs - gap);
        }
        XtRestClient.lastRequestAt = Date.now();

        const res = await fetch(url, {
          method,
          headers,
          body: method === "GET" ? undefined : bodyStr || undefined
        });

        if (res.status === 404) {
          throw new Error("BASE_URL_OR_PATH_INVALID");
        }

        const json = await this.parseJson(res, `${method} ${path}`);
        const hasRc = json && typeof json === "object" && json.rc !== undefined;
        const hasCode = json && typeof json === "object" && json.code !== undefined;
        const rc = hasRc ? Number(json.rc) : 0;
        const code = hasCode ? Number(json.code) : 0;
        const successFlag = json?.success;
        if (!res.ok || (hasRc && Number.isFinite(rc) && rc !== 0) || (hasCode && Number.isFinite(code) && code !== 0) || successFlag === false) {
          const msg = json?.mc || json?.message || json?.msg || res.statusText || "request_failed";
          const err = new Error(`XT API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
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

  private async listSymbolsRaw(): Promise<any[]> {
    const json = await this.request<any>({ method: "GET", path: "/v4/public/symbol", auth: "NONE" });
    return extractList(json);
  }

  private parseSymbolMeta(row: any): SymbolMeta {
    const filters = Array.isArray(row?.filters) ? row.filters : [];
    const priceFilter = filters.find((f: any) => f?.filterType === "PRICE" || f?.type === "PRICE") ?? {};
    const qtyFilter = filters.find((f: any) => f?.filterType === "QUANTITY" || f?.type === "QUANTITY") ?? {};
    const quoteFilter = filters.find((f: any) => f?.filterType === "QUOTE_QTY" || f?.type === "QUOTE_QTY") ?? {};

    return {
      symbol: String(row?.symbol || row?.symbolName || ""),
      priceStep: parseNumber(priceFilter?.tickSize ?? row?.tickSize ?? row?.priceTick) || undefined,
      qtyStep: parseNumber(qtyFilter?.tickSize ?? row?.stepSize ?? row?.qtyTick) || undefined,
      minQty: parseNumber(qtyFilter?.min ?? row?.minQty ?? row?.minQuantity) || undefined,
      minNotional: parseNumber(quoteFilter?.min ?? row?.minNotional ?? row?.minQuoteQty) || undefined,
      pricePrecision: Number(row?.pricePrecision ?? row?.priceScale ?? row?.quotePrecision),
      qtyPrecision: Number(row?.quantityPrecision ?? row?.quantityScale ?? row?.basePrecision)
    };
  }

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const exSymbol = toExchangeSymbol("xt", symbol);
    const cached = this.metaCache.get(exSymbol);
    if (cached && Date.now() - cached.ts < this.metaTtlMs) return cached.meta;

    const list = await this.listSymbolsRaw();
    const row = list.find((x) => String(x?.symbol || x?.symbolName || "").toLowerCase() === exSymbol.toLowerCase());
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

    const list = await this.listSymbolsRaw();
    const symbols = list
      .filter((row) => {
        const status = String(row?.status ?? row?.state ?? row?.symbolStatus ?? "").toUpperCase();
        if (!status) return true;
        if (["TRADING", "ONLINE", "ENABLED", "ACTIVE", "1"].includes(status)) return true;
        return false;
      })
      .map((row) => String(row?.symbol || row?.symbolName || ""))
      .filter(Boolean)
      .map((sym) => fromExchangeSymbol("xt", sym));

    this.symbolCache.set("symbols", { symbols, ts: Date.now() });
    return symbols;
  }

  async getTicker(symbol: string): Promise<MidPrice> {
    const exSymbol = toExchangeSymbol("xt", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/v4/public/ticker",
      params: { symbol: exSymbol },
      auth: "NONE"
    });

    const list = extractList(json);
    let row: any = list.find((r) => String(r?.symbol || r?.symbolName || "").toLowerCase() === exSymbol.toLowerCase());
    if (!row && list.length > 0) row = list[0];
    if (!row && json?.result && typeof json.result === "object") row = json.result;
    if (!row && json?.data && typeof json.data === "object") row = json.data;

    const bid = parseNumber(pick(row ?? {}, ["bidPrice", "bid", "bestBidPrice", "bidPx", "b"]));
    const ask = parseNumber(pick(row ?? {}, ["askPrice", "ask", "bestAskPrice", "askPx", "a"]));
    const last = parseNumber(pick(row ?? {}, ["lastPrice", "last", "close", "price", "c"]));
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;

    return { mid, bid, ask, last: last || mid, ts: Date.now() };
  }

  async getBalances(): Promise<Balance[]> {
    const json = await this.request<any>({ method: "GET", path: "/v4/balances", auth: "SIGNED" });
    const result = json?.result ?? json?.data ?? json;
    const list = Array.isArray(result)
      ? result
      : Array.isArray(result?.balances)
      ? result.balances
      : Array.isArray(result?.list)
      ? result.list
      : [];

    return list
      .map((row: any) => {
        const asset = String(row?.currency || row?.asset || row?.coin || row?.symbol || "").toUpperCase();
        const free = parseNumber(row?.available ?? row?.free ?? row?.balance ?? row?.availableBalance);
        let locked = parseNumber(row?.freeze ?? row?.frozen ?? row?.locked ?? row?.hold);
        if (!locked && row?.total !== undefined) {
          locked = Math.max(0, parseNumber(row.total) - free);
        }
        return { asset, free, locked } as Balance;
      })
      .filter((b: Balance) => Boolean(b.asset));
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const exSymbol = toExchangeSymbol("xt", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/v4/open-order",
      params: { symbol: exSymbol, bizType: "SPOT" },
      auth: "SIGNED"
    });

    const rows = extractList(json);
    return rows.map((row: any) => {
      const origQty = parseNumber(pick(row, ["origQty", "origQuantity", "quantity", "amount", "qty"]));
      const executed = parseNumber(pick(row, ["executedQty", "filledQty", "dealStock", "filled"]));
      const left = parseNumber(pick(row, ["left", "remainingQty", "remainQty", "leftQty"])) || Math.max(0, origQty - executed);
      return {
        id: String(pick(row, ["orderId", "id", "order_id"]) ?? ""),
        symbol: fromExchangeSymbol("xt", row?.symbol || row?.symbolName || exSymbol),
        side: sideFromValue(row?.side ?? row?.orderSide),
        price: parseNumber(row?.price),
        qty: left || origQty,
        status: mapOrderStatus(String(row?.status ?? row?.orderStatus ?? "NEW")),
        clientOrderId: pick(row, ["clientOrderId", "clientOid", "client_id"]) ? String(pick(row, ["clientOrderId", "clientOid", "client_id"])) : undefined
      } as Order;
    });
  }

  async placeOrder(q: Quote): Promise<Order> {
    const exSymbol = toExchangeSymbol("xt", q.symbol);
    const meta = await this.getSymbolMeta(q.symbol);

    const params: Record<string, string | number | undefined> = {
      symbol: exSymbol,
      side: q.side.toUpperCase(),
      bizType: "SPOT",
      clientOrderId: q.clientOrderId
    };

    let normalizedPrice = 0;
    let normalizedQty = 0;

    if (q.type === "market") {
      params.type = "MARKET";
      if (q.side === "buy" && q.quoteQty && q.quoteQty > 0) {
        params.quoteQty = q.quoteQty;
      } else {
        normalizedQty = normalizeQty(q.qty ?? 0, meta);
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
          throw new Error("[xt] QTY_NORMALIZED_TO_ZERO");
        }
        params.quantity = normalizedQty;
      }
    } else {
      normalizedPrice = normalizePrice(q.price ?? 0, meta);
      normalizedQty = normalizeQty(q.qty ?? 0, meta);

      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        throw new Error("[xt] PRICE_NORMALIZED_TO_ZERO");
      }
      if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
        throw new Error("[xt] QTY_NORMALIZED_TO_ZERO");
      }

      const minCheck = checkMins({ price: normalizedPrice, qty: normalizedQty, meta });
      if (!minCheck.ok) {
        throw new Error(`[xt] min check failed: ${minCheck.reason}`);
      }

      params.type = "LIMIT";
      params.timeInForce = q.postOnly ? "GTX" : "GTC";
      params.price = normalizedPrice;
      params.quantity = normalizedQty;
    }

    const json = await this.request<any>({ method: "POST", path: "/v4/order", body: params, auth: "SIGNED" });
    const result = json?.result ?? json?.data ?? json;
    const orderId = pick(result ?? {}, ["orderId", "id", "order_id"]);
    const clientOrderId = pick(result ?? {}, ["clientOrderId", "clientOid", "client_id"]) ?? params.clientOrderId;

    return {
      id: String(orderId ?? ""),
      symbol: q.symbol,
      side: q.side,
      price: normalizedPrice || parseNumber(q.price),
      qty: normalizedQty || parseNumber(q.qty),
      status: "open",
      clientOrderId: clientOrderId ? String(clientOrderId) : undefined
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request({
      method: "DELETE",
      path: `/v4/order/${orderId}`,
      params: { symbol: toExchangeSymbol("xt", symbol), bizType: "SPOT" },
      auth: "SIGNED"
    });
  }

  async cancelAll(symbol?: string, side?: "buy" | "sell"): Promise<void> {
    const body: Record<string, string | number> = { bizType: "SPOT" };
    if (symbol) body.symbol = toExchangeSymbol("xt", symbol);
    if (side) body.side = side.toUpperCase();
    await this.request({
      method: "DELETE",
      path: "/v4/open-order",
      body,
      auth: "SIGNED"
    });
  }

  async getMyTrades(symbol: string, params?: { startTimeMs?: number; limit?: number }): Promise<MyTrade[]> {
    const exSymbol = toExchangeSymbol("xt", symbol);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 50));
    const json = await this.request<any>({
      method: "GET",
      path: "/v4/trade",
      params: {
        symbol: exSymbol,
        bizType: "SPOT",
        startTime: params?.startTimeMs,
        limit
      },
      auth: "SIGNED"
    });
    const rows = extractList(json);
    return rows.map((row: any) => {
      const price = parseNumber(pick(row, ["price"]));
      const qty = parseNumber(pick(row, ["quantity", "qty", "amount"]));
      const notional =
        parseNumber(pick(row, ["deal", "dealMoney", "quoteQty", "quote"])) || price * qty;
      const timestamp = parseNumber(pick(row, ["timestamp", "time", "ts", "createdTime"]));
      return {
        id: String(pick(row, ["id", "tradeId"]) ?? `${pick(row, ["orderId", "order_id"]) ?? "t"}-${timestamp}`),
        orderId: pick(row, ["orderId", "order_id"]) ? String(pick(row, ["orderId", "order_id"])) : undefined,
        clientOrderId: pick(row, ["clientOrderId", "clientOid", "client_id"]) ? String(pick(row, ["clientOrderId", "clientOid", "client_id"])) : undefined,
        side: sideFromValue(row?.side ?? row?.orderSide),
        price,
        qty,
        notional,
        timestamp: timestamp || Date.now()
      } as MyTrade;
    });
  }
}
