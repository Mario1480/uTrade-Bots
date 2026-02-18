"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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
    dailyTradeCount?: number | null;
    lastTradeTs?: string | null;
    lastSignal?: string | null;
    lastSignalTs?: string | null;
    lastPredictionConfidence?: number | null;
  } | null;
  recentEvents?: Array<{
    id: string;
    type: string;
    message?: string | null;
    createdAt: string;
    meta?: Record<string, unknown> | null;
  }>;
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

export default function BotDetailsPage() {
  const t = useTranslations("system.botsDetails");
  const params = useParams();
  const id = params.id as string;

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [overview, setOverview] = useState<BotOverviewDetail | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | "" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [b, o] = await Promise.all([
        apiGet<BotDetail>(`/bots/${id}`),
        apiGet<BotOverviewDetail>(`/bots/${id}/overview?limit=10`).catch(() => null)
      ]);
      setBot(b);
      setOverview(o);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    if (!id) return;
    void load();
    const timer = setInterval(() => {
      void load();
    }, 2500);
    return () => clearInterval(timer);
  }, [id]);

  async function startBot() {
    setBusy("start");
    setError(null);
    try {
      await apiPost(`/bots/${id}/start`, {});
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  async function stopBot() {
    setBusy("stop");
    setError(null);
    try {
      await apiPost(`/bots/${id}/stop`, {});
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  const runtime = overview?.runtime ?? bot?.runtime ?? null;
  const stoppedWhy = overview?.stoppedWhy ?? runtime?.lastError ?? runtime?.reason ?? null;
  const openPositionText = overview?.trade?.openSide && Number(overview.trade?.openQty ?? 0) > 0
    ? `${overview.trade.openSide} ${overview.trade.openQty} @ ${overview.trade.openEntryPrice ?? "n/a"}`
    : t("na");

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
          <button className={startStopUi.stopClassName} onClick={stopBot} disabled={startStopUi.stopDisabled}>
            {startStopUi.stopLabel}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="botDetailGrid">
          <InfoRow label={t("fields.botStatus")} value={bot.status} />
          <InfoRow label={t("fields.exchangeAccount")} value={bot.exchangeAccount?.label ?? "-"} />
          <InfoRow label={t("fields.runnerStatus")} value={runtime?.status ?? t("na")} />
          <InfoRow label={t("fields.runtimeReason")} value={runtime?.reason ?? "-"} />
          <InfoRow label={t("fields.runtimeUpdated")} value={runtime?.updatedAt ? formatDateTime(runtime.updatedAt) : "-"} />
          <InfoRow label={t("fields.runtimeLastError")} value={runtime?.lastError ?? "-"} />
        </div>
      </div>

      {bot.status !== "running" ? (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>{t("sections.whyStopped")}</h3>
          <div className="botReasonText" style={{ fontSize: 13 }}>
            {stoppedWhy ?? t("sections.noStoppedReason")}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>{t("sections.opsMetrics")}</h3>
        <div className="botOpsGrid">
          <InfoRow label={t("metrics.openPosition")} value={openPositionText} />
          <InfoRow label={t("metrics.isOpen")} value={overview?.opsMetrics?.isOpen ? t("metrics.yes") : t("metrics.no")} />
          <InfoRow label={t("metrics.openNotionalApprox")} value={formatNumber(overview?.opsMetrics?.openNotionalApprox, 2)} />
          <InfoRow label={t("metrics.openPnlUsdt")} value={formatPnl(overview?.opsMetrics?.openPnlUsd)} />
          <InfoRow label={t("metrics.realizedPnlTodayUsdt")} value={formatPnl(overview?.opsMetrics?.realizedPnlTodayUsd)} />
          <InfoRow label={t("metrics.dailyTradeCount")} value={overview?.opsMetrics?.dailyTradeCount ?? 0} />
          <InfoRow label={t("metrics.lastTradeTs")} value={formatDateTime(overview?.opsMetrics?.lastTradeTs)} />
          <InfoRow label={t("metrics.lastSignal")} value={overview?.opsMetrics?.lastSignal ?? t("na")} />
          <InfoRow label={t("metrics.lastSignalTs")} value={formatDateTime(overview?.opsMetrics?.lastSignalTs)} />
          <InfoRow label={t("metrics.lastPredictionConfidence")} value={formatNumber(overview?.opsMetrics?.lastPredictionConfidence, 2)} />
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>{t("sections.recentEvents")}</h3>
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
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>{t("futuresConfigTitle")}</h3>
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
      </div>
    </div>
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
