"use client";

import Link from "next/link";

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

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never";

  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "Unknown";

  const diffMs = Date.now() - ts;
  const absMs = Math.max(0, diffMs);
  const sec = Math.floor(absMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusClass(status: ExchangeAccountOverview["status"]): string {
  if (status === "connected") return "badge badgeOk";
  if (status === "degraded") return "badge badgeWarn";
  return "badge badgeDanger";
}

function statusLabel(status: ExchangeAccountOverview["status"]): string {
  if (status === "connected") return "Connected";
  if (status === "degraded") return "Degraded";
  return "Disconnected";
}

export default function ExchangeAccountOverviewCard({ overview }: { overview: ExchangeAccountOverview }) {
  return (
    <article className="card exchangeOverviewCard">
      <header className="exchangeOverviewHeader">
        <div>
          <h3 className="exchangeOverviewTitle">
            {overview.exchange.toUpperCase()} — {overview.label}
          </h3>
          <div className="exchangeOverviewSub">Last sync: {formatLastSync(overview.lastSyncAt)}</div>
        </div>
        <span className={statusClass(overview.status)} title={`Status: ${statusLabel(overview.status)}`}>
          {statusLabel(overview.status)}
        </span>
      </header>

      <div className="exchangeOverviewStats">
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">Spot Budget</div>
          <div className="exchangeOverviewStatValue">
            {overview.spotBudget ? `${formatMoney(overview.spotBudget.available)} / ${formatMoney(overview.spotBudget.total)}` : "—"}
          </div>
        </div>
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">Futures Budget</div>
          <div className="exchangeOverviewStatValue">
            {overview.futuresBudget
              ? `${formatMoney(overview.futuresBudget.equity)} / ${formatMoney(overview.futuresBudget.availableMargin)}`
              : "—"}
          </div>
        </div>
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">Today PnL</div>
          <div className="exchangeOverviewStatValue">{formatMoney(overview.pnlTodayUsd)}</div>
        </div>
        <div className="exchangeOverviewStatBlock">
          <div className="exchangeOverviewStatTitle">Bots</div>
          <div className="exchangeOverviewBotStatus">
            <span>Run {overview.bots.running}</span>
            <span>Stop {overview.bots.stopped}</span>
            <span className={overview.bots.error > 0 ? "exchangeOverviewBotError" : ""}>Err {overview.bots.error}</span>
          </div>
        </div>
      </div>

      {overview.lastSyncError?.message ? (
        <div className="exchangeOverviewAlert">
          <span>
            Last sync failed{overview.lastSyncError.at ? ` (${formatLastSync(overview.lastSyncError.at)})` : ""}: {overview.lastSyncError.message}
          </span>
        </div>
      ) : null}

      {overview.alerts.hasErrors ? (
        <div className="exchangeOverviewAlert">
          <span>{overview.alerts.message ?? "Bot errors detected."}</span>
          <Link href={`/bots?exchangeAccountId=${encodeURIComponent(overview.exchangeAccountId)}&status=error`} className="exchangeOverviewAlertLink">
            View errors
          </Link>
        </div>
      ) : null}

      <footer className="exchangeOverviewActions">
        <Link href={`/trade?exchangeAccountId=${encodeURIComponent(overview.exchangeAccountId)}`} className="btn btnPrimary">
          Manual Trading
        </Link>
        <Link href={`/bots?exchangeAccountId=${encodeURIComponent(overview.exchangeAccountId)}`} className="btn">
          Bots
        </Link>
        <Link href="/settings" className="btn">
          Settings
        </Link>
      </footer>
    </article>
  );
}
