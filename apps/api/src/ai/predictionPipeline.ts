import { prisma } from "@mm/db";
import { logger } from "../logger.js";
import {
  generatePredictionExplanation,
  type ExplainerInput,
  type ExplainerOutput
} from "./predictionExplainer.js";

const db = prisma as any;

export type PredictionRecordInput = ExplainerInput & {
  userId?: string | null;
  botId?: string | null;
  modelVersionBase?: string;
  tracking?: {
    entryPrice?: number | null;
    stopLossPrice?: number | null;
    takeProfitPrice?: number | null;
    horizonMs?: number | null;
  };
};

export type PredictionRecordResult = {
  persisted: boolean;
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

export async function generateAndPersistPrediction(
  input: PredictionRecordInput
): Promise<PredictionRecordResult> {
  const explanation = await generatePredictionExplanation(input);
  const featureSnapshot = {
    ...input.featureSnapshot,
    aiPrediction: {
      signal: explanation.aiPrediction.signal,
      expectedMovePct: explanation.aiPrediction.expectedMovePct,
      confidence: explanation.aiPrediction.confidence
    }
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
        signal: input.prediction.signal,
        expectedMovePct: input.prediction.expectedMovePct,
        confidence: input.prediction.confidence,
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
      explanation,
      featureSnapshot,
      modelVersion,
      rowId: null
    };
  }
}
