import type { TradeIntent } from "@mm/futures-core";
import {
  preparePredictionCopierTick,
  type PredictionCopierDecision,
  type PredictionCopierPreparedTick
} from "../prediction-copier.js";
import { storePredictionCopierPlan } from "../runtime/predictionCopierPlanCache.js";
import type { SignalDecision, SignalSide, SignalEngine } from "./types.js";

function toSignalSide(decision: PredictionCopierDecision): SignalSide {
  if (decision.action === "enter") {
    return decision.side === "short" ? "short" : "long";
  }
  return "flat";
}

function toSignalIntentType(decision: PredictionCopierDecision): "open" | "close" | "none" {
  if (decision.action === "enter") return "open";
  if (decision.action === "exit") return "close";
  return "none";
}

function toLegacyIntent(symbol: string, decision: PredictionCopierDecision): TradeIntent {
  if (decision.action === "enter") {
    return {
      type: "open",
      symbol,
      side: decision.side,
      order: {
        qty: 0
      }
    };
  }
  if (decision.action === "exit") {
    return {
      type: "close",
      symbol,
      reason: decision.reason,
      order: {
        type: "market",
        qty: 0,
        reduceOnly: true
      }
    };
  }
  return { type: "none" };
}

function getPredictionConfidence(prepared: PredictionCopierPreparedTick): number | null {
  if (prepared.kind !== "ready") return null;
  const parsed = Number(prepared.prediction?.confidence);
  return Number.isFinite(parsed) ? parsed : null;
}

export const predictionCopierSignalEngine: SignalEngine = {
  key: "prediction_copier_signal",
  async decide(ctx): Promise<SignalDecision> {
    const prepared = await preparePredictionCopierTick(ctx.bot, ctx.workerId);

    if (prepared.kind === "blocked") {
      return {
        side: "flat",
        confidence: null,
        reason: prepared.result.gate.reason,
        metadata: {
          strategyKey: ctx.bot.strategyKey,
          blockedBySignal: false,
          signalIntentType: "none",
          predictionCopierPlanId: null,
          predictionCopierDecisionAction: "blocked",
          gate: prepared.result.gate
        },
        legacyIntent: { type: "none" }
      };
    }

    const decision = prepared.decision;
    const planId = storePredictionCopierPlan(ctx.bot.id, prepared);

    return {
      side: toSignalSide(decision),
      confidence: getPredictionConfidence(prepared),
      reason: decision.reason,
      metadata: {
        strategyKey: ctx.bot.strategyKey,
        blockedBySignal: false,
        signalIntentType: toSignalIntentType(decision),
        predictionCopierPlanId: planId,
        predictionCopierDecisionAction: decision.action,
        gate: {
          applied: true,
          allow: decision.action !== "skip",
          reason: decision.reason,
          sizeMultiplier: 1,
          timeframe: prepared.config.timeframe
        }
      },
      legacyIntent: toLegacyIntent(prepared.symbol, decision)
    };
  }
};
