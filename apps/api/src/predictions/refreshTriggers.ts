export type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type PredictionSignal = "up" | "down" | "neutral";

export type RefreshReason =
  | "scheduled_due"
  | "trigger_trend_flip"
  | "trigger_trend_regime"
  | "trigger_rsi_cross"
  | "trigger_vol_regime"
  | "trigger_breakout"
  | "trigger_funding"
  | "trigger_basis"
  | "trigger_data_gap";

export type TriggerInput = {
  timeframe: PredictionTimeframe;
  nowMs: number;
  lastUpdatedMs: number;
  refreshIntervalMs: number;
  previousFeatureSnapshot: Record<string, unknown> | null;
  currentFeatureSnapshot: Record<string, unknown>;
  previousTriggerState?: TriggerDebounceState | null;
  triggerDebounceSec?: number;
  hysteresisRatio?: number;
};

export type TriggerDebounceState = {
  candidateReason: RefreshReason | null;
  candidateCount: number;
  lastTriggerCandidateAtMs: number | null;
};

export type TriggerResult = {
  refresh: boolean;
  reasons: RefreshReason[];
  triggerState: TriggerDebounceState;
};

export type SignificantChangeType =
  | "signal_flip"
  | "confidence_jump"
  | "regime_change"
  | "scheduled_checkpoint"
  | "manual";

export type SignificantChangeInput = {
  prevState: {
    signal: PredictionSignal;
    confidence: number;
    tags: string[];
    featureSnapshot: Record<string, unknown>;
  } | null;
  newState: {
    signal: PredictionSignal;
    confidence: number;
    tags: string[];
    featureSnapshot: Record<string, unknown>;
  };
  forceCheckpoint?: boolean;
};

export type SignificantChangeResult = {
  significant: boolean;
  reasons: string[];
  changeType: SignificantChangeType;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumber(snapshot: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const direct = asNumber(snapshot[key]);
    if (direct !== null) return direct;
  }
  return null;
}

function readNestedNumber(snapshot: Record<string, unknown>, path: string): number | null {
  const parts = path.split(".");
  let cursor: unknown = snapshot;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return asNumber(cursor);
}

function readFeature(snapshot: Record<string, unknown>, paths: string[]): number | null {
  for (const path of paths) {
    if (!path.includes(".")) {
      const val = asNumber(snapshot[path]);
      if (val !== null) return val;
      continue;
    }
    const val = readNestedNumber(snapshot, path);
    if (val !== null) return val;
  }
  return null;
}

function readBool(snapshot: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "on", "yes"].includes(normalized)) return true;
      if (["0", "false", "off", "no"].includes(normalized)) return false;
    }
    if (typeof value === "number") return value > 0;
  }
  return false;
}

function signBucket(value: number | null, eps: number): -1 | 0 | 1 {
  if (value === null) return 0;
  if (value > eps) return 1;
  if (value < -eps) return -1;
  return 0;
}

function rankBucket(value: number | null): "low" | "mid" | "high" | "unknown" {
  if (value === null) return "unknown";
  if (value < 25) return "low";
  if (value > 75) return "high";
  return "mid";
}

type RegimeBucket = "low" | "mid" | "high" | "unknown";

const DEFAULT_HYSTERESIS_RATIO = Math.max(
  0.2,
  Math.min(0.95, Number(process.env.PRED_HYSTERESIS_RATIO ?? "0.6"))
);
const DEFAULT_TRIGGER_DEBOUNCE_SEC = Math.max(
  0,
  Number(process.env.PRED_TRIGGER_DEBOUNCE_SEC ?? "90")
);
const TREND_ENTER_EPS_BY_TF: Record<PredictionTimeframe, number> = {
  "5m": 0.0005,
  "15m": 0.00045,
  "1h": 0.0004,
  "4h": 0.00035,
  "1d": 0.0003
};
const VOL_HIGH_ENTER_BY_TF: Record<PredictionTimeframe, number> = {
  "5m": 72,
  "15m": 74,
  "1h": 75,
  "4h": 76,
  "1d": 78
};
const VOL_LOW_ENTER_BY_TF: Record<PredictionTimeframe, number> = {
  "5m": 28,
  "15m": 26,
  "1h": 25,
  "4h": 24,
  "1d": 22
};
const RSI_HIGH_ENTER_BY_TF: Record<PredictionTimeframe, number> = {
  "5m": 56,
  "15m": 55,
  "1h": 55,
  "4h": 54,
  "1d": 53
};
const RSI_LOW_ENTER_BY_TF: Record<PredictionTimeframe, number> = {
  "5m": 44,
  "15m": 45,
  "1h": 45,
  "4h": 46,
  "1d": 47
};

function classifyTrendSignWithHysteresis(
  timeframe: PredictionTimeframe,
  value: number | null,
  prevState: -1 | 0 | 1,
  hysteresisRatio: number
): -1 | 0 | 1 {
  if (value === null) return 0;
  const enter = TREND_ENTER_EPS_BY_TF[timeframe] ?? 0.0004;
  const exit = enter * hysteresisRatio;

  if (prevState === 1) {
    if (value >= exit) return 1;
    if (value <= -enter) return -1;
    return 0;
  }
  if (prevState === -1) {
    if (value <= -exit) return -1;
    if (value >= enter) return 1;
    return 0;
  }
  if (value >= enter) return 1;
  if (value <= -enter) return -1;
  return 0;
}

function classifyRankBucketWithHysteresis(
  timeframe: PredictionTimeframe,
  value: number | null,
  prevState: RegimeBucket,
  hysteresisRatio: number
): RegimeBucket {
  if (value === null) return "unknown";
  const highEnter = VOL_HIGH_ENTER_BY_TF[timeframe] ?? 75;
  const lowEnter = VOL_LOW_ENTER_BY_TF[timeframe] ?? 25;
  const highExit = 50 + (highEnter - 50) * hysteresisRatio;
  const lowExit = 50 - (50 - lowEnter) * hysteresisRatio;

  if (prevState === "high") {
    if (value >= highExit) return "high";
    if (value <= lowEnter) return "low";
    return "mid";
  }
  if (prevState === "low") {
    if (value <= lowExit) return "low";
    if (value >= highEnter) return "high";
    return "mid";
  }
  if (value >= highEnter) return "high";
  if (value <= lowEnter) return "low";
  return "mid";
}

function classifyRsiBucketWithHysteresis(
  timeframe: PredictionTimeframe,
  value: number | null,
  prevState: RegimeBucket,
  hysteresisRatio: number
): RegimeBucket {
  if (value === null) return "unknown";
  const highEnter = RSI_HIGH_ENTER_BY_TF[timeframe] ?? 55;
  const lowEnter = RSI_LOW_ENTER_BY_TF[timeframe] ?? 45;
  const highExit = 50 + (highEnter - 50) * hysteresisRatio;
  const lowExit = 50 - (50 - lowEnter) * hysteresisRatio;

  if (prevState === "high") {
    if (value >= highExit) return "high";
    if (value <= lowEnter) return "low";
    return "mid";
  }
  if (prevState === "low") {
    if (value <= lowExit) return "low";
    if (value >= highEnter) return "high";
    return "mid";
  }
  if (value >= highEnter) return "high";
  if (value <= lowEnter) return "low";
  return "mid";
}

function resetTriggerState(): TriggerDebounceState {
  return {
    candidateReason: null,
    candidateCount: 0,
    lastTriggerCandidateAtMs: null
  };
}

function toTagSet(tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    const normalized = String(tag ?? "").trim();
    if (!normalized) continue;
    out.add(normalized);
  }
  return out;
}

function changedTagSet(prev: string[], next: string[]): boolean {
  const a = toTagSet(prev);
  const b = toTagSet(next);
  if (a.size !== b.size) return true;
  for (const item of a) {
    if (!b.has(item)) return true;
  }
  return false;
}

export function shouldRefreshTF(input: TriggerInput): TriggerResult {
  const reasons: RefreshReason[] = [];
  const debounceState = input.previousTriggerState ?? resetTriggerState();
  const hysteresisRatio = Math.max(
    0.2,
    Math.min(0.95, Number.isFinite(Number(input.hysteresisRatio)) ? Number(input.hysteresisRatio) : DEFAULT_HYSTERESIS_RATIO)
  );

  const due = input.nowMs - input.lastUpdatedMs >= input.refreshIntervalMs;
  if (due) {
    reasons.push("scheduled_due");
    return { refresh: true, reasons, triggerState: resetTriggerState() };
  }

  const prev = asRecord(input.previousFeatureSnapshot);
  const curr = asRecord(input.currentFeatureSnapshot);

  const prevTrend = readFeature(prev, ["emaSpread", "ema_spread_pct"]);
  const currTrend = readFeature(curr, ["emaSpread", "ema_spread_pct"]);
  const prevTrendSign = classifyTrendSignWithHysteresis(
    input.timeframe,
    prevTrend,
    signBucket(prevTrend, 0.0004),
    hysteresisRatio
  );
  const currTrendSign = classifyTrendSignWithHysteresis(
    input.timeframe,
    currTrend,
    prevTrendSign,
    hysteresisRatio
  );
  if (prevTrendSign !== 0 && currTrendSign !== 0 && prevTrendSign !== currTrendSign) {
    reasons.push("trigger_trend_flip");
  }

  const prevTrendRank = readFeature(prev, ["ema_spread_abs_rank_0_100"]);
  const currTrendRank = readFeature(curr, ["ema_spread_abs_rank_0_100"]);
  const prevTrendRegime = classifyRankBucketWithHysteresis(
    input.timeframe,
    prevTrendRank,
    rankBucket(prevTrendRank),
    hysteresisRatio
  );
  const currTrendRegime = classifyRankBucketWithHysteresis(
    input.timeframe,
    currTrendRank,
    prevTrendRegime,
    hysteresisRatio
  );
  if (prevTrendRegime !== currTrendRegime) {
    reasons.push("trigger_trend_regime");
  }

  const prevRsi = readFeature(prev, ["rsi", "indicators.rsi_14"]);
  const currRsi = readFeature(curr, ["rsi", "indicators.rsi_14"]);
  if (prevRsi !== null && currRsi !== null) {
    const prevBucket = classifyRsiBucketWithHysteresis(input.timeframe, prevRsi, "mid", hysteresisRatio);
    const currBucket = classifyRsiBucketWithHysteresis(input.timeframe, currRsi, prevBucket, hysteresisRatio);
    if (prevBucket !== currBucket) {
      reasons.push("trigger_rsi_cross");
    }
  }

  const prevVolRank = readFeature(prev, ["atr_pct_rank_0_100"]);
  const currVolRank = readFeature(curr, ["atr_pct_rank_0_100"]);
  const prevVolRegime = classifyRankBucketWithHysteresis(
    input.timeframe,
    prevVolRank,
    rankBucket(prevVolRank),
    hysteresisRatio
  );
  const currVolRegime = classifyRankBucketWithHysteresis(
    input.timeframe,
    currVolRank,
    prevVolRegime,
    hysteresisRatio
  );
  if (prevVolRegime !== currVolRegime) {
    reasons.push("trigger_vol_regime");
  }

  const prevBreakout = readFeature(prev, ["breakout_score", "breakoutScore", "breakoutProb"]);
  const currBreakout = readFeature(curr, ["breakout_score", "breakoutScore", "breakoutProb"]);
  if ((prevBreakout ?? 0) < 0.8 && (currBreakout ?? 0) >= 0.8) {
    reasons.push("trigger_breakout");
  }

  const prevFunding = readFeature(prev, ["fundingRate", "fundingRatePct"]);
  const currFunding = readFeature(curr, ["fundingRate", "fundingRatePct"]);
  if ((Math.abs(prevFunding ?? 0) < 0.0005) && (Math.abs(currFunding ?? 0) >= 0.0005)) {
    reasons.push("trigger_funding");
  }

  const prevBasis = readFeature(prev, ["basisBps", "basis_bps"]);
  const currBasis = readFeature(curr, ["basisBps", "basis_bps"]);
  if ((Math.abs(prevBasis ?? 0) < 8) && (Math.abs(currBasis ?? 0) >= 8)) {
    reasons.push("trigger_basis");
  }

  const hasDataGap =
    readBool(curr, ["dataGap"]) ||
    readBool(asRecord(curr.riskFlags), ["dataGap"]) ||
    readBool(asRecord(curr.indicators), ["dataGap"]);
  if (hasDataGap) {
    reasons.push("trigger_data_gap");
  }

  const useDebounce = input.previousTriggerState !== undefined;
  if (!useDebounce) {
    return {
      refresh: reasons.length > 0,
      reasons,
      triggerState: resetTriggerState()
    };
  }

  if (reasons.length === 0) {
    return {
      refresh: false,
      reasons,
      triggerState: resetTriggerState()
    };
  }

  const primaryReason = reasons[0];
  const sameReason = debounceState.candidateReason === primaryReason;
  const nextState: TriggerDebounceState = {
    candidateReason: primaryReason,
    candidateCount: sameReason ? debounceState.candidateCount + 1 : 1,
    lastTriggerCandidateAtMs: sameReason
      ? (debounceState.lastTriggerCandidateAtMs ?? input.nowMs)
      : input.nowMs
  };
  const debounceMs = Math.max(
    0,
    Number.isFinite(Number(input.triggerDebounceSec))
      ? Number(input.triggerDebounceSec) * 1000
      : DEFAULT_TRIGGER_DEBOUNCE_SEC * 1000
  );
  const candidateAgeMs = Math.max(0, input.nowMs - (nextState.lastTriggerCandidateAtMs ?? input.nowMs));
  const debounceSatisfied =
    debounceMs <= 0 || nextState.candidateCount >= 2 || candidateAgeMs >= debounceMs;

  if (!debounceSatisfied) {
    return {
      refresh: false,
      reasons: [],
      triggerState: nextState
    };
  }

  return {
    refresh: true,
    reasons,
    triggerState: resetTriggerState()
  };
}

export function isSignificantChange(input: SignificantChangeInput): SignificantChangeResult {
  if (!input.prevState) {
    return {
      significant: true,
      reasons: ["initial_state"],
      changeType: input.forceCheckpoint ? "manual" : "scheduled_checkpoint"
    };
  }

  const reasons: string[] = [];

  if (input.prevState.signal !== input.newState.signal) {
    reasons.push(`signal:${input.prevState.signal}->${input.newState.signal}`);
  }

  const confidenceDelta = Math.abs(input.newState.confidence - input.prevState.confidence);
  if (confidenceDelta >= 10) {
    reasons.push(`confidence_delta:${confidenceDelta.toFixed(2)}`);
  }

  if (changedTagSet(input.prevState.tags, input.newState.tags)) {
    reasons.push("tags_changed");
  }

  const prevVolRank = readFeature(input.prevState.featureSnapshot, ["atr_pct_rank_0_100"]);
  const nextVolRank = readFeature(input.newState.featureSnapshot, ["atr_pct_rank_0_100"]);
  if (rankBucket(prevVolRank) !== rankBucket(nextVolRank)) {
    reasons.push("vol_rank_bucket_changed");
  }

  const prevTrendRank = readFeature(input.prevState.featureSnapshot, ["ema_spread_abs_rank_0_100"]);
  const nextTrendRank = readFeature(input.newState.featureSnapshot, ["ema_spread_abs_rank_0_100"]);
  if (rankBucket(prevTrendRank) !== rankBucket(nextTrendRank)) {
    reasons.push("trend_rank_bucket_changed");
  }

  const prevBreakout = readFeature(input.prevState.featureSnapshot, ["breakout_score", "breakoutScore", "breakoutProb"]);
  const nextBreakout = readFeature(input.newState.featureSnapshot, ["breakout_score", "breakoutScore", "breakoutProb"]);
  if ((prevBreakout ?? 0) < 0.8 && (nextBreakout ?? 0) >= 0.8) {
    reasons.push("breakout_cross_0_8");
  }

  if (input.forceCheckpoint && reasons.length === 0) {
    reasons.push("forced_checkpoint");
  }

  const significant = reasons.length > 0;

  let changeType: SignificantChangeType = "scheduled_checkpoint";
  if (reasons.some((item) => item.startsWith("signal:"))) changeType = "signal_flip";
  else if (reasons.some((item) => item.startsWith("confidence_delta:"))) changeType = "confidence_jump";
  else if (reasons.some((item) => item.includes("bucket") || item.includes("tags") || item.includes("breakout"))) {
    changeType = "regime_change";
  }
  if (input.forceCheckpoint) changeType = "manual";

  return {
    significant,
    reasons,
    changeType
  };
}

export function buildTagsDelta(prevTags: string[], nextTags: string[]): { added: string[]; removed: string[] } {
  const prev = toTagSet(prevTags);
  const next = toTagSet(nextTags);

  const added = [...next].filter((tag) => !prev.has(tag));
  const removed = [...prev].filter((tag) => !next.has(tag));

  return { added, removed };
}
