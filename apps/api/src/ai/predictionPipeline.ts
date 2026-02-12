import { prisma } from "@mm/db";
import { logger } from "../logger.js";
import {
  fallbackExplain,
  generatePredictionExplanation,
  type ExplainerInput,
  type ExplainerOutput
} from "./predictionExplainer.js";

const db = prisma as any;

export type PredictionSignalSource = "local" | "ai";
export type PredictionSignalMode = "local_only" | "ai_only" | "both";

export type PredictionRecordInput = ExplainerInput & {
  userId?: string | null;
  botId?: string | null;
  modelVersionBase?: string;
  preferredSignalSource?: PredictionSignalSource;
  signalMode?: PredictionSignalMode;
  tracking?: {
    entryPrice?: number | null;
    stopLossPrice?: number | null;
    takeProfitPrice?: number | null;
    horizonMs?: number | null;
  };
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
  const explanation =
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
        });
  const aiPrediction =
    signalMode === "local_only"
      ? null
      : normalizePrediction(explanation.aiPrediction);
  const selectedSignalSource: PredictionSignalSource =
    signalMode === "local_only"
      ? "local"
      : signalMode === "ai_only"
        ? "ai"
        : preferredSignalSource;
  const selectedPrediction = selectedSignalSource === "ai" && aiPrediction ? aiPrediction : localPrediction;
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
    selectedSignalSource,
    signalMode
  };
  const modelVersion = `${input.modelVersionBase ?? "baseline-v1"} + ${
    signalMode === "local_only" ? "local-explain-v1" : "openai-explain-v1"
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
        entryPrice: input.tracking?.entryPrice ?? null,
        stopLossPrice: input.tracking?.stopLossPrice ?? null,
        takeProfitPrice: input.tracking?.takeProfitPrice ?? null,
        horizonMs: input.tracking?.horizonMs ?? null,
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
