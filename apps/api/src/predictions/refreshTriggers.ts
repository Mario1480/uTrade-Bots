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
};

export type TriggerResult = {
  refresh: boolean;
  reasons: RefreshReason[];
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

  const due = input.nowMs - input.lastUpdatedMs >= input.refreshIntervalMs;
  if (due) {
    reasons.push("scheduled_due");
    return { refresh: true, reasons };
  }

  const prev = asRecord(input.previousFeatureSnapshot);
  const curr = asRecord(input.currentFeatureSnapshot);

  const prevTrend = readFeature(prev, ["emaSpread", "ema_spread_pct"]);
  const currTrend = readFeature(curr, ["emaSpread", "ema_spread_pct"]);
  const prevTrendSign = signBucket(prevTrend, 0.0004);
  const currTrendSign = signBucket(currTrend, 0.0004);
  if (prevTrendSign !== 0 && currTrendSign !== 0 && prevTrendSign !== currTrendSign) {
    reasons.push("trigger_trend_flip");
  }

  const prevTrendRank = readFeature(prev, ["ema_spread_abs_rank_0_100"]);
  const currTrendRank = readFeature(curr, ["ema_spread_abs_rank_0_100"]);
  if (rankBucket(prevTrendRank) !== rankBucket(currTrendRank)) {
    reasons.push("trigger_trend_regime");
  }

  const prevRsi = readFeature(prev, ["rsi", "indicators.rsi_14"]);
  const currRsi = readFeature(curr, ["rsi", "indicators.rsi_14"]);
  if (prevRsi !== null && currRsi !== null) {
    const prevBucket = prevRsi >= 55 ? "high" : prevRsi <= 45 ? "low" : "mid";
    const currBucket = currRsi >= 55 ? "high" : currRsi <= 45 ? "low" : "mid";
    if (prevBucket !== currBucket) {
      reasons.push("trigger_rsi_cross");
    }
  }

  const prevVolRank = readFeature(prev, ["atr_pct_rank_0_100"]);
  const currVolRank = readFeature(curr, ["atr_pct_rank_0_100"]);
  if (rankBucket(prevVolRank) !== rankBucket(currVolRank)) {
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

  return {
    refresh: reasons.length > 0,
    reasons
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
