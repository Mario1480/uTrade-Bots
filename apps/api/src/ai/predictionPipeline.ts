import { prisma } from "@mm/db";
import { logger } from "../logger.js";
import {
  fallbackExplain,
  generatePredictionExplanation,
  type ExplainerInput,
  type ExplainerOutput
} from "./predictionExplainer.js";
import type {
  AiPromptRuntimeSettings,
  AiPromptScopeContext
} from "./promptSettings.js";

const db = prisma as any;

export type PredictionSignalSource = "local" | "ai";
export type PredictionSignalMode = "local_only" | "ai_only" | "both";
export type PredictionSlTpSource = "local" | "ai" | "hybrid";

export type PredictionRecordInput = ExplainerInput & {
  userId?: string | null;
  botId?: string | null;
  modelVersionBase?: string;
  preferredSignalSource?: PredictionSignalSource;
  signalMode?: PredictionSignalMode;
  promptSettings?: AiPromptRuntimeSettings;
  slTpSource?: PredictionSlTpSource;
  promptScopeContext?: AiPromptScopeContext;
  tracking?: {
    entryPrice?: number | null;
    stopLossPrice?: number | null;
    takeProfitPrice?: number | null;
    horizonMs?: number | null;
  };
  newsRiskBlocked?: {
    reasonCode?: string;
    strategyMode?: "off" | "block";
  } | null;
};

export type PredictionRecordResult = {
  persisted: boolean;
  prediction: ExplainerInput["prediction"];
  signalSource: PredictionSignalSource;
  explanation: ExplainerOutput;
  featureSnapshot: Record<string, unknown>;
  modelVersion: string;
  rowId: string | null;
};

function toDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function normalizeSignalSource(value: unknown): PredictionSignalSource {
  return value === "ai" ? "ai" : "local";
}

function normalizeSignalMode(value: unknown): PredictionSignalMode {
  if (value === "local_only" || value === "ai_only" || value === "both") return value;
  if (value === "local") return "local_only";
  if (value === "ai") return "ai_only";
  return "both";
}

function normalizeSlTpSource(value: unknown): PredictionSlTpSource {
  if (value === "ai" || value === "hybrid" || value === "local") return value;
  return "local";
}

function normalizePrice(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function isDirectionalLevelValid(
  signal: "up" | "down" | "neutral",
  entryPrice: number | null,
  stopLossPrice: number | null,
  takeProfitPrice: number | null
): { stopLossValid: boolean; takeProfitValid: boolean } {
  if (!entryPrice || signal === "neutral") {
    return { stopLossValid: true, takeProfitValid: true };
  }
  if (signal === "up") {
    return {
      stopLossValid: stopLossPrice === null || stopLossPrice < entryPrice,
      takeProfitValid: takeProfitPrice === null || takeProfitPrice > entryPrice
    };
  }
  return {
    stopLossValid: stopLossPrice === null || stopLossPrice > entryPrice,
    takeProfitValid: takeProfitPrice === null || takeProfitPrice < entryPrice
  };
}

export function resolvePredictionTracking(input: {
  signal: "up" | "down" | "neutral";
  slTpSource?: PredictionSlTpSource | null;
  localTracking: {
    entryPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    horizonMs: number | null;
  };
  aiLevels: ExplainerOutput["levels"] | undefined;
}): {
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  horizonMs: number | null;
  requestedSource: PredictionSlTpSource;
  resolvedSource: PredictionSlTpSource;
  aiLevelsUsed: boolean;
} {
  const slTpSource = normalizeSlTpSource(input.slTpSource);
  const local = input.localTracking;
  const ai = {
    entryPrice: normalizePrice(input.aiLevels?.entryPrice),
    stopLossPrice: normalizePrice(input.aiLevels?.stopLossPrice),
    takeProfitPrice: normalizePrice(input.aiLevels?.takeProfitPrice)
  };
  const hasAiLevels =
    ai.entryPrice !== null || ai.stopLossPrice !== null || ai.takeProfitPrice !== null;
  const resolvedSource: PredictionSlTpSource =
    slTpSource === "local" || !hasAiLevels ? "local" : slTpSource;

  const entryFromSource =
    resolvedSource === "ai"
      ? (ai.entryPrice ?? local.entryPrice)
      : local.entryPrice;
  let stopLossFromSource =
    resolvedSource === "local"
      ? local.stopLossPrice
      : (ai.stopLossPrice ?? local.stopLossPrice);
  let takeProfitFromSource =
    resolvedSource === "local"
      ? local.takeProfitPrice
      : (ai.takeProfitPrice ?? local.takeProfitPrice);

  const directional = isDirectionalLevelValid(
    input.signal,
    entryFromSource,
    stopLossFromSource,
    takeProfitFromSource
  );
  if (!directional.stopLossValid) {
    stopLossFromSource = local.stopLossPrice;
  }
  if (!directional.takeProfitValid) {
    takeProfitFromSource = local.takeProfitPrice;
  }

  return {
    entryPrice: entryFromSource,
    stopLossPrice: stopLossFromSource,
    takeProfitPrice: takeProfitFromSource,
    horizonMs: local.horizonMs,
    requestedSource: slTpSource,
    resolvedSource,
    aiLevelsUsed: resolvedSource !== "local" && hasAiLevels
  };
}

function normalizePrediction(input: {
  signal: unknown;
  expectedMovePct: unknown;
  confidence: unknown;
}): ExplainerInput["prediction"] {
  const signal = input.signal === "up" || input.signal === "down" || input.signal === "neutral"
    ? input.signal
    : "neutral";
  const expectedMovePctRaw = Number(input.expectedMovePct);
  const confidenceRaw = Number(input.confidence);
  return {
    signal,
    expectedMovePct: Number.isFinite(expectedMovePctRaw)
      ? Number(Math.max(0, Math.min(25, Math.abs(expectedMovePctRaw))).toFixed(2))
      : 0,
    confidence: Number.isFinite(confidenceRaw)
      ? Number(Math.max(0, Math.min(1, confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100)).toFixed(4))
      : 0
  };
}

export async function generateAndPersistPrediction(
  input: PredictionRecordInput
): Promise<PredictionRecordResult> {
  const localPrediction = normalizePrediction(input.prediction);
  const signalMode = normalizeSignalMode(input.signalMode);
  const preferredSignalSource = normalizeSignalSource(input.preferredSignalSource);
  const slTpSource = normalizeSlTpSource(
    input.slTpSource ?? input.promptSettings?.slTpSource
  );
  const newsRiskBlocked = Boolean(input.newsRiskBlocked);
  let explanation: ExplainerOutput;
  if (newsRiskBlocked) {
    explanation = {
      explanation: "News blackout active; setup suspended.",
      tags: ["news_risk"],
      keyDrivers: [
        { name: "featureSnapshot.newsRisk", value: true },
        { name: "policy.reasonCode", value: input.newsRiskBlocked?.reasonCode ?? "news_risk_blocked" },
        { name: "policy.newsRiskMode", value: input.newsRiskBlocked?.strategyMode ?? "block" }
      ],
      aiPrediction: {
        signal: "neutral",
        expectedMovePct: 0,
        confidence: 0
      },
      disclaimer: "grounded_features_only"
    };
  } else {
    try {
      explanation =
        signalMode === "local_only"
          ? fallbackExplain({
              symbol: input.symbol,
              marketType: input.marketType,
              timeframe: input.timeframe,
              tsCreated: input.tsCreated,
              prediction: localPrediction,
              featureSnapshot: input.featureSnapshot
            })
          : await generatePredictionExplanation({
              ...input,
              prediction: localPrediction
            }, {
              promptSettings: input.promptSettings,
              promptScopeContext: input.promptScopeContext,
              traceUserId: input.userId ?? null,
              requireSuccessfulAi: signalMode === "ai_only"
            });
    } catch (error) {
      if (signalMode === "ai_only") {
        const reason =
          error instanceof Error && typeof error.message === "string" && error.message.trim()
            ? error.message.trim()
            : String(error);
        const wrapped = Object.assign(
          new Error(`AI signal required (ai_only), but AI response was unavailable (${reason}).`),
          { status: 503, code: "ai_only_requires_ai_success", reason }
        );
        throw wrapped;
      }
      throw error;
    }
  }
  const forcedNeutralPrediction = newsRiskBlocked
    ? { signal: "neutral" as const, expectedMovePct: 0, confidence: 0 }
    : null;
  const aiPrediction =
    signalMode === "local_only"
      ? null
      : (forcedNeutralPrediction ?? normalizePrediction(explanation.aiPrediction));
  const selectedSignalSource: PredictionSignalSource =
    signalMode === "local_only"
      ? "local"
      : signalMode === "ai_only"
        ? "ai"
        : preferredSignalSource;
  const selectedPrediction =
    forcedNeutralPrediction
      ? forcedNeutralPrediction
      : (selectedSignalSource === "ai" && aiPrediction ? aiPrediction : localPrediction);
  const localTracking = {
    entryPrice: normalizePrice(input.tracking?.entryPrice),
    stopLossPrice: normalizePrice(input.tracking?.stopLossPrice),
    takeProfitPrice: normalizePrice(input.tracking?.takeProfitPrice),
    horizonMs:
      Number.isFinite(Number(input.tracking?.horizonMs)) && Number(input.tracking?.horizonMs) > 0
        ? Math.trunc(Number(input.tracking?.horizonMs))
        : null
  };
  const resolvedTracking = resolvePredictionTracking({
    signal: selectedPrediction.signal,
    slTpSource,
    localTracking,
    aiLevels: explanation.levels
  });
  const featureSnapshot = {
    ...input.featureSnapshot,
    localPrediction,
    ...(aiPrediction
      ? {
          aiPrediction: {
            signal: aiPrediction.signal,
            expectedMovePct: aiPrediction.expectedMovePct,
            confidence: aiPrediction.confidence
          }
        }
      : { aiPrediction: null }),
    ...(resolvedTracking.entryPrice !== null
      ? { suggestedEntryPrice: resolvedTracking.entryPrice }
      : {}),
    ...(resolvedTracking.stopLossPrice !== null
      ? { suggestedStopLoss: resolvedTracking.stopLossPrice }
      : {}),
    ...(resolvedTracking.takeProfitPrice !== null
      ? { suggestedTakeProfit: resolvedTracking.takeProfitPrice }
      : {}),
    trackingConfig: {
      slTpSourceRequested: resolvedTracking.requestedSource,
      slTpSourceResolved: resolvedTracking.resolvedSource,
      aiLevelsUsed: resolvedTracking.aiLevelsUsed
    },
    selectedSignalSource,
    signalMode
  };
  const modelVersion = `${input.modelVersionBase ?? "baseline-v1"} + ${
    newsRiskBlocked
      ? "news-risk-block-v1"
      : (signalMode === "local_only" ? "local-explain-v1" : "openai-explain-v1")
  }`;

  try {
    const row = await db.prediction.create({
      data: {
        userId: input.userId ?? null,
        botId: input.botId ?? null,
        symbol: input.symbol,
        marketType: input.marketType,
        timeframe: input.timeframe,
        tsCreated: toDate(input.tsCreated),
        signal: selectedPrediction.signal,
        expectedMovePct: selectedPrediction.expectedMovePct,
        confidence: selectedPrediction.confidence,
        explanation: explanation.explanation,
        tags: explanation.tags,
        featuresSnapshot: featureSnapshot,
        entryPrice: resolvedTracking.entryPrice,
        stopLossPrice: resolvedTracking.stopLossPrice,
        takeProfitPrice: resolvedTracking.takeProfitPrice,
        horizonMs: resolvedTracking.horizonMs,
        modelVersion
      }
    });

    return {
      persisted: true,
      prediction: selectedPrediction,
      signalSource: selectedSignalSource,
      explanation,
      featureSnapshot,
      modelVersion,
      rowId: typeof row?.id === "string" ? row.id : null
    };
  } catch (error) {
    logger.warn("prediction_persist_failed", {
      persisted: false,
      modelVersion,
      reason: String(error)
    });

    return {
      persisted: false,
      prediction: selectedPrediction,
      signalSource: selectedSignalSource,
      explanation,
      featureSnapshot,
      modelVersion,
      rowId: null
    };
  }
}
