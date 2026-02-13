import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../timeframe.js";
import { computeAdvancedIndicators } from "./advancedIndicators.js";
import { computeLevels } from "./levels.js";
import { computePvsra } from "./pvsra.js";
import { computeRanges } from "./ranges.js";
import { computeSessions } from "./sessions.js";

function buildCandles(count: number, tfMs = 5 * 60 * 1000): Candle[] {
  const out: Candle[] = [];
  const start = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 14) * 0.9 + Math.cos(i / 29) * 0.4;
    price = Math.max(1, price + 0.09 + wave * 0.08);
    const open = price - 0.3;
    const close = price + 0.25;
    const high = Math.max(open, close) + 0.45;
    const low = Math.min(open, close) - 0.45;
    out.push({
      ts: start + i * tfMs,
      open,
      high,
      low,
      close,
      volume: 100 + (i % 16) * 9
    });
  }
  return out;
}

test("advancedIndicators computes EMA set + cloud with bounded cloud position", () => {
  const snapshot = computeAdvancedIndicators(buildCandles(1200), "5m");
  assert.equal(snapshot.dataGap, false);
  assert.ok(snapshot.emas.ema_50 !== null);
  assert.ok(snapshot.emas.ema_200 !== null);
  assert.ok(snapshot.emas.ema_800 !== null);
  assert.ok(snapshot.cloud.price_pos !== null);
  assert.ok(snapshot.cloud.price_pos! >= 0 && snapshot.cloud.price_pos! <= 1);
});

test("advancedIndicators marks data gap when ema_800 cannot be computed", () => {
  const snapshot = computeAdvancedIndicators(buildCandles(300), "15m");
  assert.equal(snapshot.dataGap, true);
  assert.equal(snapshot.emas.ema_800, null);
});

test("daily pivots follow classic floor equations", () => {
  const day1 = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
  const day2 = Date.UTC(2026, 1, 2, 0, 0, 0, 0);
  const candles: Candle[] = [
    { ts: day1 + 0 * 60 * 60 * 1000, open: 100, high: 110, low: 95, close: 108, volume: 100 },
    { ts: day1 + 12 * 60 * 60 * 1000, open: 108, high: 112, low: 97, close: 106, volume: 100 },
    { ts: day2 + 0 * 60 * 60 * 1000, open: 106, high: 113, low: 101, close: 111, volume: 100 }
  ];
  const levels = computeLevels(candles);
  const pp = (112 + 95 + 106) / 3;
  const r1 = (2 * pp) - 95;
  const s1 = (2 * pp) - 112;
  assert.ok(levels.daily.pivots.pp !== null);
  assert.ok(Math.abs(levels.daily.pivots.pp! - pp) < 1e-6);
  assert.ok(Math.abs(levels.daily.pivots.r1! - r1) < 1e-6);
  assert.ok(Math.abs(levels.daily.pivots.s1! - s1) < 1e-6);
});

test("pvsra classifies extreme vector on 2x volume", () => {
  const candles = buildCandles(30);
  const boosted: Candle[] = candles.map((row, idx) =>
    idx === candles.length - 1
      ? {
        ...row,
        volume: (row.volume ?? 0) * 3,
        close: row.open + Math.abs(row.close - row.open) + 0.1
      }
      : row
  );
  const pvsra = computePvsra(boosted);
  assert.equal(pvsra.vectorTier, "extreme");
  assert.ok(pvsra.vectorColor === "green" || pvsra.vectorColor === "red");
});

test("range bands follow Pine adrHiLo logic in Hi/Lo mode by default", () => {
  const day1 = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
  const day2 = Date.UTC(2026, 1, 2, 0, 0, 0, 0);
  const day3 = Date.UTC(2026, 1, 3, 0, 0, 0, 0);
  const candles: Candle[] = [
    { ts: day1, open: 100, high: 110, low: 100, close: 105, volume: 100 },
    { ts: day2, open: 105, high: 125, low: 105, close: 120, volume: 100 },
    { ts: day3, open: 145, high: 150, low: 140, close: 146, volume: 100 }
  ];
  const ranges = computeRanges(candles);
  // completed ranges: 10 and 20 => avg=15
  assert.equal(ranges.adr.mode, "hilo");
  assert.equal(ranges.adr.value, 15);
  assert.equal(ranges.adr.high, 155); // current low + avg
  assert.equal(ranges.adr.low, 135); // current high - avg
  assert.equal(ranges.adr.high50, 147.5);
  assert.equal(ranges.adr.low50, 142.5);
});

test("range bands support open-anchor mode", () => {
  const day1 = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
  const day2 = Date.UTC(2026, 1, 2, 0, 0, 0, 0);
  const day3 = Date.UTC(2026, 1, 3, 0, 0, 0, 0);
  const candles: Candle[] = [
    { ts: day1, open: 100, high: 110, low: 100, close: 105, volume: 100 },
    { ts: day2, open: 105, high: 125, low: 105, close: 120, volume: 100 },
    { ts: day3, open: 145, high: 150, low: 140, close: 146, volume: 100 }
  ];
  const ranges = computeRanges(candles, { adrUseOpen: true });
  assert.equal(ranges.adr.mode, "open");
  assert.equal(ranges.adr.value, 15);
  assert.equal(ranges.adr.high, 160); // open + avg
  assert.equal(ranges.adr.low, 130); // open - avg
});

test("sessions apply UK/US DST offsets exactly for known switch dates", () => {
  const beforeUk = Date.UTC(2024, 2, 30, 12, 0, 0, 0); // 2024-03-30
  const afterUk = Date.UTC(2024, 2, 31, 12, 0, 0, 0); // 2024-03-31
  const beforeUs = Date.UTC(2024, 2, 9, 12, 0, 0, 0); // 2024-03-09
  const afterUs = Date.UTC(2024, 2, 10, 12, 0, 0, 0); // 2024-03-10
  const candlesBeforeUk: Candle[] = [{ ts: beforeUk, open: 1, high: 2, low: 0.5, close: 1.4, volume: 1 }];
  const candlesAfterUk: Candle[] = [{ ts: afterUk, open: 1, high: 2, low: 0.5, close: 1.4, volume: 1 }];
  const candlesBeforeUs: Candle[] = [{ ts: beforeUs, open: 1, high: 2, low: 0.5, close: 1.4, volume: 1 }];
  const candlesAfterUs: Candle[] = [{ ts: afterUs, open: 1, high: 2, low: 0.5, close: 1.4, volume: 1 }];

  const ukOff = computeSessions(candlesBeforeUk);
  const ukOn = computeSessions(candlesAfterUk);
  const usOff = computeSessions(candlesBeforeUs);
  const usOn = computeSessions(candlesAfterUs);

  assert.equal(ukOff.sessions.london.sessionStartUtc?.slice(11, 16), "08:00");
  assert.equal(ukOff.sessions.london.sessionEndUtc?.slice(11, 16), "16:30");
  assert.equal(ukOn.sessions.london.sessionStartUtc?.slice(11, 16), "07:00");
  assert.equal(ukOn.sessions.london.sessionEndUtc?.slice(11, 16), "15:30");

  assert.equal(usOff.sessions.newYork.sessionStartUtc?.slice(11, 16), "14:30");
  assert.equal(usOff.sessions.newYork.sessionEndUtc?.slice(11, 16), "21:00");
  assert.equal(usOn.sessions.newYork.sessionStartUtc?.slice(11, 16), "13:30");
  assert.equal(usOn.sessions.newYork.sessionEndUtc?.slice(11, 16), "20:00");
});
