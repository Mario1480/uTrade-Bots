import type { SignalSide } from "../signal/types.js";

export type RunnerGateSummary = {
  applied: boolean;
  allow: boolean;
  reason: string;
  sizeMultiplier: number;
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
};

export type RunnerDecisionTrace = {
  signal: {
    engine: string;
    side: SignalSide;
    confidence: number | null;
    reason: string;
    metadata: Record<string, unknown>;
  };
  execution: {
    mode: string;
    status: string;
    reason: string;
    metadata: Record<string, unknown>;
  };
};

export function defaultGateSummary(): RunnerGateSummary {
  return {
    applied: false,
    allow: true,
    reason: "gating_disabled",
    sizeMultiplier: 1,
    timeframe: null
  };
}

export function toSignalSideFromIntent(intentType: "open" | "close" | "none", side?: "long" | "short"): SignalSide {
  if (intentType !== "open") return "flat";
  return side === "short" ? "short" : "long";
}

export function coerceGateSummary(value: unknown, fallback: RunnerGateSummary = defaultGateSummary()): RunnerGateSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const row = value as Record<string, unknown>;
  const timeframeRaw = String(row.timeframe ?? "").trim();
  const timeframe =
    timeframeRaw === "5m" ||
    timeframeRaw === "15m" ||
    timeframeRaw === "1h" ||
    timeframeRaw === "4h" ||
    timeframeRaw === "1d"
      ? timeframeRaw
      : null;
  return {
    applied: typeof row.applied === "boolean" ? row.applied : fallback.applied,
    allow: typeof row.allow === "boolean" ? row.allow : fallback.allow,
    reason: typeof row.reason === "string" && row.reason.trim() ? row.reason.trim() : fallback.reason,
    sizeMultiplier: Number.isFinite(Number(row.sizeMultiplier)) ? Number(row.sizeMultiplier) : fallback.sizeMultiplier,
    timeframe
  };
}
