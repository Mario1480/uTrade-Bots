import {
  executePredictionCopierPreparedTick,
  runPredictionCopierTick,
  type PredictionCopierTickResult
} from "../prediction-copier.js";
import { consumePredictionCopierPlan } from "../runtime/predictionCopierPlanCache.js";
import type { ExecutionMode, ExecutionResult } from "./types.js";

function mapLegacyResult(result: PredictionCopierTickResult, usedPreparedPlan: boolean): ExecutionResult {
  const status =
    result.outcome === "blocked"
      ? "blocked"
      : result.intent.type === "none"
        ? "noop"
        : "executed";

  return {
    status,
    reason: result.reason,
    metadata: {
      delegated: true,
      preserveReason: true,
      gate: result.gate,
      usedPreparedPlan
    },
    legacy: {
      outcome: result.outcome,
      intent: result.intent,
      gate: result.gate
    }
  };
}

function readPlanIdFromSignalMetadata(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).predictionCopierPlanId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export const predictionCopierExecutionMode: ExecutionMode = {
  key: "prediction_copier",
  async execute(signal, ctx) {
    const planId = readPlanIdFromSignalMetadata(signal.metadata);
    const preparedPlan = planId ? consumePredictionCopierPlan(ctx.bot.id, planId) : null;

    if (preparedPlan) {
      const result = await executePredictionCopierPreparedTick(ctx.bot, preparedPlan);
      return mapLegacyResult(result, true);
    }

    const fallbackResult = await runPredictionCopierTick(ctx.bot, ctx.workerId);
    return mapLegacyResult(fallbackResult, false);
  }
};
