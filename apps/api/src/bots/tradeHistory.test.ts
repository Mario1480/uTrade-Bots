import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOutcomeFromClose,
  computeCoreMetricsFromClosedTrades,
  computeRealizedPnlPct,
  decodeTradeHistoryCursor,
  encodeTradeHistoryCursor
} from "./tradeHistory.js";

test("computeRealizedPnlPct handles long and short", () => {
  assert.equal(computeRealizedPnlPct({ side: "long", entryPrice: 100, exitPrice: 105 }), 5);
  assert.equal(computeRealizedPnlPct({ side: "short", entryPrice: 100, exitPrice: 95 }), 5.2632);
  assert.equal(computeRealizedPnlPct({ side: "long", entryPrice: 0, exitPrice: 100 }), null);
});

test("classifyOutcomeFromClose maps reasons", () => {
  assert.equal(classifyOutcomeFromClose({ tpHit: true }), "tp_hit");
  assert.equal(classifyOutcomeFromClose({ slHit: true }), "sl_hit");
  assert.equal(classifyOutcomeFromClose({ exitReason: "signal_flip" }), "signal_exit");
  assert.equal(classifyOutcomeFromClose({ exitReason: "confidence_below_min" }), "signal_exit");
  assert.equal(classifyOutcomeFromClose({ exitReason: "time_stop" }), "time_stop");
  assert.equal(classifyOutcomeFromClose({ exitReason: "manual_close" }), "manual_exit");
  assert.equal(classifyOutcomeFromClose({ exitReason: "something_else" }), "unknown");
});

test("computeCoreMetricsFromClosedTrades calculates key analytics", () => {
  const metrics = computeCoreMetricsFromClosedTrades([
    {
      id: "1",
      side: "long",
      entryTs: new Date("2026-02-19T10:00:00.000Z"),
      exitTs: new Date("2026-02-19T10:30:00.000Z"),
      entryPrice: 100,
      exitPrice: 102,
      realizedPnlUsd: 20
    },
    {
      id: "2",
      side: "short",
      entryTs: new Date("2026-02-19T11:00:00.000Z"),
      exitTs: new Date("2026-02-19T11:10:00.000Z"),
      entryPrice: 100,
      exitPrice: 101,
      realizedPnlUsd: -10
    },
    {
      id: "3",
      side: "long",
      entryTs: new Date("2026-02-19T12:00:00.000Z"),
      exitTs: new Date("2026-02-19T12:20:00.000Z"),
      entryPrice: 100,
      exitPrice: 99.5,
      realizedPnlUsd: -5
    }
  ]);

  assert.equal(metrics.trades, 3);
  assert.equal(metrics.wins, 1);
  assert.equal(metrics.losses, 2);
  assert.equal(metrics.winRatePct, 33.33);
  assert.equal(metrics.avgWinUsd, 20);
  assert.equal(metrics.avgLossUsd, -7.5);
  assert.equal(metrics.profitFactor, 1.3333);
  assert.equal(metrics.netPnlUsd, 5);
  assert.equal(metrics.maxDrawdownUsd, 15);
  assert.equal(metrics.avgHoldMinutes, 20);
});

test("cursor encode/decode roundtrip", () => {
  const ts = new Date("2026-02-19T08:00:00.000Z");
  const encoded = encodeTradeHistoryCursor(ts, "hist_1");
  const decoded = decodeTradeHistoryCursor(encoded);
  assert.ok(decoded);
  assert.equal(decoded?.id, "hist_1");
  assert.equal(decoded?.entryTs.toISOString(), ts.toISOString());
  assert.equal(decodeTradeHistoryCursor("invalid"), null);
});
