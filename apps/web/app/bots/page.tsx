"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import { Suspense, useEffect, useMemo, useState } from "react";
import { getBotStartStopUi } from "../../src/bots/controls";

type BotOverviewItem = {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  exchangeAccountId?: string | null;
  status: "running" | "stopped" | "error" | string;
  stoppedWhy?: string | null;
  exchangeAccount?: {
    id: string;
    exchange: string;
    label: string;
  } | null;
  runtime?: {
    status?: string | null;
    updatedAt?: string | null;
    reason?: string | null;
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

function formatPnl(value: number | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  const sign = parsed > 0 ? "+" : "";
  return `${sign}${parsed.toFixed(2)} USDT`;
}

function BotsPageContent() {
  const t = useTranslations("system.botsList");
  const searchParams = useSearchParams();
  const [bots, setBots] = useState<BotOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<Record<string, "start" | "stop" | "delete" | null>>({});

  const exchangeAccountId = searchParams.get("exchangeAccountId");
  const statusFilter = searchParams.get("status");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (exchangeAccountId) query.set("exchangeAccountId", exchangeAccountId);
      if (statusFilter) query.set("status", statusFilter);
      const path = query.toString() ? `/bots/overview?${query.toString()}` : "/bots/overview";
      const data = await apiGet<BotOverviewItem[]>(path);
      setBots(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    void load().catch(() => undefined);
    const timer = setInterval(() => {
      if (!mounted) return;
      void load().catch(() => undefined);
    }, 6000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeAccountId, statusFilter]);

  const titleSuffix = useMemo(() => {
    if (!exchangeAccountId) return "";
    return t("titleSuffix", { account: `${exchangeAccountId.slice(0, 8)}…` });
  }, [exchangeAccountId, t]);

  function setBusy(id: string, action: "start" | "stop" | "delete" | null) {
    setActionBusy((prev) => ({ ...prev, [id]: action }));
  }

  async function startBot(bot: BotOverviewItem) {
    setBusy(bot.id, "start");
    setError(null);
    try {
      await apiPost(`/bots/${bot.id}/start`, {});
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(bot.id, null);
    }
  }

  async function stopBot(bot: BotOverviewItem) {
    setBusy(bot.id, "stop");
    setError(null);
    try {
      await apiPost(`/bots/${bot.id}/stop`, {});
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(bot.id, null);
    }
  }

  async function removeBot(bot: BotOverviewItem) {
    const ok = window.confirm(t("confirmDelete", { name: bot.name, symbol: bot.symbol }));
    if (!ok) return;
    setBusy(bot.id, "delete");
    setError(null);
    try {
      await apiPost(`/bots/${bot.id}/delete`);
      setBots((prev) => prev.filter((row) => row.id !== bot.id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(bot.id, null);
    }
  }

  return (
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{t("title")}{titleSuffix}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {statusFilter ? t("statusFilter", { status: statusFilter }) : t("allStatuses")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/dashboard" className="btn">{t("actions.dashboard")}</Link>
          <Link href="/bots/new" className="btn btnPrimary">{t("actions.newBot")}</Link>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>{t("loadError")}:</strong> {error}
        </div>
      ) : null}

      <div className="botGrid">
        {loading ? (
          <div className="card" style={{ padding: 16 }}>{t("loading")}</div>
        ) : bots.length === 0 ? (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("emptyTitle")}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
              {t("emptyHint")}
            </div>
            <Link href="/bots/new" className="btn btnPrimary">{t("actions.createBot")}</Link>
          </div>
        ) : (
          bots.map((bot) => {
            const openPosition = bot.trade?.openSide && Number(bot.trade?.openQty ?? 0) > 0
              ? `${bot.trade.openSide} ${bot.trade.openQty} @ ${bot.trade.openEntryPrice ?? "n/a"}`
              : t("metrics.none");
            const busy = actionBusy[bot.id];
            const startStopUi = getBotStartStopUi(bot.status, busy, {
              start: t("actions.start"),
              starting: t("actions.starting"),
              stop: t("actions.stop"),
              stopping: t("actions.stopping")
            });
            return (
            <article key={bot.id} className="card botCard">
              <div className="botCardHeader">
                <div>
                  <div className="botName">{bot.name}</div>
                  <div className="botMeta">
                    {bot.exchangeAccount?.label ?? t("noAccount")} · {bot.exchange} · {bot.symbol}
                  </div>
                </div>
                <span className={`badge ${bot.status === "running" ? "badgeOk" : bot.status === "error" ? "badgeDanger" : "badgeWarn"}`}>
                  {bot.status}
                </span>
              </div>

              <div className="botMiniMetrics">
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.openPosition")}</span>
                  <span className="botMiniMetricValue">{openPosition}</span>
                </div>
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.tradesToday")}</span>
                  <span className="botMiniMetricValue">{bot.trade?.dailyTradeCount ?? 0}</span>
                </div>
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.openPnlUsdt")}</span>
                  <span
                    className={`botMiniMetricValue ${
                      Number(bot.trade?.openPnlUsd ?? 0) > 0
                        ? "botPnlPositive"
                        : Number(bot.trade?.openPnlUsd ?? 0) < 0
                          ? "botPnlNegative"
                          : ""
                    }`}
                  >
                    {formatPnl(bot.trade?.openPnlUsd)}
                  </span>
                </div>
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.realizedPnlTodayUsdt")}</span>
                  <span
                    className={`botMiniMetricValue ${
                      Number(bot.trade?.realizedPnlTodayUsd ?? 0) > 0
                        ? "botPnlPositive"
                        : Number(bot.trade?.realizedPnlTodayUsd ?? 0) < 0
                          ? "botPnlNegative"
                          : ""
                    }`}
                  >
                    {formatPnl(bot.trade?.realizedPnlTodayUsd)}
                  </span>
                </div>
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.realizedPnlTotalUsdt")}</span>
                  <span
                    className={`botMiniMetricValue ${
                      Number(bot.trade?.realizedPnlTotalUsd ?? 0) > 0
                        ? "botPnlPositive"
                        : Number(bot.trade?.realizedPnlTotalUsd ?? 0) < 0
                          ? "botPnlNegative"
                          : ""
                    }`}
                  >
                    {formatPnl(bot.trade?.realizedPnlTotalUsd)}
                  </span>
                </div>
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.openTrades")}</span>
                  <span className="botMiniMetricValue">{bot.trade?.openTradesCount ?? 0}</span>
                </div>
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.lastTrade")}</span>
                  <span className="botMiniMetricValue">{formatDateTime(bot.trade?.lastTradeTs)}</span>
                </div>
                <div className="botMiniMetric">
                  <span className="botMiniMetricLabel">{t("metrics.reason")}</span>
                  <span className="botMiniMetricValue botReasonText">
                    {bot.stoppedWhy ?? bot.runtime?.reason ?? bot.runtime?.lastError ?? t("metrics.none")}
                  </span>
                </div>
              </div>

              <div className="botCardActions">
                <Link href={`/bots/${bot.id}`} className="btn">{t("actions.open")}</Link>
                <button
                  className={startStopUi.startClassName}
                  onClick={() => void startBot(bot)}
                  disabled={startStopUi.startDisabled}
                >
                  {startStopUi.startLabel}
                </button>
                <button
                  className={startStopUi.stopClassName}
                  onClick={() => void stopBot(bot)}
                  disabled={startStopUi.stopDisabled}
                >
                  {startStopUi.stopLabel}
                </button>
                <button
                  className="btn btnStop"
                  onClick={() => void removeBot(bot)}
                  disabled={busy != null}
                >
                  {busy === "delete" ? t("actions.deleting") : t("actions.delete")}
                </button>
              </div>
            </article>
          );
        })
        )}
      </div>
    </div>
  );
}

export default function BotsPage() {
  const t = useTranslations("system.botsList");
  return (
    <Suspense fallback={<div>{t("loadingPage")}</div>}>
      <BotsPageContent />
    </Suspense>
  );
}
