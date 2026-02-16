import type { AccountState, ContractInfo, FuturesPosition } from "@mm/futures-core";
import type { BitgetProductType } from "./bitget.constants.js";

export type HttpMethod = "GET" | "POST" | "DELETE";

export type BitgetApiResponse<T> = {
  code: string;
  msg: string;
  requestTime?: number;
  data: T;
};

export type BitgetLogEntry = {
  at: string;
  endpoint: string;
  method: HttpMethod;
  durationMs: number;
  status?: number;
  code?: string;
  ok: boolean;
  message?: string;
  requestId?: string;
};

export type BitgetAdapterConfig = {
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  restBaseUrl?: string;
  publicWsUrl?: string;
  privateWsUrl?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  productType?: BitgetProductType;
  marginCoin?: string;
  defaultPositionMode?: "one-way" | "hedge";
  log?: (entry: BitgetLogEntry) => void;
};

export type BitgetContractRaw = {
  symbol: string;
  baseCoin?: string;
  quoteCoin?: string;
  buyLimitPriceRatio?: string;
  sellLimitPriceRatio?: string;
  feeRateUpRatio?: string;
  makerFeeRate?: string;
  takerFeeRate?: string;
  openCostUpRatio?: string;
  supportMarginCoins?: string[];
  minTradeNum?: string;
  priceEndStep?: string;
  volumePlace?: string;
  pricePlace?: string;
  sizeMultiplier?: string;
  symbolType?: string;
  symbolStatus?: string;
  offTime?: string;
  limitOpenTime?: string;
  deliveryTime?: string;
  deliveryStartTime?: string;
  launchTime?: string;
  fundInterval?: string;
  minLever?: string;
  maxLever?: string;
  posLimit?: string;
  maintainTime?: string;
  maxMarketOrderQty?: string;
  maxOrderQty?: string;
};

export type BitgetContractInfo = ContractInfo & {
  productType: BitgetProductType;
  symbolStatus: string;
  raw: BitgetContractRaw;
};

export type BitgetAccountRaw = {
  marginCoin?: string;
  available?: string;
  accountEquity?: string;
  crossAvailable?: string;
  crossedMaxAvailable?: string;
  isolatedMaxAvailable?: string;
};

export type BitgetPositionRaw = {
  symbol?: string;
  holdSide?: string;
  total?: string;
  available?: string;
  avgOpenPrice?: string;
  markPrice?: string;
  unrealizedPL?: string;
  leverage?: string;
  marginMode?: string;
};

export type BitgetOrderPlaceRequest = {
  symbol: string;
  productType: BitgetProductType;
  marginMode?: "isolated" | "crossed";
  marginCoin?: string;
  size: string;
  price?: string;
  side: "buy" | "sell";
  tradeSide?: "open" | "close";
  orderType: "limit" | "market";
  force?: "gtc" | "ioc" | "fok" | "post_only";
  clientOid?: string;
  reduceOnly?: "YES" | "NO";
  presetStopSurplusPrice?: string;
  presetStopLossPrice?: string;
};

export type BitgetOrderModifyRequest = {
  symbol: string;
  productType: BitgetProductType;
  orderId?: string;
  clientOid?: string;
  newClientOid?: string;
  newPrice?: string;
  newSize?: string;
  newPresetStopSurplusPrice?: string;
  newPresetStopLossPrice?: string;
};

export type BitgetPositionTpSlRequest = {
  symbol: string;
  productType: BitgetProductType;
  marginCoin?: string;
  holdSide: "long" | "short";
  planType: "profit_plan" | "loss_plan";
  triggerPrice: string;
  executePrice?: string;
};

export type BitgetOrderRaw = {
  orderId?: string;
  clientOid?: string;
  symbol?: string;
  price?: string;
  size?: string;
  side?: string;
  orderType?: string;
  status?: string;
  cTime?: string;
};

export type BitgetWsSubscriptionArg = {
  instType: string;
  channel: string;
  instId?: string;
};

export type BitgetWsPayload = {
  event?: string;
  code?: string;
  msg?: string;
  action?: string;
  arg?: BitgetWsSubscriptionArg;
  data?: unknown;
  op?: string;
  [key: string]: unknown;
};

export type BitgetWsSubscription = {
  op: "subscribe" | "unsubscribe";
  args: BitgetWsSubscriptionArg[];
};

export type BitgetFillEvent = {
  orderId: string;
  symbol: string;
  side?: string;
  price?: number;
  qty?: number;
  raw: unknown;
};

export type BitgetPositionEvent = {
  symbol: string;
  size?: number;
  side?: string;
  raw: unknown;
};

export type BitgetOrderEvent = {
  orderId: string;
  symbol?: string;
  status?: string;
  raw: unknown;
};

export type BitgetExtendedAccountState = AccountState & {
  raw: unknown;
};

export type BitgetExtendedPosition = FuturesPosition & {
  raw: unknown;
};
