import type { TradeIntent } from "@mm/futures-core";
import type { ActiveFuturesBot } from "../db.js";

export type SignalSide = "long" | "short" | "flat";

export type SignalDecision = {
  side: SignalSide;
  confidence: number | null;
  reason: string;
  metadata: Record<string, unknown>;
  // Legacy compatibility for current runner/execution flow.
  legacyIntent: TradeIntent;
};

export type SignalContext = {
  bot: ActiveFuturesBot;
  now: Date;
  workerId?: string;
};

export interface SignalEngine {
  key: string;
  decide(ctx: SignalContext): Promise<SignalDecision>;
}
