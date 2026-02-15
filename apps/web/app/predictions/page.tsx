"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import {
  buildTradeDeskPrefillPayload,
  TRADE_DESK_PREFILL_SESSION_KEY,
  type PredictionPrefillSource
} from "../../src/schemas/tradeDeskPrefill";
import {
  formatRelativeTime,
  isRecentTimestamp,
  parsePredictionChangeReason,
  type PredictionSignalFlip
} from "../../src/predictions/refreshUi";

type PredictionSignal = "up" | "down" | "neutral";
type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type DirectionPreference = "long" | "short" | "either";
type SortMode = "newest" | "confidence" | "move";
type RunningStatusFilter = "all" | "running" | "paused";
type SignalSource = "local" | "ai";
type CreateSignalMode = "local_only" | "ai_only" | "both";
type PredictionActionState = "ready" | "disagreement" | "below_target" | "neutral" | "no_account";

type AiPredictionSummary = {
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
};

type PublicAiPromptItem = {
  id: string;
  name: string;
  indicatorKeys: string[];
  timeframe: PredictionTimeframe | null;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  isPublic?: boolean;
  updatedAt: string | null;
};

type PublicAiPromptLicensePolicy = {
  mode: "off" | "warn" | "enforce";
  allowedPublicPromptIds: string[];
  enforcementActive: boolean;
};

type PublicCompositeStrategyItem = {
  id: string;
  name: string;
  description: string | null;
  version: string;
};

type PublicLocalStrategyItem = {
  id: string;
  strategyType: string;
  name: string;
  description: string | null;
  version: string;
  updatedAt: string | null;
};

type StrategyKind = "ai" | "local" | "composite";
type StrategyRef = {
  kind: StrategyKind;
  id: string;
  name: string | null;
};

type StrategyEntitlements = {
  plan: "free" | "pro" | "enterprise";
  allowedStrategyKinds: StrategyKind[];
  allowedStrategyIds: string[] | null;
  maxCompositeNodes: number;
  aiAllowedModels: string[] | null;
  aiMonthlyBudgetUsd: number | null;
  source: "db" | "plan_default";
};

type PredictionDefaultsResponse = {
  signalMode: CreateSignalMode;
};

type PredictionListItem = {
  id: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  tsCreated: string;
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
  explanation: string;
  tags: string[];
  autoScheduleEnabled?: boolean;
  confidenceTargetPct?: number;
  outcomeStatus?: string;
  outcomeResult?: string | null;
  outcomePnlPct?: number | null;
  maxFavorablePct?: number | null;
  maxAdversePct?: number | null;
  outcomeEvaluatedAt?: string | null;
  realizedReturnPct?: number | null;
  realizedEvaluatedAt?: string | null;
  realizedHit?: boolean | null;
  realizedAbsError?: number | null;
  realizedSqError?: number | null;
  exchange: string;
  accountId: string | null;
  lastUpdatedAt?: string | null;
  lastChangeReason?: string | null;
  signalMode?: CreateSignalMode;
  localPrediction?: AiPredictionSummary | null;
  aiPrediction?: AiPredictionSummary | null;
  aiPromptTemplateId?: string | null;
  aiPromptTemplateName?: string | null;
  localStrategyId?: string | null;
  localStrategyName?: string | null;
  compositeStrategyId?: string | null;
  compositeStrategyName?: string | null;
  strategyRef?: StrategyRef | null;
};

type PredictionEventItem = {
  id: string;
  stateId: string;
  tsCreated: string | null;
  changeType: string;
  reason: string | null;
  delta: Record<string, unknown> | null;
  prevSnapshot: unknown;
  newSnapshot: unknown;
  modelVersion: string | null;
};

type PredictionDetailResponse = PredictionPrefillSource & {
  id: string;
  expectedMovePct: number;
  featureSnapshot?: Record<string, unknown>;
  indicators?: {
    rsi_14?: number | null;
    macd?: { line?: number | null; signal?: number | null; hist?: number | null } | null;
    bb?: {
      upper?: number | null;
      mid?: number | null;
      lower?: number | null;
      width_pct?: number | null;
      pos?: number | null;
    } | null;
    vwap?: {
      value?: number | null;
      dist_pct?: number | null;
      mode?: "session_utc" | "rolling_20";
      sessionStartUtcMs?: number | null;
    } | null;
    adx?: { adx_14?: number | null; plus_di_14?: number | null; minus_di_14?: number | null } | null;
    stochrsi?: {
      rsi_len?: number | null;
      stoch_len?: number | null;
      smooth_k?: number | null;
      smooth_d?: number | null;
      k?: number | null;
      d?: number | null;
      value?: number | null;
    } | null;
    volume?: {
      lookback?: number | null;
      vol_z?: number | null;
      rel_vol?: number | null;
      vol_ema_fast?: number | null;
      vol_ema_slow?: number | null;
      vol_trend?: number | null;
    } | null;
    fvg?: {
      lookback?: number | null;
      fill_rule?: "overlap" | "mid_touch";
      open_bullish_count?: number | null;
      open_bearish_count?: number | null;
      nearest_bullish_gap?: {
        upper?: number | null;
        lower?: number | null;
        mid?: number | null;
        dist_pct?: number | null;
        age_bars?: number | null;
      } | null;
      nearest_bearish_gap?: {
        upper?: number | null;
        lower?: number | null;
        mid?: number | null;
        dist_pct?: number | null;
        age_bars?: number | null;
      } | null;
      last_created?: {
        type?: "bullish" | "bearish" | null;
        age_bars?: number | null;
      } | null;
      last_filled?: {
        type?: "bullish" | "bearish" | null;
        age_bars?: number | null;
      } | null;
    } | null;
    atr_pct?: number | null;
    dataGap?: boolean;
  } | null;
  riskFlags?: {
    dataGap?: boolean;
  } | null;
  realized?: {
    realizedReturnPct: number | null;
    evaluatedAt: string | null;
    errorMetrics: Record<string, unknown> | null;
  } | null;
  events?: PredictionEventItem[];
};

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
};

type SymbolItem = {
  symbol: string;
  tradable: boolean;
};

type RunningPredictionItem = {
  id: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string;
  exchange: string;
  label: string;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  leverage: number | null;
  signalMode: CreateSignalMode;
  aiPromptTemplateId?: string | null;
  aiPromptTemplateName?: string | null;
  localStrategyId?: string | null;
  localStrategyName?: string | null;
  compositeStrategyId?: string | null;
  compositeStrategyName?: string | null;
  strategyRef?: StrategyRef | null;
  paused: boolean;
  tsCreated: string;
  nextRunAt: string;
  dueInSec: number;
};

type PredictionQualitySummary = {
  sampleSize: number;
  tp: number;
  sl: number;
  expired: number;
  skipped: number;
  invalid: number;
  winRatePct: number | null;
  avgOutcomePnlPct: number | null;
};

type PredictionMetricsResponse = {
  timeframe: PredictionTimeframe | null;
  symbol: string | null;
  from: string | null;
  to: string | null;
  bins: number;
  evaluatedCount: number;
  hitRate: number | null;
  mae: number | null;
  mse: number | null;
  calibrationBins: Array<{
    binFrom: number;
    binTo: number;
    avgConf: number | null;
    accuracy: number | null;
    n: number;
  }>;
};

const TIMEFRAMES: PredictionTimeframe[] = ["5m", "15m", "1h", "4h", "1d"];

function timeframeMs(value: PredictionTimeframe): number {
  if (value === "5m") return 5 * 60 * 1000;
  if (value === "15m") return 15 * 60 * 1000;
  if (value === "1h") return 60 * 60 * 1000;
  if (value === "4h") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function fmtMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function nextAutoRunText(
  row: Pick<PredictionListItem, "autoScheduleEnabled" | "timeframe" | "tsCreated">,
  nowMs: number,
  labels: {
    disabled: string;
    unknown: string;
    dueNow: string;
    inPrefix: string;
  } = {
    disabled: "disabled",
    unknown: "unknown",
    dueNow: "due now",
    inPrefix: "in"
  }
): string {
  if (!row.autoScheduleEnabled) return labels.disabled;
  const ts = new Date(row.tsCreated).getTime();
  if (!Number.isFinite(ts)) return labels.unknown;
  const dueAt = ts + timeframeMs(row.timeframe);
  const diff = dueAt - nowMs;
  if (diff <= 0) return labels.dueNow;
  return `${labels.inPrefix} ${fmtMs(diff)}`;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function fmtConfidence(value: number): string {
  const normalized = value <= 1 ? value * 100 : value;
  const clamped = Math.max(0, Math.min(100, normalized));
  return `${clamped.toFixed(1)}%`;
}

function confidenceToPct(value: number): number {
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

function signalBadgeStyle(signal: PredictionSignal) {
  if (signal === "up") return { borderColor: "#10b981", color: "#10b981" };
  if (signal === "down") return { borderColor: "#ef4444", color: "#ef4444" };
  return { borderColor: "#94a3b8", color: "#94a3b8" };
}

function outcomeLabel(outcomeStatus?: string, outcomeResult?: string | null): string {
  if (outcomeStatus !== "closed") return "pending";
  if (!outcomeResult) return "closed";
  return outcomeResult;
}

function toNum(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readAiPrediction(value: unknown): AiPredictionSummary | null {
  const raw = asRecord(value);
  const signal =
    raw.signal === "up" || raw.signal === "down" || raw.signal === "neutral"
      ? raw.signal
      : null;
  const expectedMoveRaw = toNum(raw.expectedMovePct);
  const confidenceRaw = toNum(raw.confidence);
  if (!signal || expectedMoveRaw === null || confidenceRaw === null) return null;
  const normalizedConfidence = confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100;
  return {
    signal,
    expectedMovePct: Math.max(0, Math.min(25, Math.abs(expectedMoveRaw))),
    confidence: Math.max(0, Math.min(1, normalizedConfidence))
  };
}

function resolveSignal(row: PredictionListItem, source: SignalSource): PredictionSignal {
  if (source === "local" && row.localPrediction) return row.localPrediction.signal;
  if (source === "ai" && row.aiPrediction) return row.aiPrediction.signal;
  return row.signal;
}

function resolveConfidence(row: PredictionListItem, source: SignalSource): number {
  if (source === "local" && row.localPrediction) return row.localPrediction.confidence;
  if (source === "ai" && row.aiPrediction) return row.aiPrediction.confidence;
  return row.confidence;
}

function resolveExpectedMove(row: PredictionListItem, source: SignalSource): number {
  if (source === "local" && row.localPrediction) return row.localPrediction.expectedMovePct;
  if (source === "ai" && row.aiPrediction) return row.aiPrediction.expectedMovePct;
  return row.expectedMovePct;
}

function signalModeLabel(
  mode: CreateSignalMode | undefined,
  labels: {
    localOnly: string;
    aiOnly: string;
    both: string;
  } = {
    localOnly: "local only",
    aiOnly: "ai only",
    both: "both"
  }
): string {
  if (mode === "local_only") return labels.localOnly;
  if (mode === "ai_only") return labels.aiOnly;
  return labels.both;
}

function normalizeStrategyRef(value: unknown): StrategyRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind =
    raw.kind === "ai" || raw.kind === "local" || raw.kind === "composite"
      ? raw.kind
      : null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : null;
  if (!kind || !id) return null;
  return { kind, id, name };
}

function strategyKindLabel(kind: StrategyKind): string {
  if (kind === "ai") return "AI";
  if (kind === "local") return "Local";
  return "Composite";
}

function strategyRefLabel(
  strategyRef: StrategyRef | null | undefined,
  fallback: {
    aiPromptTemplateName?: string | null;
    localStrategyName?: string | null;
    compositeStrategyName?: string | null;
  } = {}
): string {
  if (!strategyRef) {
    if (fallback.compositeStrategyName) return `Composite · ${fallback.compositeStrategyName}`;
    if (fallback.localStrategyName) return `Local · ${fallback.localStrategyName}`;
    if (fallback.aiPromptTemplateName) return `AI · ${fallback.aiPromptTemplateName}`;
    return "AI · System default prompt";
  }
  const name = strategyRef.name ?? strategyRef.id;
  return `${strategyKindLabel(strategyRef.kind)} · ${name}`;
}

function encodeStrategySelectValue(strategy: StrategyRef | null): string {
  if (!strategy) return "ai:default";
  return `${strategy.kind}:${strategy.id}`;
}

function decodeStrategySelectValue(value: string): StrategyRef | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "ai:default") return null;
  const idx = trimmed.indexOf(":");
  if (idx <= 0) return null;
  const kind = trimmed.slice(0, idx);
  const id = trimmed.slice(idx + 1).trim();
  if (!id) return null;
  if (kind !== "ai" && kind !== "local" && kind !== "composite") return null;
  return { kind, id, name: null };
}

function strategyKindFromSelectValue(value: string): StrategyKind | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("ai:")) return "ai";
  if (trimmed.startsWith("local:")) return "local";
  if (trimmed.startsWith("composite:")) return "composite";
  return null;
}

function forcedSignalModeForStrategyKind(kind: StrategyKind | null): CreateSignalMode | null {
  if (kind === "local") return "local_only";
  if (kind === "ai") return "ai_only";
  return null;
}

function isStrategyAllowedByEntitlements(
  entitlements: StrategyEntitlements | null,
  kind: StrategyKind,
  id: string | null
): boolean {
  if (!entitlements) return true;
  if (!entitlements.allowedStrategyKinds.includes(kind)) return false;
  const allowlist = entitlements.allowedStrategyIds;
  if (!allowlist) return true;
  if (!id) {
    return allowlist.some((entry) => {
      const normalized = entry.trim().toLowerCase();
      return normalized === "*" || normalized === `${kind}:*` || normalized === `${kind}:default`;
    });
  }
  const normalizedId = id.trim().toLowerCase();
  return allowlist.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    return (
      normalized === "*" ||
      normalized === normalizedId ||
      normalized === `${kind}:*` ||
      normalized === `${kind}:${normalizedId}`
    );
  });
}

function canSendToDesk(row: PredictionListItem, source: SignalSource): boolean {
  if (!row.accountId) return false;
  const signal = resolveSignal(row, source);
  if (signal === "neutral") return false;
  const confidencePct = confidenceToPct(resolveConfidence(row, source));
  const targetPct =
    typeof row.confidenceTargetPct === "number" && Number.isFinite(row.confidenceTargetPct)
      ? Math.max(0, Math.min(100, row.confidenceTargetPct))
      : 0;
  return confidencePct >= targetPct;
}

function resolvePredictionActionState(
  row: PredictionListItem,
  source: SignalSource,
  labels: {
    noAccount: string;
    noTradeSetup: string;
    belowConfidenceTarget: string;
    localAiDisagreement: string;
    readyToSend: string;
  } = {
    noAccount: "No account",
    noTradeSetup: "No trade setup",
    belowConfidenceTarget: "Below confidence target",
    localAiDisagreement: "Local/AI disagreement",
    readyToSend: "Ready to send"
  }
): { state: PredictionActionState; label: string; canSend: boolean } {
  const targetPct =
    typeof row.confidenceTargetPct === "number" && Number.isFinite(row.confidenceTargetPct)
      ? Math.max(0, Math.min(100, row.confidenceTargetPct))
      : 0;
  const signal = resolveSignal(row, source);
  const confidencePct = confidenceToPct(resolveConfidence(row, source));
  const localSignal = row.localPrediction?.signal ?? row.signal;
  const aiDisagrees = Boolean(row.aiPrediction) && row.aiPrediction!.signal !== localSignal;
  const canSend = canSendToDesk(row, source);

  if (!row.accountId) return { state: "no_account", label: labels.noAccount, canSend };
  if (signal === "neutral") return { state: "neutral", label: labels.noTradeSetup, canSend };
  if (confidencePct < targetPct) {
    return {
      state: "below_target",
      label: `${labels.belowConfidenceTarget} (${targetPct.toFixed(0)}%)`,
      canSend
    };
  }
  if (aiDisagrees) return { state: "disagreement", label: labels.localAiDisagreement, canSend };
  return { state: "ready", label: labels.readyToSend, canSend };
}

function rowStateClass(state: PredictionActionState): string {
  if (state === "ready") return "predictionRowStateReady";
  if (state === "disagreement" || state === "below_target") return "predictionRowStateWarn";
  return "predictionRowStateBlocked";
}

function mobileCardStateClass(state: PredictionActionState): string {
  if (state === "ready") return "predictionRowCardStateReady";
  if (state === "disagreement" || state === "below_target") return "predictionRowCardStateWarn";
  return "predictionRowCardStateBlocked";
}

function actionStateBadgeClass(state: PredictionActionState): string {
  if (state === "ready") return "predictionActionBadgeReady";
  if (state === "disagreement" || state === "below_target") return "predictionActionBadgeWarn";
  return "predictionActionBadgeBlocked";
}

type PredictionAlertTone = "error" | "warning";

function PredictionAlert(props: {
  title: string;
  message: string;
  tone: PredictionAlertTone;
}) {
  const toneClass = props.tone === "error" ? "predictionAlertError" : "predictionAlertWarn";
  return (
    <div className={`card predictionAlert ${toneClass}`} role={props.tone === "error" ? "alert" : "status"}>
      <strong>{props.title}:</strong> {props.message}
    </div>
  );
}

function fmtNum(value: unknown, decimals = 2): string {
  const parsed = toNum(value);
  if (parsed === null) return "n/a";
  return parsed.toFixed(decimals);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readHitValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "hit") return true;
    if (normalized === "false" || normalized === "0" || normalized === "miss") return false;
  }
  return null;
}

function summarizeEventDelta(delta: Record<string, unknown> | null): string {
  if (!delta || typeof delta !== "object") return "No delta data";
  const parts: string[] = [];

  const signal = typeof delta.signal === "string" ? delta.signal : null;
  if (signal) parts.push(`signal ${signal}`);

  const confidenceDelta = toNum(delta.confidenceDelta);
  if (confidenceDelta !== null) {
    const sign = confidenceDelta >= 0 ? "+" : "";
    parts.push(`confidence ${sign}${confidenceDelta.toFixed(2)}`);
  }

  const tagsAdded = Array.isArray(delta.tagsAdded)
    ? delta.tagsAdded.map((item) => String(item)).filter(Boolean)
    : [];
  if (tagsAdded.length > 0) parts.push(`+${tagsAdded.join(", ")}`);

  const tagsRemoved = Array.isArray(delta.tagsRemoved)
    ? delta.tagsRemoved.map((item) => String(item)).filter(Boolean)
    : [];
  if (tagsRemoved.length > 0) parts.push(`-${tagsRemoved.join(", ")}`);

  if (parts.length === 0) return "No delta data";
  return parts.join(" | ");
}

function formatFlipLabel(flip: PredictionSignalFlip | null): string {
  if (!flip) return "FLIP";
  return `${flip.from.toUpperCase()}->${flip.to.toUpperCase()}`;
}

function describeManualReason(params: {
  parsedReason: ReturnType<typeof parsePredictionChangeReason>;
  autoEnabled: boolean;
}): { label: string; shortReason: string; rawReason: string | null } {
  if (params.parsedReason.kind !== "manual") {
    return {
      label: params.parsedReason.label,
      shortReason: params.parsedReason.shortReason,
      rawReason: params.parsedReason.raw
    };
  }

  if (params.autoEnabled) {
    return {
      label: "Manual",
      shortReason: "manual (waiting for first auto refresh)",
      rawReason: "manual_waiting_first_auto_refresh"
    };
  }

  return {
    label: "Manual",
    shortReason: "manual (one-off)",
    rawReason: "manual_one_off"
  };
}

export default function PredictionsPage() {
  const tPred = useTranslations("predictions");
  const locale = useLocale() as AppLocale;
  const router = useRouter();

  const modeLabels = useMemo(
    () => ({
      localOnly: tPred("modes.localOnly"),
      aiOnly: tPred("modes.aiOnly"),
      both: tPred("modes.both")
    }),
    [tPred]
  );
  const nextRunLabels = useMemo(
    () => ({
      disabled: tPred("misc.disabled"),
      unknown: tPred("misc.unknown"),
      dueNow: tPred("running.dueNow"),
      inPrefix: tPred("running.inPrefix")
    }),
    [tPred]
  );
  const actionStateLabels = useMemo(
    () => ({
      noAccount: tPred("feed.actionStates.noAccount"),
      noTradeSetup: tPred("feed.actionStates.noTradeSetup"),
      belowConfidenceTarget: tPred("feed.actionStates.belowConfidenceTarget"),
      localAiDisagreement: tPred("feed.actionStates.localAiDisagreement"),
      readyToSend: tPred("feed.actionStates.readyToSend")
    }),
    [tPred]
  );

  const [rows, setRows] = useState<PredictionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<PredictionQualitySummary | null>(null);
  const [metrics, setMetrics] = useState<PredictionMetricsResponse | null>(null);
  const [runningRows, setRunningRows] = useState<RunningPredictionItem[]>([]);
  const [runningLoading, setRunningLoading] = useState(true);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [runningStatusFilter, setRunningStatusFilter] = useState<RunningStatusFilter>("all");

  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [createAccountId, setCreateAccountId] = useState("");
  const [createSymbols, setCreateSymbols] = useState<SymbolItem[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);

  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterSignal, setFilterSignal] = useState<PredictionSignal | "all">("all");
  const [filterTimeframe, setFilterTimeframe] = useState<PredictionTimeframe | "all">("all");
  const [signalSource, setSignalSource] = useState<SignalSource>("local");
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const [newSymbol, setNewSymbol] = useState("BTCUSDT");
  const [newMarketType, setNewMarketType] = useState<PredictionMarketType>("perp");
  const [newTimeframe, setNewTimeframe] = useState<PredictionTimeframe>("15m");
  const [publicAiPrompts, setPublicAiPrompts] = useState<PublicAiPromptItem[]>([]);
  const [publicAiPromptsLoading, setPublicAiPromptsLoading] = useState(false);
  const [publicAiPromptLicensePolicy, setPublicAiPromptLicensePolicy] = useState<PublicAiPromptLicensePolicy | null>(null);
  const [strategyEntitlements, setStrategyEntitlements] = useState<StrategyEntitlements | null>(null);
  const [localStrategies, setLocalStrategies] = useState<PublicLocalStrategyItem[]>([]);
  const [localStrategiesLoading, setLocalStrategiesLoading] = useState(false);
  const [compositeStrategies, setCompositeStrategies] = useState<PublicCompositeStrategyItem[]>([]);
  const [compositeStrategiesLoading, setCompositeStrategiesLoading] = useState(false);
  const [predictionDefaults, setPredictionDefaults] = useState<PredictionDefaultsResponse | null>(null);
  const [newStrategySelectValue, setNewStrategySelectValue] = useState("ai:default");
  const [newLeverage, setNewLeverage] = useState("10");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, PredictionDetailResponse>>({});
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [eventsByStateId, setEventsByStateId] = useState<Record<string, PredictionEventItem[]>>({});
  const [eventsLoadingStateId, setEventsLoadingStateId] = useState<string | null>(null);
  const [eventsErrorByStateId, setEventsErrorByStateId] = useState<Record<string, string | null>>({});
  const [expandedEventsByStateId, setExpandedEventsByStateId] = useState<Record<string, boolean>>({});

  async function loadPredictions() {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<{ items: PredictionListItem[] }>("/api/predictions?limit=100");
      setRows(
        Array.isArray(payload.items)
          ? payload.items.map((row) => ({
              ...row,
              localPrediction: readAiPrediction((row as Record<string, unknown>).localPrediction),
              aiPrediction: readAiPrediction((row as Record<string, unknown>).aiPrediction),
              strategyRef: normalizeStrategyRef((row as Record<string, unknown>).strategyRef)
            }))
          : []
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadRunningPredictions() {
    setRunningLoading(true);
    try {
      const payload = await apiGet<{ items: RunningPredictionItem[] }>("/api/predictions/running");
      setRunningRows(
        Array.isArray(payload.items)
          ? payload.items.map((row) => ({
              ...row,
              strategyRef: normalizeStrategyRef((row as Record<string, unknown>).strategyRef)
            }))
          : []
      );
    } catch {
      setRunningRows([]);
    } finally {
      setRunningLoading(false);
    }
  }

  async function loadPredictionQuality() {
    try {
      const payload = await apiGet<PredictionQualitySummary>("/api/predictions/quality");
      setQuality(payload);
    } catch {
      setQuality(null);
    }
  }

  async function loadPredictionMetrics() {
    try {
      const payload = await apiGet<PredictionMetricsResponse>("/api/predictions/metrics?bins=10");
      setMetrics(payload);
    } catch {
      setMetrics(null);
    }
  }

  async function loadAccounts() {
    try {
      const payload = await apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts");
      const list = Array.isArray(payload.items) ? payload.items : [];
      setAccounts(list);

      if (list.length === 0) {
        setCreateAccountId("");
        return;
      }

      setCreateAccountId((prev) => {
        if (prev && list.some((row) => row.id === prev)) return prev;
        return list[0].id;
      });
    } catch {
      setAccounts([]);
      setCreateAccountId("");
    }
  }

  async function loadPublicAiPrompts() {
    setPublicAiPromptsLoading(true);
    try {
      const payload = await apiGet<{
        items: PublicAiPromptItem[];
        licensePolicy?: PublicAiPromptLicensePolicy;
        strategyEntitlements?: StrategyEntitlements;
      }>("/settings/ai-prompts/public");
      const items = Array.isArray(payload.items) ? payload.items : [];
      setPublicAiPrompts(items);
      setPublicAiPromptLicensePolicy(payload.licensePolicy ?? null);
      if (payload.strategyEntitlements) {
        setStrategyEntitlements(payload.strategyEntitlements);
      }
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        if (!selected) return prev;
        if (selected.kind !== "ai") return prev;
        return items.some((item) => item.id === selected.id) ? prev : "ai:default";
      });
    } catch {
      setPublicAiPrompts([]);
      setPublicAiPromptLicensePolicy(null);
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        return selected?.kind === "ai" ? "ai:default" : prev;
      });
    } finally {
      setPublicAiPromptsLoading(false);
    }
  }

  async function loadPredictionDefaults() {
    try {
      const payload = await apiGet<PredictionDefaultsResponse>("/settings/prediction-defaults");
      setPredictionDefaults(payload);
    } catch {
      setPredictionDefaults(null);
    }
  }

  async function loadStrategyEntitlements() {
    try {
      const payload = await apiGet<{ entitlements: StrategyEntitlements }>("/settings/strategy-entitlements");
      setStrategyEntitlements(payload.entitlements ?? null);
    } catch {
      setStrategyEntitlements(null);
    }
  }

  async function loadLocalStrategies() {
    setLocalStrategiesLoading(true);
    try {
      const payload = await apiGet<{
        items: PublicLocalStrategyItem[];
        strategyEntitlements?: StrategyEntitlements;
      }>("/settings/local-strategies");
      const items = Array.isArray(payload.items) ? payload.items : [];
      setLocalStrategies(items);
      if (payload.strategyEntitlements) {
        setStrategyEntitlements(payload.strategyEntitlements);
      }
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        if (!selected) return prev;
        if (selected.kind !== "local") return prev;
        return items.some((item) => item.id === selected.id) ? prev : "ai:default";
      });
    } catch {
      setLocalStrategies([]);
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        return selected?.kind === "local" ? "ai:default" : prev;
      });
    } finally {
      setLocalStrategiesLoading(false);
    }
  }

  async function loadCompositeStrategies() {
    setCompositeStrategiesLoading(true);
    try {
      const payload = await apiGet<{
        items: PublicCompositeStrategyItem[];
        strategyEntitlements?: StrategyEntitlements;
      }>("/settings/composite-strategies");
      const items = Array.isArray(payload.items) ? payload.items : [];
      setCompositeStrategies(items);
      if (payload.strategyEntitlements) {
        setStrategyEntitlements(payload.strategyEntitlements);
      }
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        if (!selected) return prev;
        if (selected.kind !== "composite") return prev;
        return items.some((item) => item.id === selected.id) ? prev : "ai:default";
      });
    } catch {
      setCompositeStrategies([]);
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        return selected?.kind === "composite" ? "ai:default" : prev;
      });
    } finally {
      setCompositeStrategiesLoading(false);
    }
  }

  async function loadSymbolsForAccount(exchangeAccountId: string) {
    setSymbolsLoading(true);
    setSymbolsError(null);
    try {
      const payload = await apiGet<{ items: SymbolItem[] }>(
        `/api/symbols?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}`
      );
      const list = Array.isArray(payload.items) ? payload.items : [];
      setCreateSymbols(list);

      if (list.length > 0) {
        const hasCurrent = list.some((row) => row.symbol === newSymbol);
        if (!hasCurrent) {
          const preferred = list.find((row) => row.tradable) ?? list[0];
          if (preferred?.symbol) setNewSymbol(preferred.symbol);
        }
      }
    } catch (e) {
      setCreateSymbols([]);
      setSymbolsError(errMsg(e));
    } finally {
      setSymbolsLoading(false);
    }
  }

  useEffect(() => {
    void loadPredictions();
    void loadRunningPredictions();
    void loadPredictionQuality();
    void loadPredictionMetrics();
    void loadAccounts();
    void loadPublicAiPrompts();
    void loadStrategyEntitlements();
    void loadLocalStrategies();
    void loadCompositeStrategies();
    void loadPredictionDefaults();
  }, []);

  useEffect(() => {
    if (!createAccountId) {
      setCreateSymbols([]);
      return;
    }
    void loadSymbolsForAccount(createAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAccountId]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const selectedStrategyRef = useMemo(
    () => decodeStrategySelectValue(newStrategySelectValue),
    [newStrategySelectValue]
  );
  const selectedPrompt = useMemo(
    () =>
      selectedStrategyRef?.kind === "ai"
        ? publicAiPrompts.find((item) => item.id === selectedStrategyRef.id) ?? null
        : null,
    [selectedStrategyRef, publicAiPrompts]
  );
  const selectedLocalStrategy = useMemo(
    () =>
      selectedStrategyRef?.kind === "local"
        ? localStrategies.find((item) => item.id === selectedStrategyRef.id) ?? null
        : null,
    [selectedStrategyRef, localStrategies]
  );
  const selectedCompositeStrategy = useMemo(
    () =>
      selectedStrategyRef?.kind === "composite"
        ? compositeStrategies.find((item) => item.id === selectedStrategyRef.id) ?? null
        : null,
    [selectedStrategyRef, compositeStrategies]
  );
  const allowedAiPrompts = useMemo(
    () =>
      publicAiPrompts.filter((item) =>
        isStrategyAllowedByEntitlements(strategyEntitlements, "ai", item.id)
      ),
    [publicAiPrompts, strategyEntitlements]
  );
  const allowedLocalStrategies = useMemo(
    () =>
      localStrategies.filter((item) =>
        isStrategyAllowedByEntitlements(strategyEntitlements, "local", item.id)
      ),
    [localStrategies, strategyEntitlements]
  );
  const allowedCompositeStrategies = useMemo(
    () =>
      compositeStrategies.filter((item) =>
        isStrategyAllowedByEntitlements(strategyEntitlements, "composite", item.id)
      ),
    [compositeStrategies, strategyEntitlements]
  );
  const aiDefaultAllowed = useMemo(
    () => isStrategyAllowedByEntitlements(strategyEntitlements, "ai", "default"),
    [strategyEntitlements]
  );
  const aiKindAllowed = useMemo(
    () => isStrategyAllowedByEntitlements(strategyEntitlements, "ai", null),
    [strategyEntitlements]
  );
  const localKindAllowed = useMemo(
    () => isStrategyAllowedByEntitlements(strategyEntitlements, "local", null),
    [strategyEntitlements]
  );
  const compositeKindAllowed = useMemo(
    () => isStrategyAllowedByEntitlements(strategyEntitlements, "composite", null),
    [strategyEntitlements]
  );
  const selectedStrategyKind = useMemo(
    () => strategyKindFromSelectValue(newStrategySelectValue),
    [newStrategySelectValue]
  );
  const forcedCreateSignalMode = useMemo(
    () => forcedSignalModeForStrategyKind(selectedStrategyKind),
    [selectedStrategyKind]
  );
  const effectiveCreateSignalMode = forcedCreateSignalMode ?? predictionDefaults?.signalMode ?? "both";
  const selectedPromptLockedTimeframe = selectedPrompt?.timeframe ?? null;
  const effectiveCreateTimeframe = selectedPromptLockedTimeframe ?? newTimeframe;

  useEffect(() => {
    const selected = decodeStrategySelectValue(newStrategySelectValue);
    const selectedAllowed = selected
      ? isStrategyAllowedByEntitlements(strategyEntitlements, selected.kind, selected.id)
      : aiDefaultAllowed;
    if (selectedAllowed) return;

    if (allowedLocalStrategies.length > 0) {
      setNewStrategySelectValue(
        encodeStrategySelectValue({
          kind: "local",
          id: allowedLocalStrategies[0].id,
          name: allowedLocalStrategies[0].name
        })
      );
      return;
    }
    if (allowedCompositeStrategies.length > 0) {
      setNewStrategySelectValue(
        encodeStrategySelectValue({
          kind: "composite",
          id: allowedCompositeStrategies[0].id,
          name: allowedCompositeStrategies[0].name
        })
      );
      return;
    }
    if (allowedAiPrompts.length > 0) {
      setNewStrategySelectValue(
        encodeStrategySelectValue({
          kind: "ai",
          id: allowedAiPrompts[0].id,
          name: allowedAiPrompts[0].name
        })
      );
      return;
    }
    setNewStrategySelectValue("ai:default");
  }, [
    aiDefaultAllowed,
    allowedAiPrompts,
    allowedCompositeStrategies,
    allowedLocalStrategies,
    newStrategySelectValue,
    strategyEntitlements
  ]);

  useEffect(() => {
    if (selectedPromptLockedTimeframe && newTimeframe !== selectedPromptLockedTimeframe) {
      setNewTimeframe(selectedPromptLockedTimeframe);
    }
  }, [newTimeframe, selectedPromptLockedTimeframe]);

  const filteredRows = useMemo(() => {
    const symbolSearch = filterSymbol.trim().toUpperCase();

    const next = rows.filter((row) => {
      if (symbolSearch && !row.symbol.toUpperCase().includes(symbolSearch)) return false;
      if (filterSignal !== "all" && resolveSignal(row, signalSource) !== filterSignal) return false;
      if (filterTimeframe !== "all" && row.timeframe !== filterTimeframe) return false;
      return true;
    });

    next.sort((a, b) => {
      if (sortMode === "confidence") {
        return (
          (resolveConfidence(b, signalSource) <= 1
            ? resolveConfidence(b, signalSource) * 100
            : resolveConfidence(b, signalSource)) -
          (resolveConfidence(a, signalSource) <= 1
            ? resolveConfidence(a, signalSource) * 100
            : resolveConfidence(a, signalSource))
        );
      }
      if (sortMode === "move") {
        return Math.abs(resolveExpectedMove(b, signalSource)) - Math.abs(resolveExpectedMove(a, signalSource));
      }
      return new Date(b.tsCreated).getTime() - new Date(a.tsCreated).getTime();
    });

    return next;
  }, [filterSignal, filterSymbol, filterTimeframe, rows, signalSource, sortMode]);

  const filteredRunningRows = useMemo(() => {
    if (runningStatusFilter === "all") return runningRows;
    return runningRows.filter((row) =>
      runningStatusFilter === "paused" ? row.paused : !row.paused
    );
  }, [runningRows, runningStatusFilter]);

  const actionableRowsCount = useMemo(
    () => filteredRows.filter((row) => canSendToDesk(row, signalSource)).length,
    [filteredRows, signalSource]
  );
  const autoEnabledRowsCount = useMemo(
    () => filteredRows.filter((row) => Boolean(row.autoScheduleEnabled)).length,
    [filteredRows]
  );
  const aiDisagreementRowsCount = useMemo(
    () =>
      filteredRows.filter((row) => {
        const localSignal = row.localPrediction?.signal ?? row.signal;
        return Boolean(row.aiPrediction) && row.aiPrediction!.signal !== localSignal;
      }).length,
    [filteredRows]
  );
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterSymbol.trim()) count += 1;
    if (filterSignal !== "all") count += 1;
    if (filterTimeframe !== "all") count += 1;
    if (signalSource !== "local") count += 1;
    if (sortMode !== "newest") count += 1;
    return count;
  }, [filterSignal, filterSymbol, filterTimeframe, signalSource, sortMode]);

  async function sendToDesk(id: string) {
    setActionError(null);
    setNotice(null);
    setSendingId(id);
    try {
      const detail = await apiGet<PredictionDetailResponse>(`/api/predictions/${id}`);
      const row = rows.find((item) => item.id === id);
      const localPrediction =
        row?.localPrediction ?? readAiPrediction(asRecord(detail.featureSnapshot).localPrediction);
      const aiPrediction =
        row?.aiPrediction ?? readAiPrediction(asRecord(detail.featureSnapshot).aiPrediction);
      if (!detail.accountId) {
        throw new Error("No exchange account available for this prediction.");
      }
      const detailForPrefill: PredictionDetailResponse =
        signalSource === "ai" && aiPrediction
          ? {
              ...detail,
              signal: aiPrediction.signal,
              confidence: aiPrediction.confidence,
              expectedMovePct: aiPrediction.expectedMovePct
            }
          : signalSource === "local" && localPrediction
            ? {
                ...detail,
                signal: localPrediction.signal,
                confidence: localPrediction.confidence,
                expectedMovePct: localPrediction.expectedMovePct
              }
          : detail;
      const built = buildTradeDeskPrefillPayload(detailForPrefill);
      sessionStorage.setItem(TRADE_DESK_PREFILL_SESSION_KEY, JSON.stringify(built.payload));
      if (built.info) {
        setNotice(built.info);
      }
      const params = new URLSearchParams({
        prefill: "1",
        exchangeAccountId: built.payload.accountId
      });
      router.push(`${withLocalePath("/trading-desk", locale)}?${params.toString()}`);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setSendingId(null);
    }
  }

  async function togglePredictionDetail(id: string) {
    setDetailsError(null);
    if (expandedDetailId === id) {
      setExpandedDetailId(null);
      return;
    }

    setExpandedDetailId(id);
    if (detailsById[id]) return;

    setDetailsLoadingId(id);
    try {
      const detail = await apiGet<PredictionDetailResponse>(`/api/predictions/${id}`);
      setDetailsById((prev) => ({ ...prev, [id]: detail }));
    } catch (e) {
      setDetailsError(errMsg(e));
    } finally {
      setDetailsLoadingId(null);
    }
  }

  async function loadPredictionEvents(stateId: string) {
    if (eventsByStateId[stateId]) return;
    setEventsLoadingStateId(stateId);
    setEventsErrorByStateId((prev) => ({ ...prev, [stateId]: null }));
    try {
      const payload = await apiGet<{ items: PredictionEventItem[] }>(
        `/api/predictions/events?stateId=${encodeURIComponent(stateId)}&limit=10`
      );
      setEventsByStateId((prev) => ({
        ...prev,
        [stateId]: Array.isArray(payload.items) ? payload.items : []
      }));
    } catch {
      setEventsErrorByStateId((prev) => ({
        ...prev,
        [stateId]: tPred("create.eventsLoadFailed")
      }));
    } finally {
      setEventsLoadingStateId(null);
    }
  }

  function toggleEventLog(stateId: string) {
    const nextExpanded = !expandedEventsByStateId[stateId];
    setExpandedEventsByStateId((prev) => ({ ...prev, [stateId]: nextExpanded }));
    if (nextExpanded) {
      void loadPredictionEvents(stateId);
    }
  }

  async function createPrediction() {
    setActionError(null);
    setNotice(null);

    const symbol = newSymbol.trim().toUpperCase();
    const leverage = Number(newLeverage);

    if (!createAccountId) {
      setActionError(tPred("create.validationSelectExchangeAccount"));
      return;
    }
    if (!symbol) {
      setActionError(tPred("create.validationSelectPair"));
      return;
    }
    if (newMarketType === "perp" && (!Number.isFinite(leverage) || leverage < 1 || leverage > 125)) {
      setActionError(tPred("create.validationLeverageRange"));
      return;
    }

    setCreating(true);
    try {
      const response = await apiPost<{
        prediction: {
          signal: PredictionSignal;
          confidence: number;
          expectedMovePct: number;
          timeframe: PredictionTimeframe;
        };
        directionPreference: DirectionPreference;
        confidenceTargetPct: number;
        signalSource: SignalSource;
        signalMode: CreateSignalMode;
        aiPromptTemplateId?: string | null;
        aiPromptTemplateName?: string | null;
        localStrategyId?: string | null;
        localStrategyName?: string | null;
        compositeStrategyId?: string | null;
        compositeStrategyName?: string | null;
        strategyRef?: StrategyRef | null;
      }>("/api/predictions/generate-auto", {
        exchangeAccountId: createAccountId,
        symbol,
        marketType: newMarketType,
        timeframe: effectiveCreateTimeframe,
        strategyRef: selectedStrategyRef ?? undefined,
        aiPromptTemplateId: selectedStrategyRef?.kind === "ai" ? selectedStrategyRef.id : undefined,
        compositeStrategyId: selectedStrategyRef?.kind === "composite" ? selectedStrategyRef.id : undefined,
        leverage: newMarketType === "perp" ? Math.trunc(leverage) : undefined
      });
      const modeLabel =
        response.signalMode === "local_only"
          ? tPred("modes.localOnly")
          : response.signalMode === "ai_only"
            ? tPred("modes.aiOnly")
            : tPred("modes.both");

      setNotice(
        tPred("create.createdNotice", {
          symbol,
          timeframe: response.prediction.timeframe,
          signal: response.prediction.signal,
          confidence: fmtConfidence(response.prediction.confidence),
          modeLabel,
          source: response.signalSource.toUpperCase(),
          strategy: strategyRefLabel(response.strategyRef, {
            aiPromptTemplateName: response.aiPromptTemplateName,
            localStrategyName: response.localStrategyName,
            compositeStrategyName: response.compositeStrategyName
          }),
          direction: response.directionPreference,
          target: response.confidenceTargetPct.toFixed(0)
        })
      );
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionMetrics()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setCreating(false);
    }
  }

  async function togglePausePrediction(row: RunningPredictionItem) {
    setActionError(null);
    setNotice(null);
    setRunningActionId(row.id);
    try {
      const nextPaused = !row.paused;
      const response = await apiPost<{ updatedCount: number; paused: boolean }>(
        `/api/predictions/${row.id}/pause`,
        { paused: nextPaused }
      );
      setNotice(
        response.paused
          ? tPred("running.pausedNotice", { count: response.updatedCount })
          : tPred("running.resumedNotice", { count: response.updatedCount })
      );
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionMetrics()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setRunningActionId(null);
    }
  }

  async function deleteRunningPrediction(id: string) {
    const confirmed = window.confirm(
      tPred("running.confirmDelete")
    );
    if (!confirmed) return;

    setActionError(null);
    setNotice(null);
    setRunningActionId(id);
    try {
      const response = await apiPost<{ deletedCount: number }>(`/api/predictions/${id}/delete-schedule`, {});
      setNotice(tPred("running.deletedNotice", { count: response.deletedCount }));
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionMetrics()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setRunningActionId(null);
    }
  }

  function resetFilters() {
    setFilterSymbol("");
    setFilterSignal("all");
    setFilterTimeframe("all");
    setSignalSource("local");
    setSortMode("newest");
  }

  function renderIndicatorDetail(row: PredictionListItem) {
    const rowId = row.id;
    const detail = detailsById[rowId];
    const indicators = detail?.indicators ?? null;
    const detailSnapshot = asRecord(detail?.featureSnapshot);
    const localPrediction = row.localPrediction ?? readAiPrediction(detailSnapshot.localPrediction);
    const aiPrediction = row.aiPrediction ?? readAiPrediction(detailSnapshot.aiPrediction);
    const strategyRef = row.strategyRef ?? normalizeStrategyRef(detailSnapshot.strategyRef);
    const strategyRunOutput = asRecord(detailSnapshot.strategyRunOutput);
    const strategyRunDebug = asRecord(detailSnapshot.strategyRunDebug);
    const activeSignal = signalSource === "ai" && aiPrediction
      ? aiPrediction.signal
      : signalSource === "local" && localPrediction
        ? localPrediction.signal
        : row.signal;
    const activeConfidence = signalSource === "ai" && aiPrediction
      ? aiPrediction.confidence
      : signalSource === "local" && localPrediction
        ? localPrediction.confidence
        : row.confidence;
    const activeMove = signalSource === "ai" && aiPrediction
      ? aiPrediction.expectedMovePct
      : signalSource === "local" && localPrediction
        ? localPrediction.expectedMovePct
        : row.expectedMovePct;
    const loadingDetail = detailsLoadingId === rowId;
    const dataGap = Boolean(indicators?.dataGap || detail?.riskFlags?.dataGap);
    const updatedAtIso = row.lastUpdatedAt ?? row.tsCreated;
    const parsedReason = parsePredictionChangeReason(row.lastChangeReason ?? null);
    const manualReason = describeManualReason({
      parsedReason,
      autoEnabled: Boolean(row.autoScheduleEnabled)
    });
    const events = eventsByStateId[rowId] ?? detail?.events ?? [];
    const eventsExpanded = Boolean(expandedEventsByStateId[rowId]);
    const eventsLoading = eventsLoadingStateId === rowId;
    const eventsError = eventsErrorByStateId[rowId] ?? null;
    const detailRealized = detail?.realized ?? null;
    const detailErrorMetrics = asRecord(detailRealized?.errorMetrics);
    const realizedReturnPct =
      typeof row.realizedReturnPct === "number"
        ? row.realizedReturnPct
        : toNum(detailRealized?.realizedReturnPct);
    const realizedEvaluatedAt =
      row.realizedEvaluatedAt ??
      (typeof detailRealized?.evaluatedAt === "string" ? detailRealized.evaluatedAt : null);
    const realizedHit =
      typeof row.realizedHit === "boolean"
        ? row.realizedHit
        : readHitValue(detailErrorMetrics.hit);
    const realizedAbsError =
      typeof row.realizedAbsError === "number"
        ? row.realizedAbsError
        : toNum(detailErrorMetrics.absError);
    const realizedSqError =
      typeof row.realizedSqError === "number"
        ? row.realizedSqError
        : toNum(detailErrorMetrics.sqError);

    const reasonBadgeClass =
      parsedReason.kind === "triggered"
        ? "predictionReasonBadgeTrigger"
        : parsedReason.kind === "scheduled"
          ? "predictionReasonBadgeScheduled"
          : parsedReason.kind === "manual"
            ? "predictionReasonBadgeManual"
            : "predictionReasonBadgeUnknown";

    if (loadingDetail && !detail) {
      return (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          Loading prediction details...
        </div>
      );
    }

    return (
      <div className="predictionDetailStack">
        <div className="card predictionDetailPanel">
          <div className="predictionDetailHeader">
            <strong>Prediction Context</strong>
          </div>

          <div className="predictionContextRow">
            <span className={`badge ${reasonBadgeClass}`}>{manualReason.label}</span>
            {parsedReason.signalFlip ? (
              <span className="badge predictionFlipBadge">FLIP {formatFlipLabel(parsedReason.signalFlip)}</span>
            ) : null}
            <span
              className={`predictionUpdateMeta ${isRecentTimestamp(updatedAtIso, nowMs, 2 * 60 * 1000) ? "predictionUpdateMetaFresh" : ""}`}
              title={updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}
            >
              Last updated {formatRelativeTime(updatedAtIso, nowMs)}
            </span>
          </div>
          <div className="predictionContextReason">
            Reason: {manualReason.shortReason}
          </div>
          <div className="predictionContextReason">
            Signal source: {signalSource === "ai" ? "AI" : "Local"}
            {signalSource === "ai" && !aiPrediction ? " (AI value unavailable, using local)" : ""}
          </div>
          <div className="predictionContextReason">
            {tPred("create.signalMode")}: {signalModeLabel(row.signalMode, modeLabels)}
          </div>
          <div className="predictionContextReason">
            Strategy: {strategyRefLabel(strategyRef, {
              aiPromptTemplateName: row.aiPromptTemplateName,
              localStrategyName: row.localStrategyName,
              compositeStrategyName: row.compositeStrategyName
            })}
          </div>

          {dataGap ? (
            <span className="predictionDetailWarning">
              Data gap detected
            </span>
          ) : null}

          <div className="predictionIndicatorGrid">
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Selected signal</div>
              <div className="predictionIndicatorValue">{activeSignal}</div>
              <div className="predictionIndicatorMeta">
                conf {fmtConfidence(activeConfidence)} · move {activeMove.toFixed(2)}%
              </div>
            </div>
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Local vs AI signal</div>
              <div className="predictionIndicatorValue">
                {(localPrediction?.signal ?? row.signal)} / {aiPrediction?.signal ?? "n/a"}
              </div>
              <div className="predictionIndicatorMeta">
                local {fmtConfidence(localPrediction?.confidence ?? row.confidence)} · ai {aiPrediction ? fmtConfidence(aiPrediction.confidence) : "n/a"}
              </div>
            </div>
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Strategy run</div>
              <div className="predictionIndicatorValue">
                {typeof strategyRunOutput.status === "string" ? strategyRunOutput.status : "n/a"}
              </div>
              <div className="predictionIndicatorMeta">
                {typeof strategyRunOutput.source === "string" ? `source ${strategyRunOutput.source}` : "source n/a"}
                {typeof strategyRunOutput.aiCalled === "boolean"
                  ? ` · ai called ${strategyRunOutput.aiCalled ? "yes" : "no"}`
                  : ""}
              </div>
            </div>
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Evaluated</div>
              <div className="predictionIndicatorValue">{realizedEvaluatedAt ? "yes" : "no"}</div>
              <div className="predictionIndicatorMeta">
                {realizedEvaluatedAt
                  ? `at ${new Date(realizedEvaluatedAt).toLocaleString()}`
                  : "horizon not elapsed yet"}
              </div>
            </div>
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Realized return %</div>
              <div className="predictionIndicatorValue">{fmtNum(realizedReturnPct, 4)}</div>
            </div>
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Directional hit</div>
              <div className="predictionIndicatorValue">
                {realizedHit === null ? "n/a" : realizedHit ? "hit" : "miss"}
              </div>
            </div>
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Abs error</div>
              <div className="predictionIndicatorValue">{fmtNum(realizedAbsError, 4)}</div>
            </div>
            <div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">Sq error</div>
              <div className="predictionIndicatorValue">{fmtNum(realizedSqError, 4)}</div>
            </div>
            {indicators ? (
              <>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">RSI (14)</div>
                  <div className="predictionIndicatorValue">{fmtNum(indicators.rsi_14, 2)}</div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">MACD (line / signal / hist)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.macd?.line, 4)} / {fmtNum(indicators.macd?.signal, 4)} / {fmtNum(indicators.macd?.hist, 4)}
                  </div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">Bollinger (width% / pos)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.bb?.width_pct, 2)} / {fmtNum(indicators.bb?.pos, 3)}
                  </div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">VWAP (value / dist%)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.vwap?.value, 2)} / {fmtNum(indicators.vwap?.dist_pct, 2)}
                  </div>
                  <div className="predictionIndicatorMeta">
                    mode: {indicators.vwap?.mode ?? "n/a"}
                  </div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">ADX (ADX / +DI / -DI)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.adx?.adx_14, 2)} / {fmtNum(indicators.adx?.plus_di_14, 2)} / {fmtNum(indicators.adx?.minus_di_14, 2)}
                  </div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">StochRSI (%K / %D / value)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.stochrsi?.k, 1)} / {fmtNum(indicators.stochrsi?.d, 1)} / {fmtNum(indicators.stochrsi?.value, 1)}
                  </div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">Volume (z / rel / trend%)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.volume?.vol_z, 3)} / {fmtNum(indicators.volume?.rel_vol, 3)} / {fmtNum(indicators.volume?.vol_trend, 2)}
                  </div>
                  <div className="predictionIndicatorMeta">
                    EMA fast/slow: {fmtNum(indicators.volume?.vol_ema_fast, 2)} / {fmtNum(indicators.volume?.vol_ema_slow, 2)}
                  </div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">FVG (open bull / bear)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.fvg?.open_bullish_count, 0)} / {fmtNum(indicators.fvg?.open_bearish_count, 0)}
                  </div>
                  <div className="predictionIndicatorMeta">
                    bull dist: {fmtNum(indicators.fvg?.nearest_bullish_gap?.dist_pct, 2)}% · bear dist: {fmtNum(indicators.fvg?.nearest_bearish_gap?.dist_pct, 2)}%
                  </div>
                </div>
                <div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">ATR %</div>
                  <div className="predictionIndicatorValue">{fmtNum(indicators.atr_pct, 4)}</div>
                </div>
              </>
            ) : (
              <div className="card predictionIndicatorCard">
                <div className="predictionIndicatorTitle">Indicators</div>
                <div className="predictionIndicatorValue">n/a</div>
                <div className="predictionIndicatorMeta">No indicator data for this prediction.</div>
              </div>
            )}
          </div>
          {Object.keys(strategyRunOutput).length > 0 || Object.keys(strategyRunDebug).length > 0 ? (
            <details className="predictionDebugDetails">
              <summary>Strategy debug</summary>
              <pre
                className="predictionDebugPre"
                style={{
                  marginTop: 8,
                  maxHeight: 240,
                  overflow: "auto",
                  fontSize: 12,
                  background: "rgba(0,0,0,0.18)",
                  padding: 10,
                  borderRadius: 8
                }}
              >
                {JSON.stringify(
                  {
                    strategyRunOutput: Object.keys(strategyRunOutput).length > 0 ? strategyRunOutput : null,
                    strategyRunDebug: Object.keys(strategyRunDebug).length > 0 ? strategyRunDebug : null
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          ) : null}
        </div>

        <div className="card predictionDetailPanel">
          <div className="predictionDetailHeader">
            <strong>Recent Changes</strong>
            <button
              className="btn predictionMiniBtn"
              type="button"
              onClick={() => toggleEventLog(rowId)}
            >
              {eventsExpanded ? "Hide" : "Show"} ({events.length})
            </button>
          </div>

          {eventsExpanded ? (
            eventsLoading ? (
              <div style={{ color: "var(--muted)", marginTop: 8 }}>
                Loading event log...
              </div>
            ) : eventsError ? (
              <div style={{ color: "var(--muted)", marginTop: 8 }}>
                {eventsError}
              </div>
            ) : events.length === 0 ? (
              <div style={{ color: "var(--muted)", marginTop: 8 }}>
                No recent changes recorded.
              </div>
            ) : (
              <div className="predictionEventList">
                {events.map((event) => (
                  <div key={event.id} className="predictionEventItem">
                    <div className="predictionEventHeader">
                      <span className="badge">{event.changeType}</span>
                      <span
                        className="predictionEventTimestamp"
                        title={event.tsCreated ? new Date(event.tsCreated).toLocaleString() : "n/a"}
                      >
                        {formatRelativeTime(event.tsCreated, nowMs)}
                      </span>
                    </div>
                    <div className="predictionEventReason">{event.reason ?? "n/a"}</div>
                    <div className="predictionEventDelta">
                      {summarizeEventDelta(event.delta)}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div style={{ color: "var(--muted)", marginTop: 8 }}>
              Expand to see the last refresh events.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="predictionsWrap">
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{tPred("title")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {tPred("subtitle")}
          </div>
        </div>
        <div className="predictionsHeaderActions">
          <Link href={withLocalePath("/dashboard", locale)} className="btn">{tPred("header.dashboard")}</Link>
          <Link href={withLocalePath("/trade", locale)} className="btn">{tPred("header.manualTrading")}</Link>
        </div>
      </div>

      <section className="card predictionsSection predictionQuickStatsSection">
        <div className="predictionQuickStatsGrid">
          <div className="predictionQuickStat">
            <div className="predictionQuickStatLabel">{tPred("quickStats.listed")}</div>
            <div className="predictionQuickStatValue">
              {filteredRows.length}
              <span className="predictionQuickStatMeta"> / {rows.length} {tPred("quickStats.total")}</span>
            </div>
          </div>
          <div className="predictionQuickStat">
            <div className="predictionQuickStatLabel">{tPred("quickStats.actionableNow")}</div>
            <div className="predictionQuickStatValue">{actionableRowsCount}</div>
          </div>
          <div className="predictionQuickStat">
            <div className="predictionQuickStatLabel">{tPred("quickStats.autoEnabled")}</div>
            <div className="predictionQuickStatValue">{autoEnabledRowsCount}</div>
          </div>
          <div className="predictionQuickStat">
            <div className="predictionQuickStatLabel">{tPred("quickStats.disagreements")}</div>
            <div
              className={`predictionQuickStatValue ${
                aiDisagreementRowsCount > 0 ? "predictionQuickStatValueWarn" : ""
              }`}
            >
              {aiDisagreementRowsCount}
            </div>
          </div>
        </div>
      </section>

      <section className="card predictionsSection predictionCreateSection">
        <div className="predictionCreateHeader">
          <div>
            <div className="predictionCreateTitle">{tPred("create.title")}</div>
            <div className="predictionsSectionHint">
              {tPred("create.hint")}
            </div>
          </div>
          <div className="predictionCreateBadges">
            <span className="badge badgeOk">{tPred("create.autoScheduleAlwaysOn")}</span>
            <span className="badge">
              {tPred("create.signalMode")}:{" "}
              {effectiveCreateSignalMode === "local_only"
                ? tPred("modes.localOnly")
                : effectiveCreateSignalMode === "ai_only"
                  ? tPred("modes.aiOnly")
                  : tPred("modes.both")}
              {forcedCreateSignalMode
                ? ` (${tPred("create.strategyEnforced")})`
                : ` (${tPred("create.globalDefault")})`}
            </span>
          </div>
        </div>
        <div className="predictionCreateGrid">
          <label className="predictionCreateField predictionCreateFieldPrompt">
            <div className="predictionCreateLabel">{tPred("create.strategy")}</div>
            <div className="predictionCreateHint">
              {tPred("create.strategyHint")}
            </div>
            <select
              className="input"
              value={newStrategySelectValue}
              onChange={(e) => setNewStrategySelectValue(e.target.value)}
              disabled={publicAiPromptsLoading || localStrategiesLoading || compositeStrategiesLoading}
            >
              {!aiDefaultAllowed && allowedAiPrompts.length === 0 && allowedLocalStrategies.length === 0 && allowedCompositeStrategies.length === 0 ? (
                <option value="ai:default">{tPred("create.noLicensedStrategy")}</option>
              ) : null}
              {aiDefaultAllowed ? (
                <option value="ai:default">{tPred("create.aiSystemDefault")}</option>
              ) : null}
              {aiKindAllowed ? (
                <optgroup label={tPred("create.aiPromptStrategies")}>
                  {allowedAiPrompts.map((prompt) => (
                    <option key={prompt.id} value={encodeStrategySelectValue({ kind: "ai", id: prompt.id, name: prompt.name })}>
                      {prompt.name}
                      {prompt.isPublic === false ? ` (${tPred("create.private")})` : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {localKindAllowed ? (
                <optgroup label={tPred("create.localStrategies")}>
                  {allowedLocalStrategies.map((strategy) => (
                    <option key={strategy.id} value={encodeStrategySelectValue({ kind: "local", id: strategy.id, name: strategy.name })}>
                      {strategy.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {compositeKindAllowed ? (
                <optgroup label={tPred("create.compositeStrategies")}>
                  {allowedCompositeStrategies.map((strategy) => (
                    <option key={strategy.id} value={encodeStrategySelectValue({ kind: "composite", id: strategy.id, name: strategy.name })}>
                      {strategy.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <div className="predictionCreateHint">
              {tPred("create.selected")}: {strategyRefLabel(selectedStrategyRef, {
                aiPromptTemplateName: selectedPrompt?.name ?? null,
                localStrategyName: selectedLocalStrategy?.name ?? null,
                compositeStrategyName: selectedCompositeStrategy?.name ?? null
              })}
            </div>
            <div className="predictionCreateHint">
              {tPred("create.aiLicenseMode")}: {publicAiPromptLicensePolicy?.mode ?? "off"}
              {publicAiPromptLicensePolicy?.enforcementActive
                ? ` (${tPred("create.enforced")})`
                : ` (${tPred("create.previewOff")})`}
              .
            </div>
            <div className="predictionCreateHint predictionCreateHintCompact">
              {selectedStrategyRef?.kind === "ai"
                ? `${tPred("create.promptLockTimeframe")}: ${selectedPromptLockedTimeframe ?? "none"}`
                : selectedStrategyRef?.kind === "local"
                  ? `${tPred("create.localType")}: ${selectedLocalStrategy?.strategyType ?? tPred("misc.na")}`
                  : selectedStrategyRef?.kind === "composite"
                    ? `${tPred("create.compositeVersion")}: ${selectedCompositeStrategy?.version ?? tPred("misc.na")}`
                    : tPred("create.noExplicitStrategy")}
            </div>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">{tPred("create.exchangeAccount")}</div>
            <div className="predictionCreateHint">{tPred("create.exchangeAccountHint")}</div>
            <select
              className="input"
              value={createAccountId}
              onChange={(e) => setCreateAccountId(e.target.value)}
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 ? (
                <option value="">{tPred("create.noAccountAvailable")}</option>
              ) : (
                accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.exchange.toUpperCase()} - {account.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">{tPred("create.pair")}</div>
            <div className="predictionCreateHint">{tPred("create.pairHint")}</div>
            <select
              className="input"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              disabled={symbolsLoading || createSymbols.length === 0}
            >
              {symbolsLoading ? (
                <option value="">{tPred("create.loadingPairs")}</option>
              ) : createSymbols.length === 0 ? (
                <option value="">{tPred("create.noPairAvailable")}</option>
              ) : (
                createSymbols.map((symbol) => (
                  <option key={symbol.symbol} value={symbol.symbol}>
                    {symbol.symbol} {symbol.tradable ? "" : `(${tPred("create.restricted")})`}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">{tPred("create.marketType")}</div>
            <div className="predictionCreateHint">{tPred("create.marketTypeHint")}</div>
            <select className="input" value={newMarketType} onChange={(e) => setNewMarketType(e.target.value as PredictionMarketType)}>
              <option value="perp">perp</option>
              <option value="spot">spot</option>
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">{tPred("create.timeframe")}</div>
            <div className="predictionCreateHint">
              {selectedPromptLockedTimeframe
                ? tPred("create.timeframePromptLocked", { timeframe: selectedPromptLockedTimeframe })
                : tPred("create.timeframeHint")}
            </div>
            <select
              className="input"
              value={effectiveCreateTimeframe}
              onChange={(e) => setNewTimeframe(e.target.value as PredictionTimeframe)}
              disabled={Boolean(selectedPromptLockedTimeframe)}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">{tPred("create.leverage")}</div>
            <div className="predictionCreateHint">{tPred("create.leverageHint")}</div>
            <input
              className="input"
              type="number"
              step="1"
              min="1"
              max="125"
              value={newLeverage}
              onChange={(e) => setNewLeverage(e.target.value)}
              placeholder="10"
              disabled={newMarketType !== "perp"}
            />
          </label>
        </div>

        <div className="predictionCreateFooter">
          {symbolsError ? (
          <div className="predictionCreateAlert predictionCreateAlertWarn">
            {tPred("create.pairsLoadFailed")}: {symbolsError}
          </div>
          ) : null}
          {aiKindAllowed && !publicAiPromptsLoading && allowedAiPrompts.length === 0 ? (
          <div className="predictionCreateAlert predictionCreateAlertInfo">
            {tPred("create.noPublicPrompts")}
          </div>
          ) : null}
          {localKindAllowed && !localStrategiesLoading && allowedLocalStrategies.length === 0 ? (
          <div className="predictionCreateAlert predictionCreateAlertInfo">
            {tPred("create.noLocalStrategies")}
          </div>
          ) : null}
          {compositeKindAllowed && !compositeStrategiesLoading && allowedCompositeStrategies.length === 0 ? (
          <div className="predictionCreateAlert predictionCreateAlertInfo">
            {tPred("create.noCompositeStrategies")}
          </div>
          ) : null}
          {aiKindAllowed && publicAiPromptLicensePolicy ? (
          <div className="predictionCreateAlert predictionCreateAlertInfo">
            {tPred("create.allowedPromptIds")}:{" "}
            {publicAiPromptLicensePolicy.allowedPublicPromptIds.length > 0
              ? publicAiPromptLicensePolicy.allowedPublicPromptIds.join(", ")
              : "*"}
          </div>
          ) : null}

          <div className="predictionCreateActions">
            <button className="btn btnPrimary" type="button" disabled={creating} onClick={() => void createPrediction()}>
              {creating ? tPred("create.creating") : tPred("create.createPrediction")}
            </button>
          </div>
        </div>

        <div className="card predictionSubCard">
          <div className="predictionSubCardHeader">
            <div className="predictionSubCardTitle">{tPred("running.title")}</div>
            <div className="predictionSubCardHint">
              {tPred("running.hint")}
            </div>
          </div>
          <div className="predictionsRunningHeader">
            <div style={{ fontWeight: 700 }}>
              {tPred("running.runningAutoPredictions", {
                filtered: filteredRunningRows.length,
                total: runningRows.length
              })}
            </div>
            <div className="predictionsRunningActions">
              <select
                className="input"
                value={runningStatusFilter}
                onChange={(e) => setRunningStatusFilter(e.target.value as RunningStatusFilter)}
                style={{ minWidth: 150 }}
              >
                <option value="all">{tPred("running.statusAll")}</option>
                <option value="running">{tPred("running.statusRunning")}</option>
                <option value="paused">{tPred("running.statusPaused")}</option>
              </select>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void loadRunningPredictions();
                }}
                disabled={runningLoading}
              >
                {runningLoading ? tPred("running.refreshing") : tPred("running.refresh")}
              </button>
            </div>
          </div>

          {runningLoading ? (
            <div style={{ color: "var(--muted)" }}>{tPred("running.loading")}</div>
          ) : runningRows.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>
              {tPred("running.empty")}
            </div>
          ) : filteredRunningRows.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>
              {tPred("running.emptyFilter")}
            </div>
          ) : (
            <>
            <div className="predictionsRunningDesktopTable" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.pair")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.tf")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.market")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.account")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.prefs")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.status")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.nextRun")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRunningRows.map((row) => (
                    <tr key={row.id} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                      <td style={{ padding: "8px 6px", fontWeight: 700 }}>{row.symbol}</td>
                      <td style={{ padding: "8px 6px" }}>{row.timeframe}</td>
                      <td style={{ padding: "8px 6px" }}>{row.marketType}</td>
                      <td style={{ padding: "8px 6px" }}>
                        {row.exchange.toUpperCase()} - {row.label}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        Dir: {row.directionPreference}, conf: {row.confidenceTargetPct}%
                        {row.marketType === "perp" && row.leverage ? `, lev: ${row.leverage}x` : ""}
                        {`, ${tPred("feed.mode")}: ${signalModeLabel(row.signalMode, modeLabels)}`}
                        {`, strategy: ${strategyRefLabel(row.strategyRef, {
                          aiPromptTemplateName: row.aiPromptTemplateName,
                          localStrategyName: row.localStrategyName,
                          compositeStrategyName: row.compositeStrategyName
                        })}`}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        {row.paused ? tPred("running.paused") : "running"}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        {row.paused
                          ? tPred("running.paused")
                          : row.dueInSec <= 0
                            ? tPred("running.dueNow")
                            : tPred("running.in", { value: fmtMs(row.dueInSec * 1000) })}
                      </td>
                      <td style={{ padding: "8px 6px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="btn"
                          type="button"
                          disabled={runningActionId === row.id}
                          onClick={() => void togglePausePrediction(row)}
                        >
                          {row.paused ? tPred("running.resume") : tPred("running.pausePrediction")}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          disabled={runningActionId === row.id}
                          onClick={() => void deleteRunningPrediction(row.id)}
                        >
                          {tPred("running.delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="predictionsRunningMobileList">
              {filteredRunningRows.map((row) => (
                <div key={`${row.id}_mobile`} className="card predictionRunningCard">
                  <div className="predictionRunningCardHeader">
                    <div className="predictionRunningCardSymbol">{row.symbol}</div>
                    <span className={`badge ${row.paused ? "predictionRunningBadgePaused" : "predictionRunningBadgeActive"}`}>
                      {row.paused ? "paused" : "running"}
                    </span>
                  </div>
                  <div className="predictionRunningCardMeta">
                    <span>{row.timeframe}</span>
                    <span>{row.marketType}</span>
                    <span>{row.exchange.toUpperCase()}</span>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("running.account")}</span>
                    <strong>{row.label}</strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("running.prefs")}</span>
                    <strong>
                      {row.directionPreference}, {row.confidenceTargetPct}%
                      {row.marketType === "perp" && row.leverage ? `, ${row.leverage}x` : ""}
                    </strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("create.signalMode")}</span>
                    <strong>{signalModeLabel(row.signalMode, modeLabels)}</strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("create.strategy")}</span>
                    <strong>{strategyRefLabel(row.strategyRef, {
                      aiPromptTemplateName: row.aiPromptTemplateName,
                      localStrategyName: row.localStrategyName,
                      compositeStrategyName: row.compositeStrategyName
                    })}</strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("running.nextRun")}</span>
                    <strong>{row.paused
                      ? tPred("running.paused")
                      : row.dueInSec <= 0
                        ? tPred("running.dueNow")
                        : tPred("running.in", { value: fmtMs(row.dueInSec * 1000) })}</strong>
                  </div>
                  <div className="predictionRunningCardActions">
                    <button
                      className="btn"
                      type="button"
                      disabled={runningActionId === row.id}
                      onClick={() => void togglePausePrediction(row)}
                    >
                      {row.paused ? tPred("running.resume") : tPred("running.pausePrediction")}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={runningActionId === row.id}
                      onClick={() => void deleteRunningPrediction(row.id)}
                    >
                      {tPred("running.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>

      </section>

      {error ? <PredictionAlert tone="error" title={tPred("alerts.loadError")} message={error} /> : null}

      {actionError ? <PredictionAlert tone="error" title={tPred("alerts.actionFailed")} message={actionError} /> : null}

      {detailsError ? <PredictionAlert tone="error" title={tPred("alerts.detailLoadFailed")} message={detailsError} /> : null}

      {notice ? <PredictionAlert tone="warning" title={tPred("alerts.notice")} message={notice} /> : null}

      <section className="card predictionsSection">
        <div className="predictionsListHeader">
          <div className="predictionsListTitle">{tPred("feed.title")}</div>
          <div className="predictionsListHint">
            {tPred("feed.hint")}
          </div>
        </div>
        <div className="predictionsFiltersHeader">
          <div className="predictionsFiltersSummary">
            {tPred("feed.summary", { listed: filteredRows.length, actionable: actionableRowsCount })}
            {activeFiltersCount > 0 ? `, ${tPred("feed.activeFilters", { count: activeFiltersCount })}` : ""}
          </div>
          <div className="predictionsFiltersActions">
            <button
              className="btn"
              type="button"
              onClick={resetFilters}
              disabled={activeFiltersCount === 0}
            >
              {tPred("feed.resetFilters")}
            </button>
          </div>
        </div>
        <div className="predictionsFiltersGrid">
          <input
            className="input"
            placeholder={tPred("feed.filterSymbol")}
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
          />
          <select className="input" value={filterSignal} onChange={(e) => setFilterSignal(e.target.value as PredictionSignal | "all")}>
            <option value="all">{tPred("feed.allSignals")}</option>
            <option value="up">up</option>
            <option value="down">down</option>
            <option value="neutral">neutral</option>
          </select>
          <select className="input" value={filterTimeframe} onChange={(e) => setFilterTimeframe(e.target.value as PredictionTimeframe | "all")}>
            <option value="all">{tPred("feed.allTf")}</option>
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
          <select className="input" value={signalSource} onChange={(e) => setSignalSource(e.target.value as SignalSource)}>
            <option value="local">{tPred("feed.signalSourceLocal")}</option>
            <option value="ai">{tPred("feed.signalSourceAi")}</option>
          </select>
          <select className="input" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <option value="newest">{tPred("feed.sortNewest")}</option>
            <option value="confidence">{tPred("feed.sortConfidence")}</option>
            <option value="move">{tPred("feed.sortMove")}</option>
          </select>
          <button
            className="btn"
            type="button"
            onClick={() => {
              void Promise.all([
                loadPredictions(),
                loadPredictionQuality(),
                loadPredictionMetrics()
              ]);
            }}
            disabled={loading}
          >
            {loading ? tPred("running.refreshing") : tPred("running.refresh")}
          </button>
        </div>

        <div className="predictionsListContent">
          {loading ? (
            <div className="predictionsListState">{tPred("feed.loading")}</div>
          ) : filteredRows.length === 0 ? (
            <div className="predictionsListState">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{tPred("feed.noPredictions")}</div>
              <div style={{ color: "var(--muted)" }}>
                {tPred("feed.adjustFilters")}
              </div>
            </div>
          ) : (
            <>
          <div className="predictionsDesktopTableWrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.symbol")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.market")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.tf")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.signal")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.confidence")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.move")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.auto")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.outcome")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.outcomePnl")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.tagsExplanation")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.lastUpdated")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.change")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.created")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.action")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const activeSignal = resolveSignal(row, signalSource);
                  const activeConfidence = resolveConfidence(row, signalSource);
                  const activeMove = resolveExpectedMove(row, signalSource);
                  const localComparisonSignal = row.localPrediction?.signal ?? row.signal;
                  const aiComparisonAvailable = Boolean(row.aiPrediction);
                  const aiDisagrees = aiComparisonAvailable && row.aiPrediction!.signal !== localComparisonSignal;
                  const actionState = resolvePredictionActionState(row, signalSource, actionStateLabels);
                  const expanded = expandedDetailId === row.id;
                  const loadingDetail = detailsLoadingId === row.id;
                  const updatedAtIso = row.lastUpdatedAt ?? row.tsCreated;
                  const changeReason = parsePredictionChangeReason(row.lastChangeReason ?? null);
                  const manualReason = describeManualReason({
                    parsedReason: changeReason,
                    autoEnabled: Boolean(row.autoScheduleEnabled)
                  });
                  const flipRecently =
                    Boolean(changeReason.signalFlip) && isRecentTimestamp(updatedAtIso, nowMs, 15 * 60 * 1000);
                  const reasonBadgeClass =
                    changeReason.kind === "triggered"
                      ? "predictionReasonBadgeTrigger"
                      : changeReason.kind === "scheduled"
                        ? "predictionReasonBadgeScheduled"
                        : changeReason.kind === "manual"
                          ? "predictionReasonBadgeManual"
                          : "predictionReasonBadgeUnknown";
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={`${flipRecently ? "predictionRowFlipRecent " : ""}${rowStateClass(actionState.state)}`}
                        style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}
                      >
                        <td style={{ padding: "8px 6px", fontWeight: 700 }}>{row.symbol}</td>
                        <td style={{ padding: "8px 6px" }}>{row.marketType}</td>
                        <td style={{ padding: "8px 6px" }}>{row.timeframe}</td>
                        <td style={{ padding: "8px 6px" }}>
                          <span className="badge" style={signalBadgeStyle(activeSignal)}>{activeSignal}</span>
                          {aiComparisonAvailable ? (
                            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                              local {localComparisonSignal} / ai {row.aiPrediction?.signal}
                            </div>
                          ) : null}
                          {signalSource === "ai" && !aiComparisonAvailable ? (
                            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                              {tPred("feed.aiUnavailableUsingLocal")}
                            </div>
                          ) : null}
                          {aiDisagrees ? (
                            <div style={{ color: "#f59e0b", fontSize: 11, marginTop: 4 }}>
                              {tPred("feed.disagreement")}
                            </div>
                          ) : null}
                          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                            {tPred("feed.mode")} {signalModeLabel(row.signalMode, modeLabels)}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                            {strategyRefLabel(row.strategyRef, {
                              aiPromptTemplateName: row.aiPromptTemplateName,
                              localStrategyName: row.localStrategyName,
                              compositeStrategyName: row.compositeStrategyName
                            })}
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>{fmtConfidence(activeConfidence)}</td>
                        <td style={{ padding: "8px 6px" }}>{activeMove.toFixed(2)}%</td>
                        <td style={{ padding: "8px 6px" }}>
                          <div>{row.autoScheduleEnabled ? "enabled" : "off"}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            {tPred("feed.next")}: {nextAutoRunText(row, nowMs, nextRunLabels)}
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {outcomeLabel(row.outcomeStatus, row.outcomeResult)}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {row.outcomePnlPct !== null && row.outcomePnlPct !== undefined
                            ? `${row.outcomePnlPct.toFixed(2)}%`
                            : "-"}
                        </td>
                        <td style={{ padding: "8px 6px", maxWidth: 360 }}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                            {row.tags.slice(0, 4).map((tag) => (
                              <span key={`${row.id}_${tag}`} className="badge">{tag}</span>
                            ))}
                          </div>
                          <div style={{ color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {row.explanation || "-"}
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <div className="predictionUpdateCell">
                            <span
                              className={`predictionUpdateMeta ${isRecentTimestamp(updatedAtIso, nowMs, 2 * 60 * 1000) ? "predictionUpdateMetaFresh" : ""}`}
                              title={updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}
                            >
                              {formatRelativeTime(updatedAtIso, nowMs)}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px", maxWidth: 200 }}>
                          <div className="predictionChangeCell">
                            <div className="predictionChangeBadges">
                              <span className={`badge ${reasonBadgeClass}`}>{manualReason.label}</span>
                              {changeReason.signalFlip ? (
                                <span className="badge predictionFlipBadge">
                                  FLIP {formatFlipLabel(changeReason.signalFlip)}
                                </span>
                              ) : null}
                            </div>
                            <div className="predictionChangeText" title={manualReason.rawReason ?? "n/a"}>
                              {manualReason.shortReason}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>{new Date(row.tsCreated).toLocaleString()}</td>
                        <td style={{ padding: "8px 6px" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <span className={`badge ${actionStateBadgeClass(actionState.state)}`}>
                              {actionState.label}
                            </span>
                            {actionState.state === "ready" ? (
                              <button
                                className="btn btnPrimary"
                                onClick={() => void sendToDesk(row.id)}
                                disabled={sendingId === row.id || !actionState.canSend}
                                title={row.accountId ? "Prefill trade ticket" : "Create an exchange account first"}
                              >
                                {sendingId === row.id ? tPred("feed.sending") : tPred("feed.sendToTradingDesk")}
                              </button>
                            ) : null}
                            <button
                              className="btn"
                              type="button"
                              onClick={() => void togglePredictionDetail(row.id)}
                              disabled={loadingDetail && !expanded}
                            >
                              {expanded ? tPred("feed.hideDetails") : tPred("feed.details")}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr style={{ borderTop: "1px dashed rgba(255,255,255,.08)" }}>
                          <td colSpan={14} style={{ padding: "10px 6px" }}>
                            {renderIndicatorDetail(row)}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="predictionsMobileList">
            {filteredRows.map((row) => {
              const activeSignal = resolveSignal(row, signalSource);
              const activeConfidence = resolveConfidence(row, signalSource);
              const activeMove = resolveExpectedMove(row, signalSource);
              const actionState = resolvePredictionActionState(row, signalSource, actionStateLabels);
              const expanded = expandedDetailId === row.id;
              const loadingDetail = detailsLoadingId === row.id;
              const updatedAtIso = row.lastUpdatedAt ?? row.tsCreated;
              const changeReason = parsePredictionChangeReason(row.lastChangeReason ?? null);
              const manualReason = describeManualReason({
                parsedReason: changeReason,
                autoEnabled: Boolean(row.autoScheduleEnabled)
              });
              const reasonBadgeClass =
                changeReason.kind === "triggered"
                  ? "predictionReasonBadgeTrigger"
                  : changeReason.kind === "scheduled"
                    ? "predictionReasonBadgeScheduled"
                    : changeReason.kind === "manual"
                      ? "predictionReasonBadgeManual"
                      : "predictionReasonBadgeUnknown";

              return (
                <div
                  key={`${row.id}_mobile`}
                  className={`card predictionRowCard ${mobileCardStateClass(actionState.state)}`}
                >
                  <div className="predictionRowCardHeader">
                    <div className="predictionRowCardSymbol">{row.symbol}</div>
                    <span className="badge" style={signalBadgeStyle(activeSignal)}>{activeSignal}</span>
                  </div>

                  <div className="predictionRowCardMeta">
                    <span>{row.marketType}</span>
                    <span>{row.timeframe}</span>
                    <span>{signalModeLabel(row.signalMode, modeLabels)}</span>
                    <span>{strategyRefLabel(row.strategyRef, {
                      aiPromptTemplateName: row.aiPromptTemplateName,
                      localStrategyName: row.localStrategyName,
                      compositeStrategyName: row.compositeStrategyName
                    })}</span>
                    <span>{new Date(row.tsCreated).toLocaleString()}</span>
                    <span title={updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}>
                      {tPred("feed.updated")} {formatRelativeTime(updatedAtIso, nowMs)}
                    </span>
                  </div>

                  <div className="predictionRowCardStats">
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Confidence</div>
                      <div className="predictionRowCardStatValue">{fmtConfidence(activeConfidence)}</div>
                    </div>
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Move</div>
                      <div className="predictionRowCardStatValue">{activeMove.toFixed(2)}%</div>
                    </div>
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Outcome</div>
                      <div className="predictionRowCardStatValue">{outcomeLabel(row.outcomeStatus, row.outcomeResult)}</div>
                    </div>
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Outcome PnL</div>
                      <div className="predictionRowCardStatValue">
                        {row.outcomePnlPct !== null && row.outcomePnlPct !== undefined
                          ? `${row.outcomePnlPct.toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                    <span className={`badge ${reasonBadgeClass}`}>{manualReason.label}</span>
                    {changeReason.signalFlip ? (
                      <span className="badge predictionFlipBadge">
                        FLIP {formatFlipLabel(changeReason.signalFlip)}
                      </span>
                    ) : null}
                    {row.tags.slice(0, 4).map((tag) => (
                      <span key={`${row.id}_m_${tag}`} className="badge">{tag}</span>
                    ))}
                  </div>

                  <div className="predictionRowCardText" title={manualReason.rawReason ?? "n/a"}>
                    {manualReason.shortReason}
                  </div>

                  <div className="predictionRowCardText">
                    {row.explanation || "-"}
                  </div>

                  <div className="predictionRowCardAuto">
                    <span>{row.autoScheduleEnabled ? `Auto: ${tPred("feed.autoEnabled")}` : `Auto: ${tPred("feed.autoOff")}`}</span>
                    <span>{tPred("feed.next")}: {nextAutoRunText(row, nowMs, nextRunLabels)}</span>
                  </div>

                  <div className="predictionRowCardActions">
                    <span className={`badge ${actionStateBadgeClass(actionState.state)}`}>
                      {actionState.label}
                    </span>
                    {actionState.state === "ready" ? (
                      <button
                        className="btn btnPrimary"
                        onClick={() => void sendToDesk(row.id)}
                        disabled={sendingId === row.id || !actionState.canSend}
                        title={row.accountId ? "Prefill trade ticket" : "Create an exchange account first"}
                      >
                        {sendingId === row.id ? tPred("feed.sending") : tPred("feed.sendToTradingDesk")}
                      </button>
                    ) : null}
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void togglePredictionDetail(row.id)}
                      disabled={loadingDetail && !expanded}
                    >
                      {expanded ? tPred("feed.hideDetails") : tPred("feed.details")}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="predictionRowCardDetail">
                      {renderIndicatorDetail(row)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
            </>
          )}
        </div>
      </section>

      <section className="card predictionsSection">
        <div className="predictionCreateTitle">{tPred("performance.title")}</div>
        <div className="predictionsSectionHint">
          {tPred("performance.hint")}
        </div>
        <div className="predictionsQualityGrid">
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{tPred("performance.evaluatedSignals")}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{quality?.sampleSize ?? 0}</div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{tPred("performance.tpWinRate")}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {quality?.winRatePct !== null && quality?.winRatePct !== undefined
                ? `${quality.winRatePct.toFixed(2)}%`
                : "-"}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{tPred("performance.avgOutcomePnl")}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {quality?.avgOutcomePnlPct !== null && quality?.avgOutcomePnlPct !== undefined
                ? `${quality.avgOutcomePnlPct.toFixed(2)}%`
                : "-"}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{tPred("performance.tpSlExpired")}</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {(quality?.tp ?? 0)} / {(quality?.sl ?? 0)} / {(quality?.expired ?? 0)}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{tPred("performance.directionalHitRate")}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {metrics?.hitRate !== null && metrics?.hitRate !== undefined
                ? `${metrics.hitRate.toFixed(2)}%`
                : "-"}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>
              {tPred("performance.evaluated", { count: metrics?.evaluatedCount ?? 0 })}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{tPred("performance.mae")}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {metrics?.mae !== null && metrics?.mae !== undefined
                ? metrics.mae.toFixed(4)
                : "-"}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{tPred("performance.mse")}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {metrics?.mse !== null && metrics?.mse !== undefined
                ? metrics.mse.toFixed(4)
                : "-"}
            </div>
          </div>
        </div>
        <div className="predictionCalibrationWrap">
          <div className="predictionCalibrationHeader">
            <strong>{tPred("performance.calibrationTitle")}</strong>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {tPred("performance.calibrationHint")}
            </span>
          </div>
          {!metrics || metrics.calibrationBins.filter((bin) => bin.n > 0).length === 0 ? (
            <div className="predictionCalibrationEmpty">{tPred("performance.noBins")}</div>
          ) : (
            <div className="predictionCalibrationTableWrap">
              <table className="predictionCalibrationTable">
                <thead>
                  <tr>
                    <th>{tPred("performance.bin")}</th>
                    <th>{tPred("performance.avgConf")}</th>
                    <th>{tPred("performance.accuracy")}</th>
                    <th>N</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.calibrationBins
                    .filter((bin) => bin.n > 0)
                    .map((bin) => (
                      <tr key={`${bin.binFrom}-${bin.binTo}`}>
                        <td>{bin.binFrom.toFixed(0)}-{bin.binTo.toFixed(0)}%</td>
                        <td>{bin.avgConf !== null ? `${bin.avgConf.toFixed(2)}%` : "-"}</td>
                        <td>{bin.accuracy !== null ? `${bin.accuracy.toFixed(2)}%` : "-"}</td>
                        <td>{bin.n}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
