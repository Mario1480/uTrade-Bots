import assert from "node:assert/strict";
import test from "node:test";
import { executeAiTool, isAllowedToolName } from "./index.js";

test("isAllowedToolName accepts supported tool names", () => {
  assert.equal(isAllowedToolName("get_ohlcv"), true);
  assert.equal(isAllowedToolName("get_indicators"), true);
  assert.equal(isAllowedToolName("get_ticker"), true);
  assert.equal(isAllowedToolName("get_orderbook"), true);
  assert.equal(isAllowedToolName("not_allowed"), false);
});

test("executeAiTool rejects unknown tools", async () => {
  await assert.rejects(
    () => executeAiTool("not_allowed", "{}"),
    /ai_tool_not_allowed:not_allowed/
  );
});
