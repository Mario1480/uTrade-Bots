import type { Balance, MidPrice, Order, Quote, MyTrade } from "@mm/core";

export interface ExchangePublic {
  getMidPrice(symbol: string): Promise<MidPrice>;
  // Optional: WS streaming can be added later; runner can poll.
}

export interface ExchangePrivate {
  getBalances(): Promise<Balance[]>;
  getOpenOrders(symbol: string): Promise<Order[]>;
  placeOrder(q: Quote): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  cancelAll(symbol?: string, side?: "buy" | "sell"): Promise<void>;
  getMyTrades(
    symbol: string,
    params?: { startTimeMs?: number; limit?: number }
  ): Promise<MyTrade[]>;
}

export interface Exchange extends ExchangePublic, ExchangePrivate {}
