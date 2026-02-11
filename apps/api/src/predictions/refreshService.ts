import { hashStableObject } from "../ai/analyzer.js";
import {
  buildTagsDelta,
  isSignificantChange,
  type PredictionSignal,
  type PredictionTimeframe,
  type SignificantChangeResult
} from "./refreshTriggers.js";

export type PredictionStateLike = {
  id: string;
  signal: PredictionSignal;
  confidence: number;
  tags: string[];
  explanation: string | null;
  keyDrivers: Array<{ name: string; value: unknown }>;
  featureSnapshot: Record<string, unknown>;
  modelVersion: string;
  tsUpdated: Date;
  lastAiExplainedAt: Date | null;
};

export type RefreshCandidate = {
  exchange: string;
  accountId: string;
  userId: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: PredictionTimeframe;
  directionPreference: "long" | "short" | "either";
  confidenceTargetPct: number;
  leverage: number | null;
};

export type RefreshComputation = {
  prediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  };
  featureSnapshot: Record<string, unknown>;
  tracking: {
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    horizonMs: number;
  };
  tsCreatedIso: string;
  tsPredictedForIso: string;
  modelVersion: string;
};

export type RefreshDecision = {
  shouldCallAi: boolean;
  reason: string;
  cooldownActive: boolean;
};

const DEFAULT_AI_COOLDOWN_MS =
  Math.max(30, Number(process.env.PREDICTION_REFRESH_AI_COOLDOWN_SECONDS ?? "300")) * 1000;

const REFRESH_INTERVALS_MS: Record<PredictionTimeframe, number> = {
  "5m": Math.max(60, Number(process.env.PREDICTION_REFRESH_5M_SECONDS ?? "180")) * 1000,
  "15m": Math.max(120, Number(process.env.PREDICTION_REFRESH_15M_SECONDS ?? "300")) * 1000,
  "1h": Math.max(180, Number(process.env.PREDICTION_REFRESH_1H_SECONDS ?? "600")) * 1000,
  "4h": Math.max(300, Number(process.env.PREDICTION_REFRESH_4H_SECONDS ?? "1800")) * 1000,
  "1d": Math.max(600, Number(process.env.PREDICTION_REFRESH_1D_SECONDS ?? "10800")) * 1000
};

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = String(tag ?? "").trim();
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= 5) break;
  }
  return out;
}

function confidenceToPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

export function refreshIntervalMsForTimeframe(timeframe: PredictionTimeframe): number {
  return REFRESH_INTERVALS_MS[timeframe] ?? 300_000;
}

export function buildPredictionStateUniqueKey(input: {
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: PredictionTimeframe;
}): string {
  return [
    input.exchange.toLowerCase(),
    input.accountId,
    input.symbol.toUpperCase(),
    input.marketType,
    input.timeframe
  ].join(":");
}

export function buildPredictionChangeHash(input: {
  signal: PredictionSignal;
  confidence: number;
  tags: string[];
  keyDrivers: Array<{ name: string; value: unknown }>;
  featureSnapshot: Record<string, unknown>;
}): string {
  const rankBucket = (value: unknown): "low" | "mid" | "high" | "unknown" => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "unknown";
    if (num < 25) return "low";
    if (num > 75) return "high";
    return "mid";
  };

  const payload = {
    signal: input.signal,
    confidenceRounded2: Math.round(input.confidence / 2) * 2,
    tags: normalizeTags(input.tags),
    keyDrivers: input.keyDrivers.slice(0, 3).map((driver) => ({
      name: String(driver.name ?? ""),
      value: driver.value
    })),
    atrRankBucket: rankBucket((input.featureSnapshot as Record<string, unknown>).atr_pct_rank_0_100),
    trendRankBucket: rankBucket((input.featureSnapshot as Record<string, unknown>).ema_spread_abs_rank_0_100)
  };

  return hashStableObject(payload);
}

export function evaluateSignificantChange(input: {
  prev: PredictionStateLike | null;
  next: {
    signal: PredictionSignal;
    confidence: number;
    tags: string[];
    featureSnapshot: Record<string, unknown>;
  };
  forceCheckpoint?: boolean;
}): SignificantChangeResult {
  return isSignificantChange({
    prevState: input.prev
      ? {
          signal: input.prev.signal,
          confidence: confidenceToPct(input.prev.confidence),
          tags: input.prev.tags,
          featureSnapshot: input.prev.featureSnapshot
        }
      : null,
    newState: {
      signal: input.next.signal,
      confidence: confidenceToPct(input.next.confidence),
      tags: input.next.tags,
      featureSnapshot: input.next.featureSnapshot
    },
    forceCheckpoint: input.forceCheckpoint
  });
}

export function shouldCallAiForRefresh(input: {
  prev: PredictionStateLike | null;
  next: {
    signal: PredictionSignal;
    confidence: number;
    tags: string[];
  };
  significant: SignificantChangeResult;
  nowMs: number;
  cooldownMs?: number;
}): RefreshDecision {
  if (!input.significant.significant) {
    return {
      shouldCallAi: false,
      reason: "not_significant",
      cooldownActive: false
    };
  }

  const signalFlip = input.prev ? input.prev.signal !== input.next.signal : true;
  const confidenceJump =
    !input.prev ||
    Math.abs(confidenceToPct(input.next.confidence) - confidenceToPct(input.prev.confidence)) >= 10;

  const tagDelta = buildTagsDelta(input.prev?.tags ?? [], input.next.tags);
  const tagsChanged = tagDelta.added.length > 0 || tagDelta.removed.length > 0;

  const cooldownMs = input.cooldownMs ?? DEFAULT_AI_COOLDOWN_MS;
  const lastAiAtMs = input.prev?.lastAiExplainedAt ? input.prev.lastAiExplainedAt.getTime() : null;
  const cooldownActive =
    lastAiAtMs !== null && Number.isFinite(lastAiAtMs) && input.nowMs - lastAiAtMs < cooldownMs;

  if (!(signalFlip || confidenceJump || tagsChanged)) {
    return {
      shouldCallAi: false,
      reason: "gating_no_meaningful_ai_delta",
      cooldownActive
    };
  }

  if (cooldownActive) {
    return {
      shouldCallAi: false,
      reason: "gating_ai_cooldown",
      cooldownActive: true
    };
  }

  return {
    shouldCallAi: true,
    reason: signalFlip
      ? "signal_flip"
      : confidenceJump
        ? "confidence_jump"
        : "tags_changed",
    cooldownActive: false
  };
}

export function buildEventDelta(input: {
  prev: PredictionStateLike | null;
  next: {
    signal: PredictionSignal;
    confidence: number;
    tags: string[];
    expectedMovePct: number | null;
  };
  reasons: string[];
}): Record<string, unknown> {
  const tagDelta = buildTagsDelta(input.prev?.tags ?? [], input.next.tags);
  return {
    reasons: input.reasons,
    signal: `${input.prev?.signal ?? "none"}->${input.next.signal}`,
    confidenceDelta:
      input.prev !== null
        ? Number((input.next.confidence - input.prev.confidence).toFixed(4))
        : null,
    expectedMovePct: input.next.expectedMovePct,
    tagsAdded: tagDelta.added,
    tagsRemoved: tagDelta.removed
  };
}
