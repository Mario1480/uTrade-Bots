import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  FuturesSymbol,
  MarginMode,
  OrderSide,
  OrderType
} from "@mm/futures-core";

export type PlaceOrderRequest = {
  symbol: FuturesSymbol;
  side: OrderSide;
  type: OrderType;
  qty: number;
  price?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  reduceOnly?: boolean;
  marginMode?: MarginMode;
};

export interface FuturesExchange {
  getAccountState(): Promise<AccountState>;
  getPositions(): Promise<FuturesPosition[]>;
  setLeverage(symbol: FuturesSymbol, leverage: number, marginMode: MarginMode): Promise<void>;
  placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string }>;
  cancelOrder(orderId: string): Promise<void>;
  getContractInfo?(symbol: FuturesSymbol): Promise<ContractInfo | null>;
  toExchangeSymbol?(symbol: FuturesSymbol): Promise<string> | string;
  toCanonicalSymbol?(symbol: string): string | null;
}
