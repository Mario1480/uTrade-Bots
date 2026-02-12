import type { TradeIntent } from "@mm/futures-core";
import type { PredictionGateState } from "./db.js";

export type PredictionGateTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type PredictionGateSignal = "up" | "down" | "neutral";

export type PredictionGatePolicy = {
  enabled: boolean;
  timeframe: PredictionGateTimeframe;
  minConfidence: number;
  blockTags: string[];
  allowSignals: PredictionGateSignal[];
  maxAgeSec: number;
  sizeMultiplier: {
    base: number;
    highConfidenceThreshold: number;
    highConfidenceMultiplier: number;
    highVolMultiplier: number;
    min: number;
    max: number;
  };
  failOpenOnError: boolean;
  failOpenMultiplier: number;
};

export type PredictionGateResult = {
  allow: boolean;
  reason: string;
  sizeMultiplier: number;
};

export type PredictionGateMetrics = {
  allowedCount: number;
  gatedCount: number;
  avgMultiplier: number;
};

const gateMetrics: {
  allowedCount: number;
  gatedCount: number;
  allowedMultiplierSum: number;
  allowedMultiplierCount: number;
} = {
  allowedCount: 0,
  gatedCount: 0,
  allowedMultiplierSum: 0,
  allowedMultiplierCount: 0
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStringList(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const normalized = String(entry ?? "").trim().toLowerCase();
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeSignalList(value: unknown): PredictionGateSignal[] {
  const values = normalizeStringList(value, 3);
  const out: PredictionGateSignal[] = [];
  for (const entry of values) {
    if (entry === "up" || entry === "down" || entry === "neutral") {
      if (!out.includes(entry)) out.push(entry);
    }
  }
  return out;
}

function normalizeTimeframe(value: unknown): PredictionGateTimeframe {
  const normalized = String(value ?? "").trim();
  if (
    normalized === "5m" ||
    normalized === "15m" ||
    normalized === "1h" ||
    normalized === "4h" ||
    normalized === "1d"
  ) {
    return normalized;
  }
  return "15m";
}

function confidenceToPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value <= 1 ? value * 100 : value;
  return clamp(normalized, 0, 100);
}

function readPolicySource(paramsJson: Record<string, unknown>): Record<string, unknown> {
  const raw = paramsJson.gating;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function readPredictionGatePolicy(paramsJson: Record<string, unknown>): PredictionGatePolicy {
  const source = readPolicySource(paramsJson);
  const sizeRaw =
    source.sizeMultiplier && typeof source.sizeMultiplier === "object" && !Array.isArray(source.sizeMultiplier)
      ? (source.sizeMultiplier as Record<string, unknown>)
      : {};

  const minConfidenceRaw = toNumber(source.minConfidence);
  const maxAgeSecRaw = toNumber(source.maxAgeSec);
  const baseMultiplierRaw = toNumber(sizeRaw.base);
  const highConfidenceThresholdRaw = toNumber(sizeRaw.highConfidenceThreshold);
  const highConfidenceMultiplierRaw = toNumber(sizeRaw.highConfidenceMultiplier);
  const highVolMultiplierRaw = toNumber(sizeRaw.highVolMultiplier);
  const minMultiplierRaw = toNumber(sizeRaw.min);
  const maxMultiplierRaw = toNumber(sizeRaw.max);
  const failOpenMultiplierRaw = toNumber(source.failOpenMultiplier);

  const blockTags = normalizeStringList(source.blockTags, 20);
  const allowSignals = normalizeSignalList(source.allowSignals);

  const policy: PredictionGatePolicy = {
    enabled: toBoolean(source.enabled, false),
    timeframe: normalizeTimeframe(source.timeframe),
    minConfidence:
      minConfidenceRaw !== null ? clamp(minConfidenceRaw, 0, 100) : 65,
    blockTags,
    allowSignals: allowSignals.length > 0 ? allowSignals : ["up", "down"],
    maxAgeSec: maxAgeSecRaw !== null ? Math.max(30, Math.trunc(maxAgeSecRaw)) : 900,
    sizeMultiplier: {
      base: baseMultiplierRaw !== null ? clamp(baseMultiplierRaw, 0.1, 3) : 1,
      highConfidenceThreshold:
        highConfidenceThresholdRaw !== null ? clamp(highConfidenceThresholdRaw, 0, 100) : 80,
      highConfidenceMultiplier:
        highConfidenceMultiplierRaw !== null ? clamp(highConfidenceMultiplierRaw, 0.1, 3) : 1.2,
      highVolMultiplier: highVolMultiplierRaw !== null ? clamp(highVolMultiplierRaw, 0.1, 3) : 0.7,
      min: minMultiplierRaw !== null ? clamp(minMultiplierRaw, 0.1, 3) : 0.1,
      max: maxMultiplierRaw !== null ? clamp(maxMultiplierRaw, 0.1, 3) : 2
    },
    failOpenOnError: toBoolean(
      source.failOpenOnError,
      toBoolean(process.env.PREDICTION_GATE_FAIL_OPEN, false)
    ),
    failOpenMultiplier:
      failOpenMultiplierRaw !== null ? clamp(failOpenMultiplierRaw, 0.1, 3) : 0.5
  };

  if (policy.sizeMultiplier.min > policy.sizeMultiplier.max) {
    const fallback = policy.sizeMultiplier.min;
    policy.sizeMultiplier.min = policy.sizeMultiplier.max;
    policy.sizeMultiplier.max = fallback;
  }

  return policy;
}

function toCanonicalTags(tags: string[]): string[] {
  return normalizeStringList(tags, 20);
}

export function evaluateGate(
  policy: PredictionGatePolicy,
  predictionState: PredictionGateState | null,
  nowMs = Date.now()
): PredictionGateResult {
  if (!policy.enabled) {
    return { allow: true, reason: "gating_disabled", sizeMultiplier: 1 };
  }
  if (!predictionState) {
    return { allow: false, reason: "missing_prediction_state", sizeMultiplier: 1 };
  }

  const ageMs = nowMs - predictionState.tsUpdated.getTime();
  if (!Number.isFinite(ageMs) || ageMs > policy.maxAgeSec * 1000) {
    return { allow: false, reason: "stale_prediction_state", sizeMultiplier: 1 };
  }

  const confidencePct = confidenceToPct(predictionState.confidence);
  if (confidencePct < policy.minConfidence) {
    return { allow: false, reason: "confidence_below_min", sizeMultiplier: 1 };
  }

  if (!policy.allowSignals.includes(predictionState.signal)) {
    return { allow: false, reason: "signal_not_allowed", sizeMultiplier: 1 };
  }

  const stateTags = toCanonicalTags(predictionState.tags);
  const blockedByTag = policy.blockTags.find((tag) => stateTags.includes(tag));
  if (blockedByTag) {
    return { allow: false, reason: `blocked_tag:${blockedByTag}`, sizeMultiplier: 1 };
  }

  let multiplier = policy.sizeMultiplier.base;
  if (confidencePct >= policy.sizeMultiplier.highConfidenceThreshold) {
    multiplier *= policy.sizeMultiplier.highConfidenceMultiplier;
  }
  if (stateTags.includes("high_vol")) {
    multiplier *= policy.sizeMultiplier.highVolMultiplier;
  }

  multiplier = clamp(multiplier, policy.sizeMultiplier.min, policy.sizeMultiplier.max);
  multiplier = Number(multiplier.toFixed(4));

  return {
    allow: true,
    reason: "allowed",
    sizeMultiplier: multiplier
  };
}

export function applySizeMultiplierToIntent(intent: TradeIntent, sizeMultiplier: number): TradeIntent {
  if (intent.type !== "open") return intent;
  if (!Number.isFinite(sizeMultiplier) || sizeMultiplier <= 0 || sizeMultiplier === 1) return intent;

  const order = intent.order ?? {};
  const nextOrder = { ...order };
  if (typeof nextOrder.qty === "number" && Number.isFinite(nextOrder.qty)) {
    nextOrder.qty = Number((nextOrder.qty * sizeMultiplier).toFixed(8));
  }
  if (
    typeof nextOrder.desiredNotionalUsd === "number" &&
    Number.isFinite(nextOrder.desiredNotionalUsd)
  ) {
    nextOrder.desiredNotionalUsd = Number(
      (nextOrder.desiredNotionalUsd * sizeMultiplier).toFixed(8)
    );
  }
  if (typeof nextOrder.riskUsd === "number" && Number.isFinite(nextOrder.riskUsd)) {
    nextOrder.riskUsd = Number((nextOrder.riskUsd * sizeMultiplier).toFixed(8));
  }

  return {
    ...intent,
    order: nextOrder
  };
}

export function recordPredictionGateDecision(result: PredictionGateResult): void {
  if (result.allow) {
    gateMetrics.allowedCount += 1;
    gateMetrics.allowedMultiplierSum += result.sizeMultiplier;
    gateMetrics.allowedMultiplierCount += 1;
    return;
  }
  gateMetrics.gatedCount += 1;
}

export function getPredictionGateMetrics(): PredictionGateMetrics {
  const avgMultiplier =
    gateMetrics.allowedMultiplierCount > 0
      ? gateMetrics.allowedMultiplierSum / gateMetrics.allowedMultiplierCount
      : 0;

  return {
    allowedCount: gateMetrics.allowedCount,
    gatedCount: gateMetrics.gatedCount,
    avgMultiplier: Number(avgMultiplier.toFixed(4))
  };
}

