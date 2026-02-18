import assert from "node:assert/strict";
import test from "node:test";
import {
  computeOpenPnlUsd,
  computeRuntimeMarkPrice,
  deriveStoppedWhy,
  extractRealizedPnlUsdFromTradeEvent,
  extractLastDecisionConfidence,
  normalizeConfidencePercentValue,
  normalizeRuntimeReason,
  readBotPrimaryTradeState,
  sumRealizedPnlUsdFromTradeEvents,
  type BotTradeStateOverviewRow
} from "./overview.js";

test("readBotPrimaryTradeState matches by bot and normalized symbol", () => {
  const now = new Date("2026-02-18T12:00:00.000Z");
  const rows: BotTradeStateOverviewRow[] = [
    {
      botId: "bot_1",
      symbol: "BTCUSDT",
      lastSignal: "up",
      lastSignalTs: now,
      lastTradeTs: now,
      dailyTradeCount: 2,
      openSide: "long",
      openQty: 0.01,
      openEntryPrice: 65000,
      openTs: now
    },
    {
      botId: "bot_2",
      symbol: "ETHUSDT",
      lastSignal: "down",
      lastSignalTs: now,
      lastTradeTs: now,
      dailyTradeCount: 1,
      openSide: "short",
      openQty: 0.2,
      openEntryPrice: 3000,
      openTs: now
    }
  ];

  const matched = readBotPrimaryTradeState(rows, "bot_1", "btc_usdt");
  assert.ok(matched);
  assert.equal(matched?.symbol, "BTCUSDT");
  assert.equal(readBotPrimaryTradeState(rows, "bot_1", "ETHUSDT"), null);
});

test("normalizeRuntimeReason maps known runtime reasons", () => {
  assert.equal(normalizeRuntimeReason("stopped_by_user"), "Stopped by user");
  assert.equal(normalizeRuntimeReason("start_requested"), "Start requested");
  assert.equal(normalizeRuntimeReason("queue_enqueue_failed:timeout"), "Queue enqueue failed");
  assert.equal(normalizeRuntimeReason("loop_error:boom"), "Loop error");
  assert.equal(normalizeRuntimeReason("custom_reason"), "custom_reason");
  assert.equal(normalizeRuntimeReason(""), null);
});

test("deriveStoppedWhy prioritizes errors over runtime reason", () => {
  assert.equal(
    deriveStoppedWhy({
      botStatus: "error",
      runtimeReason: "stopped_by_user",
      runtimeLastError: "exchange timeout",
      botLastError: "fallback"
    }),
    "exchange timeout"
  );

  assert.equal(
    deriveStoppedWhy({
      botStatus: "stopped",
      runtimeReason: "stopped_by_user"
    }),
    "Stopped by user"
  );

  assert.equal(
    deriveStoppedWhy({
      botStatus: "running",
      runtimeReason: "stopped_by_user"
    }),
    null
  );
});

test("normalizeConfidencePercentValue converts 0..1 scale and passthrough percent", () => {
  assert.equal(normalizeConfidencePercentValue(0.8234), 82.34);
  assert.equal(normalizeConfidencePercentValue(73.1), 73.1);
  assert.equal(normalizeConfidencePercentValue("foo"), null);
});

test("extractLastDecisionConfidence reads first prediction copier decision confidence", () => {
  const events = [
    { type: "OTHER_EVENT", meta: { confidence: 99 } },
    { type: "PREDICTION_COPIER_DECISION", meta: { confidence: 0.67 } },
    { type: "PREDICTION_COPIER_DECISION", meta: { confidence: 88 } }
  ];

  assert.equal(extractLastDecisionConfidence(events), 67);
  assert.equal(extractLastDecisionConfidence([{ type: "OTHER_EVENT", meta: {} }]), null);
});

test("computeRuntimeMarkPrice uses mid first and falls back to bid/ask midpoint", () => {
  assert.equal(computeRuntimeMarkPrice({ mid: 123.45, bid: 100, ask: 200 }), 123.45);
  assert.equal(computeRuntimeMarkPrice({ mid: null, bid: 100, ask: 102 }), 101);
  assert.equal(computeRuntimeMarkPrice({ mid: null, bid: null, ask: 102 }), null);
});

test("computeOpenPnlUsd calculates long and short pnl", () => {
  assert.equal(
    computeOpenPnlUsd({ side: "long", qty: 1.5, entryPrice: 100, markPrice: 110 }),
    15
  );
  assert.equal(
    computeOpenPnlUsd({ side: "short", qty: 2, entryPrice: 100, markPrice: 90 }),
    20
  );
  assert.equal(
    computeOpenPnlUsd({ side: "flat", qty: 2, entryPrice: 100, markPrice: 90 }),
    null
  );
});

test("extractRealizedPnlUsdFromTradeEvent only accepts exit trade events", () => {
  assert.equal(
    extractRealizedPnlUsdFromTradeEvent({
      message: "exit:signal_flip",
      meta: { realizedPnlUsd: 12.34567 }
    }),
    12.3457
  );
  assert.equal(
    extractRealizedPnlUsdFromTradeEvent({
      message: "enter:long",
      meta: { realizedPnlUsd: 10 }
    }),
    null
  );
});

test("sumRealizedPnlUsdFromTradeEvents aggregates exit realized pnl", () => {
  const sum = sumRealizedPnlUsdFromTradeEvents([
    { message: "enter:long", meta: { realizedPnlUsd: 9 } },
    { message: "exit:neutral", meta: { realizedPnlUsd: 12.2 } },
    { message: "exit:signal_flip", meta: { realizedPnlUsd: -4.1 } },
    { message: "exit:signal_flip", meta: { foo: "bar" } }
  ]);
  assert.equal(sum, 8.1);
});
