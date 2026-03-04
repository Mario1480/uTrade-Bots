import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot } from "../db.js";
import { resolveExecutionModeForBot, resolveExecutionModeKeyForBot } from "./registry.js";

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    name: "Registry test bot",
    symbol: "BTCUSDT",
    exchange: "bitget",
    exchangeAccountId: "acc_1",
    strategyKey: "dummy",
    marginMode: "isolated",
    leverage: 3,
    paramsJson: {},
    tickMs: 1000,
    credentials: {
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p"
    },
    marketData: {
      exchange: "bitget",
      exchangeAccountId: "acc_1",
      credentials: {
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p"
      }
    },
    ...overrides
  };
}

test("execution registry resolves default mode for non-copier strategies", () => {
  const bot = makeBot({ strategyKey: "dummy" });
  const key = resolveExecutionModeKeyForBot(bot);
  const mode = resolveExecutionModeForBot(bot);

  assert.equal(key, "futures_engine");
  assert.equal(mode.key, "futures_engine");
});

test("execution registry resolves prediction_copier mode by strategy key", () => {
  const bot = makeBot({ strategyKey: "prediction_copier" });
  const key = resolveExecutionModeKeyForBot(bot);
  const mode = resolveExecutionModeForBot(bot);

  assert.equal(key, "prediction_copier");
  assert.equal(mode.key, "prediction_copier");
});

test("execution registry allows explicit paramsJson executionMode override", () => {
  const bot = makeBot({
    strategyKey: "prediction_copier",
    paramsJson: {
      executionMode: "futures_engine"
    }
  });
  const key = resolveExecutionModeKeyForBot(bot);
  const mode = resolveExecutionModeForBot(bot);

  assert.equal(key, "futures_engine");
  assert.equal(mode.key, "futures_engine");
});
