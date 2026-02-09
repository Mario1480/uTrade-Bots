import type { ContractCacheOptions } from "@mm/futures-core";
import { ContractCache } from "@mm/futures-core";
import {
  BITGET_BLOCKED_SYMBOL_STATUSES,
  BITGET_DEFAULT_PRODUCT_TYPE,
  type BitgetProductType
} from "./bitget.constants.js";
import type { BitgetContractInfo, BitgetContractRaw } from "./bitget.types.js";
import { splitBaseQuote } from "./bitget.symbols.js";
import { BitgetMarketApi } from "./bitget.market.api.js";

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "normal").trim().toLowerCase();
}

function deriveTickSize(raw: BitgetContractRaw): number | null {
  const pricePlace = toNumber(raw.pricePlace);
  const priceEndStep = toNumber(raw.priceEndStep);

  if (pricePlace === null || pricePlace < 0) return null;
  const base = 1 / 10 ** pricePlace;
  if (priceEndStep === null || priceEndStep <= 0) return base;
  return base * priceEndStep;
}

function deriveStepSize(raw: BitgetContractRaw): number | null {
  const byMultiplier = toNumber(raw.sizeMultiplier);
  if (byMultiplier !== null && byMultiplier > 0) return byMultiplier;

  const volumePlace = toNumber(raw.volumePlace);
  if (volumePlace === null || volumePlace < 0) return null;
  return 1 / 10 ** volumePlace;
}

export function toBitgetContractInfo(raw: BitgetContractRaw, productType: BitgetProductType): BitgetContractInfo {
  const symbol = String(raw.symbol ?? "").trim().toUpperCase();
  const status = normalizeStatus(raw.symbolStatus);
  const pair = splitBaseQuote(symbol);
  const tickSize = deriveTickSize(raw);
  const stepSize = deriveStepSize(raw);

  return {
    canonicalSymbol: symbol,
    mexcSymbol: symbol,
    baseAsset: raw.baseCoin ?? pair.baseAsset,
    quoteAsset: raw.quoteCoin ?? pair.quoteAsset,
    apiAllowed: !BITGET_BLOCKED_SYMBOL_STATUSES.has(status),
    priceScale: toNumber(raw.pricePlace),
    volScale: toNumber(raw.volumePlace),
    priceUnit: tickSize,
    volUnit: stepSize,
    tickSize,
    stepSize,
    minVol: toNumber(raw.minTradeNum),
    maxVol: toNumber(raw.maxOrderQty) ?? toNumber(raw.maxMarketOrderQty),
    minLeverage: toNumber(raw.minLever),
    maxLeverage: toNumber(raw.maxLever),
    contractSize: toNumber(raw.sizeMultiplier),
    makerFeeRate: toNumber(raw.makerFeeRate),
    takerFeeRate: toNumber(raw.takerFeeRate),
    updatedAt: new Date().toISOString(),
    productType,
    symbolStatus: status,
    raw
  };
}

export class BitgetContractCache {
  private readonly cache: ContractCache;

  constructor(
    private readonly marketApi: BitgetMarketApi,
    private readonly productType: BitgetProductType = BITGET_DEFAULT_PRODUCT_TYPE,
    options: Pick<ContractCacheOptions, "ttlSeconds" | "now"> = {}
  ) {
    this.cache = new ContractCache({
      ttlSeconds: options.ttlSeconds,
      now: options.now,
      loader: async () => {
        const rows = await this.marketApi.getContracts(this.productType);
        return rows.map((row) => toBitgetContractInfo(row, this.productType));
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

  async getByCanonical(symbol: string): Promise<BitgetContractInfo | null> {
    return (await this.cache.getByCanonical(symbol)) as BitgetContractInfo | null;
  }

  async getByBitget(symbol: string): Promise<BitgetContractInfo | null> {
    return (await this.cache.getByMexc(symbol)) as BitgetContractInfo | null;
  }

  snapshot(): BitgetContractInfo[] {
    return this.cache.snapshot() as BitgetContractInfo[];
  }

  getSymbolRegistry() {
    return this.cache.getSymbolRegistry();
  }
}
