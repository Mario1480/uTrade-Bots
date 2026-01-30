export type DexStatus = "OK" | "STALE" | "DOWN";

export type DextoolsPriceResponse = {
  price: number;
  price5m?: number;
  variation5m?: number;
  price1h?: number;
  variation1h?: number;
  price24h?: number;
  variation24h?: number;
};

export type DextoolsNormalizedPrice = {
  price: number;
  ts: number;
  raw?: unknown;
};

export type DexPriceFeedResult = {
  mid: number | null;
  status: DexStatus;
  ts: number | null;
  meta?: {
    price5m?: number;
    variation5m?: number;
    price1h?: number;
    variation1h?: number;
    price24h?: number;
    variation24h?: number;
  };
};
