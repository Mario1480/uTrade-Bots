import type { MarketMakingConfig, Quote, Rng } from "@mm/core";
import { clamp, randBetween } from "@mm/core";
import { weights } from "./distribution.js";

export function buildQuotes(params: {
  symbol: string;
  mid: number;
  cfg: MarketMakingConfig;
  inventoryRatio: number; // current_base / target_base
  rng?: Rng;
}): Quote[] {
  const { symbol, mid, cfg } = params;

  const skew = clamp((params.inventoryRatio - 1) * cfg.skewFactor, -cfg.maxSkew, cfg.maxSkew);
  const skewedMid = mid * (1 + skew);

  const buyN = cfg.levelsDown;
  const sellN = cfg.levelsUp;

  const buyW = weights(buyN, cfg.distribution, params.rng);
  const sellW = weights(sellN, cfg.distribution, params.rng);

  const quotes: Quote[] = [];

  const minOrderUsdt = Math.max(0, cfg.minOrderUsdt ?? 0);
  const maxOrderUsdt = Math.max(0, cfg.maxOrderUsdt ?? 0);
  const effectiveMaxOrder = maxOrderUsdt > 0 ? Math.max(maxOrderUsdt, minOrderUsdt) : 0;

  const halfMin = cfg.spreadPct / 2;
  const halfMax = cfg.maxSpreadPct / 2;

  const buyDenom = Math.max(1, buyN - 1);
  const sellDenom = Math.max(1, sellN - 1);

  // Buy levels
  for (let i = 0; i < buyN; i++) {
    const pctRaw = halfMin + (i / buyDenom) * Math.max(0, halfMax - halfMin);
    const pct = clamp(pctRaw, 0, 0.95);
    const base = skewedMid * (1 - pct);
    const jitter = cfg.jitterPct > 0
      ? (1 + randBetween(-cfg.jitterPct, cfg.jitterPct, params.rng))
      : 1;
    const price = base * jitter;

    if (!Number.isFinite(price) || price <= 0) continue;

    let notional = cfg.budgetQuoteUsdt * buyW[i];
    if (minOrderUsdt > 0 && notional < minOrderUsdt) continue;
    if (effectiveMaxOrder > 0 && notional > effectiveMaxOrder) notional = effectiveMaxOrder;
    const qty = notional / price;
    if (!Number.isFinite(qty) || qty <= 0) continue;

    quotes.push({
      symbol,
      side: "buy",
      type: "limit",
      price,
      qty,
      postOnly: true,
      clientOrderId: `mmb${i}`
    });
  }

  // Sell levels
  for (let i = 0; i < sellN; i++) {
    const pctRaw = halfMin + (i / sellDenom) * Math.max(0, halfMax - halfMin);
    const pct = clamp(pctRaw, 0, 0.95);
    const base = skewedMid * (1 + pct);
    const jitter = cfg.jitterPct > 0
      ? (1 + randBetween(-cfg.jitterPct, cfg.jitterPct, params.rng))
      : 1;
    const price = base * jitter;

    if (!Number.isFinite(price) || price <= 0) continue;

    let qty = cfg.budgetBaseToken * sellW[i];
    let notional = qty * price;
    if (minOrderUsdt > 0 && notional < minOrderUsdt) continue;
    if (effectiveMaxOrder > 0 && notional > effectiveMaxOrder) {
      qty = effectiveMaxOrder / price;
      notional = qty * price;
    }
    if (!Number.isFinite(qty) || qty <= 0) continue;

    quotes.push({
      symbol,
      side: "sell",
      type: "limit",
      price,
      qty,
      postOnly: true,
      clientOrderId: `mms${i}`
    });
  }

  return quotes;
}
