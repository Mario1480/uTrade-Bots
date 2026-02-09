export const BITGET_DEFAULT_REST_BASE_URL = "https://api.bitget.com";

export const BITGET_DEFAULT_PUBLIC_WS_URL = "wss://ws.bitget.com/v2/ws/public";
export const BITGET_DEFAULT_PRIVATE_WS_URL = "wss://ws.bitget.com/v2/ws/private";

export const BITGET_DEFAULT_PRODUCT_TYPE = "USDT-FUTURES";
export const BITGET_DEFAULT_MARGIN_COIN = "USDT";

export const BITGET_DEFAULT_TIMEOUT_MS = 12_000;
export const BITGET_DEFAULT_RETRY_ATTEMPTS = 3;
export const BITGET_DEFAULT_RETRY_BASE_DELAY_MS = 300;

export const BITGET_DEFAULT_PING_INTERVAL_MS = 30_000;
export const BITGET_DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
export const BITGET_DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;

export const BITGET_SUCCESS_CODE = "00000";

export const BITGET_PRODUCT_TYPES = [
  "USDT-FUTURES",
  "USDC-FUTURES",
  "COIN-FUTURES"
] as const;

export type BitgetProductType = (typeof BITGET_PRODUCT_TYPES)[number];

export const BITGET_BLOCKED_SYMBOL_STATUSES = new Set<string>([
  "maintain",
  "maintaining",
  "limit_open",
  "restrictedapi",
  "off",
  "delisted",
  "suspend"
]);
