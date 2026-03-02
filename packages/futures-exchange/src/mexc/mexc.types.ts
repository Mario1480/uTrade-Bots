import type { AccountState, ContractInfo, FuturesPosition } from "@mm/futures-core";

export type HttpMethod = "GET" | "POST" | "DELETE";

export type MexcApiResponse<T> = {
  success?: boolean;
  code?: number;
  message?: string;
  data: T;
};

export type MexcContractDetail = {
  symbol: string;
  displayName?: string;
  baseCoin?: string;
  quoteCoin?: string;
  priceUnit?: string;
  volUnit?: string;
  minVol?: string;
  maxVol?: string;
  priceScale?: number;
  volScale?: number;
  contractSize?: string;
  apiAllowed?: boolean;
  maxLeverage?: number;
  minLeverage?: number;
  makerFeeRate?: string;
  takerFeeRate?: string;
};

export type MexcOrderBookSnapshot = {
  asks?: Array<[string | number, string | number]>;
  bids?: Array<[string | number, string | number]>;
  version?: number;
  timestamp?: number;
};

export type MexcPositionRaw = {
  symbol?: string;
  positionType?: number | string;
  holdVol?: number | string;
  positionVol?: number | string;
  openAvgPrice?: number | string;
  avgPrice?: number | string;
  holdAvgPrice?: number | string;
  fairPrice?: number | string;
  unrealizedPnl?: number | string;
};

export type MexcAccountAssetRaw = {
  currency?: string;
  availableBalance?: number | string;
  cashBalance?: number | string;
  equity?: number | string;
  frozenBalance?: number | string;
};

export type MexcPlaceOrderRequest = {
  symbol: string;
  price?: number;
  vol: number;
  side: number;
  type: number;
  openType?: number;
  leverage?: number;
  externalOid?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  positionMode?: number;
  reduceOnly?: boolean;
};

export type MexcOrderResponse = {
  orderId?: string;
  order_id?: string;
  externalOid?: string;
  state?: number;
};

export type MexcContractInfo = ContractInfo & {
  raw: MexcContractDetail;
};

export type MexcCapabilities = {
  placeOrder: boolean;
  batchPlaceOrder: boolean;
  cancelOrder: boolean;
  cancelWithExternal: boolean;
  cancelAll: boolean;
  stopOrders: boolean;
  planOrders: boolean;
  positionModeChange: boolean;
  leverageChange: boolean;
  privateWs: boolean;
};

export type MexcAdapterConfig = {
  apiKey?: string;
  apiSecret?: string;
  productType?: string;
  marginCoin?: string;
  restBaseUrl?: string;
  wsUrl?: string;
  recvWindowSeconds?: number;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  capabilities?: Partial<MexcCapabilities>;
  log?: (entry: MexcLogEntry) => void;
};

export type MexcLogEntry = {
  at: string;
  endpoint: string;
  method: HttpMethod;
  durationMs: number;
  status?: number;
  mexcCode?: number;
  ok: boolean;
  message?: string;
  requestId?: string;
};

export type MexcPrivateWsAuth = {
  apiKey: string;
  apiSecret: string;
};

export type MexcWsPayload = {
  channel?: string;
  symbol?: string;
  data?: unknown;
  method?: string;
  [key: string]: unknown;
};

export type MexcWsSubscription = {
  method: string;
  param?: Record<string, unknown>;
  subscribe?: boolean;
  [key: string]: unknown;
};

export type MexcFillEvent = {
  orderId: string;
  symbol: string;
  side?: string;
  price?: number;
  qty?: number;
  raw: unknown;
};

export type MexcPositionEvent = {
  symbol: string;
  size?: number;
  side?: string;
  raw: unknown;
};

export type MexcOrderEvent = {
  orderId: string;
  symbol?: string;
  status?: string;
  raw: unknown;
};

export type MexcExtendedAccountState = AccountState & {
  raw: unknown;
};

export type MexcExtendedPosition = FuturesPosition & {
  raw: unknown;
};
