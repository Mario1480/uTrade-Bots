export type SymbolMeta = {
  symbol: string;
  priceStep?: number;
  qtyStep?: number;
  minQty?: number;
  minNotional?: number;
};

function roundDownToStep(x: number, step: number): number {
  if (step <= 0) return x;
  const k = Math.floor(x / step + 1e-12);
  return k * step;
}

export function normalizePrice(price: number, meta?: SymbolMeta): number {
  if (!meta?.priceStep || meta.priceStep <= 0) return price;
  return roundDownToStep(price, meta.priceStep);
}

export function normalizeQty(qty: number, meta?: SymbolMeta): number {
  if (!meta?.qtyStep || meta.qtyStep <= 0) return qty;
  return roundDownToStep(qty, meta.qtyStep);
}

export function checkMins(params: {
  price: number;
  qty: number;
  meta?: SymbolMeta;
}): { ok: true } | { ok: false; reason: string } {
  const { price, qty, meta } = params;
  if (!meta) return { ok: true };

  if (meta.minQty && qty < meta.minQty) {
    return { ok: false, reason: `qty ${qty} < minQty ${meta.minQty}` };
  }

  const notional = price * qty;
  if (meta.minNotional && notional < meta.minNotional) {
    return { ok: false, reason: `notional ${notional} < minNotional ${meta.minNotional}` };
  }

  return { ok: true };
}
