import type { TradeIntent } from "@mm/futures-core";
import type { ActiveFuturesBot } from "./db.js";
import {
  markExchangeAccountUsed,
  writeBotTick,
  writeRiskEvent
} from "./db.js";
import { resolveExecutionModeForBot } from "./execution/registry.js";
import type { ExecutionMode, ExecutionResult } from "./execution/types.js";
import { log } from "./logger.js";
import {
  coerceGateSummary,
  defaultGateSummary,
  type RunnerDecisionTrace
} from "./runtime/decisionTrace.js";
import { createLegacyDummySignalEngine } from "./signal/legacyDummySignalEngine.js";
import { predictionCopierSignalEngine } from "./signal/predictionCopierSignalEngine.js";
import type { SignalDecision, SignalEngine } from "./signal/types.js";

const legacyDummySignalEngine = createLegacyDummySignalEngine();

export type LoopTickResult = {
  outcome: "ok" | "blocked";
  intent: TradeIntent;
  reason: string;
  signalReason: string;
  executionReason: string;
  trace: RunnerDecisionTrace;
  gate: {
    applied: boolean;
    allow: boolean;
    reason: string;
    sizeMultiplier: number;
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  };
};

export type LoopDependencies = {
  resolveSignalEngine?: (bot: ActiveFuturesBot) => SignalEngine;
  resolveExecutionMode?: (bot: ActiveFuturesBot) => ExecutionMode;
  writeBotTickFn?: typeof writeBotTick;
  writeRiskEventFn?: typeof writeRiskEvent;
  markExchangeAccountUsedFn?: typeof markExchangeAccountUsed;
};

function toEngineLikeReason(strategyKey: string, intent: TradeIntent, result: ExecutionResult): string {
  if (result.metadata.preserveReason === true) {
    return result.reason;
  }

  if (result.status === "blocked") {
    return `blocked:${result.reason};strategy:${strategyKey};intent:${intent.type}`;
  }

  const engineStatusRaw = String(result.metadata.engineStatus ?? "").trim();
  const engineStatus = engineStatusRaw || (result.status === "executed" ? "accepted" : "noop");
  return `strategy:${strategyKey};intent:${intent.type};engine:${engineStatus}`;
}

function blockedBySignalDecision(signal: SignalDecision): boolean {
  return signal.metadata.blockedBySignal === true;
}

function getSignalIntentType(signal: SignalDecision): TradeIntent["type"] {
  const raw = String(signal.metadata.signalIntentType ?? "").trim().toLowerCase();
  if (raw === "open" || raw === "close" || raw === "none") {
    return raw;
  }
  return signal.legacyIntent.type;
}

function createSignalBlockedReason(bot: ActiveFuturesBot, signal: SignalDecision): string {
  return `gated:${signal.reason};strategy:${bot.strategyKey};intent:${getSignalIntentType(signal)}`;
}

export function resolveSignalEngineForBot(bot: ActiveFuturesBot): SignalEngine {
  if (bot.strategyKey === "prediction_copier") return predictionCopierSignalEngine;
  return legacyDummySignalEngine;
}

export async function loopOnce(
  bot: ActiveFuturesBot,
  workerId?: string,
  deps: LoopDependencies = {}
): Promise<LoopTickResult> {
  const resolveSignalEngine = deps.resolveSignalEngine ?? resolveSignalEngineForBot;
  const resolveExecutionMode = deps.resolveExecutionMode ?? resolveExecutionModeForBot;
  const writeBotTickFn = deps.writeBotTickFn ?? writeBotTick;
  const writeRiskEventFn = deps.writeRiskEventFn ?? writeRiskEvent;
  const markExchangeAccountUsedFn = deps.markExchangeAccountUsedFn ?? markExchangeAccountUsed;

  const signalEngine = resolveSignalEngine(bot);
  const executionMode = resolveExecutionMode(bot);
  const now = new Date();

  const signalDecision = await signalEngine.decide({
    bot,
    now,
    workerId
  });

  const signalGate = coerceGateSummary(signalDecision.metadata.gate, defaultGateSummary());

  const emitDecisionRiskEvent = async (params: {
    type: "SIGNAL_DECISION" | "EXECUTION_DECISION";
    message: string;
    meta: Record<string, unknown>;
  }) => {
    try {
      await writeRiskEventFn({
        botId: bot.id,
        type: params.type,
        message: params.message,
        meta: {
          workerId: workerId ?? null,
          strategyKey: bot.strategyKey,
          ...params.meta
        }
      });
    } catch (error) {
      log.warn(
        {
          botId: bot.id,
          strategyKey: bot.strategyKey,
          eventType: params.type,
          err: String(error)
        },
        "decision risk event write failed"
      );
    }
  };

  await emitDecisionRiskEvent({
    type: "SIGNAL_DECISION",
    message: signalDecision.reason,
    meta: {
      signalEngine: signalEngine.key,
      side: signalDecision.side,
      confidence: signalDecision.confidence,
      signalIntentType: getSignalIntentType(signalDecision),
      blockedBySignal: blockedBySignalDecision(signalDecision),
      signalGate,
      signalMetadata: signalDecision.metadata
    }
  });

  if (blockedBySignalDecision(signalDecision)) {
    const reason = createSignalBlockedReason(bot, signalDecision);
    const trace: RunnerDecisionTrace = {
      signal: {
        engine: signalEngine.key,
        side: signalDecision.side,
        confidence: signalDecision.confidence,
        reason: signalDecision.reason,
        metadata: signalDecision.metadata
      },
      execution: {
        mode: executionMode.key,
        status: "blocked",
        reason: "skipped_due_to_signal_block",
        metadata: {
          blockedBySignal: true
        }
      }
    };

    await emitDecisionRiskEvent({
      type: "EXECUTION_DECISION",
      message: "skipped_due_to_signal_block",
      meta: {
        executionMode: executionMode.key,
        status: "blocked",
        reason: "skipped_due_to_signal_block",
        executionMetadata: {
          blockedBySignal: true
        }
      }
    });

    await writeBotTickFn({
      botId: bot.id,
      status: "running",
      reason,
      intent: signalDecision.legacyIntent,
      workerId: workerId ?? null,
      trace
    });
    await markExchangeAccountUsedFn(bot.exchangeAccountId);

    return {
      outcome: "blocked",
      intent: signalDecision.legacyIntent,
      reason,
      signalReason: signalDecision.reason,
      executionReason: "skipped_due_to_signal_block",
      trace,
      gate: signalGate
    };
  }

  const executionResult = await executionMode.execute(signalDecision, {
    bot,
    now,
    workerId
  });

  const reason = toEngineLikeReason(bot.strategyKey, executionResult.legacy.intent, executionResult);
  const trace: RunnerDecisionTrace = {
    signal: {
      engine: signalEngine.key,
      side: signalDecision.side,
      confidence: signalDecision.confidence,
      reason: signalDecision.reason,
      metadata: signalDecision.metadata
    },
    execution: {
      mode: executionMode.key,
      status: executionResult.status,
      reason: executionResult.reason,
      metadata: executionResult.metadata
    }
  };

  await emitDecisionRiskEvent({
    type: "EXECUTION_DECISION",
    message: executionResult.reason,
    meta: {
      executionMode: executionMode.key,
      status: executionResult.status,
      reason: executionResult.reason,
      executionMetadata: executionResult.metadata
    }
  });

  await writeBotTickFn({
    botId: bot.id,
    status: "running",
    reason,
    intent: executionResult.legacy.intent,
    workerId: workerId ?? null,
    trace
  });

  await markExchangeAccountUsedFn(bot.exchangeAccountId);

  return {
    outcome: executionResult.legacy.outcome,
    intent: executionResult.legacy.intent,
    reason,
    signalReason: signalDecision.reason,
    executionReason: executionResult.reason,
    trace,
    gate: executionResult.legacy.gate
  };
}
