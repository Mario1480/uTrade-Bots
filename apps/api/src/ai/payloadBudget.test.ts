import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAiPayloadBudget,
  getAiPayloadBudgetAlertSnapshot,
  getAiPayloadBudgetTelemetrySnapshot,
  recordAiPayloadBudgetTelemetry,
  resetAiPayloadBudgetTelemetry,
  type AiPayloadBudgetMetrics
} from "./payloadBudget.js";

function makeHistoryContext(evCount: number, lastBarsCount: number) {
  return {
    v: 1,
    tf: "5m",
    ts_to: "2026-02-14T12:00:00.000Z",
    lastBars: {
      n: lastBarsCount,
      ohlc: Array.from({ length: lastBarsCount }, (_, idx) => ({
        t: 1_771_000_000 + idx,
        o: 70000,
        h: 70010,
        l: 69990,
        c: 70005,
        v: 120 + idx
      }))
    },
    win: {
      w20: { ret: 1, vr: 0.8, atr: 0.5, tr: 60, mx: 2, dd: -1 },
      w50: { ret: 2, vr: 0.7, atr: 0.4, tr: 58, mx: 3, dd: -2 },
      w200: { ret: 3, vr: 0.6, atr: 0.3, tr: 54, mx: 5, dd: -3 },
      w800: { ret: 4, vr: 0.5, atr: 0.2, tr: 50, mx: 7, dd: -4 }
    },
    reg: {
      state: "transition",
      conf: 55,
      since: "2026-02-14T11:40:00.000Z",
      why: ["trend_strong"]
    },
    lvl: {
      pivD: { pp: null, r1: null, s1: null, r2: null, s2: null },
      hiLo: { yH: null, yL: null, wH: null, wL: null },
      do: { p: null }
    },
    ema: {
      e5: 1,
      e13: 1,
      e50: 1,
      e200: 1,
      e800: 1,
      stk: "bull",
      d50: 0.2,
      d200: 0.6,
      d800: 1.1,
      sl50: 0.02,
      sl200: 0.01
    },
    vol: { z: 1.2, rv: 1.3, tr: 0.6 },
    fvg: {
      ob: 2,
      os: 1,
      nb: { m: 70000, d: 0.2, a: 5 },
      ns: { m: 69800, d: -0.3, a: 7 }
    },
    ls: { le: null, nb: null, ns: null },
    ev: Array.from({ length: evCount }, (_, idx) => ({
      t: new Date(1_771_000_000_000 + idx * 60_000).toISOString(),
      ty: `ev_${idx}`,
      sd: idx % 2 === 0 ? "bull" : "bear",
      i: 3
    })),
    bud: {
      bytes: 0,
      trim: []
    }
  };
}

test("applyAiPayloadBudget trims history context and writes trim metadata", () => {
  const payload = {
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "5m",
    prediction: { signal: "up", expectedMovePct: 1.2, confidence: 0.62 },
    featureSnapshot: {
      historyContext: makeHistoryContext(40, 40)
    }
  } as Record<string, unknown>;

  const { payload: trimmed, metrics } = applyAiPayloadBudget(payload, {
    maxPayloadBytes: 2000,
    maxHistoryBytes: 1400
  });
  const bytes = Buffer.byteLength(JSON.stringify(trimmed), "utf8");

  assert.equal(bytes <= metrics.maxPayloadBytes || metrics.overBudget, true);
  assert.equal(Array.isArray(metrics.trimFlags), true);
  assert.equal((trimmed.meta as any).payloadBytes, metrics.bytes);
  assert.equal(Array.isArray((trimmed.meta as any).trim), true);
  assert.equal((trimmed.meta as any).trim.length > 0, true);
});

test("applyAiPayloadBudget marks over-budget payloads after last-resort trim", () => {
  const payload = {
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "5m",
    operatorPrompt: "x".repeat(10_000),
    prediction: { signal: "up", expectedMovePct: 1.2, confidence: 0.62 },
    featureSnapshot: {
      historyContext: makeHistoryContext(20, 20)
    }
  } as Record<string, unknown>;

  const { payload: trimmed, metrics } = applyAiPayloadBudget(payload, {
    maxPayloadBytes: 1200,
    maxHistoryBytes: 800
  });

  assert.equal(metrics.overBudget, true);
  assert.equal(metrics.trimFlags.includes("payload_budget_exceeded"), true);
  assert.equal((trimmed.meta as any).trim.includes("payload_budget_exceeded"), true);
});

test("applyAiPayloadBudget can drop heavy mtf/ohlcv payload sections to meet tight budget", () => {
  const bars = Array.from({ length: 120 }, (_, idx) => ({
    t: 1_771_000_000 + idx * 300,
    o: 70_000 + idx,
    h: 70_100 + idx,
    l: 69_900 + idx,
    c: 70_050 + idx,
    v: 100 + idx
  }));
  const payload = {
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "5m",
    prediction: { signal: "up", expectedMovePct: 1.2, confidence: 0.62 },
    featureSnapshot: {
      ohlcvSeries: {
        timeframe: "5m",
        count: bars.length,
        bars
      },
      mtf: {
        runTimeframe: "5m",
        frames: {
          "5m": {
            ohlcvSeries: {
              timeframe: "5m",
              count: bars.length,
              bars
            },
            advancedIndicators: {
              pvsra: {
                vectorTier: "extreme",
                score: 99
              }
            }
          },
          "1h": {
            ohlcvSeries: {
              timeframe: "1h",
              count: bars.length,
              bars
            },
            advancedIndicators: {
              cloud: {
                pricePos: 0.84
              }
            }
          }
        }
      },
      advancedIndicators: {
        emas: {
          ema_50: 70_000,
          ema_200: 69_000
        }
      }
    }
  } as Record<string, unknown>;

  const { payload: trimmed, metrics } = applyAiPayloadBudget(payload, {
    maxPayloadBytes: 4500,
    maxHistoryBytes: 2000
  });
  assert.equal(metrics.overBudget, false);
  assert.equal(metrics.trimFlags.length > 0, true);
  assert.equal(
    metrics.trimFlags.some((flag) =>
      flag.includes("trimmed") || flag.endsWith("_dropped")
    ),
    true
  );
});

test("budget telemetry emits high-water and trim-rate alert snapshots", () => {
  resetAiPayloadBudgetTelemetry();
  const base: AiPayloadBudgetMetrics = {
    bytes: 11_200,
    estimatedTokens: 2800,
    trimFlags: [],
    maxPayloadBytes: 12 * 1024,
    maxHistoryBytes: 8 * 1024,
    toolCallsUsed: 1,
    historyContextHash: "abc",
    overBudget: false
  };

  for (let i = 0; i < 9; i += 1) {
    recordAiPayloadBudgetTelemetry(base);
  }
  let snapshot = getAiPayloadBudgetAlertSnapshot();
  assert.equal(snapshot.highWaterAlert, true);

  for (let i = 0; i < 21; i += 1) {
    recordAiPayloadBudgetTelemetry({
      ...base,
      trimFlags: ["history_ev_trimmed_10"]
    });
  }
  snapshot = getAiPayloadBudgetAlertSnapshot();
  assert.equal(snapshot.trimAlert, true);
  assert.equal(snapshot.trimCountLastHour >= snapshot.trimAlertThresholdPerHour, true);
  const telemetry = getAiPayloadBudgetTelemetrySnapshot();
  assert.equal(telemetry.totalBudgetCalls >= 30, true);
  assert.equal(telemetry.cacheHitRatePct >= 0, true);
  assert.equal(telemetry.lastMetrics?.bytes, 11_200);

  resetAiPayloadBudgetTelemetry();
});
