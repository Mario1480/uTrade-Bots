import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFmpEventsPayload } from "./fmp.js";

test("normalizeFmpEventsPayload maps and sanitizes rows", () => {
  const rows = normalizeFmpEventsPayload([
    {
      id: "evt-1",
      date: "2026-02-12 13:30:00",
      country: "US",
      currency: "USD",
      event: "Non-Farm Payrolls",
      impact: "High",
      forecast: "215.4K",
      previous: "198.2K",
      actual: "223.1K"
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceId, "evt-1");
  assert.equal(rows[0]?.impact, "high");
  assert.equal(rows[0]?.currency, "USD");
  assert.equal(rows[0]?.title, "Non-Farm Payrolls");
  assert.equal(rows[0]?.forecast, 215.4);
  assert.equal(rows[0]?.previous, 198.2);
  assert.equal(rows[0]?.actual, 223.1);
});

test("normalizeFmpEventsPayload skips invalid rows", () => {
  const rows = normalizeFmpEventsPayload([
    { id: "missing-date", event: "CPI" },
    { id: "missing-title", date: "2026-02-12 13:30:00" }
  ]);
  assert.equal(rows.length, 0);
});
