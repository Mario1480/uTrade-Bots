"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ExchangeAccountOverviewCard, {
type ExchangeAccountOverview
} from "./components/ExchangeAccountOverviewCard";
import AlertsFeed, { type DashboardAlert } from "../components/dashboard/AlertsFeed";
import TotalsBar, { type DashboardTotals } from "../components/dashboard/TotalsBar";
import { ApiError, apiGet } from "../lib/api";

type EconomicCalendarSummary = {
  currency: string;
  impactMin: "low" | "medium" | "high";
  blackoutActive: boolean;
  activeWindow: {
    from: string;
    to: string;
    event: {
      id: string;
      title: string;
      ts: string;
      impact: "low" | "medium" | "high";
      currency: string;
      country: string;
      sourceId: string;
      forecast: number | null;
      previous: number | null;
      actual: number | null;
      source: string;
    };
  } | null;
  nextEvent: {
    id: string;
    title: string;
    ts: string;
    impact: "low" | "medium" | "high";
    currency: string;
    country: string;
    sourceId: string;
    forecast: number | null;
    previous: number | null;
    actual: number | null;
    source: string;
  } | null;
  asOf: string;
};

type DashboardOverviewResponse = {
  accounts: ExchangeAccountOverview[];
  totals: DashboardTotals;
};

type DashboardAlertsResponse = {
  items: DashboardAlert[];
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function DashboardSkeletonCard() {
  return (
    <article className="card exchangeOverviewCard exchangeOverviewSkeleton" aria-hidden>
      <div className="skeletonLine skeletonLineLg" />
      <div className="skeletonLine skeletonLineMd" />
      <div className="exchangeOverviewStats" style={{ marginTop: 10 }}>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
      </div>
      <div className="exchangeOverviewActions" style={{ marginTop: 10 }}>
        <div className="skeletonButton" />
        <div className="skeletonButton" />
      </div>
    </article>
  );
}

export default function Page() {
  const [overview, setOverview] = useState<ExchangeAccountOverview[]>([]);
  const [overviewTotals, setOverviewTotals] = useState<DashboardTotals | null>(null);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [calendarSummary, setCalendarSummary] = useState<EconomicCalendarSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [overviewResult, alertsResult, calendarResult] = await Promise.allSettled([
          apiGet<DashboardOverviewResponse | ExchangeAccountOverview[]>("/dashboard/overview"),
          apiGet<DashboardAlertsResponse>("/dashboard/alerts?limit=10"),
          apiGet<EconomicCalendarSummary>("/economic-calendar/next?currency=USD&impact=high")
        ]);
        if (!mounted) return;
        if (overviewResult.status === "fulfilled") {
          const payload = overviewResult.value as DashboardOverviewResponse | ExchangeAccountOverview[];
          if (Array.isArray(payload)) {
            setOverview(payload);
            setOverviewTotals(null);
          } else {
            setOverview(Array.isArray(payload.accounts) ? payload.accounts : []);
            setOverviewTotals(payload.totals ?? null);
          }
        } else {
          throw overviewResult.reason;
        }
        if (alertsResult.status === "fulfilled") {
          setAlerts(Array.isArray(alertsResult.value?.items) ? alertsResult.value.items : []);
        } else {
          setAlerts([]);
        }
        if (calendarResult.status === "fulfilled") {
          setCalendarSummary(calendarResult.value ?? null);
        } else {
          setCalendarSummary(null);
        }
      } catch (e) {
        if (!mounted) return;
        setError(errMsg(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    const timer = setInterval(() => {
      void load();
    }, 20_000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const headlineStats = useMemo(() => {
    return overview.reduce(
      (acc, row) => {
        acc.accounts += 1;
        acc.running += row.bots.running;
        acc.errors += row.bots.error;
        return acc;
      },
      { accounts: 0, running: 0, errors: 0 }
    );
  }, [overview]);

  return (
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            One overview card per exchange account.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/predictions" className="btn">Predictions</Link>
          <Link href="/calendar" className="btn">Calendar</Link>
          <Link href="/trade" className="btn">Manual Trading</Link>
          <Link href="/bots/new" className="btn btnPrimary">New Futures Bot</Link>
        </div>
      </div>

      <div className="statGrid">
        <div className="card statCard">
          <div className="statLabel">Exchange Accounts</div>
          <div className="statValue">{loading ? "…" : headlineStats.accounts}</div>
        </div>
        <div className="card statCard">
          <div className="statLabel">Running Bots</div>
          <div className="statValue">{loading ? "…" : headlineStats.running}</div>
        </div>
        <div className="card statCard">
          <div className="statLabel">Bots in Error</div>
          <div className="statValue">{loading ? "…" : headlineStats.errors}</div>
        </div>
      </div>

      <TotalsBar totals={overviewTotals} />

      <AlertsFeed alerts={alerts} />

      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Economic Calendar (USD / high)</div>
        {calendarSummary ? (
          calendarSummary.blackoutActive && calendarSummary.activeWindow ? (
            <div style={{ fontSize: 13, color: "#ef4444" }}>
              Blackout active until {new Date(calendarSummary.activeWindow.to).toLocaleString()} ·{" "}
              {calendarSummary.activeWindow.event.title}
            </div>
          ) : calendarSummary.nextEvent ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Next event: {calendarSummary.nextEvent.title} at{" "}
              {new Date(calendarSummary.nextEvent.ts).toLocaleString()}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No upcoming high-impact events.</div>
          )
        ) : (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading calendar status…</div>
        )}
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Load error:</strong> {error}
        </div>
      ) : null}

      {loading ? (
        <div className="exchangeOverviewGrid">
          <DashboardSkeletonCard />
          <DashboardSkeletonCard />
          <DashboardSkeletonCard />
        </div>
      ) : overview.length === 0 ? (
        <div className="card exchangeOverviewEmpty">
          <h3 style={{ marginTop: 0 }}>No exchange accounts yet</h3>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Add your first exchange account to start manual trading and bot management.
          </p>
          <Link href="/settings" className="btn btnPrimary">Add Exchange Account</Link>
        </div>
      ) : (
        <div className="exchangeOverviewGrid">
          {overview.map((item) => (
            <ExchangeAccountOverviewCard key={item.exchangeAccountId} overview={item} />
          ))}
        </div>
      )}
    </div>
  );
}
