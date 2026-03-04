import { readPredictionCopierConfig } from "../prediction-copier.js";
import type { SignalEngine } from "./types.js";

export const legacyPredictionCopierSignalEngine: SignalEngine = {
  key: "prediction_copier_legacy_signal",
  async decide(ctx) {
    const config = readPredictionCopierConfig(ctx.bot);
    return {
      side: "flat",
      confidence: null,
      reason: "delegated_to_prediction_copier_execution",
      metadata: {
        delegated: true,
        strategyKey: ctx.bot.strategyKey,
        gate: {
          applied: true,
          allow: true,
          reason: "delegated_to_prediction_copier_execution",
          sizeMultiplier: 1,
          timeframe: config.timeframe
        }
      },
      legacyIntent: { type: "none" }
    };
  }
};
