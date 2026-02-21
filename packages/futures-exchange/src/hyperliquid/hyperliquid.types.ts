import type { AccountState, ContractInfo, FuturesPosition } from "@mm/futures-core";

export type HyperliquidProductType = "USDT-FUTURES";

export type HttpMethod = "GET" | "POST";

export type HyperliquidLogEntry = {
  at: string;
  endpoint: string;
  method: HttpMethod;
  durationMs: number;
  status?: number;
  ok: boolean;
  message?: string;
  requestId?: string;
};

export type HyperliquidAdapterConfig = {
  // Reuses existing exchange-account field naming in this repository.
  apiKey?: string; // walletAddress
  apiSecret?: string; // privateKey
  apiPassphrase?: string; // vaultAddress (optional)
  restBaseUrl?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  marginCoin?: string;
  productType?: HyperliquidProductType;
  defaultPositionMode?: "one-way" | "hedge";
  log?: (entry: HyperliquidLogEntry) => void;
};

export type HyperliquidContractRaw = {
  name?: string;
  maxLeverage?: number | string;
  onlyIsolated?: boolean;
  szDecimals?: number | string;
};

export type HyperliquidUniverseRaw = HyperliquidContractRaw;

export type HyperliquidAssetCtxRaw = {
  markPx?: string | number;
  oraclePx?: string | number;
  openInterest?: string | number;
  dayNtlVlm?: string | number;
};

export type HyperliquidContractInfo = ContractInfo & {
  assetIndex: number;
  coin: string;
  raw: {
    universe: HyperliquidUniverseRaw;
    assetCtx: HyperliquidAssetCtxRaw | null;
  };
};

export type HyperliquidAccountRaw = {
  marginCoin?: string;
  available?: string;
  accountEquity?: string;
  crossAvailable?: string;
};

export type HyperliquidPositionRaw = {
  symbol?: string;
  holdSide?: string;
  total?: string;
  avgOpenPrice?: string;
  markPrice?: string;
  unrealizedPL?: string;
  leverage?: string;
  marginMode?: string;
  reduceOnly?: boolean;
};

export type HyperliquidOrderPlaceRequest = {
  symbol: string;
  productType?: HyperliquidProductType;
  marginMode?: "isolated" | "crossed";
  marginCoin?: string;
  size: string;
  price?: string;
  side: "buy" | "sell";
  orderType: "limit" | "market";
  force?: "gtc" | "ioc" | "fok" | "post_only";
  clientOid?: string;
  reduceOnly?: "YES" | "NO";
  presetStopSurplusPrice?: string;
  presetStopLossPrice?: string;
};

export type HyperliquidOrderModifyRequest = {
  symbol: string;
  productType?: HyperliquidProductType;
  orderId?: string;
  clientOid?: string;
  newClientOid?: string;
  newPrice?: string;
  newSize?: string;
  newPresetStopSurplusPrice?: string;
  newPresetStopLossPrice?: string;
};

export type HyperliquidPositionTpSlRequest = {
  symbol: string;
  productType?: HyperliquidProductType;
  marginCoin?: string;
  holdSide: "long" | "short";
  planType: "profit_plan" | "loss_plan";
  triggerPrice: string;
  executePrice?: string;
};

export type HyperliquidOrderRaw = {
  orderId?: string;
  clientOid?: string;
  symbol?: string;
  price?: string;
  size?: string;
  side?: string;
  orderType?: string;
  status?: string;
  cTime?: string;
  triggerPrice?: string;
  planType?: string;
  reduceOnly?: boolean;
  raw?: unknown;
};

export type HyperliquidExtendedAccountState = AccountState & {
  raw: unknown;
};

export type HyperliquidExtendedPosition = FuturesPosition & {
  raw: unknown;
};

export type HyperliquidInfoResponse = unknown;

export type HyperliquidExchangeResponse = {
  status?: string;
  response?: unknown;
};
