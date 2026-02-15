export type CompositeNodeKind = "local" | "ai";
export type CompositeEdgeRule = "always" | "if_signal_not_neutral" | "if_confidence_gte";

export type CompositeNode = {
  id: string;
  kind: CompositeNodeKind;
  refId: string;
  configOverrides?: Record<string, unknown>;
  position?: { x?: number; y?: number };
};

export type CompositeEdge = {
  from: string;
  to: string;
  rule?: CompositeEdgeRule;
  confidenceGte?: number;
};

export type CompositeCombineMode = "pipeline" | "vote";
export type CompositeOutputPolicy =
  | "first_non_neutral"
  | "override_by_confidence"
  | "local_signal_ai_explain";

export type CompositeGraph = {
  nodes: CompositeNode[];
  edges: CompositeEdge[];
  combineMode: CompositeCombineMode;
  outputPolicy: CompositeOutputPolicy;
};

export type CompositeGraphValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  topologicalOrder: string[];
};

export type GraphRefResolver = (node: CompositeNode) => Promise<boolean>;

const MAX_NODES = 30;
const MAX_EDGES = 120;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeNode(value: unknown): CompositeNode | null {
  const row = asObject(value);
  if (!row) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const kind = row.kind === "local" || row.kind === "ai" ? row.kind : null;
  const refId = typeof row.refId === "string" ? row.refId.trim() : "";
  if (!id || !kind || !refId) return null;
  const configOverrides = asObject(row.configOverrides) ?? undefined;
  const posRaw = asObject(row.position);
  const position = posRaw
    ? {
      x: Number.isFinite(Number(posRaw.x)) ? Number(posRaw.x) : undefined,
      y: Number.isFinite(Number(posRaw.y)) ? Number(posRaw.y) : undefined
    }
    : undefined;

  return {
    id,
    kind,
    refId,
    configOverrides,
    position
  };
}

function normalizeEdge(value: unknown): CompositeEdge | null {
  const row = asObject(value);
  if (!row) return null;
  const from = typeof row.from === "string" ? row.from.trim() : "";
  const to = typeof row.to === "string" ? row.to.trim() : "";
  const ruleRaw = typeof row.rule === "string" ? row.rule.trim() : "always";
  const rule: CompositeEdgeRule =
    ruleRaw === "if_signal_not_neutral" || ruleRaw === "if_confidence_gte"
      ? ruleRaw
      : "always";
  const confidenceRaw = Number(row.confidenceGte);
  const confidenceGte = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, confidenceRaw))
    : undefined;
  if (!from || !to) return null;
  return {
    from,
    to,
    rule,
    confidenceGte
  };
}

export function normalizeCompositeGraph(input: {
  nodesJson: unknown;
  edgesJson: unknown;
  combineMode?: unknown;
  outputPolicy?: unknown;
}): CompositeGraph {
  const nodes = Array.isArray(input.nodesJson)
    ? input.nodesJson.map((item) => normalizeNode(item)).filter((item): item is CompositeNode => Boolean(item))
    : [];
  const edges = Array.isArray(input.edgesJson)
    ? input.edgesJson.map((item) => normalizeEdge(item)).filter((item): item is CompositeEdge => Boolean(item))
    : [];

  const combineMode: CompositeCombineMode = input.combineMode === "vote" ? "vote" : "pipeline";
  const outputPolicyRaw = typeof input.outputPolicy === "string" ? input.outputPolicy.trim() : "local_signal_ai_explain";
  const outputPolicy: CompositeOutputPolicy =
    outputPolicyRaw === "first_non_neutral"
      || outputPolicyRaw === "override_by_confidence"
      || outputPolicyRaw === "local_signal_ai_explain"
      ? outputPolicyRaw
      : "local_signal_ai_explain";

  return {
    nodes,
    edges,
    combineMode,
    outputPolicy
  };
}

function topologicalSort(nodes: CompositeNode[], edges: CompositeEdge[]): {
  order: string[];
  hasCycle: boolean;
} {
  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    graph.set(node.id, []);
  }
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    graph.get(edge.from)?.push(edge.to);
  }

  const queue: string[] = [];
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const next of graph.get(current) ?? []) {
      const updated = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, updated);
      if (updated === 0) {
        queue.push(next);
      }
    }
  }

  return {
    order,
    hasCycle: order.length !== nodes.length
  };
}

export async function validateCompositeGraph(
  graph: CompositeGraph,
  options: {
    resolveRef?: GraphRefResolver;
  } = {}
): Promise<CompositeGraphValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (graph.nodes.length === 0) {
    errors.push("graph_nodes_empty");
  }
  if (graph.nodes.length > MAX_NODES) {
    errors.push("graph_nodes_exceed_limit");
  }
  if (graph.edges.length > MAX_EDGES) {
    errors.push("graph_edges_exceed_limit");
  }

  const idSet = new Set<string>();
  for (const node of graph.nodes) {
    if (idSet.has(node.id)) {
      errors.push(`node_id_duplicate:${node.id}`);
      continue;
    }
    idSet.add(node.id);
  }

  const localCount = graph.nodes.filter((node) => node.kind === "local").length;
  const aiCount = graph.nodes.filter((node) => node.kind === "ai").length;
  if (localCount === 0) {
    warnings.push("graph_no_local_nodes");
  }
  if (aiCount === 0) {
    warnings.push("graph_no_ai_nodes");
  }

  const edgeKey = new Set<string>();
  for (const edge of graph.edges) {
    if (!idSet.has(edge.from)) {
      errors.push(`edge_from_missing:${edge.from}`);
    }
    if (!idSet.has(edge.to)) {
      errors.push(`edge_to_missing:${edge.to}`);
    }
    if (edge.from === edge.to) {
      errors.push(`edge_self_loop:${edge.from}`);
    }
    if (edge.rule === "if_confidence_gte" && (edge.confidenceGte === undefined || !Number.isFinite(edge.confidenceGte))) {
      errors.push(`edge_confidence_threshold_missing:${edge.from}->${edge.to}`);
    }
    const key = `${edge.from}->${edge.to}:${edge.rule ?? "always"}`;
    if (edgeKey.has(key)) {
      warnings.push(`edge_duplicate:${key}`);
    }
    edgeKey.add(key);
  }

  if (options.resolveRef) {
    for (const node of graph.nodes) {
      try {
        const ok = await options.resolveRef(node);
        if (!ok) {
          errors.push(`node_ref_not_found:${node.kind}:${node.refId}`);
        }
      } catch {
        errors.push(`node_ref_validation_failed:${node.kind}:${node.refId}`);
      }
    }
  }

  const topo = topologicalSort(graph.nodes, graph.edges);
  if (topo.hasCycle) {
    errors.push("graph_cycle_detected");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder: topo.order
  };
}
