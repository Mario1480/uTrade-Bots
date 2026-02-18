import assert from "node:assert/strict";
import test from "node:test";
import { getBotStartStopUi } from "./controls";

const labels = {
  start: "Start",
  starting: "Starting...",
  stop: "Stop",
  stopping: "Stopping..."
};

test("running bot disables start and enables stop", () => {
  const ui = getBotStartStopUi("running", null, labels);
  assert.equal(ui.startClassName, "btn btnStart");
  assert.equal(ui.stopClassName, "btn btnStop");
  assert.equal(ui.startDisabled, true);
  assert.equal(ui.stopDisabled, false);
  assert.equal(ui.startLabel, "Start");
  assert.equal(ui.stopLabel, "Stop");
});

test("stopped bot enables start and disables stop", () => {
  const ui = getBotStartStopUi("stopped", null, labels);
  assert.equal(ui.startDisabled, false);
  assert.equal(ui.stopDisabled, true);
});

test("busy start state updates label and disables both actions", () => {
  const ui = getBotStartStopUi("stopped", "start", labels);
  assert.equal(ui.startDisabled, true);
  assert.equal(ui.stopDisabled, true);
  assert.equal(ui.startLabel, "Starting...");
  assert.equal(ui.stopLabel, "Stop");
});

test("busy stop state updates label and disables both actions", () => {
  const ui = getBotStartStopUi("running", "stop", labels);
  assert.equal(ui.startDisabled, true);
  assert.equal(ui.stopDisabled, true);
  assert.equal(ui.startLabel, "Start");
  assert.equal(ui.stopLabel, "Stopping...");
});

