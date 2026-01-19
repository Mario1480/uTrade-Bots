export type BotStatus = "STOPPED" | "RUNNING" | "PAUSED" | "ERROR";

export type Side = "buy" | "sell";
export type OrderType = "limit" | "market";

export type Distribution = "LINEAR" | "VALLEY" | "RANDOM";
export type VolumeMode = "PASSIVE" | "MIXED" | "ACTIVE";
export type PriceSupportMode = "PASSIVE" | "MIXED";
export type PriceSourceType = "TICKER" | "ORDERBOOK_MID";
