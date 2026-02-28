import test from "node:test";
import assert from "node:assert/strict";
import { resolveAiModelFromConfig } from "./provider.js";

test("resolveAiModelFromConfig prefers db model over env model", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: "gpt-5-mini",
    envModel: "gpt-4o-mini"
  });
  assert.equal(resolved.model, "gpt-5-mini");
  assert.equal(resolved.source, "db");
});

test("resolveAiModelFromConfig falls back to env model when db model is missing", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: "gpt-4.1-nano"
  });
  assert.equal(resolved.model, "gpt-4.1-nano");
  assert.equal(resolved.source, "env");
});

test("resolveAiModelFromConfig falls back to default when db and env are missing", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: null
  });
  assert.equal(resolved.model, "gpt-4o-mini");
  assert.equal(resolved.source, "default");
});

test("resolveAiModelFromConfig ignores invalid db model and uses env when valid", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: "gpt-4o",
    envModel: "gpt-5-nano"
  });
  assert.equal(resolved.model, "gpt-5-nano");
  assert.equal(resolved.source, "env");
});

test("resolveAiModelFromConfig ignores invalid env model and uses default", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: "gpt-4o"
  });
  assert.equal(resolved.model, "gpt-4o-mini");
  assert.equal(resolved.source, "default");
});

test("resolveAiModelFromConfig allows free-form ollama model names", () => {
  const resolved = resolveAiModelFromConfig({
    provider: "ollama",
    dbModel: "qwen3:8b",
    envModel: "llama3.1:8b"
  });
  assert.equal(resolved.model, "qwen3:8b");
  assert.equal(resolved.source, "db");
});

test("resolveAiModelFromConfig falls back to ollama default model", () => {
  const resolved = resolveAiModelFromConfig({
    provider: "ollama",
    dbModel: null,
    envModel: null
  });
  assert.equal(resolved.model, "qwen3:8b");
  assert.equal(resolved.source, "default");
});
