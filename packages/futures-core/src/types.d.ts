export type MarginMode = "isolated" | "cross";
export type PositionSide = "long" | "short";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type FuturesSymbol = string;
export type FuturesPosition = {
    symbol: FuturesSymbol;
    side: PositionSide;
    size: number;
    entryPrice: number;
    markPrice?: number;
    unrealizedPnl?: number;
};
export type AccountState = {
    equity: number;
    availableMargin?: number;
    marginMode?: MarginMode;
};
export type RiskLimits = {
    maxLeverage: number;
    maxNotionalUsd?: number;
    dailyLossLimitUsd?: number;
};
export type TradeIntent = {
    type: "open";
    symbol: FuturesSymbol;
    side: PositionSide;
    confidence?: number;
} | {
    type: "close";
    symbol: FuturesSymbol;
    reason?: string;
} | {
    type: "none";
};
