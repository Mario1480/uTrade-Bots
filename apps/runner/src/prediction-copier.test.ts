import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot, BotTradeState, PredictionGateState } from "./db.js";
import {
  buildPredictionHash,
  evaluatePredictionCopierDecision,
  readPredictionCopierConfig,
  type PredictionCopierConfig
} from "./prediction-copier.js";

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    name: "Prediction Copier",
    symbol: "BTCUSDT",
    exchange: "bitget",
    exchangeAccountId: "acc_1",
    strategyKey: "prediction_copier",
    marginMode: "isolated",
    leverage: 5,
    tickMs: 1000,
    paramsJson: {},
    credentials: {
      apiKey: "key",
      apiSecret: "secret",
      passphrase: "pass"
    },
    marketData: {
      exchange: "bitget",
      exchangeAccountId: "acc_1",
      credentials: {
        apiKey: "key",
        apiSecret: "secret",
        passphrase: "pass"
      }
    },
    ...overrides
  };
}

function makeState(overrides: Partial<BotTradeState> = {}): BotTradeState {
  return {
    botId: "bot_1",
    symbol: "BTCUSDT",
    lastPredictionHash: null,
    lastSignal: null,
    lastSignalTs: null,
    lastTradeTs: null,
    dailyTradeCount: 0,
    dailyResetUtc: new Date("2026-02-12T00:00:00.000Z"),
    openSide: null,
    openQty: null,
    openEntryPrice: null,
    openTs: null,
    ...overrides
  };
}

function makePrediction(overrides: Partial<PredictionGateState> = {}): PredictionGateState {
  return {
    id: "state_1",
    exchange: "bitget",
    accountId: "acc_1",
    userId: "user_1",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    signal: "up",
    expectedMovePct: 1.2,
    confidence: 82,
    tags: ["trend_up"],
    tsUpdated: new Date("2026-02-12T12:00:00.000Z"),
    ...overrides
  };
}

function makeConfig(overrides: Partial<PredictionCopierConfig> = {}): PredictionCopierConfig {
  return {
    botType: "prediction_copier",
    exchange: "bitget",
    accountId: "acc_1",
    marketType: "perp",
    symbols: ["BTCUSDT"],
    timeframe: "15m",
    minConfidence: 70,
    maxPredictionAgeSec: 600,
    mode: "enter_exit",
    positionSizing: {
      type: "fixed_usd",
      value: 100
    },
    risk: {
      maxOpenPositions: 3,
      maxDailyTrades: 20,
      cooldownSecAfterTrade: 120,
      maxNotionalPerSymbolUsd: 500,
      maxTotalNotionalUsd: 1500,
      maxLeverage: 3,
      stopLossPct: null,
      takeProfitPct: null,
      timeStopMin: null
    },
    filters: {
      blockTags: ["news_risk", "data_gap", "low_liquidity"],
      requireTags: null,
      allowSignals: ["up", "down"],
      minExpectedMovePct: null
    },
    execution: {
      orderType: "market",
      limitOffsetBps: 2,
      reduceOnlyOnExit: true
    },
    ...overrides
  };
}

test("readPredictionCopierConfig returns safe defaults", () => {
  const cfg = readPredictionCopierConfig(makeBot());
  assert.equal(cfg.botType, "prediction_copier");
  assert.equal(cfg.exchange, "bitget");
  assert.equal(cfg.timeframe, "15m");
  assert.equal(cfg.positionSizing.type, "fixed_usd");
  assert.equal(cfg.positionSizing.value, 100);
  assert.deepEqual(cfg.filters.allowSignals, ["up", "down"]);
});

test("readPredictionCopierConfig supports paper execution exchange", () => {
  const cfg = readPredictionCopierConfig(
    makeBot({
      exchange: "paper"
    })
  );
  assert.equal(cfg.exchange, "paper");
});

test("buildPredictionHash is deterministic", () => {
  const prediction = makePrediction();
  const h1 = buildPredictionHash(prediction);
  const h2 = buildPredictionHash(prediction);
  assert.equal(h1, h2);
});

test("decision enters on fresh up signal when flat", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction();
  const hash = buildPredictionHash(prediction);

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: hash,
    state: makeState(),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });

  assert.equal(decision.action, "enter");
  if (decision.action === "enter") {
    assert.equal(decision.side, "long");
  }
});

test("decision exits long when signal flips down", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ signal: "down" });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:50:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:50:00.000Z") },
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "exit");
  if (decision.action === "exit") {
    assert.equal(decision.side, "long");
  }
});

test("decision blocks duplicate prediction hash", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction();
  const hash = buildPredictionHash(prediction);

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: hash,
    state: makeState({ lastPredictionHash: hash }),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "duplicate_prediction_hash");
});

test("decision blocks cooldown after recent trade", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction();

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ lastTradeTs: new Date("2026-02-12T12:00:15.000Z") }),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "cooldown_active");
});

test("decision blocks blocked tags", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ tags: ["news_risk"] });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState(),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "blocked_tag:news_risk");
});
