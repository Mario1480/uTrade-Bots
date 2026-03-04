import {
  runPredictionCopierTick,
  type PredictionCopierTickResult
} from "../prediction-copier.js";
import type { ExecutionMode, ExecutionResult } from "./types.js";

function mapLegacyResult(result: PredictionCopierTickResult): ExecutionResult {
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
      gate: result.gate
    },
    legacy: {
      outcome: result.outcome,
      intent: result.intent,
      gate: result.gate
    }
  };
}

export const legacyPredictionCopierExecutionMode: ExecutionMode = {
  key: "prediction_copier_legacy",
  async execute(_signal, ctx) {
    const result = await runPredictionCopierTick(ctx.bot, ctx.workerId);
    return mapLegacyResult(result);
  }
};
