import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalSchema, mapDecisionToSignal } from "./agent.js";

test("mapDecisionToSignal maps long/short/no_trade to up/down/neutral", () => {
  assert.equal(mapDecisionToSignal("long"), "up");
  assert.equal(mapDecisionToSignal("short"), "down");
  assert.equal(mapDecisionToSignal("no_trade"), "neutral");
});

test("buildSignalSchema requires explanation by default", () => {
  const schema = buildSignalSchema();
  const required = Array.isArray((schema as any).required) ? (schema as any).required : [];
  assert.equal(required.includes("explanation"), true);
});

test("buildSignalSchema applies custom explanation min length", () => {
  const schema = buildSignalSchema({
    explanationRequired: true,
    explanationMinLength: 420
  });
  const explanation = (schema as any)?.properties?.explanation ?? {};
  assert.equal(explanation.minLength, 420);
});
