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
import {
  loadLatestPredictionStateForGate,
  markExchangeAccountUsed,
  writeBotTick,
  writeRiskEvent
} from "./db.js";
import { log } from "./logger.js";
import {
  applySizeMultiplierToIntent,
  evaluateGate,
  getPredictionGateMetrics,
  readPredictionGatePolicy,
  recordPredictionGateDecision,
  type PredictionGateResult
} from "./prediction-gate.js";
import { runPredictionCopierTick } from "./prediction-copier.js";

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
  gate: {
    applied: boolean;
    allow: boolean;
    reason: string;
    sizeMultiplier: number;
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  };
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
  if (bot.strategyKey === "prediction_copier") {
    const copierResult = await runPredictionCopierTick(bot, workerId);
    await writeBotTick({
      botId: bot.id,
      status: "running",
      reason: copierResult.reason,
      intent: copierResult.intent,
      workerId: workerId ?? null
    });
    await markExchangeAccountUsed(bot.exchangeAccountId);
    return copierResult;
  }

  const strategyIntent = await DummyStrategy.onTick({
    nowMs: Date.now(),
    symbol: bot.symbol
  });

  const policy = readPredictionGatePolicy(bot.paramsJson ?? {});
  let intent = strategyIntent;
  let gateSummary: LoopTickResult["gate"] = {
    applied: false,
    allow: true,
    reason: "gating_disabled",
    sizeMultiplier: 1,
    timeframe: null
  };

  if (strategyIntent.type === "open" && policy.enabled) {
    gateSummary = {
      applied: true,
      allow: true,
      reason: "allowed",
      sizeMultiplier: 1,
      timeframe: policy.timeframe
    };
    let predictionGateResult: PredictionGateResult;
    let predictionState: Awaited<ReturnType<typeof loadLatestPredictionStateForGate>> = null;
    let gateError: string | null = null;

    try {
      predictionState = await loadLatestPredictionStateForGate({
        userId: bot.userId,
        exchange: bot.exchange,
        exchangeAccountId: bot.exchangeAccountId,
        symbol: bot.symbol,
        marketType: "perp",
        timeframe: policy.timeframe
      });
      predictionGateResult = evaluateGate(policy, predictionState);
    } catch (error) {
      gateError = String(error);
      predictionGateResult = policy.failOpenOnError
        ? {
            allow: true,
            reason: "prediction_state_unavailable_fail_open",
            sizeMultiplier: policy.failOpenMultiplier
          }
        : {
            allow: false,
            reason: "prediction_state_unavailable",
            sizeMultiplier: 1
          };
    }

    gateSummary = {
      applied: true,
      allow: predictionGateResult.allow,
      reason: predictionGateResult.reason,
      sizeMultiplier: predictionGateResult.sizeMultiplier,
      timeframe: policy.timeframe
    };
    recordPredictionGateDecision(predictionGateResult);
    const gateMetrics = getPredictionGateMetrics();

    const riskEventType: RiskEventType = predictionGateResult.allow
      ? predictionGateResult.reason === "prediction_state_unavailable_fail_open"
        ? "PREDICTION_GATE_FAIL_OPEN"
        : "PREDICTION_GATE_ALLOW"
      : "PREDICTION_GATE_BLOCK";
    await writeRiskEvent({
      botId: bot.id,
      type: riskEventType,
      message: predictionGateResult.reason,
      meta: {
        timeframe: policy.timeframe,
        minConfidence: policy.minConfidence,
        maxAgeSec: policy.maxAgeSec,
        allowSignals: policy.allowSignals,
        blockTags: policy.blockTags,
        sizeMultiplier: predictionGateResult.sizeMultiplier,
        confidence: predictionState ? Number(predictionState.confidence) : null,
        signal: predictionState?.signal ?? null,
        tags: predictionState?.tags ?? [],
        predictionUpdatedAt: predictionState?.tsUpdated?.toISOString?.() ?? null,
        gateError
      }
    });
    log.info(
      {
        botId: bot.id,
        symbol: bot.symbol,
        timeframe: policy.timeframe,
        confidence: predictionState ? Number(predictionState.confidence) : null,
        tags: predictionState?.tags ?? [],
        decision: predictionGateResult.allow ? "allow" : "deny",
        reason: predictionGateResult.reason,
        sizeMultiplier: predictionGateResult.sizeMultiplier,
        allowedCount: gateMetrics.allowedCount,
        gatedCount: gateMetrics.gatedCount,
        avgMultiplier: gateMetrics.avgMultiplier
      },
      "prediction gate decision"
    );

    if (!predictionGateResult.allow) {
      const reason = `gated:${predictionGateResult.reason};strategy:${bot.strategyKey};intent:${strategyIntent.type}`;
      await writeBotTick({
        botId: bot.id,
        status: "running",
        reason,
        intent: strategyIntent,
        workerId: workerId ?? null
      });
      await markExchangeAccountUsed(bot.exchangeAccountId);
      return {
        outcome: "blocked",
        intent: strategyIntent,
        reason,
        gate: gateSummary
      };
    }

    intent = applySizeMultiplierToIntent(strategyIntent, predictionGateResult.sizeMultiplier);
  }

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
      reason,
      gate: gateSummary
    };
  }

  return {
    outcome: "ok",
    intent,
    reason,
    gate: gateSummary
  };
}
