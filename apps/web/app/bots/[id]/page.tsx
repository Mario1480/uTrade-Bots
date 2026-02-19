"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";
import { getBotStartStopUi } from "../../../src/bots/controls";

type BotDetail = {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  status: string;
  exchangeAccount?: {
    id: string;
    exchange: string;
    label: string;
  } | null;
  futuresConfig?: {
    strategyKey: string;
    marginMode: string;
    leverage: number;
    tickMs: number;
    testnet: boolean;
    predictionCopier?: {
      sourceStateId?: string | null;
      sourceSnapshot?: {
        symbol?: string;
        timeframe?: string;
        strategyRef?: string | null;
      } | null;
    } | null;
  } | null;
  runtime?: {
    status: string;
    reason: string | null;
    updatedAt: string;
    lastError?: string | null;
    lastErrorAt?: string | null;
  } | null;
};

type BotOverviewDetail = {
  runtime?: {
    status?: string | null;
    reason?: string | null;
    updatedAt?: string | null;
    lastError?: string | null;
    lastErrorAt?: string | null;
    mid?: number | null;
    bid?: number | null;
    ask?: number | null;
  } | null;
  trade?: {
    openSide?: string | null;
    openQty?: number | null;
    openEntryPrice?: number | null;
    openPnlUsd?: number | null;
    realizedPnlTodayUsd?: number | null;
    realizedPnlTotalUsd?: number | null;
    openTradesCount?: number | null;
    openTs?: string | null;
    dailyTradeCount?: number | null;
    lastTradeTs?: string | null;
    lastSignal?: string | null;
    lastSignalTs?: string | null;
  } | null;
  stoppedWhy?: string | null;
  opsMetrics?: {
    isOpen?: boolean;
    openNotionalApprox?: number | null;
    openPnlUsd?: number | null;
    realizedPnlTodayUsd?: number | null;
    realizedPnlTotalUsd?: number | null;
    openTradesCount?: number | null;
    dailyTradeCount?: number | null;
    lastTradeTs?: string | null;
    lastSignal?: string | null;
    lastSignalTs?: string | null;
    lastPredictionConfidence?: number | null;
    winRatePct?: number | null;
    avgWinUsd?: number | null;
    avgLossUsd?: number | null;
    profitFactor?: number | null;
    netPnlUsd?: number | null;
    maxDrawdownUsd?: number | null;
    avgHoldMinutes?: number | null;
    closedTrades?: number | null;
    wins?: number | null;
    losses?: number | null;
  } | null;
  recentEvents?: Array<{
    id: string;
    type: string;
    message?: string | null;
    createdAt: string;
    meta?: Record<string, unknown> | null;
  }>;
};

type BotOpenTradesResponse = {
  botPosition?: {
    side?: string | null;
    qty?: number | null;
    entryPrice?: number | null;
    openTs?: string | null;
    tpPrice?: number | null;
    slPrice?: number | null;
  } | null;
  exchangePosition?: {
    side?: string | null;
    qty?: number | null;
    entryPrice?: number | null;
    markPrice?: number | null;
    unrealizedPnl?: number | null;
    tpPrice?: number | null;
    slPrice?: number | null;
  } | null;
  mergedView?: {
    symbol?: string | null;
    side?: string | null;
    qty?: number | null;
    entryPrice?: number | null;
    markPrice?: number | null;
    tpPrice?: number | null;
    slPrice?: number | null;
    unrealizedPnlUsd?: number | null;
    openTs?: string | null;
  } | null;
  consistency?: "matched" | "mismatch" | "missing_live" | "live_only" | "none";
  exchangeError?: string | null;
  updatedAt?: string | null;
};

type BotTradeHistoryItem = {
  id: string;
  side: string | null;
  status: string;
  entryTs: string;
  entryPrice: number;
  entryQty: number;
  tpPrice: number | null;
  slPrice: number | null;
  exitTs: string | null;
  exitPrice: number | null;
  realizedPnlUsd: number | null;
  realizedPnlPct: number | null;
  outcome: string | null;
  exitReason: string | null;
};

type BotTradeHistoryResponse = {
  items: BotTradeHistoryItem[];
  nextCursor: string | null;
  summary?: {
    count: number;
    wins: number;
    losses: number;
    netPnlUsd: number;
  };
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleString();
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "n/a";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return parsed.toFixed(digits);
}

function formatPnl(value: number | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  const sign = parsed > 0 ? "+" : "";
  return `${sign}${parsed.toFixed(2)} USDT`;
}

function formatPct(value: number | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  const sign = parsed > 0 ? "+" : "";
  return `${sign}${parsed.toFixed(2)}%`;
}

function normalizePositionSide(value: unknown): "long" | "short" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("long")) return "long";
  if (normalized.includes("short")) return "short";
  return null;
}

function toUtcDayStartIso(value: string | null): string | null {
  if (!value) return null;
  const [yy, mm, dd] = value.split("-").map((v) => Number(v));
  if (!yy || !mm || !dd) return null;
  return new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0)).toISOString();
}

function toUtcDayEndIso(value: string | null): string | null {
  if (!value) return null;
  const [yy, mm, dd] = value.split("-").map((v) => Number(v));
  if (!yy || !mm || !dd) return null;
  return new Date(Date.UTC(yy, mm - 1, dd, 23, 59, 59, 999)).toISOString();
}

export default function BotDetailsPage() {
  const t = useTranslations("system.botsDetails");
  const params = useParams();
  const id = params.id as string;

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [overview, setOverview] = useState<BotOverviewDetail | null>(null);
  const [openTrades, setOpenTrades] = useState<BotOpenTradesResponse | null>(null);
  const [history, setHistory] = useState<BotTradeHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOutcome, setHistoryOutcome] = useState<string>("all");
  const [historyFrom, setHistoryFrom] = useState<string>("");
  const [historyTo, setHistoryTo] = useState<string>("");
  const [busy, setBusy] = useState<"start" | "stop" | "" | null>(null);
  const [stopAndCloseRequested, setStopAndCloseRequested] = useState(false);
  const [closingPosition, setClosingPosition] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildHistoryPath(cursor?: string | null): string {
    const query = new URLSearchParams();
    query.set("limit", "20");
    if (cursor) query.set("cursor", cursor);
    if (historyOutcome !== "all") query.set("outcome", historyOutcome);
    const fromIso = toUtcDayStartIso(historyFrom || null);
    const toIso = toUtcDayEndIso(historyTo || null);
    if (fromIso) query.set("from", fromIso);
    if (toIso) query.set("to", toIso);
    return `/bots/${id}/trade-history?${query.toString()}`;
  }

  async function loadBase() {
    setError(null);
    try {
      const [b, o, ot] = await Promise.all([
        apiGet<BotDetail>(`/bots/${id}`),
        apiGet<BotOverviewDetail>(`/bots/${id}/overview?limit=10`).catch(() => null),
        apiGet<BotOpenTradesResponse>(`/bots/${id}/open-trades`).catch(() => null)
      ]);
      setBot(b);
      setOverview(o);
      setOpenTrades(ot);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function loadHistory(options?: { cursor?: string | null; append?: boolean }) {
    setHistoryLoading(true);
    try {
      const next = await apiGet<BotTradeHistoryResponse>(buildHistoryPath(options?.cursor ?? null));
      setHistory((prev) => {
        if (!options?.append || !prev) return next;
        return {
          ...next,
          items: [...prev.items, ...(next.items ?? [])]
        };
      });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    void loadBase();
    const timer = setInterval(() => {
      void loadBase();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, historyOutcome, historyFrom, historyTo]);

  async function startBot() {
    setBusy("start");
    setError(null);
    try {
      await apiPost(`/bots/${id}/start`, {});
      await loadBase();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  async function stopBot(closeOpenPosition = false) {
    setBusy("stop");
    setStopAndCloseRequested(closeOpenPosition);
    setError(null);
    try {
      const result = await apiPost<{
        positionClose?: {
          error?: string;
        };
      }>(`/bots/${id}/stop`, closeOpenPosition ? { closeOpenPosition: true } : {});
      if (closeOpenPosition && result?.positionClose?.error) {
        setError(`${t("actions.stopAndClose")} (${result.positionClose.error})`);
      }
      await loadBase();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy("");
      setStopAndCloseRequested(false);
    }
  }

  async function closeOpenPositionManually() {
    if (!bot?.exchangeAccount?.id) {
      setError(t("openTrades.closeMissingAccount"));
      return;
    }
    setClosingPosition(true);
    setError(null);
    try {
      const side =
        normalizePositionSide(openTrades?.mergedView?.side) ??
        normalizePositionSide(openTrades?.botPosition?.side) ??
        normalizePositionSide(openTrades?.exchangePosition?.side);
      await apiPost("/api/positions/close", {
        exchangeAccountId: bot.exchangeAccount.id,
        symbol: bot.symbol,
        ...(side ? { side } : {})
      });
      await Promise.all([loadBase(), loadHistory()]);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setClosingPosition(false);
    }
  }

  const runtime = overview?.runtime ?? bot?.runtime ?? null;
  const stoppedWhy = overview?.stoppedWhy ?? runtime?.lastError ?? runtime?.reason ?? null;
  const openPositionText = overview?.trade?.openSide && Number(overview.trade?.openQty ?? 0) > 0
    ? `${overview.trade.openSide} ${overview.trade.openQty} @ ${overview.trade.openEntryPrice ?? "n/a"}`
    : t("na");

  const consistencyLabel = useMemo(() => {
    const raw = openTrades?.consistency;
    if (!raw) return t("na");
    return t(`openTrades.consistency.${raw}` as any);
  }, [openTrades?.consistency, t]);
  const hasOpenPosition = Boolean(openTrades?.mergedView);
  const openTradeUnrealizedPnl =
    openTrades?.mergedView?.unrealizedPnlUsd
    ?? overview?.opsMetrics?.openPnlUsd
    ?? null;

  if (!bot) {
    return (
      <div className="card" style={{ padding: 14 }}>
        {error ? `${t("loadError")}: ${error}` : t("loading")}
      </div>
    );
  }

  const startStopUi = getBotStartStopUi(bot.status, busy, {
    start: t("actions.start"),
    starting: t("actions.starting"),
    stop: t("actions.stop"),
    stopping: t("actions.stopping")
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{bot.name}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{bot.exchange} · {bot.symbol}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/bots" className="btn">{t("actions.back")}</Link>
          <Link href={`/bots/${id}/settings`} className="btn">{t("actions.settings")}</Link>
          <button className={startStopUi.startClassName} onClick={startBot} disabled={startStopUi.startDisabled}>
            {startStopUi.startLabel}
          </button>
          <button className={startStopUi.stopClassName} onClick={() => void stopBot(false)} disabled={startStopUi.stopDisabled}>
            {startStopUi.stopLabel}
          </button>
          <button
            className={startStopUi.stopClassName}
            onClick={() => void stopBot(true)}
            disabled={startStopUi.stopDisabled || !hasOpenPosition}
          >
            {busy === "stop" && stopAndCloseRequested ? t("actions.stoppingAndClosing") : t("actions.stopAndClose")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <BotAccordionSection title={t("sections.overview")}>
        <div className="botDetailGrid">
          <InfoRow label={t("fields.botStatus")} value={bot.status} />
          <InfoRow label={t("fields.exchangeAccount")} value={bot.exchangeAccount?.label ?? "-"} />
          <InfoRow label={t("fields.runnerStatus")} value={runtime?.status ?? t("na")} />
          <InfoRow label={t("fields.runtimeReason")} value={runtime?.reason ?? "-"} />
          <InfoRow label={t("fields.runtimeUpdated")} value={runtime?.updatedAt ? formatDateTime(runtime.updatedAt) : "-"} />
          <InfoRow label={t("fields.runtimeLastError")} value={runtime?.lastError ?? "-"} />
        </div>
      </BotAccordionSection>

      {bot.status !== "running" ? (
        <BotAccordionSection title={t("sections.whyStopped")}>
          <div className="botReasonText" style={{ fontSize: 13 }}>
            {stoppedWhy ?? t("sections.noStoppedReason")}
          </div>
        </BotAccordionSection>
      ) : null}

      <BotAccordionSection title={t("sections.opsMetrics")}>
        <div className="botOpsGrid">
          <InfoRow label={t("metrics.openPosition")} value={openPositionText} />
          <InfoRow label={t("metrics.isOpen")} value={overview?.opsMetrics?.isOpen ? t("metrics.yes") : t("metrics.no")} />
          <InfoRow label={t("metrics.openNotionalApprox")} value={formatNumber(overview?.opsMetrics?.openNotionalApprox, 2)} />
          <InfoRow label={t("metrics.openPnlUsdt")} value={formatPnl(overview?.opsMetrics?.openPnlUsd)} />
          <InfoRow label={t("metrics.realizedPnlTodayUsdt")} value={formatPnl(overview?.opsMetrics?.realizedPnlTodayUsd)} />
          <InfoRow label={t("metrics.realizedPnlTotalUsdt")} value={formatPnl(overview?.opsMetrics?.realizedPnlTotalUsd)} />
          <InfoRow label={t("metrics.openTradesCount")} value={overview?.opsMetrics?.openTradesCount ?? 0} />
          <InfoRow label={t("metrics.dailyTradeCount")} value={overview?.opsMetrics?.dailyTradeCount ?? 0} />
          <InfoRow label={t("metrics.lastTradeTs")} value={formatDateTime(overview?.opsMetrics?.lastTradeTs)} />
          <InfoRow label={t("metrics.lastSignal")} value={overview?.opsMetrics?.lastSignal ?? t("na")} />
          <InfoRow label={t("metrics.lastSignalTs")} value={formatDateTime(overview?.opsMetrics?.lastSignalTs)} />
          <InfoRow label={t("metrics.lastPredictionConfidence")} value={formatNumber(overview?.opsMetrics?.lastPredictionConfidence, 2)} />
          <InfoRow label={t("metrics.winRatePct")} value={formatPct(overview?.opsMetrics?.winRatePct)} />
          <InfoRow label={t("metrics.avgWinUsd")} value={formatPnl(overview?.opsMetrics?.avgWinUsd)} />
          <InfoRow label={t("metrics.avgLossUsd")} value={formatPnl(overview?.opsMetrics?.avgLossUsd)} />
          <InfoRow label={t("metrics.profitFactor")} value={formatNumber(overview?.opsMetrics?.profitFactor, 2)} />
          <InfoRow label={t("metrics.netPnlUsd")} value={formatPnl(overview?.opsMetrics?.netPnlUsd)} />
          <InfoRow label={t("metrics.maxDrawdownUsd")} value={formatPnl(overview?.opsMetrics?.maxDrawdownUsd)} />
          <InfoRow label={t("metrics.avgHoldMinutes")} value={formatNumber(overview?.opsMetrics?.avgHoldMinutes, 1)} />
        </div>
      </BotAccordionSection>

      <BotAccordionSection title={t("sections.openTrades")}>
        <div className="botTradeHistorySummary" style={{ marginBottom: 10 }}>
          <span>{t("openTrades.consistencyLabel")}: {consistencyLabel}</span>
          <span>{t("openTrades.updated")}: {formatDateTime(openTrades?.updatedAt ?? null)}</span>
          <button
            className="btn"
            onClick={() => void closeOpenPositionManually()}
            disabled={!hasOpenPosition || closingPosition}
          >
            {closingPosition ? t("openTrades.closingAction") : t("openTrades.closeAction")}
          </button>
        </div>
        {openTrades?.exchangeError ? (
          <div className="botReasonText" style={{ marginBottom: 10, color: "#fca5a5", fontSize: 12 }}>
            {t("openTrades.exchangeError")}: {openTrades.exchangeError}
          </div>
        ) : null}
        <div className="botTradeHistoryTableWrap">
          <table className="botTradeHistoryTable">
            <thead>
              <tr>
                <th>{t("openTrades.columns.side")}</th>
                <th>{t("openTrades.columns.size")}</th>
                <th>{t("openTrades.columns.entry")}</th>
                <th>{t("openTrades.columns.mark")}</th>
                <th>{t("openTrades.columns.tp")}</th>
                <th>{t("openTrades.columns.sl")}</th>
                <th>{t("openTrades.columns.unrealized")}</th>
                <th>{t("openTrades.columns.openTs")}</th>
                <th>{t("openTrades.columns.action")}</th>
              </tr>
            </thead>
            <tbody>
              {openTrades?.mergedView ? (
                <tr>
                  <td>{openTrades.mergedView.side ?? "-"}</td>
                  <td>{formatNumber(openTrades.mergedView.qty, 6)}</td>
                  <td>{formatNumber(openTrades.mergedView.entryPrice, 4)}</td>
                  <td>{formatNumber(openTrades.mergedView.markPrice, 4)}</td>
                  <td>{formatNumber(openTrades.mergedView.tpPrice, 4)}</td>
                  <td>{formatNumber(openTrades.mergedView.slPrice, 4)}</td>
                  <td className={Number(openTradeUnrealizedPnl ?? 0) > 0 ? "botPnlPositive" : Number(openTradeUnrealizedPnl ?? 0) < 0 ? "botPnlNegative" : ""}>
                    {formatPnl(openTradeUnrealizedPnl)}
                  </td>
                  <td>{formatDateTime(openTrades.mergedView.openTs)}</td>
                  <td>
                    <button
                      className="btn"
                      onClick={() => void closeOpenPositionManually()}
                      disabled={closingPosition}
                    >
                      {closingPosition ? t("openTrades.closingAction") : t("openTrades.closeAction")}
                    </button>
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={9} style={{ color: "var(--muted)" }}>{t("openTrades.empty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </BotAccordionSection>

      <BotAccordionSection title={t("sections.tradeHistory")}>
        <div className="botTradeHistoryFilters">
          <div className="fieldRow" style={{ marginBottom: 0 }}>
            <label>{t("history.filters.from")}</label>
            <input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} />
          </div>
          <div className="fieldRow" style={{ marginBottom: 0 }}>
            <label>{t("history.filters.to")}</label>
            <input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} />
          </div>
          <div className="fieldRow" style={{ marginBottom: 0 }}>
            <label>{t("history.filters.outcome")}</label>
            <select value={historyOutcome} onChange={(e) => setHistoryOutcome(e.target.value)}>
              <option value="all">{t("history.outcomes.all")}</option>
              <option value="tp_hit">{t("history.outcomes.tp_hit")}</option>
              <option value="sl_hit">{t("history.outcomes.sl_hit")}</option>
              <option value="signal_exit">{t("history.outcomes.signal_exit")}</option>
              <option value="manual_exit">{t("history.outcomes.manual_exit")}</option>
              <option value="time_stop">{t("history.outcomes.time_stop")}</option>
              <option value="unknown">{t("history.outcomes.unknown")}</option>
            </select>
          </div>
          <button className="btn" onClick={() => void loadHistory()} disabled={historyLoading}>
            {historyLoading ? t("history.loading") : t("history.actions.refresh")}
          </button>
        </div>

        <div className="botTradeHistorySummary">
          <span>{t("history.summary.count")}: {history?.summary?.count ?? 0}</span>
          <span>{t("history.summary.wins")}: {history?.summary?.wins ?? 0}</span>
          <span>{t("history.summary.losses")}: {history?.summary?.losses ?? 0}</span>
          <span className={Number(history?.summary?.netPnlUsd ?? 0) > 0 ? "botPnlPositive" : Number(history?.summary?.netPnlUsd ?? 0) < 0 ? "botPnlNegative" : ""}>
            {t("history.summary.netPnl")}: {formatPnl(history?.summary?.netPnlUsd)}
          </span>
        </div>

        <div className="botTradeHistoryTableWrap">
          <table className="botTradeHistoryTable">
            <thead>
              <tr>
                <th>{t("history.columns.entryTs")}</th>
                <th>{t("history.columns.entryPrice")}</th>
                <th>{t("history.columns.exitTs")}</th>
                <th>{t("history.columns.exitPrice")}</th>
                <th>{t("history.columns.tp")}</th>
                <th>{t("history.columns.sl")}</th>
                <th>{t("history.columns.side")}</th>
                <th>{t("history.columns.qty")}</th>
                <th>{t("history.columns.outcome")}</th>
                <th>{t("history.columns.exitReason")}</th>
                <th>{t("history.columns.realizedPnlUsd")}</th>
                <th>{t("history.columns.realizedPnlPct")}</th>
              </tr>
            </thead>
            <tbody>
              {(history?.items?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={12} style={{ color: "var(--muted)" }}>{t("history.empty")}</td>
                </tr>
              ) : (
                history?.items.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.entryTs)}</td>
                    <td>{formatNumber(row.entryPrice, 4)}</td>
                    <td>{formatDateTime(row.exitTs)}</td>
                    <td>{formatNumber(row.exitPrice, 4)}</td>
                    <td>{formatNumber(row.tpPrice, 4)}</td>
                    <td>{formatNumber(row.slPrice, 4)}</td>
                    <td>{row.side ?? "-"}</td>
                    <td>{formatNumber(row.entryQty, 6)}</td>
                    <td>{row.outcome ? t(`history.outcomes.${row.outcome}` as any) : "-"}</td>
                    <td className="botReasonText">{row.exitReason ?? "-"}</td>
                    <td className={Number(row.realizedPnlUsd ?? 0) > 0 ? "botPnlPositive" : Number(row.realizedPnlUsd ?? 0) < 0 ? "botPnlNegative" : ""}>
                      {formatPnl(row.realizedPnlUsd)}
                    </td>
                    <td className={Number(row.realizedPnlPct ?? 0) > 0 ? "botPnlPositive" : Number(row.realizedPnlPct ?? 0) < 0 ? "botPnlNegative" : ""}>
                      {formatPct(row.realizedPnlPct)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {history?.nextCursor ? (
          <div style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={() => void loadHistory({ cursor: history.nextCursor, append: true })}
              disabled={historyLoading}
            >
              {historyLoading ? t("history.loading") : t("history.actions.loadMore")}
            </button>
          </div>
        ) : null}
      </BotAccordionSection>

      <BotAccordionSection title={t("sections.recentEvents")} defaultOpen={false}>
        {!overview?.recentEvents?.length ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("sections.noEvents")}</div>
        ) : (
          <div className="botEventList">
            {overview.recentEvents.map((event) => (
              <article key={event.id} className="botEventItem">
                <div className="botEventHead">
                  <span className="badge">{event.type}</span>
                  <span className="botEventTime">{formatDateTime(event.createdAt)}</span>
                </div>
                <div className="botEventMessage">{event.message ?? "-"}</div>
              </article>
            ))}
          </div>
        )}
      </BotAccordionSection>

      <BotAccordionSection title={t("futuresConfigTitle")} defaultOpen={false}>
        <div className="botDetailGrid">
          <InfoRow label={t("fields.strategy")} value={bot.futuresConfig?.strategyKey ?? "-"} />
          <InfoRow label={t("fields.marginMode")} value={bot.futuresConfig?.marginMode ?? "-"} />
          <InfoRow label={t("fields.leverage")} value={bot.futuresConfig?.leverage ?? "-"} />
          <InfoRow label={t("fields.tickInterval")} value={bot.futuresConfig?.tickMs ? `${bot.futuresConfig.tickMs} ms` : "-"} />
          <InfoRow label={t("fields.testnet")} value={String(bot.futuresConfig?.testnet ?? false)} />
          {bot.futuresConfig?.strategyKey === "prediction_copier" ? (
            <InfoRow
              label={t("fields.predictionSource")}
              value={bot.futuresConfig?.predictionCopier?.sourceSnapshot?.symbol
                ? `${bot.futuresConfig.predictionCopier.sourceSnapshot.symbol} · ${bot.futuresConfig.predictionCopier.sourceSnapshot.timeframe ?? "-"}`
                : (bot.futuresConfig?.predictionCopier?.sourceStateId ?? "-")}
            />
          ) : null}
        </div>
      </BotAccordionSection>
    </div>
  );
}

function BotAccordionSection({
  title,
  defaultOpen = true,
  children
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="card botAccordionCard" open={defaultOpen}>
      <summary className="botAccordionSummary">{title}</summary>
      <div className="botAccordionBody">{children}</div>
    </details>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 14 }}>{String(value)}</div>
    </div>
  );
}
