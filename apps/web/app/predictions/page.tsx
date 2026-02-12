"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost } from "../../lib/api";
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
  exchange: string;
  accountId: string | null;
  lastUpdatedAt?: string | null;
  lastChangeReason?: string | null;
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
    atr_pct?: number | null;
    dataGap?: boolean;
  } | null;
  riskFlags?: {
    dataGap?: boolean;
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

type PredictionActivityResponse = {
  scheduler: {
    enabled: boolean;
    running: boolean;
    pollSeconds: number;
    lastCycleStartedAt: string | null;
    lastCycleFinishedAt: string | null;
    lastCycleDurationMs: number | null;
    lastCycleRefreshed: number;
    lastCycleSignificant: number;
    lastCycleAiCalls: number;
    lastSuccessfulCycleAt: string | null;
    lastRefreshedAt: string | null;
    lastSignificantAt: string | null;
    lastAiCallAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  user: {
    activeSchedules: number;
    pausedSchedules: number;
    latestSignalCalculatedAt: string | null;
    latestStateReason: string | null;
    latestStateEventAt: string | null;
    latestStateEventType: string | null;
    latestStateEventReason: string | null;
    latestAiExplainedAt: string | null;
    nextDueAt: string | null;
    staleAfterMs: number;
  };
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
  nowMs: number
): string {
  if (!row.autoScheduleEnabled) return "disabled";
  const ts = new Date(row.tsCreated).getTime();
  if (!Number.isFinite(ts)) return "unknown";
  const dueAt = ts + timeframeMs(row.timeframe);
  const diff = dueAt - nowMs;
  if (diff <= 0) return "due now";
  return `in ${fmtMs(diff)}`;
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

function fmtNum(value: unknown, decimals = 2): string {
  const parsed = toNum(value);
  if (parsed === null) return "n/a";
  return parsed.toFixed(decimals);
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
  const router = useRouter();

  const [rows, setRows] = useState<PredictionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<PredictionQualitySummary | null>(null);
  const [activity, setActivity] = useState<PredictionActivityResponse | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [runningRows, setRunningRows] = useState<RunningPredictionItem[]>([]);
  const [runningLoading, setRunningLoading] = useState(true);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [runningStatusFilter, setRunningStatusFilter] = useState<RunningStatusFilter>("all");
  const [clearOldDays, setClearOldDays] = useState("30");
  const [clearingOld, setClearingOld] = useState(false);
  const [clearingListed, setClearingListed] = useState(false);

  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [createAccountId, setCreateAccountId] = useState("");
  const [createSymbols, setCreateSymbols] = useState<SymbolItem[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);

  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterSignal, setFilterSignal] = useState<PredictionSignal | "all">("all");
  const [filterTimeframe, setFilterTimeframe] = useState<PredictionTimeframe | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const [newSymbol, setNewSymbol] = useState("BTCUSDT");
  const [newMarketType, setNewMarketType] = useState<PredictionMarketType>("perp");
  const [newTimeframe, setNewTimeframe] = useState<PredictionTimeframe>("15m");
  const [newDirectionPreference, setNewDirectionPreference] = useState<DirectionPreference>("either");
  const [newConfidenceTarget, setNewConfidenceTarget] = useState("60");
  const [newLeverage, setNewLeverage] = useState("10");
  const [newAutoSchedule, setNewAutoSchedule] = useState(true);
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
      setRows(Array.isArray(payload.items) ? payload.items : []);
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
      setRunningRows(Array.isArray(payload.items) ? payload.items : []);
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

  async function loadPredictionActivity() {
    setActivityLoading(true);
    try {
      const payload = await apiGet<PredictionActivityResponse>("/api/predictions/activity");
      setActivity(payload);
    } catch {
      setActivity(null);
    } finally {
      setActivityLoading(false);
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
    void loadPredictionActivity();
    void loadAccounts();
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

  const filteredRows = useMemo(() => {
    const symbolSearch = filterSymbol.trim().toUpperCase();

    const next = rows.filter((row) => {
      if (symbolSearch && !row.symbol.toUpperCase().includes(symbolSearch)) return false;
      if (filterSignal !== "all" && row.signal !== filterSignal) return false;
      if (filterTimeframe !== "all" && row.timeframe !== filterTimeframe) return false;
      return true;
    });

    next.sort((a, b) => {
      if (sortMode === "confidence") {
        return (b.confidence <= 1 ? b.confidence * 100 : b.confidence) - (a.confidence <= 1 ? a.confidence * 100 : a.confidence);
      }
      if (sortMode === "move") {
        return Math.abs(b.expectedMovePct) - Math.abs(a.expectedMovePct);
      }
      return new Date(b.tsCreated).getTime() - new Date(a.tsCreated).getTime();
    });

    return next;
  }, [filterSignal, filterSymbol, filterTimeframe, rows, sortMode]);

  const filteredRunningRows = useMemo(() => {
    if (runningStatusFilter === "all") return runningRows;
    return runningRows.filter((row) =>
      runningStatusFilter === "paused" ? row.paused : !row.paused
    );
  }, [runningRows, runningStatusFilter]);

  async function sendToDesk(id: string) {
    setActionError(null);
    setNotice(null);
    setSendingId(id);
    try {
      const detail = await apiGet<PredictionDetailResponse>(`/api/predictions/${id}`);
      if (!detail.accountId) {
        throw new Error("No exchange account available for this prediction.");
      }

      const built = buildTradeDeskPrefillPayload(detail);
      sessionStorage.setItem(TRADE_DESK_PREFILL_SESSION_KEY, JSON.stringify(built.payload));
      if (built.info) {
        setNotice(built.info);
      }
      const params = new URLSearchParams({
        prefill: "1",
        exchangeAccountId: built.payload.accountId
      });
      router.push(`/trading-desk?${params.toString()}`);
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
        [stateId]: "Unable to load events."
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
    const confidenceTargetPct = Number(newConfidenceTarget);
    const leverage = Number(newLeverage);

    if (!createAccountId) {
      setActionError("Please select an exchange account first.");
      return;
    }
    if (!symbol) {
      setActionError("Please select a pair.");
      return;
    }
    if (!Number.isFinite(confidenceTargetPct) || confidenceTargetPct < 0 || confidenceTargetPct > 100) {
      setActionError("Confidence target must be between 0 and 100.");
      return;
    }
    if (newMarketType === "perp" && (!Number.isFinite(leverage) || leverage < 1 || leverage > 125)) {
      setActionError("Leverage must be between 1 and 125 for futures.");
      return;
    }

    setCreating(true);
    try {
      const response = await apiPost<{
        prediction: {
          signal: PredictionSignal;
          confidence: number;
          expectedMovePct: number;
        };
      }>("/api/predictions/generate-auto", {
        exchangeAccountId: createAccountId,
        symbol,
        marketType: newMarketType,
        timeframe: newTimeframe,
        directionPreference: newDirectionPreference,
        confidenceTargetPct,
        leverage: newMarketType === "perp" ? Math.trunc(leverage) : undefined,
        autoSchedule: newAutoSchedule
      });

      setNotice(
        `Prediction created for ${symbol} (${newTimeframe}) with signal ${response.prediction.signal} ` +
        `and confidence ${fmtConfidence(response.prediction.confidence)}.` +
        (newAutoSchedule ? ` Auto mode is enabled (${newTimeframe} cadence).` : " Auto mode is disabled.")
      );
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionActivity()
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
          ? `Prediction paused (${response.updatedCount} template rows updated).`
          : `Prediction resumed (${response.updatedCount} template rows updated).`
      );
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionActivity()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setRunningActionId(null);
    }
  }

  async function deleteRunningPrediction(id: string) {
    const confirmed = window.confirm(
      "Delete this auto-prediction schedule and related template rows? This cannot be undone."
    );
    if (!confirmed) return;

    setActionError(null);
    setNotice(null);
    setRunningActionId(id);
    try {
      const response = await apiPost<{ deletedCount: number }>(`/api/predictions/${id}/delete-schedule`, {});
      setNotice(`Auto prediction deleted (${response.deletedCount} rows removed).`);
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionActivity()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setRunningActionId(null);
    }
  }

  async function clearOldPredictions() {
    const olderThanDays = Number(clearOldDays);
    if (!Number.isFinite(olderThanDays) || olderThanDays < 1 || olderThanDays > 3650) {
      setActionError("Please enter a valid day count between 1 and 3650.");
      return;
    }

    const confirmed = window.confirm(
      `Delete predictions older than ${Math.trunc(olderThanDays)} day(s)? Active auto templates will be kept.`
    );
    if (!confirmed) return;

    setActionError(null);
    setNotice(null);
    setClearingOld(true);
    try {
      const response = await apiPost<{ deletedCount: number; olderThanDays: number; preservedCount: number }>(
        "/api/predictions/clear-old",
        {
          olderThanDays: Math.trunc(olderThanDays),
          keepRunningTemplates: true
        }
      );
      setNotice(
        `Cleared ${response.deletedCount} old prediction(s) older than ${response.olderThanDays} day(s). ` +
        `Preserved running templates: ${response.preservedCount}.`
      );
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionActivity()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setClearingOld(false);
    }
  }

  async function clearListedPredictions() {
    if (filteredRows.length === 0) {
      setActionError("No filtered predictions to delete.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${filteredRows.length} currently listed prediction(s)?`
    );
    if (!confirmed) return;

    setActionError(null);
    setNotice(null);
    setClearingListed(true);
    try {
      const response = await apiPost<{ deletedCount: number }>(
        "/api/predictions/delete-many",
        { ids: filteredRows.map((row) => row.id) }
      );
      setNotice(`Deleted ${response.deletedCount} listed prediction(s).`);
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionActivity()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setClearingListed(false);
    }
  }

  function renderIndicatorDetail(row: PredictionListItem) {
    const rowId = row.id;
    const detail = detailsById[rowId];
    const indicators = detail?.indicators ?? null;
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

          {dataGap ? (
            <span className="predictionDetailWarning">
              Data gap detected
            </span>
          ) : null}

          {indicators ? (
            <div className="predictionIndicatorGrid">
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
                <div className="predictionIndicatorTitle">ATR %</div>
                <div className="predictionIndicatorValue">{fmtNum(indicators.atr_pct, 4)}</div>
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--muted)", marginTop: 8 }}>
              No indicator data for this prediction.
            </div>
          )}
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

  const predictionActivityReason = parsePredictionChangeReason(activity?.user.latestStateReason ?? null);
  const predictionActivityReasonDetail = describeManualReason({
    parsedReason: predictionActivityReason,
    autoEnabled: (activity?.user.activeSchedules ?? 0) > 0
  });
  const activeSchedules = activity?.user.activeSchedules ?? 0;
  const staleAfterMs = Number.isFinite(Number(activity?.user.staleAfterMs))
    ? Number(activity?.user.staleAfterMs)
    : 15 * 60 * 1000;
  const latestSignalCalculatedAt = activity?.user.latestSignalCalculatedAt ?? null;
  const isPredictionActivityStale =
    activeSchedules > 0 &&
    !isRecentTimestamp(latestSignalCalculatedAt, nowMs, Math.max(staleAfterMs, 60_000));
  const schedulerStatusLabel = !activity
    ? "unknown"
    : !activity.scheduler.enabled
      ? "disabled"
      : activity.scheduler.running
        ? "running"
        : "idle";
  const activityBadgeClass = !activity || !activity.scheduler.enabled
    ? "predictionHealthBadgeIdle"
    : isPredictionActivityStale
      ? "predictionHealthBadgeWarn"
      : "predictionHealthBadgeOk";

  return (
    <div className="predictionsWrap">
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>Ai Predictions</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Select a prediction and prefill the Manual Trading Desk ticket.
          </div>
        </div>
        <div className="predictionsHeaderActions">
          <Link href="/dashboard" className="btn">Dashboard</Link>
          <Link href="/trade" className="btn">Manual Trading</Link>
        </div>
      </div>

      <section className="card predictionsSection">
        <div className="predictionCreateTitle">Create Prediction (Local)</div>
        <div className="predictionCreateGrid">
          <label className="predictionCreateField">
            <div className="predictionCreateLabel">Exchange account</div>
            <div className="predictionCreateHint">Welcher Account später beim Trading-Prefill genutzt wird.</div>
            <select
              className="input"
              value={createAccountId}
              onChange={(e) => setCreateAccountId(e.target.value)}
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 ? (
                <option value="">No account available</option>
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
            <div className="predictionCreateLabel">Pair</div>
            <div className="predictionCreateHint">Handelspaar für die Vorhersage (aus Exchange-Symbolen).</div>
            <select
              className="input"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              disabled={symbolsLoading || createSymbols.length === 0}
            >
              {symbolsLoading ? (
                <option value="">Loading pairs...</option>
              ) : createSymbols.length === 0 ? (
                <option value="">No pair available</option>
              ) : (
                createSymbols.map((symbol) => (
                  <option key={symbol.symbol} value={symbol.symbol}>
                    {symbol.symbol} {symbol.tradable ? "" : "(restricted)"}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">Market type</div>
            <div className="predictionCreateHint">Spot oder Perpetual für die Interpretation.</div>
            <select className="input" value={newMarketType} onChange={(e) => setNewMarketType(e.target.value as PredictionMarketType)}>
              <option value="perp">perp</option>
              <option value="spot">spot</option>
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">Timeframe</div>
            <div className="predictionCreateHint">Zeithorizont der Prognose.</div>
            <select className="input" value={newTimeframe} onChange={(e) => setNewTimeframe(e.target.value as PredictionTimeframe)}>
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">Direction preference</div>
            <div className="predictionCreateHint">Optional: long only, short only oder egal.</div>
            <select className="input" value={newDirectionPreference} onChange={(e) => setNewDirectionPreference(e.target.value as DirectionPreference)}>
              <option value="either">either (egal)</option>
              <option value="long">long preferred</option>
              <option value="short">short preferred</option>
            </select>
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">Confidence target (%)</div>
            <div className="predictionCreateHint">Mindest-Confidence für ein klares Long/Short Signal.</div>
            <input
              className="input"
              type="number"
              step="1"
              min="0"
              max="100"
              value={newConfidenceTarget}
              onChange={(e) => setNewConfidenceTarget(e.target.value)}
              placeholder="60"
            />
          </label>

          <label className="predictionCreateField">
            <div className="predictionCreateLabel">Leverage (futures)</div>
            <div className="predictionCreateHint">Wird als Futures-Hinweis im Ticket übernommen.</div>
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

          <label className="predictionCreateField" style={{ justifyContent: "flex-end" }}>
            <div className="predictionCreateLabel">Auto schedule</div>
            <div className="predictionCreateHint">
              Erstellt automatisch neue Predictions im gewählten Timeframe.
            </div>
            <div
              className="card"
              style={{ margin: 0 }}
            >
              <label className="predictionAutoToggle">
              <input
                type="checkbox"
                checked={newAutoSchedule}
                onChange={(e) => setNewAutoSchedule(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>
                {newAutoSchedule ? "Enabled" : "Disabled"}
              </span>
              </label>
            </div>
          </label>
        </div>

        {symbolsError ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#f59e0b" }}>
            Pairs konnten nicht geladen werden: {symbolsError}
          </div>
        ) : null}

        <div style={{ marginTop: 10 }}>
          <button className="btn btnPrimary" type="button" disabled={creating} onClick={() => void createPrediction()}>
            {creating ? "Creating..." : "Create Prediction"}
          </button>
        </div>
      </section>

      <section className="card predictionsSection">
        <div className="predictionsQualityGrid">
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Evaluated Signals</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{quality?.sampleSize ?? 0}</div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>TP Win Rate</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {quality?.winRatePct !== null && quality?.winRatePct !== undefined
                ? `${quality.winRatePct.toFixed(2)}%`
                : "-"}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Avg Outcome PnL</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {quality?.avgOutcomePnlPct !== null && quality?.avgOutcomePnlPct !== undefined
                ? `${quality.avgOutcomePnlPct.toFixed(2)}%`
                : "-"}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>TP / SL / Expired</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {(quality?.tp ?? 0)} / {(quality?.sl ?? 0)} / {(quality?.expired ?? 0)}
            </div>
          </div>
          <div className="card predictionActivityCard" style={{ margin: 0, padding: 10 }}>
            <div className="predictionActivityHeader">
              <div style={{ color: "var(--muted)", fontSize: 12 }}>AI Refresh</div>
              <span className={`badge ${activityBadgeClass}`}>
                {activityLoading ? "loading" : schedulerStatusLabel}
              </span>
            </div>
            <div className="predictionActivityLine">
              <span>Last calc</span>
              <strong title={latestSignalCalculatedAt ? new Date(latestSignalCalculatedAt).toLocaleString() : "n/a"}>
                {activityLoading ? "..." : formatRelativeTime(latestSignalCalculatedAt, nowMs)}
              </strong>
            </div>
            <div className="predictionActivityLine">
              <span>Last cycle</span>
              <strong title={activity?.scheduler.lastCycleFinishedAt ? new Date(activity.scheduler.lastCycleFinishedAt).toLocaleString() : "n/a"}>
                {activityLoading ? "..." : formatRelativeTime(activity?.scheduler.lastCycleFinishedAt ?? null, nowMs)}
              </strong>
            </div>
            <div className="predictionActivityLine">
              <span>Reason</span>
              <strong title={predictionActivityReasonDetail.rawReason ?? "n/a"}>
                {activityLoading ? "..." : predictionActivityReasonDetail.shortReason}
              </strong>
            </div>
            {isPredictionActivityStale ? (
              <div className="predictionActivityWarning">
                No fresh signal calculation in {Math.ceil(staleAfterMs / 60000)}m.
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card predictionsSection">
        <div className="predictionsRunningHeader">
          <div style={{ fontWeight: 700 }}>
            Running Auto Predictions ({filteredRunningRows.length}/{runningRows.length})
          </div>
          <div className="predictionsRunningActions">
            <select
              className="input"
              value={runningStatusFilter}
              onChange={(e) => setRunningStatusFilter(e.target.value as RunningStatusFilter)}
              style={{ minWidth: 150 }}
            >
              <option value="all">Status: all</option>
              <option value="running">Status: running</option>
              <option value="paused">Status: paused</option>
            </select>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void Promise.all([loadRunningPredictions(), loadPredictionActivity()]);
              }}
              disabled={runningLoading}
            >
              {runningLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {runningLoading ? (
          <div style={{ color: "var(--muted)" }}>Loading running schedules…</div>
        ) : runningRows.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>
            No running auto-predictions. Enable <code>Auto schedule</code> when creating a prediction.
          </div>
        ) : filteredRunningRows.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>
            No entries for selected status filter.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "8px 6px" }}>Pair</th>
                  <th style={{ padding: "8px 6px" }}>TF</th>
                  <th style={{ padding: "8px 6px" }}>Market</th>
                  <th style={{ padding: "8px 6px" }}>Account</th>
                  <th style={{ padding: "8px 6px" }}>Prefs</th>
                  <th style={{ padding: "8px 6px" }}>Status</th>
                  <th style={{ padding: "8px 6px" }}>Next run</th>
                  <th style={{ padding: "8px 6px" }}>Actions</th>
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
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      {row.paused ? "paused" : "running"}
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      {row.paused ? "paused" : row.dueInSec <= 0 ? "due now" : `in ${fmtMs(row.dueInSec * 1000)}`}
                    </td>
                    <td style={{ padding: "8px 6px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        type="button"
                        disabled={runningActionId === row.id}
                        onClick={() => void togglePausePrediction(row)}
                      >
                        {row.paused ? "Resume" : "Pause prediction"}
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={runningActionId === row.id}
                        onClick={() => void deleteRunningPrediction(row.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="predictionsCleanupRow">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Older than (days)</span>
            <input
              className="input"
              type="number"
              min="1"
              max="3650"
              step="1"
              value={clearOldDays}
              onChange={(e) => setClearOldDays(e.target.value)}
              style={{ width: 120 }}
            />
          </label>
          <button
            className="btn"
            type="button"
            disabled={clearingOld}
            onClick={() => void clearOldPredictions()}
          >
            {clearingOld ? "Clearing..." : "Clear old predictions"}
          </button>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Deletes historical rows but keeps active schedule templates.
          </span>
        </div>
      </section>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Load error:</strong> {error}
        </div>
      ) : null}

      {actionError ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Action failed:</strong> {actionError}
        </div>
      ) : null}

      {detailsError ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Detail load failed:</strong> {detailsError}
        </div>
      ) : null}

      {notice ? (
        <div className="card" style={{ padding: 12, borderColor: "#f59e0b", marginBottom: 12 }}>
          <strong>Notice:</strong> {notice}
        </div>
      ) : null}

      <section className="card predictionsSection">
        <div className="predictionsFiltersGrid">
          <input
            className="input"
            placeholder="Filter symbol..."
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
          />
          <select className="input" value={filterSignal} onChange={(e) => setFilterSignal(e.target.value as PredictionSignal | "all")}>
            <option value="all">All signals</option>
            <option value="up">up</option>
            <option value="down">down</option>
            <option value="neutral">neutral</option>
          </select>
          <select className="input" value={filterTimeframe} onChange={(e) => setFilterTimeframe(e.target.value as PredictionTimeframe | "all")}>
            <option value="all">All TF</option>
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
          <select className="input" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <option value="newest">Sort: Newest</option>
            <option value="confidence">Sort: Confidence</option>
            <option value="move">Sort: Move size</option>
          </select>
          <button
            className="btn"
            type="button"
            onClick={() => {
              void Promise.all([
                loadPredictions(),
                loadPredictionQuality(),
                loadPredictionActivity()
              ]);
            }}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void clearListedPredictions()}
            disabled={clearingListed || filteredRows.length === 0}
            title={filteredRows.length === 0 ? "No rows match current filters" : "Delete currently listed rows"}
          >
            {clearingListed ? "Deleting..." : `Clear listed (${filteredRows.length})`}
          </button>
        </div>
      </section>

      {loading ? (
        <div className="card" style={{ padding: 14 }}>Loading predictions…</div>
      ) : filteredRows.length === 0 ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>No predictions found</div>
          <div style={{ color: "var(--muted)" }}>
            Adjust filters or create a new prediction above.
          </div>
        </div>
      ) : (
        <section className="card" style={{ padding: 12 }}>
          <div className="predictionsDesktopTableWrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "8px 6px" }}>Symbol</th>
                  <th style={{ padding: "8px 6px" }}>Market</th>
                  <th style={{ padding: "8px 6px" }}>TF</th>
                  <th style={{ padding: "8px 6px" }}>Signal</th>
                  <th style={{ padding: "8px 6px" }}>Confidence</th>
                  <th style={{ padding: "8px 6px" }}>Move</th>
                  <th style={{ padding: "8px 6px" }}>Auto</th>
                  <th style={{ padding: "8px 6px" }}>Outcome</th>
                  <th style={{ padding: "8px 6px" }}>Outcome PnL</th>
                  <th style={{ padding: "8px 6px" }}>Tags / Explanation</th>
                  <th style={{ padding: "8px 6px" }}>Last Updated</th>
                  <th style={{ padding: "8px 6px" }}>Change</th>
                  <th style={{ padding: "8px 6px" }}>Created</th>
                  <th style={{ padding: "8px 6px" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const confidencePct = confidenceToPct(row.confidence);
                  const targetPct =
                    typeof row.confidenceTargetPct === "number" &&
                    Number.isFinite(row.confidenceTargetPct)
                      ? Math.max(0, Math.min(100, row.confidenceTargetPct))
                      : 0;
                  const belowTarget = confidencePct < targetPct;
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
                        className={flipRecently ? "predictionRowFlipRecent" : undefined}
                        style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}
                      >
                        <td style={{ padding: "8px 6px", fontWeight: 700 }}>{row.symbol}</td>
                        <td style={{ padding: "8px 6px" }}>{row.marketType}</td>
                        <td style={{ padding: "8px 6px" }}>{row.timeframe}</td>
                        <td style={{ padding: "8px 6px" }}>
                          <span className="badge" style={signalBadgeStyle(row.signal)}>{row.signal}</span>
                        </td>
                        <td style={{ padding: "8px 6px" }}>{fmtConfidence(row.confidence)}</td>
                        <td style={{ padding: "8px 6px" }}>{row.expectedMovePct.toFixed(2)}%</td>
                        <td style={{ padding: "8px 6px" }}>
                          <div>{row.autoScheduleEnabled ? "enabled" : "off"}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            Next: {nextAutoRunText(row, nowMs)}
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
                            {row.signal === "neutral" ? (
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                                No trade setup
                              </span>
                            ) : belowTarget ? (
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                                Below confidence target ({targetPct.toFixed(0)}%)
                              </span>
                            ) : (
                              <button
                                className="btn btnPrimary"
                                onClick={() => void sendToDesk(row.id)}
                                disabled={sendingId === row.id || !row.accountId}
                                title={row.accountId ? "Prefill trade ticket" : "Create an exchange account first"}
                              >
                                {sendingId === row.id ? "Sending..." : "Send to Trading Desk"}
                              </button>
                            )}
                            <button
                              className="btn"
                              type="button"
                              onClick={() => void togglePredictionDetail(row.id)}
                              disabled={loadingDetail && !expanded}
                            >
                              {expanded ? "Hide details" : "Details"}
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
              const confidencePct = confidenceToPct(row.confidence);
              const targetPct =
                typeof row.confidenceTargetPct === "number" &&
                Number.isFinite(row.confidenceTargetPct)
                  ? Math.max(0, Math.min(100, row.confidenceTargetPct))
                  : 0;
              const belowTarget = confidencePct < targetPct;
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
                <div key={`${row.id}_mobile`} className="card predictionRowCard">
                  <div className="predictionRowCardHeader">
                    <div className="predictionRowCardSymbol">{row.symbol}</div>
                    <span className="badge" style={signalBadgeStyle(row.signal)}>{row.signal}</span>
                  </div>

                  <div className="predictionRowCardMeta">
                    <span>{row.marketType}</span>
                    <span>{row.timeframe}</span>
                    <span>{new Date(row.tsCreated).toLocaleString()}</span>
                    <span title={updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}>
                      Updated {formatRelativeTime(updatedAtIso, nowMs)}
                    </span>
                  </div>

                  <div className="predictionRowCardStats">
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Confidence</div>
                      <div className="predictionRowCardStatValue">{fmtConfidence(row.confidence)}</div>
                    </div>
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Move</div>
                      <div className="predictionRowCardStatValue">{row.expectedMovePct.toFixed(2)}%</div>
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
                    <span>{row.autoScheduleEnabled ? "Auto: enabled" : "Auto: off"}</span>
                    <span>Next: {nextAutoRunText(row, nowMs)}</span>
                  </div>

                  <div className="predictionRowCardActions">
                    {row.signal === "neutral" ? (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>
                        No trade setup
                      </span>
                    ) : belowTarget ? (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>
                        Below confidence target ({targetPct.toFixed(0)}%)
                      </span>
                    ) : (
                      <button
                        className="btn btnPrimary"
                        onClick={() => void sendToDesk(row.id)}
                        disabled={sendingId === row.id || !row.accountId}
                        title={row.accountId ? "Prefill trade ticket" : "Create an exchange account first"}
                      >
                        {sendingId === row.id ? "Sending..." : "Send to Trading Desk"}
                      </button>
                    )}
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void togglePredictionDetail(row.id)}
                      disabled={loadingDetail && !expanded}
                    >
                      {expanded ? "Hide details" : "Details"}
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
        </section>
      )}
    </div>
  );
}
