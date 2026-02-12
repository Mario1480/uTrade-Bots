import { hashStableObject } from "../ai/analyzer.js";
import { logger } from "../logger.js";
import {
  predictionDetailDtoSchema,
  predictionIdParamSchema,
  predictionMarketTypeSchema,
  predictionSignalSchema,
  predictionTimeframeSchema,
  normalizePredictionConfidence,
  normalizePredictionExplanation,
  normalizePredictionFeatureSnapshot,
  normalizePredictionKeyDrivers,
  normalizePredictionTags
} from "../dto/predictions.dto.js";
import { readRealizedPayloadFromOutcomeMeta } from "../jobs/predictionEvaluatorJob.js";

type PredictionDetailBot = {
  id: string;
  userId: string | null;
  exchange: string | null;
  exchangeAccountId: string | null;
};

type PredictionDetailExchangeAccount = {
  id: string;
  exchange: string;
};

type PredictionDetailDb = {
  prediction: {
    findUnique(args: {
      where: { id: string };
    }): Promise<PredictionRecord | null>;
  };
  predictionState: {
    findUnique(args: {
      where: { id: string };
    }): Promise<PredictionStateRecord | null>;
  };
  predictionEvent: {
    findMany(args: {
      where: { stateId: string };
      orderBy: { tsCreated: "desc" }[];
      take: number;
    }): Promise<PredictionEventRecord[]>;
  };
  bot: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        userId: true;
        exchange: true;
        exchangeAccountId: true;
      };
    }): Promise<PredictionDetailBot | null>;
  };
  exchangeAccount: {
    findMany(args: {
      where: { userId: string };
      orderBy: { updatedAt: "desc" };
      select: {
        id: true;
        exchange: true;
      };
    }): Promise<PredictionDetailExchangeAccount[]>;
  };
};

type PredictionRecord = {
  id: string;
  userId: string | null;
  botId: string | null;
  symbol: string;
  marketType: string;
  timeframe: string;
  tsCreated: Date;
  signal: string;
  expectedMovePct: number;
  confidence: number;
  explanation: string;
  tags: unknown;
  featuresSnapshot: unknown;
  modelVersion: string;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  horizonMs?: number | null;
  outcomeStatus?: string | null;
  outcomeResult?: string | null;
  outcomeReason?: string | null;
  outcomePnlPct?: number | null;
  maxFavorablePct?: number | null;
  maxAdversePct?: number | null;
  outcomeEvaluatedAt?: Date | null;
  outcomeMeta?: unknown;
};

type PredictionStateRecord = {
  id: string;
  userId: string;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: string;
  timeframe: string;
  tsUpdated: Date;
  tsPredictedFor: Date;
  signal: string;
  expectedMovePct: number | null;
  confidence: number;
  tags: unknown;
  explanation: string | null;
  keyDrivers: unknown;
  featuresSnapshot: unknown;
  modelVersion: string;
  lastAiExplainedAt: Date | null;
  lastChangeHash: string | null;
  lastChangeReason: string | null;
  autoScheduleEnabled: boolean;
  autoSchedulePaused: boolean;
  directionPreference: string | null;
  confidenceTargetPct: number | null;
  leverage: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type PredictionEventRecord = {
  id: string;
  tsCreated: Date;
  changeType: string;
  prevSnapshot: unknown;
  newSnapshot: unknown;
  delta: unknown;
  modelVersion: string;
  reason: string | null;
};

export type PredictionDetailControllerResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400; body: { error: "invalid_prediction_id" } }
  | { status: 403; body: { error: "prediction_access_denied" } }
  | { status: 404; body: { error: "prediction_not_found" } }
  | { status: 500; body: { error: "prediction_detail_unexpected_error" } };

export type PredictionDetailControllerInput = {
  db: PredictionDetailDb;
  predictionId: string;
  userId: string;
  includeEvents?: boolean;
  eventsLimit?: number;
};

type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type MarketType = "spot" | "perp";
type Signal = "up" | "down" | "neutral";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function normalizeTimeframe(value: unknown): Timeframe {
  const parsed = predictionTimeframeSchema.safeParse(value);
  return parsed.success ? parsed.data : "15m";
}

function normalizeMarketType(value: unknown): MarketType {
  const parsed = predictionMarketTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "perp";
}

function normalizeSignal(value: unknown): Signal {
  const parsed = predictionSignalSchema.safeParse(value);
  return parsed.success ? parsed.data : "neutral";
}

function pickNumber(snapshot: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = Number(snapshot[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function deriveSuggestedEntry(snapshot: Record<string, unknown>) {
  const rawType = String(
    snapshot.suggestedEntryType ??
      snapshot.entryType ??
      snapshot.orderType ??
      ""
  )
    .trim()
    .toLowerCase();

  const entryPrice = pickNumber(snapshot, [
    "suggestedEntryPrice",
    "entryPrice",
    "limitPrice",
    "entry"
  ]);

  if (rawType === "market") {
    return { type: "market" as const };
  }

  const inferredType = rawType === "limit" || entryPrice !== null ? "limit" : "market";
  if (inferredType === "limit") {
    return {
      type: "limit" as const,
      price: entryPrice ?? undefined
    };
  }
  return { type: "market" as const };
}

function derivePositionSizeHint(snapshot: Record<string, unknown>) {
  const raw = snapshot.positionSizeHint;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const modeValue = String((raw as any).mode ?? "").trim().toLowerCase();
    const value = Number((raw as any).value);
    if ((modeValue === "percent_balance" || modeValue === "fixed_quote") && Number.isFinite(value) && value > 0) {
      return {
        mode: modeValue as "percent_balance" | "fixed_quote",
        value
      };
    }
  }

  const percentValue = pickNumber(snapshot, ["positionSizePercent", "sizePercent", "balancePercent"]);
  if (percentValue !== null && percentValue > 0) {
    return {
      mode: "percent_balance" as const,
      value: percentValue
    };
  }

  const quoteValue = pickNumber(snapshot, ["positionSizeQuote", "sizeQuote", "sizeUsdt"]);
  if (quoteValue !== null && quoteValue > 0) {
    return {
      mode: "fixed_quote" as const,
      value: quoteValue
    };
  }

  return null;
}

function derivePredictionKeyDrivers(snapshot: Record<string, unknown>) {
  const preferred = [
    "atr_pct_rank_0_100",
    "ema_spread_abs_rank_0_100",
    "rsi",
    "emaSpread",
    "emaFast",
    "emaSlow",
    "macd",
    "atrPct",
    "volatility",
    "spreadBps",
    "liquidityScore",
    "fundingRate",
    "newsRisk"
  ];

  const out: Array<{ name: string; value: unknown }> = [];
  for (const key of preferred) {
    if (!(key in snapshot)) continue;
    out.push({ name: key, value: snapshot[key] });
    if (out.length >= 5) return out;
  }

  const fallbackKeys = Object.keys(snapshot).sort().slice(0, 5);
  for (const key of fallbackKeys) {
    out.push({ name: key, value: snapshot[key] });
  }
  return out.slice(0, 5);
}

function normalizeErrorMetrics(outcomeMeta: unknown): Record<string, unknown> | null {
  const realizedPayload = readRealizedPayloadFromOutcomeMeta(outcomeMeta);
  const nested = asRecord(realizedPayload.errorMetrics);
  if (nested) return nested;
  const metaRecord = asRecord(outcomeMeta);
  return metaRecord;
}

export async function getPredictionDetailController(
  input: PredictionDetailControllerInput
): Promise<PredictionDetailControllerResult> {
  const parsedParams = predictionIdParamSchema.safeParse({ id: input.predictionId });
  if (!parsedParams.success) {
    return { status: 400, body: { error: "invalid_prediction_id" } };
  }

  const [stateRow, exchangeAccounts] = await Promise.all([
    input.db.predictionState.findUnique({
      where: { id: parsedParams.data.id }
    }),
    input.db.exchangeAccount.findMany({
      where: { userId: input.userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        exchange: true
      }
    })
  ]);

  if (stateRow) {
    const accountIds = new Set(exchangeAccounts.map((rowItem) => rowItem.id));
    const hasAccess = stateRow.userId === input.userId || accountIds.has(stateRow.accountId);
    if (!hasAccess) {
      return { status: 403, body: { error: "prediction_access_denied" } };
    }

    const resolvedAccountId =
      stateRow.accountId && accountIds.has(stateRow.accountId)
        ? stateRow.accountId
        : exchangeAccounts[0]?.id ?? stateRow.accountId;
    const resolvedExchangeFromAccount = exchangeAccounts.find(
      (account) => account.id === resolvedAccountId
    )?.exchange;
    const resolvedExchange =
      (typeof stateRow.exchange === "string" && stateRow.exchange.trim()) ||
      resolvedExchangeFromAccount ||
      "bitget";

    const snapshot = normalizePredictionFeatureSnapshot(stateRow.featuresSnapshot);
    const tags = normalizePredictionTags(stateRow.tags);
    const explanation = normalizePredictionExplanation(stateRow.explanation);
    const keyDrivers = normalizePredictionKeyDrivers(
      stateRow.keyDrivers ?? (snapshot as Record<string, unknown>).keyDrivers ?? derivePredictionKeyDrivers(snapshot)
    );
    const indicators = asRecord(snapshot.indicators) ?? null;

    const dtoCandidate = {
      id: stateRow.id,
      exchange: resolvedExchange,
      accountId: resolvedAccountId,
      symbol: stateRow.symbol,
      marketType: normalizeMarketType(stateRow.marketType),
      timeframe: normalizeTimeframe(stateRow.timeframe),
      tsCreated: stateRow.tsUpdated.toISOString(),
      tsPredictedFor: stateRow.tsPredictedFor.toISOString(),
      prediction: {
        signal: normalizeSignal(stateRow.signal),
        expectedMovePct: toNumber(stateRow.expectedMovePct),
        confidence: normalizePredictionConfidence(stateRow.confidence)
      },
      tags,
      explanation: explanation.value,
      keyDrivers,
      featureSnapshot: snapshot,
      modelVersion:
        typeof stateRow.modelVersion === "string" && stateRow.modelVersion.trim().length > 0
          ? stateRow.modelVersion
          : "baseline-v1",
      realized: {
        realizedReturnPct: null,
        evaluatedAt: null,
        errorMetrics: null
      }
    };

    const parsedDto = predictionDetailDtoSchema.safeParse(dtoCandidate);
    if (!parsedDto.success) {
      logger.error("prediction_detail_state_dto_validation_failed", {
        predictionId: stateRow.id,
        exchange: resolvedExchange,
        timeframe: stateRow.timeframe,
        modelVersion: stateRow.modelVersion,
        featureSnapshotBytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
        featureSnapshotHash: hashStableObject(snapshot)
      });
      return { status: 500, body: { error: "prediction_detail_unexpected_error" } };
    }

    if (explanation.truncated) {
      logger.warn("prediction_detail_explanation_truncated", {
        predictionId: stateRow.id,
        exchange: parsedDto.data.exchange,
        timeframe: parsedDto.data.timeframe,
        modelVersion: parsedDto.data.modelVersion
      });
    }

    const suggestedStopLoss = pickNumber(snapshot, ["suggestedStopLoss", "stopLoss", "slPrice", "sl"]);
    const suggestedTakeProfit = pickNumber(snapshot, ["suggestedTakeProfit", "takeProfit", "tpPrice", "tp"]);
    const requestedLeverageRaw = pickNumber(snapshot, ["requestedLeverage", "leverage"]);
    const requestedLeverage =
      requestedLeverageRaw !== null && Number.isFinite(requestedLeverageRaw)
        ? Math.max(1, Math.min(125, Math.trunc(requestedLeverageRaw)))
        : null;
    const positionSizeHint = derivePositionSizeHint(snapshot);
    const riskFlags = asRecord(snapshot.riskFlags);

    const events =
      input.includeEvents
        ? await input.db.predictionEvent.findMany({
            where: { stateId: stateRow.id },
            orderBy: [{ tsCreated: "desc" }],
            take: Math.max(1, Math.min(100, input.eventsLimit ?? 20))
          })
        : [];

    return {
      status: 200,
      body: {
        ...parsedDto.data,
        predictionId: parsedDto.data.id,
        signal: parsedDto.data.prediction.signal,
        expectedMovePct: parsedDto.data.prediction.expectedMovePct,
        confidence: parsedDto.data.prediction.confidence,
        indicators: indicators ?? null,
        riskFlags: riskFlags ?? null,
        accountId: parsedDto.data.accountId === "unassigned" ? null : parsedDto.data.accountId,
        leverage: requestedLeverage,
        suggestedEntry: deriveSuggestedEntry(snapshot),
        suggestedStopLoss,
        suggestedTakeProfit,
        positionSizeHint,
        entryPrice: null,
        stopLossPrice: suggestedStopLoss,
        takeProfitPrice: suggestedTakeProfit,
        horizonMs: null,
        outcomeStatus: "pending",
        outcomeResult: null,
        outcomeReason: null,
        outcomePnlPct: null,
        maxFavorablePct: null,
        maxAdversePct: null,
        outcomeEvaluatedAt: null,
        tags: asStringArray(parsedDto.data.tags).slice(0, 5),
        ...(input.includeEvents
          ? {
              events: events.map((event) => ({
                id: event.id,
                tsCreated: event.tsCreated.toISOString(),
                changeType: event.changeType,
                reason: event.reason,
                delta: event.delta,
                prevSnapshot: event.prevSnapshot,
                newSnapshot: event.newSnapshot,
                modelVersion: event.modelVersion
              }))
            }
          : {})
      }
    };
  }

  const row = await input.db.prediction.findUnique({
    where: { id: parsedParams.data.id }
  });
  if (!row) {
    return { status: 404, body: { error: "prediction_not_found" } };
  }

  const [linkedBot, ownedExchangeAccounts] = await Promise.all([
    row.botId
      ? input.db.bot.findUnique({
          where: { id: row.botId },
          select: {
            id: true,
            userId: true,
            exchange: true,
            exchangeAccountId: true
          }
        })
      : Promise.resolve(null),
    Promise.resolve(exchangeAccounts)
  ]);

  const accountIds = new Set(ownedExchangeAccounts.map((rowItem) => rowItem.id));
  const defaultAccount = ownedExchangeAccounts[0] ?? null;

  const snapshot = normalizePredictionFeatureSnapshot(row.featuresSnapshot);
  const requestedPrefillAccountId =
    typeof snapshot.prefillExchangeAccountId === "string"
      ? snapshot.prefillExchangeAccountId
      : null;
  const requestedPrefillExchange =
    typeof snapshot.prefillExchange === "string"
      ? snapshot.prefillExchange
      : null;

  const hasAccess =
    row.userId === input.userId ||
    linkedBot?.userId === input.userId ||
    (!!requestedPrefillAccountId && accountIds.has(requestedPrefillAccountId)) ||
    (!!linkedBot?.exchangeAccountId && accountIds.has(linkedBot.exchangeAccountId));

  if (!hasAccess) {
    return { status: 403, body: { error: "prediction_access_denied" } };
  }

  const resolvedAccountId =
    (requestedPrefillAccountId && accountIds.has(requestedPrefillAccountId)
      ? requestedPrefillAccountId
      : null) ??
    (linkedBot?.exchangeAccountId && accountIds.has(linkedBot.exchangeAccountId)
      ? linkedBot.exchangeAccountId
      : null) ??
    defaultAccount?.id ??
    "unassigned";

  const resolvedExchangeFromAccount = ownedExchangeAccounts.find((account) => account.id === resolvedAccountId)?.exchange;
  const resolvedExchange =
    requestedPrefillExchange ??
    resolvedExchangeFromAccount ??
    linkedBot?.exchange ??
    "bitget";

  const tags = normalizePredictionTags(row.tags);
  const explanation = normalizePredictionExplanation(row.explanation);
  const keyDrivers = normalizePredictionKeyDrivers(
    (snapshot as Record<string, unknown>).keyDrivers ?? derivePredictionKeyDrivers(snapshot)
  );
  const indicators = asRecord(snapshot.indicators) ?? null;
  const realizedPayload = readRealizedPayloadFromOutcomeMeta(row.outcomeMeta);

  const dtoCandidate = {
    id: row.id,
    exchange: resolvedExchange,
    accountId: resolvedAccountId,
    symbol: row.symbol,
    marketType: normalizeMarketType(row.marketType),
    timeframe: normalizeTimeframe(row.timeframe),
    tsCreated: row.tsCreated.toISOString(),
    tsPredictedFor: row.tsCreated.toISOString(),
    prediction: {
      signal: normalizeSignal(row.signal),
      expectedMovePct: toNumber(row.expectedMovePct),
      confidence: normalizePredictionConfidence(row.confidence)
    },
    tags,
    explanation: explanation.value,
    keyDrivers,
    featureSnapshot: snapshot,
    modelVersion: typeof row.modelVersion === "string" && row.modelVersion.trim().length > 0
      ? row.modelVersion
      : "baseline-v1",
    realized: {
      realizedReturnPct: realizedPayload.realizedReturnPct ?? toNumber(row.outcomePnlPct),
      evaluatedAt: realizedPayload.evaluatedAt ?? toIsoOrNull(row.outcomeEvaluatedAt),
      errorMetrics: normalizeErrorMetrics(row.outcomeMeta)
    }
  };

  const parsedDto = predictionDetailDtoSchema.safeParse(dtoCandidate);
  if (!parsedDto.success) {
    logger.error("prediction_detail_dto_validation_failed", {
      predictionId: row.id,
      exchange: resolvedExchange,
      timeframe: row.timeframe,
      modelVersion: row.modelVersion,
      featureSnapshotBytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
      featureSnapshotHash: hashStableObject(snapshot)
    });
    return { status: 500, body: { error: "prediction_detail_unexpected_error" } };
  }

  if (explanation.truncated) {
    logger.warn("prediction_detail_explanation_truncated", {
      predictionId: row.id,
      exchange: parsedDto.data.exchange,
      timeframe: parsedDto.data.timeframe,
      modelVersion: parsedDto.data.modelVersion
    });
  }

  const suggestedStopLoss = pickNumber(snapshot, ["suggestedStopLoss", "stopLoss", "slPrice", "sl"]);
  const suggestedTakeProfit = pickNumber(snapshot, ["suggestedTakeProfit", "takeProfit", "tpPrice", "tp"]);
  const requestedLeverageRaw = pickNumber(snapshot, ["requestedLeverage", "leverage"]);
  const requestedLeverage =
    requestedLeverageRaw !== null && Number.isFinite(requestedLeverageRaw)
      ? Math.max(1, Math.min(125, Math.trunc(requestedLeverageRaw)))
      : null;
  const positionSizeHint = derivePositionSizeHint(snapshot);
  const riskFlags = asRecord(snapshot.riskFlags);

  return {
    status: 200,
    body: {
      ...parsedDto.data,
      // Backward-compatible fields for current UI usage.
      predictionId: parsedDto.data.id,
      signal: parsedDto.data.prediction.signal,
      expectedMovePct: parsedDto.data.prediction.expectedMovePct,
      confidence: parsedDto.data.prediction.confidence,
      indicators: indicators ?? null,
      riskFlags: riskFlags ?? null,
      accountId: parsedDto.data.accountId === "unassigned" ? null : parsedDto.data.accountId,
      leverage: requestedLeverage,
      suggestedEntry: deriveSuggestedEntry(snapshot),
      suggestedStopLoss,
      suggestedTakeProfit,
      positionSizeHint,
      entryPrice: toNumber(row.entryPrice),
      stopLossPrice: toNumber(row.stopLossPrice),
      takeProfitPrice: toNumber(row.takeProfitPrice),
      horizonMs: toNumber(row.horizonMs),
      outcomeStatus: typeof row.outcomeStatus === "string" ? row.outcomeStatus : "pending",
      outcomeResult: typeof row.outcomeResult === "string" ? row.outcomeResult : null,
      outcomeReason: typeof row.outcomeReason === "string" ? row.outcomeReason : null,
      outcomePnlPct: toNumber(row.outcomePnlPct),
      maxFavorablePct: toNumber(row.maxFavorablePct),
      maxAdversePct: toNumber(row.maxAdversePct),
      outcomeEvaluatedAt: toIsoOrNull(row.outcomeEvaluatedAt),
      tags: asStringArray(parsedDto.data.tags).slice(0, 5)
    }
  };
}
