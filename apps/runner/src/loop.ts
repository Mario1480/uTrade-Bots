import {
  FuturesEngine,
  isGlobalTradingEnabled,
  type EngineExecutionResult,
  type EngineRiskEvent
} from "@mm/futures-engine";
import type { TradeIntent } from "@mm/futures-core";
import { DummyStrategy } from "@mm/strategies";
import type { ActiveFuturesBot } from "./db.js";
import type { RiskEventType } from "./db.js";
import { markExchangeAccountUsed, writeBotTick, writeRiskEvent } from "./db.js";

const noopExchange = {
  async getAccountState() {
    return { equity: 0 };
  },
  async getPositions() {
    return [];
  },
  async setLeverage() {
    return;
  },
  async placeOrder() {
    return { orderId: "noop" };
  },
  async cancelOrder() {
    return;
  }
};

const engine = new FuturesEngine(noopExchange, {
  isTradingEnabled: () => isGlobalTradingEnabled()
});

export type LoopTickResult = {
  outcome: "ok" | "blocked";
  intent: TradeIntent;
  reason: string;
};

async function handleEngineRiskEvent(botId: string, event: EngineRiskEvent) {
  const type: RiskEventType =
    event.type === "KILL_SWITCH_BLOCK"
      ? "KILL_SWITCH_BLOCK"
      : "BOT_ERROR";

  await writeRiskEvent({
    botId,
    type,
    message: event.message,
    meta: {
      engineType: event.type,
      ...event.meta,
      timestamp: event.timestamp
    }
  });
}

function toReason(strategyKey: string, intent: TradeIntent, engineResult: EngineExecutionResult): string {
  if (engineResult.status === "blocked") {
    return `blocked:${engineResult.reason};strategy:${strategyKey};intent:${intent.type}`;
  }
  return `strategy:${strategyKey};intent:${intent.type};engine:${engineResult.status}`;
}

export async function loopOnce(bot: ActiveFuturesBot, workerId?: string): Promise<LoopTickResult> {
  const intent = await DummyStrategy.onTick({
    nowMs: Date.now(),
    symbol: bot.symbol
  });

  const engineResult = await engine.execute(intent, {
    botId: bot.id,
    emitRiskEvent: (event) => handleEngineRiskEvent(bot.id, event)
  });

  const reason = toReason(bot.strategyKey, intent, engineResult);
  await writeBotTick({
    botId: bot.id,
    status: "running",
    reason,
    intent,
    workerId: workerId ?? null
  });

  await markExchangeAccountUsed(bot.exchangeAccountId);

  if (engineResult.status === "blocked") {
    return {
      outcome: "blocked",
      intent,
      reason
    };
  }

  return {
    outcome: "ok",
    intent,
    reason
  };
}
