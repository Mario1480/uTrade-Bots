import type { TradeIntent } from "@mm/futures-core";
import type { ActiveFuturesBot } from "../db.js";
import type { RunnerGateSummary } from "../runtime/decisionTrace.js";
import type { SignalDecision } from "../signal/types.js";

export type ExecutionResult = {
  status: "executed" | "blocked" | "noop" | "error";
  reason: string;
  orderIds?: string[];
  metadata: Record<string, unknown>;
  legacy: {
    outcome: "ok" | "blocked";
    intent: TradeIntent;
    gate: RunnerGateSummary;
  };
};

export type ExecutionContext = {
  bot: ActiveFuturesBot;
  now: Date;
  workerId?: string;
};

export interface ExecutionMode {
  key: string;
  execute(signal: SignalDecision, ctx: ExecutionContext): Promise<ExecutionResult>;
}
