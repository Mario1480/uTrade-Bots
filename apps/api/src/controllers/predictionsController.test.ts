import assert from "node:assert/strict";
import test from "node:test";
import type { Prediction } from "@mm/db";
import { predictionDetailDtoSchema } from "../dto/predictions.dto.js";
import { getPredictionDetailController } from "./predictionsController.js";

type FixtureDb = {
  predictions: Prediction[];
  predictionStates?: Array<any>;
  predictionEvents?: Array<any>;
  bots: Array<{
    id: string;
    userId: string | null;
    exchange: string | null;
    exchangeAccountId: string | null;
  }>;
  exchangeAccounts: Array<{
    id: string;
    userId: string;
    exchange: string;
    updatedAt: Date;
  }>;
};

function makePrediction(
  overrides: Partial<Prediction> & Pick<Prediction, "id" | "symbol" | "marketType" | "timeframe">
): Prediction {
  const now = new Date("2026-02-11T12:00:00.000Z");
  return {
    id: overrides.id,
    userId: overrides.userId ?? "user_1",
    botId: overrides.botId ?? null,
    symbol: overrides.symbol,
    marketType: overrides.marketType,
    timeframe: overrides.timeframe,
    tsCreated: overrides.tsCreated ?? now,
    signal: overrides.signal ?? "up",
    expectedMovePct: overrides.expectedMovePct ?? 1.23,
    confidence: overrides.confidence ?? 71.5,
    explanation: overrides.explanation ?? "Grounded explanation.",
    tags: overrides.tags ?? ["trend_up", "high_vol", "invalid_tag", "trend_up"],
    featuresSnapshot: overrides.featuresSnapshot ?? {
      indicators: {
        rsi_14: 64.1,
        macd: { line: 0.12, signal: 0.09, hist: 0.03 }
      },
      keyDrivers: [
        { name: "rsi", value: 64.1 },
        { name: "emaSpread", value: 0.0021 },
        { name: "atrPct", value: 1.2 },
        { name: "spreadBps", value: 12 },
        { name: "fundingRate", value: 0.0002 },
        { name: "tooMuch", value: true }
      ],
      prefillExchangeAccountId: "acc_1"
    },
    entryPrice: overrides.entryPrice ?? null,
    stopLossPrice: overrides.stopLossPrice ?? null,
    takeProfitPrice: overrides.takeProfitPrice ?? null,
    horizonMs: overrides.horizonMs ?? null,
    outcomeStatus: overrides.outcomeStatus ?? "pending",
    outcomeResult: overrides.outcomeResult ?? null,
    outcomeReason: overrides.outcomeReason ?? null,
    outcomePnlPct: overrides.outcomePnlPct ?? null,
    maxFavorablePct: overrides.maxFavorablePct ?? null,
    maxAdversePct: overrides.maxAdversePct ?? null,
    outcomeEvaluatedAt: overrides.outcomeEvaluatedAt ?? null,
    outcomeMeta: overrides.outcomeMeta ?? null,
    modelVersion: overrides.modelVersion ?? "baseline-v1 + openai-explain-v1",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  };
}

function makeDb(fixtures: FixtureDb) {
  const predictionStates = fixtures.predictionStates ?? [];
  const predictionEvents = fixtures.predictionEvents ?? [];
  return {
    prediction: {
      findUnique: async (args: { where: { id: string } }) =>
        fixtures.predictions.find((item) => item.id === args.where.id) ?? null
    },
    predictionState: {
      findUnique: async (args: { where: { id: string } }) =>
        predictionStates.find((item) => item.id === args.where.id) ?? null
    },
    predictionEvent: {
      findMany: async (args: { where: { stateId: string }; take: number }) =>
        predictionEvents
          .filter((item) => item.stateId === args.where.stateId)
          .slice(0, args.take)
    },
    bot: {
      findUnique: async (args: { where: { id: string } }) =>
        fixtures.bots.find((item) => item.id === args.where.id) ?? null
    },
    exchangeAccount: {
      findMany: async (args: { where: { userId: string } }) =>
        fixtures.exchangeAccounts
          .filter((item) => item.userId === args.where.userId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map((item) => ({ id: item.id, exchange: item.exchange }))
    }
  };
}

test("returns 200 with validated dto and normalized tags/keyDrivers", async () => {
  const db = makeDb({
    predictions: [
      makePrediction({
        id: "cmf1234567890123456789012",
        symbol: "BTCUSDT",
        marketType: "perp",
        timeframe: "15m"
      })
    ],
    bots: [],
    exchangeAccounts: [
      { id: "acc_1", userId: "user_1", exchange: "bitget", updatedAt: new Date("2026-02-11T12:01:00.000Z") }
    ]
  });

  const result = await getPredictionDetailController({
    db: db as any,
    predictionId: "cmf1234567890123456789012",
    userId: "user_1"
  });

  assert.equal(result.status, 200);
  if (result.status !== 200) return;

  const parsed = predictionDetailDtoSchema.safeParse(result.body);
  assert.equal(parsed.success, true);
  assert.deepEqual(result.body.tags, ["trend_up", "high_vol"]);
  assert.equal(Array.isArray(result.body.keyDrivers), true);
  assert.equal((result.body.keyDrivers as any[]).length, 5);
});

test("returns 404 when prediction id does not exist", async () => {
  const db = makeDb({
    predictions: [],
    bots: [],
    exchangeAccounts: []
  });

  const result = await getPredictionDetailController({
    db: db as any,
    predictionId: "cmf1234567890123456789012",
    userId: "user_1"
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "prediction_not_found");
});

test("returns 403 when prediction exists but user has no access", async () => {
  const db = makeDb({
    predictions: [
      makePrediction({
        id: "cmf1234567890123456789012",
        userId: "user_2",
        symbol: "BTCUSDT",
        marketType: "perp",
        timeframe: "1h",
        featuresSnapshot: { prefillExchangeAccountId: "acc_other" }
      })
    ],
    bots: [],
    exchangeAccounts: [{ id: "acc_1", userId: "user_1", exchange: "bitget", updatedAt: new Date() }]
  });

  const result = await getPredictionDetailController({
    db: db as any,
    predictionId: "cmf1234567890123456789012",
    userId: "user_1"
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, "prediction_access_denied");
});

test("backward compatibility: missing indicators/explanation still returns valid dto", async () => {
  const db = makeDb({
    predictions: [
      makePrediction({
        id: "cmf1234567890123456789012",
        symbol: "ETHUSDT",
        marketType: "spot",
        timeframe: "5m",
        explanation: "",
        tags: ["invalid_tag", "trend_down"],
        featuresSnapshot: {}
      })
    ],
    bots: [],
    exchangeAccounts: [{ id: "acc_1", userId: "user_1", exchange: "bitget", updatedAt: new Date() }]
  });

  const result = await getPredictionDetailController({
    db: db as any,
    predictionId: "cmf1234567890123456789012",
    userId: "user_1"
  });

  assert.equal(result.status, 200);
  if (result.status !== 200) return;
  const parsed = predictionDetailDtoSchema.parse(result.body);
  assert.equal(parsed.explanation, null);
  assert.equal(parsed.featureSnapshot.indicators, undefined);
  assert.deepEqual(parsed.tags, ["trend_down"]);
});

test("returns state dto when id belongs to predictions_state and can include events", async () => {
  const now = new Date("2026-02-11T12:00:00.000Z");
  const db = makeDb({
    predictions: [],
    predictionStates: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        userId: "user_1",
        exchange: "bitget",
        accountId: "acc_1",
        symbol: "BTCUSDT",
        marketType: "perp",
        timeframe: "15m",
        tsUpdated: now,
        tsPredictedFor: new Date(now.getTime() + 15 * 60 * 1000),
        signal: "up",
        expectedMovePct: 1.1,
        confidence: 0.71,
        tags: ["trend_up", "high_vol"],
        explanation: "State explanation.",
        keyDrivers: [{ name: "indicators.rsi_14", value: 63.4 }],
        featuresSnapshot: {
          indicators: {
            rsi_14: 63.4
          },
          prefillExchangeAccountId: "acc_1"
        },
        modelVersion: "baseline-v1 + openai-explain-v1",
        lastAiExplainedAt: now,
        lastChangeHash: "abc",
        lastChangeReason: "signal_flip",
        autoScheduleEnabled: true,
        autoSchedulePaused: false,
        directionPreference: "either",
        confidenceTargetPct: 60,
        leverage: 10,
        createdAt: now,
        updatedAt: now
      }
    ],
    predictionEvents: [
      {
        id: "evt_1",
        stateId: "11111111-1111-4111-8111-111111111111",
        tsCreated: now,
        changeType: "signal_flip",
        prevSnapshot: { signal: "down" },
        newSnapshot: { signal: "up" },
        delta: { signal: "down->up" },
        modelVersion: "baseline-v1 + openai-explain-v1",
        reason: "trigger_trend_flip"
      }
    ],
    bots: [],
    exchangeAccounts: [
      { id: "acc_1", userId: "user_1", exchange: "bitget", updatedAt: now }
    ]
  });

  const result = await getPredictionDetailController({
    db: db as any,
    predictionId: "11111111-1111-4111-8111-111111111111",
    userId: "user_1",
    includeEvents: true,
    eventsLimit: 10
  });

  assert.equal(result.status, 200);
  if (result.status !== 200) return;
  assert.equal(result.body.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.body.signal, "up");
  assert.equal(Array.isArray((result.body as any).events), true);
  assert.equal(((result.body as any).events as any[]).length, 1);
});
