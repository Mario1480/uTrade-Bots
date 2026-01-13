import type { MarketMakingConfig, Quote } from "@mm/core";
import { makeRng } from "@mm/core";
import { buildQuotes } from "./level-builder.js";

export function buildMmQuotes(params: {
  symbol: string;
  mid: number;
  cfg: MarketMakingConfig;
  inventoryRatio: number;
  includeJitter?: boolean;
  seed?: number;
}): Quote[] {
  const cfg = params.includeJitter === false
    ? { ...params.cfg, jitterPct: 0 }
    : params.cfg;

  const rng = Number.isFinite(params.seed) ? makeRng(params.seed as number) : undefined;

  return buildQuotes({
    symbol: params.symbol,
    mid: params.mid,
    cfg,
    inventoryRatio: params.inventoryRatio,
    rng
  });
}
