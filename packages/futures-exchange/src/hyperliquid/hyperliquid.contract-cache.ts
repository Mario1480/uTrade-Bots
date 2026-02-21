import type { ContractCacheOptions } from "@mm/futures-core";
import { ContractCache } from "@mm/futures-core";
import type { HyperliquidContractInfo, HyperliquidUniverseRaw, HyperliquidAssetCtxRaw } from "./hyperliquid.types.js";
import { HyperliquidMarketApi } from "./hyperliquid.market.api.js";
import { coinToCanonicalSymbol, normalizeHyperliquidSymbol, toInternalPerpSymbol } from "./hyperliquid.symbols.js";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStepSize(szDecimals: unknown): number | null {
  const scale = toNumber(szDecimals);
  if (scale === null || scale < 0) return null;
  return 1 / 10 ** scale;
}

function toContractInfo(params: {
  index: number;
  universe: HyperliquidUniverseRaw;
  assetCtx: HyperliquidAssetCtxRaw | null;
}): HyperliquidContractInfo {
  const coin = normalizeHyperliquidSymbol(String(params.universe.name ?? ""));
  const canonicalSymbol = coinToCanonicalSymbol(coin);
  const exchangeSymbol = toInternalPerpSymbol(coin);
  const stepSize = toStepSize(params.universe.szDecimals);
  const maxLeverage = toNumber(params.universe.maxLeverage);

  return {
    canonicalSymbol,
    mexcSymbol: exchangeSymbol,
    baseAsset: coin,
    quoteAsset: "USDC",
    apiAllowed: true,
    priceScale: null,
    volScale: toNumber(params.universe.szDecimals),
    priceUnit: null,
    volUnit: stepSize,
    tickSize: null,
    stepSize,
    minVol: stepSize,
    maxVol: null,
    minLeverage: 1,
    maxLeverage,
    contractSize: 1,
    makerFeeRate: null,
    takerFeeRate: null,
    updatedAt: new Date().toISOString(),
    assetIndex: params.index,
    coin,
    raw: {
      universe: params.universe,
      assetCtx: params.assetCtx
    }
  };
}

export class HyperliquidContractCache {
  private readonly cache: ContractCache;

  constructor(
    private readonly marketApi: HyperliquidMarketApi,
    options: Pick<ContractCacheOptions, "ttlSeconds" | "now"> = {}
  ) {
    this.cache = new ContractCache({
      ttlSeconds: options.ttlSeconds,
      now: options.now,
      loader: async () => {
        const [meta, assetCtxs] = await this.marketApi.getMetaAndAssetCtxs();
        const universe = Array.isArray(meta?.universe) ? meta.universe : [];
        return universe
          .map((row, index) =>
            toContractInfo({
              index,
              universe: row,
              assetCtx: Array.isArray(assetCtxs) ? (assetCtxs[index] ?? null) : null
            })
          )
          .filter((row) => row.coin.length > 0);
      }
    });
  }

  async warmup(): Promise<void> {
    await this.cache.warmup();
  }

  startBackgroundRefresh(): void {
    this.cache.startBackgroundRefresh();
  }

  stopBackgroundRefresh(): void {
    this.cache.stopBackgroundRefresh();
  }

  async refresh(force = false): Promise<void> {
    await this.cache.refresh(force);
  }

  async getByCanonical(symbol: string): Promise<HyperliquidContractInfo | null> {
    return (await this.cache.getByCanonical(symbol)) as HyperliquidContractInfo | null;
  }

  async getByHyperliquid(symbol: string): Promise<HyperliquidContractInfo | null> {
    return (await this.cache.getByMexc(symbol)) as HyperliquidContractInfo | null;
  }

  snapshot(): HyperliquidContractInfo[] {
    return this.cache.snapshot() as HyperliquidContractInfo[];
  }

  getSymbolRegistry() {
    return this.cache.getSymbolRegistry();
  }
}
