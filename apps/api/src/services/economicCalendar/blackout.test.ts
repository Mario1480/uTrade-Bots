import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNewsBlackout } from "./blackout.js";

function event(ts: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId: String(overrides.sourceId ?? ts),
    ts: new Date(ts),
    country: String(overrides.country ?? "US"),
    currency: String(overrides.currency ?? "USD"),
    title: String(overrides.title ?? "CPI"),
    impact: (overrides.impact as "low" | "medium" | "high") ?? "high",
    forecast: null,
    previous: null,
    actual: null,
    source: "fmp" as const
  };
}

test("blackout active inside pre/post window", () => {
  const result = evaluateNewsBlackout({
    now: new Date("2026-02-12T12:15:00.000Z"),
    currency: "USD",
    events: [event("2026-02-12T12:30:00.000Z")],
    config: {
      enabled: true,
      impactMin: "high",
      preMinutes: 30,
      postMinutes: 30,
      currencies: "USD,EUR"
    }
  });
  assert.equal(result.newsRisk, true);
  assert.ok(result.activeWindow);
  assert.equal(result.nextEvent?.currency, "USD");
});

test("currency filter blocks unmatched events", () => {
  const result = evaluateNewsBlackout({
    now: new Date("2026-02-12T12:15:00.000Z"),
    currency: "USD",
    events: [event("2026-02-12T12:30:00.000Z", { currency: "EUR" })],
    config: {
      enabled: true,
      impactMin: "high",
      preMinutes: 30,
      postMinutes: 30,
      currencies: "USD,EUR"
    }
  });
  assert.equal(result.newsRisk, false);
  assert.equal(result.activeWindow, null);
  assert.equal(result.nextEvent, null);
});

test("overlapping windows choose earliest ending active window", () => {
  const result = evaluateNewsBlackout({
    now: new Date("2026-02-12T12:35:00.000Z"),
    currency: "USD",
    events: [
      event("2026-02-12T12:30:00.000Z", { title: "CPI" }),
      event("2026-02-12T12:40:00.000Z", { title: "PPI" })
    ],
    config: {
      enabled: true,
      impactMin: "high",
      preMinutes: 15,
      postMinutes: 15,
      currencies: "USD"
    }
  });
  assert.equal(result.newsRisk, true);
  assert.equal(result.activeWindow?.event.title, "CPI");
});
