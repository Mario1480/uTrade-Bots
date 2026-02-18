"use client";

import Link from "next/link";
import Script from "next/script";
import { createElement, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ExchangeAccountOverviewCard, {
type ExchangeAccountOverview
} from "./components/ExchangeAccountOverviewCard";
import AlertsFeed, { type DashboardAlert } from "../components/dashboard/AlertsFeed";
import TotalsBar, { type DashboardTotals } from "../components/dashboard/TotalsBar";
import { ApiError, apiGet } from "../lib/api";
import { withLocalePath, type AppLocale } from "../i18n/config";
import {
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionVisibility
} from "../src/access/accessSection";

type EconomicCalendarSummary = {
  id: string;
  sourceId: string;
  ts: string;
  country: string;
  currency: string;
  title: string;
  impact: "low" | "medium" | "high";
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  source: string;
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
  const t = useTranslations("dashboard");
  const locale = useLocale() as AppLocale;
  const [overview, setOverview] = useState<ExchangeAccountOverview[]>([]);
  const [overviewTotals, setOverviewTotals] = useState<DashboardTotals | null>(null);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<EconomicCalendarSummary[]>([]);
  const [calendarLoadError, setCalendarLoadError] = useState(false);
  const [accessVisibility, setAccessVisibility] = useState<AccessSectionVisibility>(
    DEFAULT_ACCESS_SECTION_VISIBILITY
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const today = new Date().toISOString().slice(0, 10);
      setLoading(true);
      setError(null);
      try {
        const [overviewResult, alertsResult, calendarResult, accessResult] = await Promise.allSettled([
          apiGet<DashboardOverviewResponse | ExchangeAccountOverview[]>("/dashboard/overview"),
          apiGet<DashboardAlertsResponse>("/dashboard/alerts?limit=10"),
          apiGet<{ events: EconomicCalendarSummary[] }>(
            `/economic-calendar?from=${today}&to=${today}&currency=USD&impacts=high,medium`
          ),
          apiGet<{ visibility?: AccessSectionVisibility }>("/settings/access-section")
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
          const events = Array.isArray(calendarResult.value?.events) ? calendarResult.value.events : [];
          setCalendarEvents(events);
          setCalendarLoadError(false);
        } else {
          setCalendarEvents([]);
          setCalendarLoadError(true);
        }
        if (accessResult.status === "fulfilled" && accessResult.value?.visibility) {
          setAccessVisibility({
            tradingDesk: accessResult.value.visibility.tradingDesk !== false,
            bots: accessResult.value.visibility.bots !== false,
            predictionsDashboard: accessResult.value.visibility.predictionsDashboard !== false,
            economicCalendar: accessResult.value.visibility.economicCalendar !== false,
            news: accessResult.value.visibility.news !== false
          });
        } else {
          setAccessVisibility(DEFAULT_ACCESS_SECTION_VISIBILITY);
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
          <h2 style={{ margin: 0 }}>{t("title")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {t("subtitle")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {accessVisibility.predictionsDashboard ? (
            <Link href={withLocalePath("/predictions", locale)} className="btn">{t("actions.predictions")}</Link>
          ) : null}
          {accessVisibility.economicCalendar ? (
            <Link href={withLocalePath("/calendar", locale)} className="btn">{t("actions.calendar")}</Link>
          ) : null}
          {accessVisibility.news ? (
            <Link href={withLocalePath("/news", locale)} className="btn">{t("actions.news")}</Link>
          ) : null}
          {accessVisibility.tradingDesk ? (
            <Link href={withLocalePath("/trade", locale)} className="btn">{t("actions.manualTrading")}</Link>
          ) : null}
          {accessVisibility.bots ? (
            <Link href={withLocalePath("/bots/new", locale)} className="btn btnPrimary">{t("actions.newFuturesBot")}</Link>
          ) : null}
        </div>
      </div>

      <div className="statGrid">
        <div className="card statCard">
          <div className="statLabel">{t("stats.exchangeAccounts")}</div>
          <div className="statValue">{loading ? "…" : headlineStats.accounts}</div>
        </div>
        <div className="card statCard">
          <div className="statLabel">{t("stats.runningBots")}</div>
          <div className="statValue">{loading ? "…" : headlineStats.running}</div>
        </div>
        <div className="card statCard">
          <div className="statLabel">{t("stats.botsInError")}</div>
          <div className="statValue">{loading ? "…" : headlineStats.errors}</div>
        </div>
      </div>

      <TotalsBar totals={overviewTotals} />

      <AlertsFeed alerts={alerts} />

      <div className="dashboardInsightsGrid">
        <div className="card dashboardInsightCard">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 700 }}>{t("calendar.title")}</div>
            {accessVisibility.economicCalendar ? (
              <Link href={withLocalePath("/calendar", locale)} className="btn">{t("calendar.open")}</Link>
            ) : null}
          </div>
          {calendarLoadError ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("calendar.unavailable")}</div>
          ) : loading && calendarEvents.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("calendar.loading")}</div>
          ) : calendarEvents.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("calendar.none")}</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("calendar.todayCount", { count: calendarEvents.length })}
              </div>
              {calendarEvents.slice(0, 5).map((event) => (
                <div key={event.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className={`badge ${
                    event.impact === "high"
                      ? "calendarImpactBadgeHigh"
                      : event.impact === "medium"
                        ? "calendarImpactBadgeMedium"
                        : "calendarImpactBadgeLow"
                  }`}>
                    {event.impact.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    {new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {event.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card dashboardInsightCard dashboardFearGreedCard">
          <img
            src="https://alternative.me/crypto/fear-and-greed-index.png"
            alt={t("fearGreed.alt")}
            className="dashboardFearGreedImage"
            loading="lazy"
          />
        </div>

        <div className="card dashboardInsightCard dashboardUttCard">
          <Script
            id="coingecko-widget-script"
            src="https://widgets.coingecko.com/gecko-coin-price-chart-widget.js"
            strategy="afterInteractive"
          />
          <div className="dashboardUttWidgetHost">
            {createElement("gecko-coin-price-chart-widget", {
              locale: locale === "de" ? "de" : "en",
              "dark-mode": "true",
              "transparent-background": "true",
              outlined: "true",
              "coin-id": "utrade",
              "initial-currency": "usd"
            })}
          </div>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>{t("errors.load")}</strong> {error}
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
          <h3 style={{ marginTop: 0 }}>{t("empty.title")}</h3>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            {t("empty.description")}
          </p>
          <Link href={withLocalePath("/settings", locale)} className="btn btnPrimary">{t("empty.cta")}</Link>
        </div>
      ) : (
        <div className="exchangeOverviewGrid">
          {overview.map((item) => (
            <ExchangeAccountOverviewCard
              key={item.exchangeAccountId}
              overview={item}
              visibility={accessVisibility}
            />
          ))}
        </div>
      )}
    </div>
  );
}
