import test from "node:test";
import assert from "node:assert/strict";
import { filterEconomicEventsByLocalDate } from "./notifications.js";

test("filterEconomicEventsByLocalDate keeps only events in target local date", () => {
  const events = [
    {
      id: "1",
      sourceId: "1",
      ts: "2026-03-01T23:30:00.000Z",
      country: "US",
      currency: "USD",
      title: "Event A",
      impact: "high",
      forecast: null,
      previous: null,
      actual: null,
      source: "fmp"
    },
    {
      id: "2",
      sourceId: "2",
      ts: "2026-03-02T08:00:00.000Z",
      country: "DE",
      currency: "EUR",
      title: "Event B",
      impact: "medium",
      forecast: null,
      previous: null,
      actual: null,
      source: "fmp"
    },
    {
      id: "3",
      sourceId: "3",
      ts: "2026-03-02T23:30:00.000Z",
      country: "JP",
      currency: "JPY",
      title: "Event C",
      impact: "high",
      forecast: null,
      previous: null,
      actual: null,
      source: "fmp"
    }
  ];

  const filtered = filterEconomicEventsByLocalDate({
    events,
    timezone: "Europe/Berlin",
    localDate: "2026-03-02"
  });

  assert.deepEqual(filtered.map((event) => event.id), ["1", "2"]);
});
