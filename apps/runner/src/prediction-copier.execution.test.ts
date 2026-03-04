import assert from "node:assert/strict";
import test from "node:test";
import { executePredictionCopierIntentViaEngine } from "./prediction-copier.js";

test("prediction copier engine bridge forwards open intent and maps accepted result", async () => {
  const riskEvents: Array<{ type: string; message?: string | null; meta?: unknown }> = [];
  let capturedIntent: unknown = null;

  const result = await executePredictionCopierIntentViaEngine({
    adapter: {},
    botId: "bot_1",
    intent: {
      type: "open",
      symbol: "BTCUSDT",
      side: "long",
      order: {
        type: "limit",
        qty: 0.25,
        price: 65000
      }
    },
    deps: {
      createEngine: () => ({
        execute: async (intent, ctx) => {
          capturedIntent = intent;
          await ctx.emitRiskEvent?.({
            type: "ORDER_VALIDATION_BLOCK",
            botId: "bot_1",
            timestamp: new Date().toISOString(),
            message: "validation blocked",
            meta: { field: "qty" }
          });
          return { status: "accepted", orderId: "ord_123" };
        }
      } as any),
      writeRiskEventFn: async (params) => {
        riskEvents.push(params);
      }
    }
  });

  assert.deepEqual(capturedIntent, {
    type: "open",
    symbol: "BTCUSDT",
    side: "long",
    order: {
      type: "limit",
      qty: 0.25,
      price: 65000
    }
  });
  assert.equal(result.orderId, "ord_123");
  assert.equal(result.blockedReason, null);
  assert.equal(riskEvents.length, 1);
  assert.equal(riskEvents[0]?.type, "BOT_ERROR");
});

test("prediction copier engine bridge maps blocked close result", async () => {
  const result = await executePredictionCopierIntentViaEngine({
    adapter: {},
    botId: "bot_1",
    intent: {
      type: "close",
      symbol: "BTCUSDT",
      reason: "signal_flip",
      order: {
        type: "market",
        qty: 0.5,
        reduceOnly: true
      }
    },
    deps: {
      createEngine: () => ({
        execute: async () => ({ status: "blocked", reason: "validation" })
      } as any)
    }
  });

  assert.equal(result.orderId, null);
  assert.equal(result.blockedReason, "validation");
});

test("prediction copier engine bridge maps noop as blockedReason noop", async () => {
  const result = await executePredictionCopierIntentViaEngine({
    adapter: {},
    botId: "bot_1",
    intent: {
      type: "close",
      symbol: "BTCUSDT",
      reason: "manual"
    },
    deps: {
      createEngine: () => ({
        execute: async () => ({ status: "noop" })
      } as any)
    }
  });

  assert.equal(result.orderId, null);
  assert.equal(result.blockedReason, "noop");
});
