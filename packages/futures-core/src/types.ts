export type MarginMode = "isolated" | "cross";
export type PositionSide = "long" | "short";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";

export type FuturesSymbol = string;

export type FuturesPosition = {
  symbol: FuturesSymbol;
  side: PositionSide;
  size: number;         // contracts or base qty (decide later)
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

export type TradeOrderParams = {
  type?: OrderType;
  qty?: number;
  price?: number;
  reduceOnly?: boolean;
  roundingMode?: "down" | "up" | "nearest";
  leverage?: number;
  marginMode?: MarginMode;
  desiredNotionalUsd?: number;
  riskUsd?: number;
  stopDistancePct?: number;
  markPrice?: number;
  cancelOrderId?: string;
};

export type TradeIntent =
  | {
      type: "open";
      symbol: FuturesSymbol;
      side: PositionSide;
      confidence?: number;
      order?: TradeOrderParams;
    }
  | {
      type: "close";
      symbol: FuturesSymbol;
      reason?: string;
      order?: TradeOrderParams;
    }
  | { type: "none" };
