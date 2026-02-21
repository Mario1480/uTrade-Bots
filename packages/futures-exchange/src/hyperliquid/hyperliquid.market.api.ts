import type { Hyperliquid, Meta, MetaAndAssetCtxs } from "hyperliquid";
import { parseCoinFromAnySymbol } from "./hyperliquid.symbols.js";
import type { HyperliquidContractRaw } from "./hyperliquid.types.js";

function toMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
  return Math.trunc(parsed);
}

function toInterval(granularity: string): string {
  const normalized = String(granularity ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "8h": "8h",
    "12h": "12h",
    "1d": "1d",
    "3d": "3d",
    "1w": "1w",
    "1M": "1M",
    "1month": "1M"
  };
  return map[normalized] ?? "1m";
}

function parseMid(raw: unknown): number | null {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export class HyperliquidMarketApi {
  constructor(private readonly sdk: Hyperliquid) {}

  async getMetaAndAssetCtxs(): Promise<MetaAndAssetCtxs> {
    return this.sdk.info.perpetuals.getMetaAndAssetCtxs(true);
  }

  async getContracts(_productType?: string): Promise<HyperliquidContractRaw[]> {
    const meta = await this.sdk.info.perpetuals.getMeta(true);
    return Array.isArray(meta?.universe) ? (meta.universe as HyperliquidContractRaw[]) : [];
  }

  async getTicker(symbol: string, _productType?: string): Promise<unknown> {
    const coin = parseCoinFromAnySymbol(symbol);
    const [allMidsRaw, metaAndAssetCtxs] = await Promise.all([
      this.sdk.info.getAllMids(true),
      this.sdk.info.perpetuals.getMetaAndAssetCtxs(true)
    ]);

    const mid = parseMid((allMidsRaw as Record<string, string>)[coin]);
    const [meta, assetCtxs] = metaAndAssetCtxs;
    const universe = Array.isArray(meta?.universe) ? meta.universe : [];
    const index = universe.findIndex((row) => String(row.name ?? "").toUpperCase() === coin);
    const ctx = index >= 0 && Array.isArray(assetCtxs) ? assetCtxs[index] : null;

    return {
      symbol,
      coin,
      lastPr: mid,
      last: mid,
      markPrice: Number(ctx?.markPx ?? mid ?? 0),
      indexPrice: Number(ctx?.oraclePx ?? mid ?? 0),
      bidPr: mid,
      askPr: mid,
      ts: Date.now()
    };
  }

  async getTickers(_productType?: string): Promise<unknown> {
    const [allMidsRaw, metaAndAssetCtxs] = await Promise.all([
      this.sdk.info.getAllMids(true),
      this.sdk.info.perpetuals.getMetaAndAssetCtxs(true)
    ]);

    const [meta, assetCtxs] = metaAndAssetCtxs;
    const universe = Array.isArray(meta?.universe) ? meta.universe : [];

    return universe.map((row, index) => {
      const coin = String(row.name ?? "").toUpperCase();
      const mid = parseMid((allMidsRaw as Record<string, string>)[coin]);
      const ctx = Array.isArray(assetCtxs) ? assetCtxs[index] : null;
      return {
        symbol: `${coin}-PERP`,
        coin,
        lastPr: mid,
        markPrice: Number(ctx?.markPx ?? mid ?? 0),
        indexPrice: Number(ctx?.oraclePx ?? mid ?? 0),
        bidPr: mid,
        askPr: mid,
        ts: Date.now()
      };
    });
  }

  async getCandles(params: {
    symbol: string;
    granularity: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    productType?: string;
  }): Promise<unknown> {
    const coin = parseCoinFromAnySymbol(params.symbol);
    const endTime = toMs(params.endTime ?? Date.now());
    const interval = toInterval(params.granularity);
    const defaultWindowMs = Math.max(60_000, (Number(params.limit ?? 500) || 500) * 60_000);
    const startTime = toMs(params.startTime ?? endTime - defaultWindowMs);

    return this.sdk.info.getCandleSnapshot(coin, interval, startTime, endTime, true);
  }

  async getDepth(symbol: string, _limit = 50, _productType?: string): Promise<unknown> {
    const coin = parseCoinFromAnySymbol(symbol);
    return this.sdk.info.getL2Book(coin, true);
  }

  async getTrades(_symbol: string, _limit = 100, _productType?: string): Promise<unknown> {
    // Hyperliquid's SDK does not expose a direct REST recent-trades helper in this package version.
    // Streaming uses websocket channels; for REST snapshots we return an empty array.
    return [];
  }
}
