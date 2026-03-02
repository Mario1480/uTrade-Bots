export const MEXC_DEFAULT_REST_BASE_URL = "https://api.mexc.com";
export const MEXC_DEFAULT_WS_URL = "wss://contract.mexc.com/edge";
export const MEXC_DEFAULT_PRODUCT_TYPE = "USDT-FUTURES" as const;
export const MEXC_DEFAULT_MARGIN_COIN = "USDT";

export const MEXC_DEFAULT_RECV_WINDOW_SECONDS = 30;
export const MEXC_MAX_RECV_WINDOW_SECONDS = 60;

export const MEXC_DEFAULT_TIMEOUT_MS = 12_000;
export const MEXC_DEFAULT_RETRY_ATTEMPTS = 3;
export const MEXC_DEFAULT_RETRY_BASE_DELAY_MS = 300;

export const MEXC_DEFAULT_PING_INTERVAL_MS = 15_000;
export const MEXC_DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
export const MEXC_DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;

export const MEXC_OPEN_API_PREFIX = "/api/v1";

export const MEXC_MAINTENANCE_ENDPOINTS = new Set<string>([
  "/api/v1/private/order/submit",
  "/api/v1/private/order/submit_batch",
  "/api/v1/private/order/cancel",
  "/api/v1/private/order/cancel_with_external",
  "/api/v1/private/order/cancel_all",
  "/api/v1/private/planorder/place",
  "/api/v1/private/planorder/cancel",
  "/api/v1/private/planorder/cancel_all",
  "/api/v1/private/stoporder/place",
  "/api/v1/private/stoporder/cancel",
  "/api/v1/private/stoporder/cancel_all",
  "/api/v1/private/stoporder/change_price",
  "/api/v1/private/stoporder/change_plan_price"
]);

export const MEXC_PRIVATE_WS_CHANNELS = [
  "push.personal.order",
  "push.personal.order.deal",
  "push.personal.position",
  "push.personal.plan.order",
  "push.personal.stop.planorder",
  "push.personal.track.order",
  "push.personal.stop.order",
  "push.personal.liquidate.risk",
  "push.personal.position.mode",
  "push.personal.leverage.mode",
  "push.personal.asset",
  "push.personal.risk.limit",
  "push.personal.adl.level"
] as const;

export type MexcPrivateWsChannel = (typeof MEXC_PRIVATE_WS_CHANNELS)[number];

export const MEXC_PUBLIC_WS_CHANNELS = [
  "sub.ticker",
  "sub.tickers",
  "sub.depth",
  "sub.depth.step",
  "sub.depth.full",
  "sub.deal",
  "sub.kline",
  "sub.fair.price",
  "sub.index.price",
  "sub.funding.rate",
  "sub.contract",
  "unsub.ticker",
  "unsub.tickers",
  "unsub.depth",
  "unsub.depth.step",
  "unsub.depth.full",
  "unsub.deal",
  "unsub.kline",
  "unsub.fair.price",
  "unsub.index.price",
  "unsub.funding.rate",
  "unsub.contract"
] as const;

export type MexcPublicWsChannel = (typeof MEXC_PUBLIC_WS_CHANNELS)[number];
