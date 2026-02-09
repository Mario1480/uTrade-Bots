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
};

export type PredictionRecordResult = {
  persisted: boolean;
  explanation: ExplainerOutput;
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
        featuresSnapshot: input.featureSnapshot,
        modelVersion
      }
    });

    return {
      persisted: true,
      explanation,
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
      modelVersion,
      rowId: null
    };
  }
}

