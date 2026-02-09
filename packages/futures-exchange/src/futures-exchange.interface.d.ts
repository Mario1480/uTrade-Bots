import type { AccountState, FuturesPosition, FuturesSymbol, MarginMode, OrderSide, OrderType } from "@mm/futures-core";
export type PlaceOrderRequest = {
    symbol: FuturesSymbol;
    side: OrderSide;
    type: OrderType;
    qty: number;
    price?: number;
    reduceOnly?: boolean;
};
export interface FuturesExchange {
    getAccountState(): Promise<AccountState>;
    getPositions(): Promise<FuturesPosition[]>;
    setLeverage(symbol: FuturesSymbol, leverage: number, marginMode: MarginMode): Promise<void>;
    placeOrder(req: PlaceOrderRequest): Promise<{
        orderId: string;
    }>;
    cancelOrder(orderId: string): Promise<void>;
}
