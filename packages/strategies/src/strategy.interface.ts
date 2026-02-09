import type { TradeIntent } from "@mm/futures-core";

export interface StrategyContext {
  nowMs: number;
  symbol: string;
}

export interface Strategy {
  onTick(ctx: StrategyContext): Promise<TradeIntent>;
}