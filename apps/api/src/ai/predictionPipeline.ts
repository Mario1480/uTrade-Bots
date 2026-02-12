import { prisma } from "@mm/db";
import { logger } from "../logger.js";
import {
  generatePredictionExplanation,
  type ExplainerInput,
  type ExplainerOutput
} from "./predictionExplainer.js";

const db = prisma as any;

export type PredictionSignalSource = "local" | "ai";

export type PredictionRecordInput = ExplainerInput & {
  userId?: string | null;
  botId?: string | null;
  modelVersionBase?: string;
  preferredSignalSource?: PredictionSignalSource;
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
  const preferredSignalSource = normalizeSignalSource(input.preferredSignalSource);
  const explanation = await generatePredictionExplanation(input);
  const aiPrediction = normalizePrediction(explanation.aiPrediction);
  const selectedPrediction = preferredSignalSource === "ai" ? aiPrediction : localPrediction;
  const featureSnapshot = {
    ...input.featureSnapshot,
    localPrediction,
    aiPrediction: {
      signal: aiPrediction.signal,
      expectedMovePct: aiPrediction.expectedMovePct,
      confidence: aiPrediction.confidence
    },
    selectedSignalSource: preferredSignalSource
  };
  const modelVersion = `${input.modelVersionBase ?? "baseline-v1"} + openai-explain-v1`;

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
      signalSource: preferredSignalSource,
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
      signalSource: preferredSignalSource,
      explanation,
      featureSnapshot,
      modelVersion,
      rowId: null
    };
  }
}
