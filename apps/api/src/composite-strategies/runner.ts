import { getAiPromptRuntimeSettingsByTemplateId } from "../ai/promptSettings.js";
import {
  generatePredictionExplanation,
  type ExplainerOutput
} from "../ai/predictionExplainer.js";
import { getAiPayloadBudgetAlertSnapshot } from "../ai/payloadBudget.js";
import {
  shouldInvokeAiExplain,
  type AiQualityGateConfig,
  type AiQualityGateRollingState,
  type GatePriority
} from "../ai/qualityGate.js";
import { runLocalStrategy, type LocalStrategyExecutionContext } from "../local-strategies/registry.js";
import {
  normalizeCompositeGraph,
  validateCompositeGraph,
  type CompositeEdge,
  type CompositeGraph,
  type CompositeNode,
  type CompositeOutputPolicy
} from "./graph.js";

export type CompositeRunSignal = "up" | "down" | "neutral";

export type CompositeNodeExecutionResult = {
  nodeId: string;
  kind: "local" | "ai";
  refId: string;
  executed: boolean;
  skippedReason: string | null;
  inputSignal: CompositeRunSignal;
  inputConfidence: number;
  outputSignal: CompositeRunSignal;
  outputConfidence: number;
  tags: string[];
  keyDrivers: Array<{ name: string; value: unknown }>;
  explanation: string;
  meta: Record<string, unknown>;
};

export type CompositeRunResult = {
  compositeId: string;
  combineMode: "pipeline" | "vote";
  outputPolicy: CompositeOutputPolicy;
  signal: CompositeRunSignal;
  confidence: number;
  tags: string[];
  keyDrivers: Array<{ name: string; value: unknown }>;
  explanation: string;
  aiCallsUsed: number;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    topologicalOrder: string[];
  };
  nodes: CompositeNodeExecutionResult[];
};

export type CompositeRunInput = {
  compositeId: string;
  nodesJson: unknown;
  edgesJson: unknown;
  combineMode?: unknown;
  outputPolicy?: unknown;
  featureSnapshot: Record<string, unknown>;
  basePrediction: {
    signal: CompositeRunSignal;
    confidence: number;
    expectedMovePct: number;
    symbol: string;
    marketType: "spot" | "perp";
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
    tsCreated: string;
  };
  context?: {
    exchange?: string;
    accountId?: string;
    symbol?: string;
    marketType?: string;
    timeframe?: "5m" | "15m" | "1h" | "4h" | "1d";
    aiQualityGateConfig?: Partial<AiQualityGateConfig>;
    gateState?: AiQualityGateRollingState;
  };
};

export type CompositeRunnerDeps = {
  resolveLocalStrategyRef?: (id: string) => Promise<boolean>;
  resolveAiPromptRef?: (id: string) => Promise<boolean>;
  runLocalStrategyFn?: typeof runLocalStrategy;
  getRuntimePromptSettingsByTemplateId?: typeof getAiPromptRuntimeSettingsByTemplateId;
  generatePredictionExplanationFn?: typeof generatePredictionExplanation;
  shouldInvokeAiExplainFn?: typeof shouldInvokeAiExplain;
  getBudgetSnapshot?: typeof getAiPayloadBudgetAlertSnapshot;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toFinite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clampPct(value: unknown, fallback = 0): number {
  return Math.max(0, Math.min(100, toFinite(value, fallback)));
}

function normalizeSignal(value: unknown): CompositeRunSignal {
  if (value === "up" || value === "down" || value === "neutral") return value;
  return "neutral";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 30) break;
  }
  return out;
}

function mergeTags(base: string[], next: string[], limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...base, ...next]) {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeDrivers(value: unknown): Array<{ name: string; value: unknown }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name: string; value: unknown }> = [];
  for (const item of value) {
    const row = asObject(item);
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    out.push({ name, value: row?.value ?? null });
    if (out.length >= 20) break;
  }
  return out;
}

function mergeDrivers(
  base: Array<{ name: string; value: unknown }>,
  next: Array<{ name: string; value: unknown }>,
  limit = 10
): Array<{ name: string; value: unknown }> {
  const out: Array<{ name: string; value: unknown }> = [];
  const seen = new Set<string>();
  for (const item of [...base, ...next]) {
    const key = item.name.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: key, value: item.value ?? null });
    if (out.length >= limit) break;
  }
  return out;
}

function sanitizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed;
}

function shouldExecuteNodeByIncomingEdges(
  node: CompositeNode,
  incoming: CompositeEdge[],
  nodeOutputs: Map<string, CompositeNodeExecutionResult>
): { execute: boolean; reason?: string } {
  for (const edge of incoming) {
    const source = nodeOutputs.get(edge.from);
    if (!source || !source.executed) {
      return { execute: false, reason: `dependency_not_executed:${edge.from}` };
    }
    const rule = edge.rule ?? "always";
    if (rule === "always") continue;
    if (rule === "if_signal_not_neutral") {
      if (source.outputSignal === "neutral") {
        return { execute: false, reason: `edge_blocked_signal_neutral:${edge.from}` };
      }
      continue;
    }
    if (rule === "if_confidence_gte") {
      const threshold = clampPct(edge.confidenceGte, 60);
      if (source.outputConfidence < threshold) {
        return { execute: false, reason: `edge_blocked_confidence:${edge.from}` };
      }
    }
  }
  return { execute: true };
}

function deriveOutputByPolicy(
  policy: CompositeOutputPolicy,
  base: { signal: CompositeRunSignal; confidence: number },
  nodes: CompositeNodeExecutionResult[]
): { signal: CompositeRunSignal; confidence: number } {
  const executed = nodes.filter((item) => item.executed);
  if (executed.length === 0) {
    return {
      signal: base.signal,
      confidence: clampPct(base.confidence)
    };
  }

  if (policy === "first_non_neutral") {
    for (const node of executed) {
      if (node.outputSignal !== "neutral") {
        return {
          signal: node.outputSignal,
          confidence: clampPct(node.outputConfidence)
        };
      }
    }
    return {
      signal: "neutral",
      confidence: Math.min(...executed.map((item) => clampPct(item.outputConfidence)))
    };
  }

  if (policy === "override_by_confidence") {
    const nonNeutral = executed.filter((item) => item.outputSignal !== "neutral");
    if (nonNeutral.length === 0) {
      return {
        signal: "neutral",
        confidence: Math.max(...executed.map((item) => clampPct(item.outputConfidence)))
      };
    }
    const best = nonNeutral.reduce((bestSoFar, current) =>
      clampPct(current.outputConfidence) > clampPct(bestSoFar.outputConfidence) ? current : bestSoFar
    );
    return {
      signal: best.outputSignal,
      confidence: clampPct(best.outputConfidence)
    };
  }

  const lastLocal = [...executed].reverse().find((item) => item.kind === "local" && item.outputSignal !== "neutral");
  if (lastLocal) {
    return {
      signal: lastLocal.outputSignal,
      confidence: clampPct(lastLocal.outputConfidence)
    };
  }
  return {
    signal: base.signal,
    confidence: clampPct(base.confidence)
  };
}

export async function runCompositeStrategy(
  input: CompositeRunInput,
  deps: CompositeRunnerDeps = {}
): Promise<CompositeRunResult> {
  const normalizedGraph = normalizeCompositeGraph({
    nodesJson: input.nodesJson,
    edgesJson: input.edgesJson,
    combineMode: input.combineMode,
    outputPolicy: input.outputPolicy
  });

  const runLocalStrategyFn = deps.runLocalStrategyFn ?? runLocalStrategy;
  const getPromptSettings = deps.getRuntimePromptSettingsByTemplateId ?? getAiPromptRuntimeSettingsByTemplateId;
  const generateAi = deps.generatePredictionExplanationFn ?? generatePredictionExplanation;
  const gateAi = deps.shouldInvokeAiExplainFn ?? shouldInvokeAiExplain;
  const readBudget = deps.getBudgetSnapshot ?? getAiPayloadBudgetAlertSnapshot;

  const validation = await validateCompositeGraph(normalizedGraph, {
    resolveRef: async (node) => {
      if (node.kind === "local") {
        if (!deps.resolveLocalStrategyRef) return true;
        return deps.resolveLocalStrategyRef(node.refId);
      }
      if (!deps.resolveAiPromptRef) return true;
      return deps.resolveAiPromptRef(node.refId);
    }
  });

  const nodeById = new Map(normalizedGraph.nodes.map((node) => [node.id, node]));
  const incomingByNode = new Map<string, CompositeEdge[]>();
  for (const node of normalizedGraph.nodes) {
    incomingByNode.set(node.id, []);
  }
  for (const edge of normalizedGraph.edges) {
    incomingByNode.get(edge.to)?.push(edge);
  }

  const results: CompositeNodeExecutionResult[] = [];
  const outputByNode = new Map<string, CompositeNodeExecutionResult>();

  let currentSignal = normalizeSignal(input.basePrediction.signal);
  let currentConfidence = clampPct(input.basePrediction.confidence);
  let mergedTags: string[] = normalizeTags(input.featureSnapshot.tags);
  let mergedDrivers: Array<{ name: string; value: unknown }> = [];
  let mergedExplanation = "";

  let previousNodeResult: CompositeNodeExecutionResult | null = null;
  let aiCallsUsed = 0;
  let gateState: AiQualityGateRollingState = input.context?.gateState ?? {
    lastAiCallTs: null,
    lastExplainedPredictionHash: null,
    lastExplainedHistoryHash: null,
    lastAiDecisionHash: null,
    windowStartedAt: new Date(input.basePrediction.tsCreated),
    aiCallsLastHour: 0,
    highPriorityCallsLastHour: 0
  };

  const runOrder = validation.topologicalOrder.length > 0
    ? validation.topologicalOrder
    : normalizedGraph.nodes.map((node) => node.id);

  if (!validation.valid) {
    return {
      compositeId: input.compositeId,
      combineMode: normalizedGraph.combineMode,
      outputPolicy: normalizedGraph.outputPolicy,
      signal: normalizeSignal(input.basePrediction.signal),
      confidence: clampPct(input.basePrediction.confidence),
      tags: mergedTags,
      keyDrivers: [],
      explanation: "Composite graph validation failed; execution skipped.",
      aiCallsUsed: 0,
      validation,
      nodes: []
    };
  }

  for (const nodeId of runOrder) {
    const node = nodeById.get(nodeId);
    if (!node) continue;

    const incoming = incomingByNode.get(node.id) ?? [];
    const dependencyCheck = shouldExecuteNodeByIncomingEdges(node, incoming, outputByNode);
    if (!dependencyCheck.execute) {
      const skipped: CompositeNodeExecutionResult = {
        nodeId: node.id,
        kind: node.kind,
        refId: node.refId,
        executed: false,
        skippedReason: dependencyCheck.reason ?? "edge_rule_blocked",
        inputSignal: currentSignal,
        inputConfidence: currentConfidence,
        outputSignal: currentSignal,
        outputConfidence: currentConfidence,
        tags: [],
        keyDrivers: [],
        explanation: "",
        meta: {
          incomingEdges: incoming.length
        }
      };
      results.push(skipped);
      outputByNode.set(node.id, skipped);
      previousNodeResult = skipped;
      continue;
    }

    if (node.kind === "local") {
      const localCtx: LocalStrategyExecutionContext = {
        signal: currentSignal,
        exchange: input.context?.exchange,
        accountId: input.context?.accountId,
        symbol: input.context?.symbol ?? input.basePrediction.symbol,
        marketType: input.context?.marketType ?? input.basePrediction.marketType,
        timeframe: input.context?.timeframe ?? input.basePrediction.timeframe,
        prevResult: previousNodeResult
      };
      const local = await runLocalStrategyFn(node.refId, input.featureSnapshot, localCtx);
      const score = clampPct(local.score);
      const outputSignal: CompositeRunSignal = local.allow ? currentSignal : "neutral";
      const outputConfidence = local.allow ? Math.max(currentConfidence, score) : Math.min(currentConfidence, score);
      const drivers = local.reasonCodes.map((code) => ({
        name: `local.${local.strategyType}.${code}`,
        value: true
      }));

      const execution: CompositeNodeExecutionResult = {
        nodeId: node.id,
        kind: node.kind,
        refId: node.refId,
        executed: true,
        skippedReason: null,
        inputSignal: currentSignal,
        inputConfidence: currentConfidence,
        outputSignal,
        outputConfidence,
        tags: local.tags,
        keyDrivers: drivers,
        explanation: local.explanation,
        meta: {
          strategyType: local.strategyType,
          allow: local.allow,
          reasonCodes: local.reasonCodes,
          configHash: local.configHash,
          snapshotHash: local.snapshotHash,
          score
        }
      };

      currentSignal = outputSignal;
      currentConfidence = outputConfidence;
      mergedTags = mergeTags(mergedTags, execution.tags);
      mergedDrivers = mergeDrivers(mergedDrivers, execution.keyDrivers);
      if (execution.explanation) {
        mergedExplanation = mergedExplanation
          ? `${mergedExplanation}\n${execution.explanation}`
          : execution.explanation;
      }

      results.push(execution);
      outputByNode.set(node.id, execution);
      previousNodeResult = execution;
      continue;
    }

    // AI node
    if (aiCallsUsed >= 1) {
      const skipped: CompositeNodeExecutionResult = {
        nodeId: node.id,
        kind: node.kind,
        refId: node.refId,
        executed: false,
        skippedReason: "ai_call_budget_exceeded",
        inputSignal: currentSignal,
        inputConfidence: currentConfidence,
        outputSignal: currentSignal,
        outputConfidence: currentConfidence,
        tags: [],
        keyDrivers: [],
        explanation: "",
        meta: {
          aiCallsUsed
        }
      };
      results.push(skipped);
      outputByNode.set(node.id, skipped);
      previousNodeResult = skipped;
      continue;
    }

    const gateDecision = gateAi({
      timeframe: input.basePrediction.timeframe,
      nowMs: Date.now(),
      prediction: {
        signal: currentSignal,
        confidence: currentConfidence,
        expectedMovePct: input.basePrediction.expectedMovePct,
        tsUpdated: input.basePrediction.tsCreated
      },
      featureSnapshot: input.featureSnapshot,
      prevState: previousNodeResult
        ? {
          signal: previousNodeResult.inputSignal,
          confidence: previousNodeResult.inputConfidence,
          featureSnapshot: input.featureSnapshot
        }
        : null,
      gateState,
      config: input.context?.aiQualityGateConfig,
      budgetPressureConsecutive: readBudget().highWaterConsecutive
    });

    if (!gateDecision.allow) {
      const skipped: CompositeNodeExecutionResult = {
        nodeId: node.id,
        kind: node.kind,
        refId: node.refId,
        executed: false,
        skippedReason: `ai_quality_gate_blocked:${gateDecision.reasonCodes.join(",")}`,
        inputSignal: currentSignal,
        inputConfidence: currentConfidence,
        outputSignal: currentSignal,
        outputConfidence: currentConfidence,
        tags: [],
        keyDrivers: [],
        explanation: "No major state change; awaiting clearer signal.",
        meta: {
          gateReasons: gateDecision.reasonCodes,
          gatePriority: gateDecision.priority as GatePriority,
          gateDecisionHash: gateDecision.decisionHash
        }
      };
      results.push(skipped);
      outputByNode.set(node.id, skipped);
      previousNodeResult = skipped;
      continue;
    }

    const runtimePrompt = await getPromptSettings({
      templateId: node.refId,
      context: {
        exchange: input.context?.exchange,
        accountId: input.context?.accountId,
        symbol: input.basePrediction.symbol,
        timeframe: input.basePrediction.timeframe
      }
    });

    const aiOut: ExplainerOutput = await generateAi({
      symbol: input.basePrediction.symbol,
      marketType: input.basePrediction.marketType,
      timeframe: input.basePrediction.timeframe,
      tsCreated: input.basePrediction.tsCreated,
      prediction: {
        signal: currentSignal,
        confidence: currentConfidence,
        expectedMovePct: input.basePrediction.expectedMovePct
      },
      featureSnapshot: input.featureSnapshot
    }, {
      promptSettings: runtimePrompt,
      promptScopeContext: {
        exchange: input.context?.exchange,
        accountId: input.context?.accountId,
        symbol: input.basePrediction.symbol,
        timeframe: input.basePrediction.timeframe
      }
    });

    aiCallsUsed += 1;
    gateState = {
      ...gateDecision.state,
      lastAiCallTs: new Date(),
      lastExplainedPredictionHash: gateDecision.predictionHash,
      lastExplainedHistoryHash: gateDecision.historyHash,
      lastAiDecisionHash: gateDecision.decisionHash,
      aiCallsLastHour: gateDecision.state.aiCallsLastHour + 1,
      highPriorityCallsLastHour:
        gateDecision.state.highPriorityCallsLastHour + (gateDecision.priority === "high" ? 1 : 0)
    };

    const aiSignal = normalizeSignal(aiOut.aiPrediction.signal);
    const aiConfidence = clampPct(aiOut.aiPrediction.confidence <= 1
      ? aiOut.aiPrediction.confidence * 100
      : aiOut.aiPrediction.confidence);

    let outputSignal = currentSignal;
    let outputConfidence = currentConfidence;
    if (normalizedGraph.outputPolicy !== "local_signal_ai_explain") {
      outputSignal = aiSignal;
      outputConfidence = aiConfidence;
    }

    const execution: CompositeNodeExecutionResult = {
      nodeId: node.id,
      kind: node.kind,
      refId: node.refId,
      executed: true,
      skippedReason: null,
      inputSignal: currentSignal,
      inputConfidence: currentConfidence,
      outputSignal,
      outputConfidence,
      tags: normalizeTags(aiOut.tags),
      keyDrivers: normalizeDrivers(aiOut.keyDrivers),
      explanation: sanitizeText(aiOut.explanation),
      meta: {
        aiPrediction: aiOut.aiPrediction,
        disclaimer: aiOut.disclaimer,
        gateDecisionHash: gateDecision.decisionHash,
        gatePriority: gateDecision.priority
      }
    };

    currentSignal = outputSignal;
    currentConfidence = outputConfidence;
    mergedTags = mergeTags(mergedTags, execution.tags);
    mergedDrivers = mergeDrivers(mergedDrivers, execution.keyDrivers);
    if (execution.explanation) {
      mergedExplanation = mergedExplanation
        ? `${mergedExplanation}\n${execution.explanation}`
        : execution.explanation;
    }

    results.push(execution);
    outputByNode.set(node.id, execution);
    previousNodeResult = execution;
  }

  const final = deriveOutputByPolicy(
    normalizedGraph.outputPolicy,
    {
      signal: input.basePrediction.signal,
      confidence: input.basePrediction.confidence
    },
    results
  );

  return {
    compositeId: input.compositeId,
    combineMode: normalizedGraph.combineMode,
    outputPolicy: normalizedGraph.outputPolicy,
    signal: final.signal,
    confidence: clampPct(final.confidence),
    tags: mergedTags,
    keyDrivers: mergedDrivers,
    explanation: sanitizeText(mergedExplanation, "Composite run completed."),
    aiCallsUsed,
    validation,
    nodes: results
  };
}
