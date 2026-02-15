import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompositeGraph, validateCompositeGraph } from "./graph.js";

test("validateCompositeGraph detects cycles", async () => {
  const graph = normalizeCompositeGraph({
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "local_1" },
      { id: "n2", kind: "ai", refId: "prompt_1" }
    ],
    edgesJson: [
      { from: "n1", to: "n2", rule: "always" },
      { from: "n2", to: "n1", rule: "always" }
    ]
  });

  const validated = await validateCompositeGraph(graph);
  assert.equal(validated.valid, false);
  assert.equal(validated.errors.includes("graph_cycle_detected"), true);
});

test("validateCompositeGraph returns topological order for DAG", async () => {
  const graph = normalizeCompositeGraph({
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "a", kind: "local", refId: "local_1" },
      { id: "b", kind: "ai", refId: "prompt_1" },
      { id: "c", kind: "local", refId: "local_2" }
    ],
    edgesJson: [
      { from: "a", to: "b" },
      { from: "b", to: "c" }
    ]
  });

  const validated = await validateCompositeGraph(graph, {
    resolveRef: async () => true
  });

  assert.equal(validated.valid, true);
  assert.deepEqual(validated.topologicalOrder, ["a", "b", "c"]);
});

test("validateCompositeGraph checks ref resolvers", async () => {
  const graph = normalizeCompositeGraph({
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "local_missing" },
      { id: "n2", kind: "ai", refId: "prompt_ok" }
    ],
    edgesJson: []
  });

  const validated = await validateCompositeGraph(graph, {
    resolveRef: async (node) => node.refId !== "local_missing"
  });

  assert.equal(validated.valid, false);
  assert.equal(validated.errors.some((item) => item.startsWith("node_ref_not_found:local:local_missing")), true);
});
