import { hashStableObject } from "./analyzer.js";
import { logger } from "../logger.js";

export type PredictionSignal = "up" | "down" | "neutral";
export type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type GatePriority = "low" | "normal" | "high";

export type AiQualityGateConfig = {
  enabled: boolean;
  minConfidenceForExplain: number;
  minConfidenceForNeutralExplain: number;
  confidenceJumpThreshold: number;
  keyLevelNearPct: number;
  recentEventBars: Record<PredictionTimeframe, number>;
  highImportanceMin: number;
  aiCooldownSec: Record<PredictionTimeframe, number>;
  maxHighPriorityPerHour: number;
  maxPredictionAgeSec: Record<PredictionTimeframe, number>;
  budgetPressureConsecutiveCalls: number;
};

export type AiQualityGateRollingState = {
  lastAiCallTs: Date | null;
  lastExplainedPredictionHash: string | null;
  lastExplainedHistoryHash: string | null;
  lastAiDecisionHash: string | null;
  windowStartedAt: Date | null;
  aiCallsLastHour: number;
  highPriorityCallsLastHour: number;
};

export type AiQualityGateInput = {
  timeframe: PredictionTimeframe;
  nowMs: number;
  prediction: {
    signal: PredictionSignal;
    confidence: number;
    expectedMovePct: number;
    tsUpdated?: string | Date | null;
  };
  featureSnapshot: Record<string, unknown>;
  prevState: {
    signal: PredictionSignal;
    confidence: number;
    featureSnapshot: Record<string, unknown>;
  } | null;
  gateState: AiQualityGateRollingState;
  config?: Partial<AiQualityGateConfig> | null;
  budgetPressureConsecutive?: number | null;
};

export type GateDecision = {
  allow: boolean;
  reasonCodes: string[];
  priority: GatePriority;
  recommendedCooldownSec: number;
  predictionHash: string;
  historyHash: string;
  decisionHash: string;
  state: {
    windowStartedAt: Date;
    aiCallsLastHour: number;
    highPriorityCallsLastHour: number;
  };
};

const TF_MS: Record<PredictionTimeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000
};

const DEFAULT_CONFIG: AiQualityGateConfig = {
  enabled: true,
  minConfidenceForExplain: 70,
  minConfidenceForNeutralExplain: 60,
  confidenceJumpThreshold: 10,
  keyLevelNearPct: 0.5,
  recentEventBars: {
    "5m": 6,
    "15m": 4,
    "1h": 2,
    "4h": 2,
    "1d": 2
  },
  highImportanceMin: 4,
  aiCooldownSec: {
    "5m": 120,
    "15m": 240,
    "1h": 900,
    "4h": 1800,
    "1d": 3600
  },
  maxHighPriorityPerHour: 12,
  maxPredictionAgeSec: {
    "5m": 1200,
    "15m": 3600,
    "1h": 14_400,
    "4h": 43_200,
    "1d": 172_800
  },
  budgetPressureConsecutiveCalls: 3
};

type QualityGateTelemetry = {
  gateAllowCount: number;
  gateBlockCount: number;
  reasons: Map<string, number>;
  priorities: Record<GatePriority, number>;
  aiCallsSaved: number;
};

const telemetry: QualityGateTelemetry = {
  gateAllowCount: 0,
  gateBlockCount: 0,
  reasons: new Map<string, number>(),
  priorities: {
    low: 0,
    normal: 0,
    high: 0
  },
  aiCallsSaved: 0
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNum(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  const num = toNum(value);
  if (num === null) return null;
  if (num > 1_000_000_000_000) return Math.trunc(num);
  if (num > 1_000_000_000) return Math.trunc(num * 1000);
  return null;
}

function confidenceToPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return Math.max(0, Math.min(100, value * 100));
  return Math.max(0, Math.min(100, value));
}

function normalizeConfig(config?: Partial<AiQualityGateConfig> | null): AiQualityGateConfig {
  const source = config ?? {};
  const out: AiQualityGateConfig = {
    ...DEFAULT_CONFIG,
    ...source,
    recentEventBars: {
      ...DEFAULT_CONFIG.recentEventBars,
      ...(source.recentEventBars ?? {})
    },
    aiCooldownSec: {
      ...DEFAULT_CONFIG.aiCooldownSec,
      ...(source.aiCooldownSec ?? {})
    },
    maxPredictionAgeSec: {
      ...DEFAULT_CONFIG.maxPredictionAgeSec,
      ...(source.maxPredictionAgeSec ?? {})
    }
  };
  out.minConfidenceForExplain = Math.max(0, Math.min(100, out.minConfidenceForExplain));
  out.minConfidenceForNeutralExplain = Math.max(0, Math.min(100, out.minConfidenceForNeutralExplain));
  out.confidenceJumpThreshold = Math.max(0, Math.min(100, out.confidenceJumpThreshold));
  out.keyLevelNearPct = Math.max(0.05, Math.min(5, out.keyLevelNearPct));
  out.highImportanceMin = Math.max(1, Math.min(5, Math.trunc(out.highImportanceMin)));
  out.maxHighPriorityPerHour = Math.max(1, Math.min(200, Math.trunc(out.maxHighPriorityPerHour)));
  out.budgetPressureConsecutiveCalls = Math.max(1, Math.min(30, Math.trunc(out.budgetPressureConsecutiveCalls)));
  for (const tf of Object.keys(TF_MS) as PredictionTimeframe[]) {
    out.recentEventBars[tf] = Math.max(1, Math.min(100, Math.trunc(out.recentEventBars[tf])));
    out.aiCooldownSec[tf] = Math.max(0, Math.min(86_400, Math.trunc(out.aiCooldownSec[tf])));
    out.maxPredictionAgeSec[tf] = Math.max(60, Math.min(30 * 86_400, Math.trunc(out.maxPredictionAgeSec[tf])));
  }
  return out;
}

function normalizeHistoryHash(snapshot: Record<string, unknown>): string {
  const historyRaw = asObject(snapshot.historyContext);
  if (!historyRaw) return "none";
  const clone = JSON.parse(JSON.stringify(historyRaw)) as Record<string, unknown>;
  const bud = asObject(clone.bud);
  if (bud) bud.bytes = 0;
  return hashStableObject(clone);
}

function normalizePredictionHash(prediction: AiQualityGateInput["prediction"]): string {
  return hashStableObject({
    signal: prediction.signal,
    confidence: Number(confidenceToPct(prediction.confidence).toFixed(2)),
    expectedMovePct: Number(Math.abs(prediction.expectedMovePct || 0).toFixed(3))
  });
}

function historyRegimeState(snapshot: Record<string, unknown>): string | null {
  const reg = asObject(asObject(snapshot.historyContext)?.reg);
  if (!reg) return null;
  const state = typeof reg.state === "string" ? reg.state.trim() : "";
  return state || null;
}

function historyRegimeSinceMs(snapshot: Record<string, unknown>): number | null {
  const reg = asObject(asObject(snapshot.historyContext)?.reg);
  return reg ? toDateMs(reg.since) : null;
}

function eventTypeQualifies(type: string): boolean {
  const normalized = type.toLowerCase();
  if (normalized === "ema_stk" || normalized === "ema_stack" || normalized === "ema_stack_flip") return true;
  if (normalized.includes("sweep") || normalized === "liq_sweep") return true;
  if (normalized === "fvg_open" || normalized === "fvg_fill") return true;
  if (normalized === "vol_spike") return true;
  return false;
}

function readCurrentPrice(snapshot: Record<string, unknown>): number | null {
  const candidates = [
    snapshot.suggestedEntryPrice,
    snapshot.referencePrice,
    snapshot.lastPrice,
    snapshot.markPrice
  ];
  for (const item of candidates) {
    const num = toNum(item);
    if (num !== null && num > 0) return num;
  }
  const lastBars = asObject(asObject(snapshot.historyContext)?.lastBars);
  const rows = asArray(lastBars?.ohlc);
  const last = rows.length > 0 ? asObject(rows[rows.length - 1]) : null;
  const close = toNum(last?.c);
  return close && close > 0 ? close : null;
}

function nearestFvgDistancePct(snapshot: Record<string, unknown>): number | null {
  const fvg = asObject(asObject(snapshot.historyContext)?.fvg);
  if (!fvg) return null;
  const nb = asObject(fvg.nb);
  const ns = asObject(fvg.ns);
  const d1 = toNum(nb?.d);
  const d2 = toNum(ns?.d);
  const values = [d1, d2].filter((item): item is number => item !== null).map((item) => Math.abs(item));
  if (values.length === 0) return null;
  return Math.min(...values);
}

function levelList(snapshot: Record<string, unknown>): number[] {
  const levels = asObject(asObject(snapshot.historyContext)?.lvl);
  if (!levels) return [];
  const pivD = asObject(levels.pivD);
  const hiLo = asObject(levels.hiLo);
  const dayOpen = asObject(levels.do);
  const values = [
    toNum(pivD?.pp),
    toNum(pivD?.r1),
    toNum(pivD?.s1),
    toNum(hiLo?.yH),
    toNum(hiLo?.yL),
    toNum(hiLo?.wH),
    toNum(hiLo?.wL),
    toNum(dayOpen?.p)
  ].filter((item): item is number => item !== null && item > 0);
  return values;
}

function nearAnyLevel(snapshot: Record<string, unknown>, nearPct: number): boolean {
  const price = readCurrentPrice(snapshot);
  if (price === null || price <= 0) return false;
  const levels = levelList(snapshot);
  if (levels.length === 0) return false;
  return levels.some((level) => Math.abs(((price / level) - 1) * 100) <= nearPct);
}

function hasNonTrivialSetup(snapshot: Record<string, unknown>): boolean {
  const history = asObject(snapshot.historyContext);
  if (!history) return false;
  const ema = asObject(history.ema);
  const vol = asObject(history.vol);
  const fvg = asObject(history.fvg);
  const ls = asObject(history.ls);
  const stk = typeof ema?.stk === "string" ? ema.stk : "unknown";
  const volZ = toNum(vol?.z) ?? 0;
  const openGaps = (toNum(fvg?.ob) ?? 0) + (toNum(fvg?.os) ?? 0);
  const sweepEvent = asObject(ls?.le);
  return (
    (stk !== "none" && stk !== "unknown")
    || volZ >= 1.5
    || openGaps >= 1
    || Boolean(sweepEvent)
  );
}

function eventTriggeredRecently(params: {
  snapshot: Record<string, unknown>;
  timeframe: PredictionTimeframe;
  nowMs: number;
  maxBars: number;
  highImportanceMin: number;
}): boolean {
  const history = asObject(params.snapshot.historyContext);
  if (!history) return false;
  const rows = asArray(history.ev);
  if (rows.length === 0) return false;
  const recencyMs = Math.max(1, params.maxBars) * TF_MS[params.timeframe];
  const nearestFvgDist = nearestFvgDistancePct(params.snapshot);
  for (const row of rows) {
    const event = asObject(row);
    if (!event) continue;
    const importance = toNum(event.i) ?? 0;
    if (importance < params.highImportanceMin) continue;
    const type = typeof event.ty === "string" ? event.ty : "";
    if (!eventTypeQualifies(type)) continue;
    const ts = toDateMs(event.t);
    if (ts === null || params.nowMs - ts > recencyMs || ts > params.nowMs + 60_000) continue;
    if ((type === "fvg_open" || type === "fvg_fill") && nearestFvgDist !== null && nearestFvgDist > 1) {
      continue;
    }
    return true;
  }
  return false;
}

function normalizeWindowState(input: AiQualityGateInput["gateState"], nowMs: number): {
  windowStartedAt: Date;
  aiCallsLastHour: number;
  highPriorityCallsLastHour: number;
} {
  const startMs = input.windowStartedAt ? input.windowStartedAt.getTime() : nowMs;
  if (!Number.isFinite(startMs) || nowMs - startMs >= 60 * 60_000) {
    return {
      windowStartedAt: new Date(nowMs),
      aiCallsLastHour: 0,
      highPriorityCallsLastHour: 0
    };
  }
  return {
    windowStartedAt: input.windowStartedAt ?? new Date(startMs),
    aiCallsLastHour: Math.max(0, Math.trunc(input.aiCallsLastHour || 0)),
    highPriorityCallsLastHour: Math.max(0, Math.trunc(input.highPriorityCallsLastHour || 0))
  };
}

function withReason(set: Set<string>, value: string): void {
  const normalized = value.trim();
  if (!normalized) return;
  set.add(normalized);
}

function logDecision(params: {
  allow: boolean;
  reasonCodes: string[];
  priority: GatePriority;
  decisionHash: string;
  timeframe: PredictionTimeframe;
}): void {
  if (params.allow) telemetry.gateAllowCount += 1;
  else {
    telemetry.gateBlockCount += 1;
    telemetry.aiCallsSaved += 1;
  }
  telemetry.priorities[params.priority] += 1;
  for (const reason of params.reasonCodes) {
    telemetry.reasons.set(reason, (telemetry.reasons.get(reason) ?? 0) + 1);
  }

  logger.info("ai_quality_gate_decision", {
    gate_allow: params.allow,
    gate_priority: params.priority,
    gate_reasons: params.reasonCodes,
    gate_decision_hash: params.decisionHash,
    gate_timeframe: params.timeframe,
    gate_allow_count: telemetry.gateAllowCount,
    gate_block_count: telemetry.gateBlockCount,
    ai_calls_saved: telemetry.aiCallsSaved
  });
}

export function getDefaultAiQualityGateConfig(): AiQualityGateConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AiQualityGateConfig;
}

export function applyAiQualityGateCallToState(
  state: {
    windowStartedAt: Date;
    aiCallsLastHour: number;
    highPriorityCallsLastHour: number;
  },
  priority: GatePriority
): {
  windowStartedAt: Date;
  aiCallsLastHour: number;
  highPriorityCallsLastHour: number;
} {
  const next = {
    windowStartedAt: new Date(state.windowStartedAt),
    aiCallsLastHour: Math.max(0, Math.trunc(state.aiCallsLastHour)) + 1,
    highPriorityCallsLastHour: Math.max(0, Math.trunc(state.highPriorityCallsLastHour))
  };
  if (priority === "high") {
    next.highPriorityCallsLastHour += 1;
  }
  return next;
}

export function shouldInvokeAiExplain(input: AiQualityGateInput): GateDecision {
  const config = normalizeConfig(input.config);
  const state = normalizeWindowState(input.gateState, input.nowMs);
  const reasonCodes = new Set<string>();

  const predictionHash = normalizePredictionHash(input.prediction);
  const historyHash = normalizeHistoryHash(input.featureSnapshot);
  const confidencePct = confidenceToPct(input.prediction.confidence);
  const prevConfidencePct = input.prevState ? confidenceToPct(input.prevState.confidence) : null;

  let priority: GatePriority = "low";

  if (!config.enabled) {
    withReason(reasonCodes, "gate_disabled");
    const decisionHash = hashStableObject({
      allow: true,
      reasonCodes: [...reasonCodes],
      predictionHash,
      historyHash,
      priority
    });
    const decision: GateDecision = {
      allow: true,
      reasonCodes: [...reasonCodes],
      priority,
      recommendedCooldownSec: config.aiCooldownSec[input.timeframe],
      predictionHash,
      historyHash,
      decisionHash,
      state
    };
    logDecision({
      allow: decision.allow,
      reasonCodes: decision.reasonCodes,
      priority: decision.priority,
      decisionHash,
      timeframe: input.timeframe
    });
    return decision;
  }

  if (input.prevState && input.prevState.signal !== input.prediction.signal && input.prediction.signal !== "neutral") {
    withReason(reasonCodes, "signal_flip");
    priority = "high";
  }

  if (prevConfidencePct === null || Math.abs(confidencePct - prevConfidencePct) >= config.confidenceJumpThreshold) {
    withReason(reasonCodes, "confidence_jump");
    if (priority !== "high") priority = "normal";
  }

  const prevRegime = input.prevState ? historyRegimeState(input.prevState.featureSnapshot) : null;
  const currentRegime = historyRegimeState(input.featureSnapshot);
  if (prevRegime && currentRegime && prevRegime !== currentRegime) {
    withReason(reasonCodes, "regime_state_changed");
    priority = "high";
  }
  const sinceMs = historyRegimeSinceMs(input.featureSnapshot);
  if (sinceMs !== null) {
    const recentRegimeMs = 2 * TF_MS[input.timeframe];
    if (input.nowMs - sinceMs <= recentRegimeMs && input.nowMs >= sinceMs) {
      withReason(reasonCodes, "regime_recent_switch");
      priority = "high";
    }
  }

  if (eventTriggeredRecently({
    snapshot: input.featureSnapshot,
    timeframe: input.timeframe,
    nowMs: input.nowMs,
    maxBars: config.recentEventBars[input.timeframe],
    highImportanceMin: config.highImportanceMin
  })) {
    withReason(reasonCodes, "high_importance_event_recent");
    priority = "high";
  }

  if (nearAnyLevel(input.featureSnapshot, config.keyLevelNearPct) && hasNonTrivialSetup(input.featureSnapshot)) {
    withReason(reasonCodes, "near_key_level_setup");
    if (priority !== "high") priority = "normal";
  }

  const triggersAllow = reasonCodes.size > 0;
  if (!triggersAllow) {
    withReason(reasonCodes, "no_actionable_change");
  }

  const predictionUpdatedMs = toDateMs(input.prediction.tsUpdated) ?? input.nowMs;
  if (input.nowMs - predictionUpdatedMs > config.maxPredictionAgeSec[input.timeframe] * 1000) {
    withReason(reasonCodes, "stale_prediction");
  }

  if (input.prediction.signal === "neutral" && confidencePct < config.minConfidenceForNeutralExplain) {
    withReason(reasonCodes, "neutral_low_confidence");
  }

  if (confidencePct < config.minConfidenceForExplain && input.prediction.signal !== "neutral") {
    withReason(reasonCodes, "below_min_confidence");
  }

  const unchangedHashes =
    input.gateState.lastExplainedPredictionHash === predictionHash
    && input.gateState.lastExplainedHistoryHash === historyHash;
  if (unchangedHashes) {
    withReason(reasonCodes, "idempotent_hash_unchanged");
  }

  const budgetPressureConsecutive =
    toNum(input.budgetPressureConsecutive) ?? 0;
  const underBudgetPressure = budgetPressureConsecutive >= config.budgetPressureConsecutiveCalls;
  if (underBudgetPressure && priority !== "high") {
    withReason(reasonCodes, "budget_pressure_requires_high_priority");
  }

  const lastAiCallMs = input.gateState.lastAiCallTs ? input.gateState.lastAiCallTs.getTime() : null;
  const cooldownSec = config.aiCooldownSec[input.timeframe];
  const cooldownActive =
    lastAiCallMs !== null && Number.isFinite(lastAiCallMs) && (input.nowMs - lastAiCallMs) < cooldownSec * 1000;
  if (cooldownActive && priority !== "high") {
    withReason(reasonCodes, "cooldown_active");
  }

  if (priority === "high" && state.highPriorityCallsLastHour >= config.maxHighPriorityPerHour) {
    withReason(reasonCodes, "high_priority_hour_cap");
  }

  const blockingReasons = new Set([
    "stale_prediction",
    "neutral_low_confidence",
    "below_min_confidence",
    "idempotent_hash_unchanged",
    "budget_pressure_requires_high_priority",
    "cooldown_active",
    "high_priority_hour_cap",
    "no_actionable_change"
  ]);

  let allow = triggersAllow;
  for (const code of reasonCodes) {
    if (blockingReasons.has(code)) {
      allow = false;
      break;
    }
  }

  const orderedReasons = [...reasonCodes];
  const decisionHash = hashStableObject({
    allow,
    priority,
    reasons: orderedReasons,
    predictionHash,
    historyHash,
    timeframe: input.timeframe,
    confidencePct: Number(confidencePct.toFixed(2))
  });

  const decision: GateDecision = {
    allow,
    reasonCodes: orderedReasons,
    priority,
    recommendedCooldownSec: cooldownSec,
    predictionHash,
    historyHash,
    decisionHash,
    state
  };

  logDecision({
    allow: decision.allow,
    reasonCodes: decision.reasonCodes,
    priority: decision.priority,
    decisionHash,
    timeframe: input.timeframe
  });
  return decision;
}

export function resetAiQualityGateTelemetry(): void {
  telemetry.gateAllowCount = 0;
  telemetry.gateBlockCount = 0;
  telemetry.reasons.clear();
  telemetry.priorities.low = 0;
  telemetry.priorities.normal = 0;
  telemetry.priorities.high = 0;
  telemetry.aiCallsSaved = 0;
}

export function getAiQualityGateTelemetrySnapshot(): {
  gateAllowCount: number;
  gateBlockCount: number;
  aiCallsSaved: number;
  priorities: Record<GatePriority, number>;
  reasons: Array<{ code: string; count: number }>;
} {
  return {
    gateAllowCount: telemetry.gateAllowCount,
    gateBlockCount: telemetry.gateBlockCount,
    aiCallsSaved: telemetry.aiCallsSaved,
    priorities: { ...telemetry.priorities },
    reasons: [...telemetry.reasons.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
  };
}
