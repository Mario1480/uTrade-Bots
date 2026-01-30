import type { DextoolsNormalizedPrice } from "./types.js";

const DEFAULT_BASE_URL = "https://api.dexscreener.com";

type DextoolsClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
};

type RawDexscreenerPair = {
  chainId?: string;
  priceUsd?: string | number;
  priceNative?: string | number;
  liquidity?: { usd?: number | string };
  priceChange?: { m5?: number | string; h1?: number | string; h24?: number | string };
};

type RawDexscreenerResponse = {
  pairs?: RawDexscreenerPair[];
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
  private timeoutMs: number;

  constructor(opts?: DextoolsClientOptions) {
    this.baseUrl =
      opts?.baseUrl ??
      process.env.DEXSCREENER_BASE_URL ??
      process.env.DEXTOOLS_BASE_URL ??
      DEFAULT_BASE_URL;
    this.timeoutMs = opts?.timeoutMs ?? 8000;
  }

  private buildUrl(tokenAddress: string) {
    const base = this.baseUrl.replace(/\/$/, "");
    return `${base}/latest/dex/tokens/${tokenAddress}`;
  }

  async getTokenPrice(chain: string, tokenAddress: string): Promise<DextoolsNormalizedPrice> {
    const url = this.buildUrl(tokenAddress);
    const headers: Record<string, string> = { accept: "application/json" };
    const res = await fetchWithTimeout(url, { method: "GET", headers }, this.timeoutMs);
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.slice(0, 300);
      throw new Error(`[dexscreener] ${res.status} ${res.statusText}: ${snippet}`);
    }

    let json: RawDexscreenerResponse;
    try {
      json = JSON.parse(text) as RawDexscreenerResponse;
    } catch (e) {
      const snippet = text.slice(0, 300);
      throw new Error(`[dexscreener] non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }

    const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
    const targetChain = chain?.trim().toLowerCase();
    const candidates = targetChain
      ? pairs.filter((p) => String(p.chainId ?? "").toLowerCase() === targetChain)
      : pairs;
    const best = candidates.reduce<RawDexscreenerPair | null>((acc, pair) => {
      if (!pair) return acc;
      const liq = Number(pair.liquidity?.usd ?? 0);
      if (!acc) return pair;
      const accLiq = Number(acc.liquidity?.usd ?? 0);
      return liq > accLiq ? pair : acc;
    }, null);
    const price = Number(best?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("[dexscreener] missing/invalid price");
    }

    return {
      price,
      ts: Date.now(),
      raw: { pair: best, response: json }
    };
  }
}
