import type { AccountState, FuturesPosition, MarginMode } from "@mm/futures-core";
import type { FuturesExchange, PlaceOrderRequest } from "../futures-exchange.interface.js";

export type CcxtPerpAdapterConfig = {
  exchangeId: string;
};

function notReady(action: string): never {
  throw new Error(`ccxt_perp_not_enabled:${action}`);
}

// Skeleton only: futures/perp production path stays native for now.
export class CcxtPerpAdapter implements FuturesExchange {
  readonly exchangeId: string;

  constructor(config: CcxtPerpAdapterConfig) {
    this.exchangeId = String(config.exchangeId ?? "").trim().toLowerCase();
    if (!this.exchangeId) {
      throw new Error("ccxt_perp_exchange_id_required");
    }
  }

  async getAccountState(): Promise<AccountState> {
    return notReady("getAccountState");
  }

  async getPositions(): Promise<FuturesPosition[]> {
    return notReady("getPositions");
  }

  async setLeverage(_symbol: string, _leverage: number, _marginMode: MarginMode): Promise<void> {
    return notReady("setLeverage");
  }

  async placeOrder(_req: PlaceOrderRequest): Promise<{ orderId: string }> {
    return notReady("placeOrder");
  }

  async cancelOrder(_orderId: string): Promise<void> {
    return notReady("cancelOrder");
  }
}
