"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import {
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionVisibility
} from "../../src/access/accessSection";

export type ExchangeAccountOverview = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  status: "connected" | "degraded" | "disconnected";
  lastSyncAt: string | null;
  lastSyncError: { at: string | null; message: string | null } | null;
  spotBudget: { total?: number | null; available?: number | null } | null;
  futuresBudget: { equity?: number | null; availableMargin?: number | null } | null;
  pnlTodayUsd: number | null;
  bots: { running: number; stopped: number; error: number };
  runningPredictions: number;
  alerts: { hasErrors: boolean; message?: string | null };
};

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatLastSync(
  iso: string | null,
  t: ReturnType<typeof useTranslations>
): string {
  if (!iso) return t("never");

  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return t("unknown");

  const diffMs = Date.now() - ts;
  const absMs = Math.max(0, diffMs);
  const sec = Math.floor(absMs / 1000);
  if (sec < 60) return t("agoSeconds", { count: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("agoMinutes", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("agoHours", { count: hours });
  const days = Math.floor(hours / 24);
  return t("agoDays", { count: days });
}

function statusClass(status: ExchangeAccountOverview["status"]): string {
  if (status === "connected") return "badge badgeOk";
  if (status === "degraded") return "badge badgeWarn";
  return "badge badgeDanger";
}

function statusLabel(
  status: ExchangeAccountOverview["status"],
  t: ReturnType<typeof useTranslations>
): string {
  if (status === "connected") return t("status.connected");
  if (status === "degraded") return t("status.degraded");
  return t("status.disconnected");
}

export default function ExchangeAccountOverviewCard({
  overview,
  visibility = DEFAULT_ACCESS_SECTION_VISIBILITY
}: {
  overview: ExchangeAccountOverview;
  visibility?: AccessSectionVisibility;
}) {
  const t = useTranslations("dashboard.accountCard");
  const locale = useLocale() as AppLocale;
  const syncText = formatLastSync(overview.lastSyncAt, t);
  const accountStatus = statusLabel(overview.status, t);

  return (
    <article className="card exchangeOverviewCard">
      <header className="exchangeOverviewHeader">
        <div>
          <h3 className="exchangeOverviewTitle">
            {overview.exchange.toUpperCase()} — {overview.label}
          </h3>
          <div className="exchangeOverviewSub">{t("lastSync", { value: syncText })}</div>
        </div>
        <span className={statusClass(overview.status)} title={accountStatus}>
          {accountStatus}
        </span>
      </header>

      <div className="exchangeOverviewStats">
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">{t("spotBudget")}</div>
          <div className="exchangeOverviewStatValue">
            {overview.spotBudget ? `${formatMoney(overview.spotBudget.available)} / ${formatMoney(overview.spotBudget.total)}` : "—"}
          </div>
        </div>
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">{t("futuresBudget")}</div>
          <div className="exchangeOverviewStatValue">
            {overview.futuresBudget
              ? `${formatMoney(overview.futuresBudget.equity)} / ${formatMoney(overview.futuresBudget.availableMargin)}`
              : "—"}
          </div>
        </div>
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">{t("todayPnl")}</div>
          <div className="exchangeOverviewStatValue">{formatMoney(overview.pnlTodayUsd)}</div>
        </div>
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">{t("botsPredictions")}</div>
          <div className="exchangeOverviewBotStatus">
            <span>{t("run")} {overview.bots.running}</span>
            <span>{t("stop")} {overview.bots.stopped}</span>
            <span className={overview.bots.error > 0 ? "exchangeOverviewBotError" : ""}>{t("err")} {overview.bots.error}</span>
            <span>{t("pred")} {overview.runningPredictions}</span>
          </div>
        </div>
      </div>

      {overview.lastSyncError?.message ? (
        <div className="exchangeOverviewAlert">
          <span>
            {t("lastSyncFailed")}
            {overview.lastSyncError.at ? ` (${formatLastSync(overview.lastSyncError.at, t)})` : ""}
            : {overview.lastSyncError.message}
          </span>
        </div>
      ) : null}

      {overview.alerts.hasErrors ? (
        <div className="exchangeOverviewAlert">
          <span>{overview.alerts.message ?? t("botErrorsDetected")}</span>
          <Link
            href={`${withLocalePath("/bots", locale)}?exchangeAccountId=${encodeURIComponent(overview.exchangeAccountId)}&status=error`}
            className="exchangeOverviewAlertLink"
          >
            {t("viewErrors")}
          </Link>
        </div>
      ) : null}

      <footer className="exchangeOverviewActions">
        {visibility.tradingDesk ? (
          <Link
            href={`${withLocalePath("/trade", locale)}?exchangeAccountId=${encodeURIComponent(overview.exchangeAccountId)}`}
            className="btn btnPrimary"
          >
            {t("manualTrading")}
          </Link>
        ) : null}
        {visibility.bots ? (
          <Link
            href={`${withLocalePath("/bots", locale)}?exchangeAccountId=${encodeURIComponent(overview.exchangeAccountId)}`}
            className="btn"
          >
            {t("bots")}
          </Link>
        ) : null}
        <Link href={withLocalePath("/settings", locale)} className="btn">
          {t("settings")}
        </Link>
      </footer>
    </article>
  );
}
