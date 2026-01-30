import type { DexPriceFeedResult, DexStatus } from "./types.js";
import { DextoolsClient } from "./dextools.client.js";

type FeedOptions = {
  cacheTtlMs?: number;
  staleAfterMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  client?: DextoolsClient;
};

type CacheEntry = {
  mid: number;
  ts: number;
  meta?: DexPriceFeedResult["meta"];
};

type State = {
  failures: number;
  lastFailureAt: number;
  downUntil: number;
  backoffMs: number;
};

export class DextoolsPriceFeed {
  private cache = new Map<string, CacheEntry>();
  private state = new Map<string, State>();
  private cacheTtlMs: number;
  private staleAfterMs: number;
  private failureThreshold: number;
  private cooldownMs: number;
  private minBackoffMs: number;
  private maxBackoffMs: number;
  private client: DextoolsClient;

  constructor(opts?: FeedOptions) {
    this.cacheTtlMs = opts?.cacheTtlMs ?? 3000;
    this.staleAfterMs = opts?.staleAfterMs ?? 15000;
    this.failureThreshold = opts?.failureThreshold ?? 3;
    this.cooldownMs = opts?.cooldownMs ?? 30_000;
    this.minBackoffMs = opts?.minBackoffMs ?? 1000;
    this.maxBackoffMs = opts?.maxBackoffMs ?? 30_000;
    this.client = opts?.client ?? new DextoolsClient();
  }

  private key(chain: string, tokenAddress: string) {
    return `${chain.toLowerCase()}:${tokenAddress.toLowerCase()}`;
  }

  private getState(key: string): State {
    const existing = this.state.get(key);
    if (existing) return existing;
    const state: State = { failures: 0, lastFailureAt: 0, downUntil: 0, backoffMs: this.minBackoffMs };
    this.state.set(key, state);
    return state;
  }

  private recordFailure(key: string) {
    const state = this.getState(key);
    state.failures += 1;
    state.lastFailureAt = Date.now();
    if (state.failures >= this.failureThreshold) {
      state.downUntil = Date.now() + this.cooldownMs;
    }
    state.backoffMs = Math.min(this.maxBackoffMs, Math.max(this.minBackoffMs, state.backoffMs * 2));
  }

  private recordSuccess(key: string) {
    const state = this.getState(key);
    state.failures = 0;
    state.lastFailureAt = 0;
    state.downUntil = 0;
    state.backoffMs = this.minBackoffMs;
  }

  private statusFromCache(entry?: CacheEntry): DexStatus {
    if (!entry) return "DOWN";
    const age = Date.now() - entry.ts;
    if (age <= this.cacheTtlMs) return "OK";
    if (age <= this.staleAfterMs) return "STALE";
    return "DOWN";
  }

  async getPrice(chain: string, tokenAddress: string): Promise<DexPriceFeedResult> {
    const key = this.key(chain, tokenAddress);
    const cached = this.cache.get(key);
    const cachedStatus = this.statusFromCache(cached);
    const now = Date.now();
    const state = this.getState(key);

    if (cached && now - cached.ts <= this.cacheTtlMs) {
      return { mid: cached.mid, status: "OK", ts: cached.ts, meta: cached.meta };
    }

    if (state.downUntil > now) {
      if (cached) {
        return { mid: cached.mid, status: cachedStatus, ts: cached.ts, meta: cached.meta };
      }
      return { mid: null, status: "DOWN", ts: null };
    }

    if (state.lastFailureAt && now - state.lastFailureAt < state.backoffMs) {
      if (cached) {
        return { mid: cached.mid, status: cachedStatus, ts: cached.ts, meta: cached.meta };
      }
      return { mid: null, status: "DOWN", ts: null };
    }

    try {
      const resp = await this.client.getTokenPrice(chain, tokenAddress);
      const raw = resp.raw as any;
      const meta = {
        price5m: Number(raw?.data?.price5m ?? raw?.price5m),
        variation5m: Number(raw?.data?.variation5m ?? raw?.variation5m),
        price1h: Number(raw?.data?.price1h ?? raw?.price1h),
        variation1h: Number(raw?.data?.variation1h ?? raw?.variation1h),
        price24h: Number(raw?.data?.price24h ?? raw?.price24h),
        variation24h: Number(raw?.data?.variation24h ?? raw?.variation24h)
      };
      this.cache.set(key, { mid: resp.price, ts: resp.ts, meta });
      this.recordSuccess(key);
      return { mid: resp.price, status: "OK", ts: resp.ts, meta };
    } catch (e) {
      const errStr = String(e);
      if (errStr.includes("429")) {
        this.recordFailure(key);
      } else {
        this.recordFailure(key);
      }
      if (cached) {
        return { mid: cached.mid, status: cachedStatus, ts: cached.ts, meta: cached.meta };
      }
      return { mid: null, status: "DOWN", ts: null };
    }
  }
}
