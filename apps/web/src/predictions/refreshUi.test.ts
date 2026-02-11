import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPredictionCopySummary,
  formatRelativeTime,
  parsePredictionChangeReason
} from "./refreshUi";

test("parsePredictionChangeReason detects signal flip as triggered", () => {
  const parsed = parsePredictionChangeReason("signal:up->down,confidence_delta:12");
  assert.equal(parsed.kind, "triggered");
  assert.equal(parsed.lastChangeType, "signal_flip");
  assert.deepEqual(parsed.signalFlip, { from: "up", to: "down" });
  assert.equal(parsed.label, "Triggered");
});

test("parsePredictionChangeReason maps scheduled reason", () => {
  const parsed = parsePredictionChangeReason("scheduled");
  assert.equal(parsed.kind, "scheduled");
  assert.equal(parsed.label, "Scheduled");
});

test("formatRelativeTime handles recent timestamps", () => {
  const nowMs = Date.UTC(2026, 1, 11, 12, 0, 0);
  const result = formatRelativeTime(new Date(nowMs - 120_000).toISOString(), nowMs);
  assert.equal(result, "2m ago");
});

test("buildPredictionCopySummary includes refresh metadata", () => {
  const nowMs = Date.UTC(2026, 1, 11, 12, 0, 0);
  const summary = buildPredictionCopySummary({
    symbol: "BTCUSDT",
    timeframe: "1h",
    signal: "down",
    confidence: 78,
    expectedMovePct: -0.9,
    lastUpdatedAt: new Date(nowMs - 180_000).toISOString(),
    lastChangeReason: "trigger:trend_flip",
    tags: ["high_vol", "trend_down"],
    nowMs
  });
  assert.match(summary, /updated: 3m ago/);
  assert.match(summary, /reason: trigger:trend_flip/);
  assert.match(summary, /tags: high_vol, trend_down/);
});
