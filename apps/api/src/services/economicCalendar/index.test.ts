import assert from "node:assert/strict";
import test from "node:test";
import { applyNewsRiskToFeatureSnapshot } from "./index.js";

test("applyNewsRiskToFeatureSnapshot sets newsRisk + tag", () => {
  const next = applyNewsRiskToFeatureSnapshot(
    {
      tags: ["trend_up", "high_vol"]
    },
    {
      newsRisk: true,
      currency: "USD",
      nextEvent: {
        id: "evt1",
        sourceId: "evt1",
        ts: "2026-02-12T12:30:00.000Z",
        country: "US",
        currency: "USD",
        title: "CPI",
        impact: "high",
        forecast: null,
        previous: null,
        actual: null,
        source: "fmp"
      },
      activeWindow: {
        from: "2026-02-12T12:00:00.000Z",
        to: "2026-02-12T13:00:00.000Z",
        event: {
          id: "evt1",
          sourceId: "evt1",
          ts: "2026-02-12T12:30:00.000Z",
          country: "US",
          currency: "USD",
          title: "CPI",
          impact: "high",
          forecast: null,
          previous: null,
          actual: null,
          source: "fmp"
        }
      }
    }
  );

  assert.equal(next.newsRisk, true);
  assert.ok(Array.isArray(next.tags));
  assert.equal((next.tags as string[])[0], "news_risk");
});

test("applyNewsRiskToFeatureSnapshot clears news_risk when inactive", () => {
  const next = applyNewsRiskToFeatureSnapshot(
    { tags: ["news_risk", "trend_down"] },
    {
      newsRisk: false,
      currency: "USD",
      nextEvent: null,
      activeWindow: null
    }
  );

  assert.equal(next.newsRisk, false);
  assert.deepEqual(next.tags, ["trend_down"]);
});
