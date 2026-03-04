import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot } from "./db.js";
import { loopOnce } from "./loop.js";
import type { ExecutionMode } from "./execution/types.js";
import type { SignalEngine } from "./signal/types.js";

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    name: "Loop test bot",
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

test("loopOnce blocks when signal layer blocks and does not execute execution mode", async () => {
  const bot = makeBot();
  let writeCalls = 0;
  let markCalls = 0;
  const riskEvents: Array<{ type: string; message?: string | null; meta?: unknown }> = [];

  const signalEngine: SignalEngine = {
    key: "test_signal_engine",
    async decide() {
      return {
        side: "flat",
        confidence: 0.51,
        reason: "confidence_below_min",
        metadata: {
          blockedBySignal: true,
          signalIntentType: "open",
          gate: {
            applied: true,
            allow: false,
            reason: "confidence_below_min",
            sizeMultiplier: 1,
            timeframe: "15m"
          }
        },
        legacyIntent: {
          type: "open",
          symbol: "BTCUSDT",
          side: "long",
          order: { qty: 1 }
        }
      };
    }
  };

  const executionMode: ExecutionMode = {
    key: "test_execution_mode",
    async execute() {
      throw new Error("execution mode must not be called for blocked signal");
    }
  };

  const result = await loopOnce(bot, "worker_1", {
    resolveSignalEngine: () => signalEngine,
    resolveExecutionMode: () => executionMode,
    writeBotTickFn: async () => {
      writeCalls += 1;
    },
    writeRiskEventFn: async (params) => {
      riskEvents.push(params);
    },
    markExchangeAccountUsedFn: async () => {
      markCalls += 1;
    }
  });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.reason, "gated:confidence_below_min;strategy:dummy;intent:open");
  assert.equal(result.signalReason, "confidence_below_min");
  assert.equal(result.executionReason, "skipped_due_to_signal_block");
  assert.equal(result.trace.signal.engine, "test_signal_engine");
  assert.equal(result.trace.execution.mode, "test_execution_mode");
  assert.equal(writeCalls, 1);
  assert.equal(markCalls, 1);
  assert.equal(riskEvents.length, 2);
  assert.equal(riskEvents[0]?.type, "SIGNAL_DECISION");
  assert.equal(riskEvents[1]?.type, "EXECUTION_DECISION");
  assert.equal(riskEvents[1]?.message, "skipped_due_to_signal_block");
});

test("loopOnce executes execution mode and emits split trace", async () => {
  const bot = makeBot();
  let writeCalls = 0;
  let markCalls = 0;
  const riskEvents: Array<{ type: string; message?: string | null; meta?: unknown }> = [];

  const signalEngine: SignalEngine = {
    key: "test_signal_engine",
    async decide() {
      return {
        side: "long",
        confidence: 0.82,
        reason: "signal_ready",
        metadata: {
          blockedBySignal: false,
          gate: {
            applied: false,
            allow: true,
            reason: "gating_disabled",
            sizeMultiplier: 1,
            timeframe: null
          }
        },
        legacyIntent: {
          type: "open",
          symbol: "BTCUSDT",
          side: "long",
          order: { qty: 0.5 }
        }
      };
    }
  };

  const executionMode: ExecutionMode = {
    key: "test_execution_mode",
    async execute(signal) {
      return {
        status: "executed",
        reason: "accepted",
        metadata: {
          engineStatus: "accepted",
          preserveReason: false
        },
        orderIds: ["order_1"],
        legacy: {
          outcome: "ok",
          intent: signal.legacyIntent,
          gate: {
            applied: false,
            allow: true,
            reason: "gating_disabled",
            sizeMultiplier: 1,
            timeframe: null
          }
        }
      };
    }
  };

  const result = await loopOnce(bot, "worker_1", {
    resolveSignalEngine: () => signalEngine,
    resolveExecutionMode: () => executionMode,
    writeBotTickFn: async () => {
      writeCalls += 1;
    },
    writeRiskEventFn: async (params) => {
      riskEvents.push(params);
    },
    markExchangeAccountUsedFn: async () => {
      markCalls += 1;
    }
  });

  assert.equal(result.outcome, "ok");
  assert.equal(result.reason, "strategy:dummy;intent:open;engine:accepted");
  assert.equal(result.signalReason, "signal_ready");
  assert.equal(result.executionReason, "accepted");
  assert.equal(result.trace.signal.engine, "test_signal_engine");
  assert.equal(result.trace.execution.mode, "test_execution_mode");
  assert.equal(result.trace.execution.status, "executed");
  assert.equal(writeCalls, 1);
  assert.equal(markCalls, 1);
  assert.equal(riskEvents.length, 2);
  assert.equal(riskEvents[0]?.type, "SIGNAL_DECISION");
  assert.equal(riskEvents[1]?.type, "EXECUTION_DECISION");
  assert.equal(riskEvents[1]?.message, "accepted");
});
