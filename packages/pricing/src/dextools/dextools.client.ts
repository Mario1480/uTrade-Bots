import type { DextoolsNormalizedPrice } from "./types.js";

const DEFAULT_BASE_URL = "https://public-api.dextools.io";
const DEFAULT_PLAN = "trial";

type DextoolsClientOptions = {
  baseUrl?: string;
  plan?: string;
  apiKey?: string | null;
  timeoutMs?: number;
};

type RawDextoolsResponse = {
  data?: {
    price?: number;
    price5m?: number;
    variation5m?: number;
    price1h?: number;
    variation1h?: number;
    price24h?: number;
    variation24h?: number;
  };
  price?: number;
  price5m?: number;
  variation5m?: number;
  price1h?: number;
  variation1h?: number;
  price24h?: number;
  variation24h?: number;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class DextoolsClient {
  private baseUrl: string;
  private plan: string;
  private apiKey: string | null;
  private timeoutMs: number;

  constructor(opts?: DextoolsClientOptions) {
    this.baseUrl = opts?.baseUrl ?? process.env.DEXTOOLS_BASE_URL ?? DEFAULT_BASE_URL;
    this.plan = opts?.plan ?? process.env.DEXTOOLS_PLAN ?? DEFAULT_PLAN;
    this.apiKey = opts?.apiKey ?? process.env.DEXTOOLS_API_KEY ?? null;
    this.timeoutMs = opts?.timeoutMs ?? 8000;
  }

  private buildUrl(chain: string, tokenAddress: string) {
    const base = this.baseUrl.replace(/\/$/, "");
    const plan = this.plan.replace(/^\/|\/$/g, "");
    return `${base}/${plan}/v2/token/${chain}/${tokenAddress}/price`;
  }

  async getTokenPrice(chain: string, tokenAddress: string): Promise<DextoolsNormalizedPrice> {
    const url = this.buildUrl(chain, tokenAddress);
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) {
      headers["X-API-KEY"] = this.apiKey;
    }

    const res = await fetchWithTimeout(url, { method: "GET", headers }, this.timeoutMs);
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.slice(0, 300);
      throw new Error(`[dextools] ${res.status} ${res.statusText}: ${snippet}`);
    }

    let json: RawDextoolsResponse;
    try {
      json = JSON.parse(text) as RawDextoolsResponse;
    } catch (e) {
      const snippet = text.slice(0, 300);
      throw new Error(`[dextools] non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }

    const price = Number(json?.data?.price ?? json?.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("[dextools] missing/invalid price");
    }

    return {
      price,
      ts: Date.now(),
      raw: json
    };
  }
}
