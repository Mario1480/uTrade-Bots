export type PredictionSignal = "up" | "down" | "neutral";

export type PredictionChangeKind = "scheduled" | "triggered" | "manual" | "unknown";

export type PredictionSignalFlip = {
  from: PredictionSignal;
  to: PredictionSignal;
};

export type ParsedPredictionChangeReason = {
  raw: string | null;
  kind: PredictionChangeKind;
  label: string;
  shortReason: string;
  lastChangeType: "signal_flip" | "confidence_jump" | "regime_change" | "scheduled_checkpoint" | "manual" | null;
  signalFlip: PredictionSignalFlip | null;
};

const SIGNAL_CHANGE_RE = /signal:(up|down|neutral)->(up|down|neutral)/i;
const CONFIDENCE_DELTA_RE = /confidence_delta:([+-]?\d+(?:\.\d+)?)/i;

const REASON_LABEL_MAP: Record<string, string> = {
  scheduled_due: "Scheduled refresh",
  tags_changed: "Tags changed",
  trend_rank_bucket_changed: "Trend regime changed",
  vol_rank_bucket_changed: "Volatility regime changed",
  atr_rank_bucket_changed: "ATR regime changed",
  manual_create: "Manual create",
  bootstrap: "Bootstrap import"
};

function normalizeConfidencePct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

function humanizeToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const mapped = REASON_LABEL_MAP[trimmed];
  if (mapped) return mapped;
  return trimmed
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatConfidenceDelta(raw: string): string | null {
  const match = raw.match(CONFIDENCE_DELTA_RE);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return "Confidence changed";
  const sign = value > 0 ? "+" : "";
  return `Confidence ${sign}${value.toFixed(1)}`;
}

function buildHumanReason(raw: string, signalFlip: PredictionSignalFlip | null): string {
  const tokens = raw.split(",").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return "n/a";

  const rendered: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("signal:")) {
      if (signalFlip) {
        rendered.push(`Signal ${signalFlip.from.toUpperCase()}->${signalFlip.to.toUpperCase()}`);
      } else {
        rendered.push("Signal changed");
      }
      continue;
    }

    if (token.startsWith("confidence_delta:")) {
      rendered.push(formatConfidenceDelta(token) ?? "Confidence changed");
      continue;
    }

    if (token.startsWith("trigger:")) {
      const triggerReason = token.slice("trigger:".length).trim();
      rendered.push(`Trigger: ${humanizeToken(triggerReason) || "condition met"}`);
      continue;
    }

    rendered.push(humanizeToken(token));
  }

  return rendered.filter(Boolean).join(" • ");
}

export function parsePredictionChangeReason(
  reasonInput: string | null | undefined
): ParsedPredictionChangeReason {
  const raw = typeof reasonInput === "string" && reasonInput.trim().length > 0
    ? reasonInput.trim()
    : null;
  if (!raw) {
    return {
      raw: null,
      kind: "unknown",
      label: "Unknown",
      shortReason: "n/a",
      lastChangeType: null,
      signalFlip: null
    };
  }

  const signalMatch = raw.match(SIGNAL_CHANGE_RE);
  const signalFlip: PredictionSignalFlip | null = signalMatch
    ? {
        from: signalMatch[1].toLowerCase() as PredictionSignal,
        to: signalMatch[2].toLowerCase() as PredictionSignal
      }
    : null;

  let lastChangeType: ParsedPredictionChangeReason["lastChangeType"] = null;
  if (raw.startsWith("manual")) lastChangeType = "manual";
  else if (raw.startsWith("scheduled")) lastChangeType = "scheduled_checkpoint";
  else if (signalFlip) lastChangeType = "signal_flip";
  else if (raw.includes("confidence_delta:")) lastChangeType = "confidence_jump";
  else if (
    raw.includes("atr_rank_bucket") ||
    raw.includes("trend_rank_bucket") ||
    raw.includes("tags:") ||
    raw.includes("trigger:")
  ) {
    lastChangeType = "regime_change";
  }

  let kind: PredictionChangeKind = "unknown";
  if (raw.startsWith("manual")) kind = "manual";
  else if (raw.startsWith("scheduled") || raw.startsWith("bootstrap")) kind = "scheduled";
  else if (raw.startsWith("trigger:") || signalFlip || raw.includes("confidence_delta:") || raw.includes("tags:")) {
    kind = "triggered";
  }

  const shortReasonBase = buildHumanReason(raw, signalFlip);
  const shortReason =
    shortReasonBase.length > 80 ? `${shortReasonBase.slice(0, 77)}...` : shortReasonBase;

  const label =
    kind === "scheduled"
      ? "Scheduled"
      : kind === "triggered"
        ? "Triggered"
        : kind === "manual"
          ? "Manual"
          : "Unknown";

  return {
    raw,
    kind,
    label,
    shortReason,
    lastChangeType,
    signalFlip
  };
}

export function formatRelativeTime(
  isoTimestamp: string | null | undefined,
  nowMs: number
): string {
  if (!isoTimestamp) return "n/a";
  const ts = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ts)) return "n/a";

  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function isRecentTimestamp(
  isoTimestamp: string | null | undefined,
  nowMs: number,
  windowMs: number
): boolean {
  if (!isoTimestamp) return false;
  const ts = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts <= windowMs;
}

export function buildPredictionCopySummary(input: {
  symbol: string;
  timeframe: string;
  signal: PredictionSignal;
  confidence: number;
  expectedMovePct: number;
  lastUpdatedAt: string | null | undefined;
  lastChangeReason: string | null | undefined;
  tags: string[];
  nowMs: number;
}): string {
  const confidencePct = normalizeConfidencePct(input.confidence);
  const parsedReason = parsePredictionChangeReason(input.lastChangeReason);
  const updated = formatRelativeTime(input.lastUpdatedAt, input.nowMs);
  const tagsText = input.tags.length > 0 ? input.tags.slice(0, 5).join(", ") : "-";
  const move = Number.isFinite(Number(input.expectedMovePct))
    ? Number(input.expectedMovePct).toFixed(2)
    : "0.00";

  return [
    `${input.symbol} ${input.timeframe}`,
    `signal: ${input.signal} (${confidencePct.toFixed(1)}%)`,
    `move: ${move}%`,
    `updated: ${updated}`,
    `reason: ${parsedReason.raw ?? "n/a"}`,
    `change: ${parsedReason.lastChangeType ?? "n/a"}`,
    `tags: ${tagsText}`
  ].join(" | ");
}
