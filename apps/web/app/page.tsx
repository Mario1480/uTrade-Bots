"use client";

import Link from "next/link";
import Script from "next/script";
import { createElement, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import ExchangeAccountOverviewCard, {
type ExchangeAccountOverview
} from "./components/ExchangeAccountOverviewCard";
import AlertsFeed, { type DashboardAlert } from "../components/dashboard/AlertsFeed";
import type { DashboardTotals } from "../components/dashboard/TotalsBar";
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

type DashboardNewsItem = {
  id: string;
  feed: "crypto" | "general";
  title: string;
  url: string;
  publishedAt: string;
  symbol?: string | null;
};

type DashboardNewsResponse = {
  items: DashboardNewsItem[];
};

type DashboardOverviewResponse = {
  accounts: ExchangeAccountOverview[];
  totals: DashboardTotals;
};

type DashboardAlertsResponse = {
  items: DashboardAlert[];
};

type PerformanceRange = "24h" | "7d" | "30d";

type DashboardPerformancePoint = {
  ts: string;
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  includedAccounts: number;
};

type DashboardPerformanceResponse = {
  range: PerformanceRange;
  bucketSeconds: number;
  points: DashboardPerformancePoint[];
};

type DashboardPerformanceChartPoint = {
  ts: number;
  totalEquity: number;
};

type DashboardRiskAnalysisTrigger = "dailyLoss" | "margin" | "insufficientData";
type DashboardRiskAnalysisSeverity = "critical" | "warning" | "ok";

type DashboardRiskAnalysisItem = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  severity: DashboardRiskAnalysisSeverity;
  triggers: DashboardRiskAnalysisTrigger[];
  riskScore: number;
  insufficientData: boolean;
  lossUsd: number;
  lossPct: number | null;
  marginPct: number | null;
  availableMarginUsd: number | null;
  pnlTodayUsd: number | null;
  lastSyncAt: string | null;
  runtimeUpdatedAt: string | null;
};

type DashboardRiskAnalysisResponse = {
  items: DashboardRiskAnalysisItem[];
  summary: {
    critical: number;
    warning: number;
    ok: number;
  };
  evaluatedAt: string;
};

type DashboardOpenPositionItem = {
  exchangeAccountId: string;
  exchange: string;
  exchangeLabel: string;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  unrealizedPnl: number | null;
};

type DashboardOpenPositionsExchange = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
};

type DashboardOpenPositionsMeta = {
  fetchedAt: string;
  partialErrors: number;
  failedExchangeAccountIds: string[];
};

type DashboardOpenPositionsResponse = {
  items: DashboardOpenPositionItem[];
  exchanges: DashboardOpenPositionsExchange[];
  meta: DashboardOpenPositionsMeta;
};

const PERFORMANCE_RANGES: PerformanceRange[] = ["24h", "7d", "30d"];

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function resolveIntlLocale(locale: AppLocale): string {
  return locale === "de" ? "de-DE" : "en-US";
}

function formatUsdt(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value))} USDT`;
}

function formatAmount(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value));
}

function formatSignedUsdt(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(numeric)} USDT`;
}

function formatPct(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value))}%`;
}

function formatPerformanceAxisTick(ts: number, range: PerformanceRange, locale: AppLocale): string {
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return "—";
  if (range === "24h") {
    return date.toLocaleTimeString(resolveIntlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return date.toLocaleDateString(resolveIntlLocale(locale), {
    month: "2-digit",
    day: "2-digit"
  });
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
  const [newsItems, setNewsItems] = useState<DashboardNewsItem[]>([]);
  const [newsLoadError, setNewsLoadError] = useState(false);
  const [performanceRange, setPerformanceRange] = useState<PerformanceRange>("24h");
  const [performancePoints, setPerformancePoints] = useState<DashboardPerformancePoint[]>([]);
  const [performanceLoadError, setPerformanceLoadError] = useState(false);
  const [riskItems, setRiskItems] = useState<DashboardRiskAnalysisItem[]>([]);
  const [riskSummary, setRiskSummary] = useState<DashboardRiskAnalysisResponse["summary"]>({
    critical: 0,
    warning: 0,
    ok: 0
  });
  const [riskLoadError, setRiskLoadError] = useState(false);
  const [openPositions, setOpenPositions] = useState<DashboardOpenPositionItem[]>([]);
  const [openPositionsExchanges, setOpenPositionsExchanges] = useState<DashboardOpenPositionsExchange[]>([]);
  const [openPositionsMeta, setOpenPositionsMeta] = useState<DashboardOpenPositionsMeta | null>(null);
  const [openPositionsLoadError, setOpenPositionsLoadError] = useState(false);
  const [openPositionsExchangeFilter, setOpenPositionsExchangeFilter] = useState<string>("all");
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
        const [
          overviewResult,
          alertsResult,
          calendarResult,
          newsResult,
          performanceResult,
          riskResult,
          openPositionsResult,
          accessResult
        ] = await Promise.allSettled([
          apiGet<DashboardOverviewResponse | ExchangeAccountOverview[]>("/dashboard/overview"),
          apiGet<DashboardAlertsResponse>("/dashboard/alerts?limit=10"),
          apiGet<{ events: EconomicCalendarSummary[] }>(
            `/economic-calendar?from=${today}&to=${today}&currency=USD&impacts=high,medium`
          ),
          apiGet<DashboardNewsResponse>("/news?mode=all&limit=3&page=1"),
          apiGet<DashboardPerformanceResponse>(`/dashboard/performance?range=${performanceRange}`),
          apiGet<DashboardRiskAnalysisResponse>("/dashboard/risk-analysis?limit=3"),
          apiGet<DashboardOpenPositionsResponse>("/dashboard/open-positions"),
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
        if (newsResult.status === "fulfilled") {
          const items = Array.isArray(newsResult.value?.items) ? newsResult.value.items : [];
          setNewsItems(items);
          setNewsLoadError(false);
        } else {
          setNewsItems([]);
          setNewsLoadError(true);
        }
        if (performanceResult.status === "fulfilled") {
          const points = Array.isArray(performanceResult.value?.points) ? performanceResult.value.points : [];
          setPerformancePoints(points);
          setPerformanceLoadError(false);
        } else {
          setPerformancePoints([]);
          setPerformanceLoadError(true);
        }
        if (riskResult.status === "fulfilled") {
          const items = Array.isArray(riskResult.value?.items) ? riskResult.value.items : [];
          setRiskItems(items);
          setRiskSummary(
            riskResult.value?.summary && typeof riskResult.value.summary === "object"
              ? {
                  critical: Number(riskResult.value.summary.critical ?? 0) || 0,
                  warning: Number(riskResult.value.summary.warning ?? 0) || 0,
                  ok: Number(riskResult.value.summary.ok ?? 0) || 0
                }
              : { critical: 0, warning: 0, ok: 0 }
          );
          setRiskLoadError(false);
        } else {
          setRiskItems([]);
          setRiskSummary({ critical: 0, warning: 0, ok: 0 });
          setRiskLoadError(true);
        }
        if (openPositionsResult.status === "fulfilled") {
          const items = Array.isArray(openPositionsResult.value?.items)
            ? openPositionsResult.value.items
            : [];
          const exchanges = Array.isArray(openPositionsResult.value?.exchanges)
            ? openPositionsResult.value.exchanges
            : [];
          setOpenPositions(items);
          setOpenPositionsExchanges(exchanges);
          setOpenPositionsMeta(
            openPositionsResult.value?.meta && typeof openPositionsResult.value.meta === "object"
              ? {
                  fetchedAt: String(openPositionsResult.value.meta.fetchedAt ?? ""),
                  partialErrors: Math.max(0, Number(openPositionsResult.value.meta.partialErrors ?? 0) || 0),
                  failedExchangeAccountIds: Array.isArray(openPositionsResult.value.meta.failedExchangeAccountIds)
                    ? openPositionsResult.value.meta.failedExchangeAccountIds
                        .map((value) => String(value))
                        .filter((value) => value.length > 0)
                    : []
                }
              : null
          );
          setOpenPositionsLoadError(false);
        } else {
          setOpenPositions([]);
          setOpenPositionsExchanges([]);
          setOpenPositionsMeta(null);
          setOpenPositionsLoadError(true);
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
        setPerformancePoints([]);
        setPerformanceLoadError(true);
        setRiskItems([]);
        setRiskSummary({ critical: 0, warning: 0, ok: 0 });
        setRiskLoadError(true);
        setOpenPositions([]);
        setOpenPositionsExchanges([]);
        setOpenPositionsMeta(null);
        setOpenPositionsLoadError(true);
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
  }, [performanceRange]);

  useEffect(() => {
    if (openPositionsExchangeFilter === "all") return;
    const exists = openPositionsExchanges.some(
      (item) => item.exchangeAccountId === openPositionsExchangeFilter
    );
    if (!exists) {
      setOpenPositionsExchangeFilter("all");
    }
  }, [openPositionsExchangeFilter, openPositionsExchanges]);

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

  const resolvedTotals = useMemo<DashboardTotals | null>(() => {
    if (overviewTotals) return overviewTotals;
    if (!overview.length) return null;
    const reduced = overview.reduce<DashboardTotals>(
      (acc, row) => {
        const spotTotal = Number(row.spotBudget?.total ?? NaN);
        const futuresEquity = Number(row.futuresBudget?.equity ?? NaN);
        const availableMargin = Number(row.futuresBudget?.availableMargin ?? NaN);
        const pnlToday = Number(row.pnlTodayUsd ?? NaN);

        let contributes = false;

        if (Number.isFinite(spotTotal)) {
          acc.totalEquity += spotTotal;
          contributes = true;
        }
        if (Number.isFinite(futuresEquity)) {
          acc.totalEquity += futuresEquity;
          contributes = true;
        }
        if (Number.isFinite(availableMargin)) {
          acc.totalAvailableMargin += availableMargin;
          contributes = true;
        }
        if (Number.isFinite(pnlToday)) {
          acc.totalTodayPnl += pnlToday;
          contributes = true;
        }
        if (contributes) acc.includedAccounts += 1;
        return acc;
      },
      {
        totalEquity: 0,
        totalAvailableMargin: 0,
        totalTodayPnl: 0,
        currency: "USDT",
        includedAccounts: 0
      }
    );
    return {
      ...reduced,
      totalEquity: Number(reduced.totalEquity.toFixed(6)),
      totalAvailableMargin: Number(reduced.totalAvailableMargin.toFixed(6)),
      totalTodayPnl: Number(reduced.totalTodayPnl.toFixed(6))
    };
  }, [overview, overviewTotals]);

  const performanceChartData = useMemo<DashboardPerformanceChartPoint[]>(() => {
    return performancePoints
      .map((point) => {
        const ts = new Date(point.ts).getTime();
        if (!Number.isFinite(ts)) return null;
        const totalEquity = Number(point.totalEquity);
        if (!Number.isFinite(totalEquity)) return null;
        return { ts, totalEquity };
      })
      .filter((point): point is DashboardPerformanceChartPoint => Boolean(point));
  }, [performancePoints]);

  const latestPerformancePoint = useMemo(() => {
    return performancePoints.length > 0 ? performancePoints[performancePoints.length - 1] : null;
  }, [performancePoints]);

  const visibleAlerts = useMemo(() => {
    return alerts.filter((item) => item.severity === "critical" || item.severity === "warning");
  }, [alerts]);

  const fallbackPerformanceTotals = useMemo(() => {
    return {
      totalEquity: latestPerformancePoint?.totalEquity ?? resolvedTotals?.totalEquity ?? null,
      totalAvailableMargin:
        latestPerformancePoint?.totalAvailableMargin ?? resolvedTotals?.totalAvailableMargin ?? null,
      totalTodayPnl: resolvedTotals?.totalTodayPnl ?? latestPerformancePoint?.totalTodayPnl ?? null
    };
  }, [latestPerformancePoint, resolvedTotals]);

  const filteredOpenPositions = useMemo(() => {
    if (openPositionsExchangeFilter === "all") return openPositions;
    return openPositions.filter((item) => item.exchangeAccountId === openPositionsExchangeFilter);
  }, [openPositions, openPositionsExchangeFilter]);

  return (
    <div>
      <section id="overview" className="dashboardSectionAnchor">
        <div className="dashboardHeader">
          <div>
            <h2 style={{ margin: 0 }}>{t("title")}</h2>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {t("subtitle")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {accessVisibility.tradingDesk ? (
              <Link href={withLocalePath("/trade", locale)} className="btn">{t("actions.manualTrading")}</Link>
            ) : null}            
            {accessVisibility.predictionsDashboard ? (
              <Link href={withLocalePath("/predictions", locale)} className="btn">{t("actions.predictions")}</Link>
            ) : null}
            {accessVisibility.bots ? (
              <Link href={withLocalePath("/bots", locale)} className="btn">{t("actions.Bots")}</Link>
            ) : null}            
            {accessVisibility.economicCalendar ? (
              <Link href={withLocalePath("/calendar", locale)} className="btn">{t("actions.calendar")}</Link>
            ) : null}
            {accessVisibility.news ? (
              <Link href={withLocalePath("/news", locale)} className="btn">{t("actions.news")}</Link>
            ) : null}
          </div>
        </div>
      </section>

      <section id="risk-alerts" className="dashboardSectionAnchor">
        {visibleAlerts.length > 0 ? <AlertsFeed alerts={visibleAlerts} /> : null}
      </section>

      <section id="market-context" className="dashboardSectionAnchor">
        <div className="dashboardInsightsGrid">
          <div className="card dashboardInsightCard dashboardPerformanceProCard dashboardInsightSpan3">
            <div className="dashboardPerformanceHead">
              <div>
                <div className="dashboardPerformanceTitle">{t("performance.title")}</div>
                <div className="dashboardPerformanceSubtitle">{t("performance.subtitle")}</div>
              </div>
              <div className="dashboardPerformanceTabs" role="tablist" aria-label={t("performance.title")}>
                {PERFORMANCE_RANGES.map((range) => (
                  <button
                    key={range}
                    type="button"
                    role="tab"
                    aria-selected={performanceRange === range}
                    className={`dashboardPerformanceTab ${
                      performanceRange === range ? "dashboardPerformanceTabActive" : ""
                    }`}
                    onClick={() => setPerformanceRange(range)}
                  >
                    {range === "24h"
                      ? t("performance.range24h")
                      : range === "7d"
                        ? t("performance.range7d")
                        : t("performance.range30d")}
                  </button>
                ))}
              </div>
            </div>
            <div className="dashboardPerformanceBody">
              <div className="dashboardPerformanceMain">
                {performanceLoadError ? (
                  <div className="dashboardPerformanceState">{t("performance.unavailable")}</div>
                ) : loading && performanceChartData.length === 0 ? (
                  <div className="dashboardPerformanceState">{t("performance.loading")}</div>
                ) : performanceChartData.length === 0 ? (
                  <div className="dashboardPerformanceState">{t("performance.none")}</div>
                ) : (
                  <div className="dashboardPerformanceChartWrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={performanceChartData} margin={{ top: 14, right: 14, left: 6, bottom: 2 }}>
                        <defs>
                          <linearGradient id="dashboardPerformanceAreaFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="rgba(16, 185, 199, 0.78)" />
                            <stop offset="95%" stopColor="rgba(16, 185, 199, 0.05)" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis
                          dataKey="ts"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(value) =>
                            formatPerformanceAxisTick(Number(value), performanceRange, locale)
                          }
                          stroke="rgba(255,255,255,0.48)"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={24}
                        />
                        <YAxis
                          tickFormatter={(value) => formatUsdt(Number(value), locale, 0)}
                          stroke="rgba(255,255,255,0.48)"
                          tickLine={false}
                          axisLine={false}
                          width={92}
                          padding={{ top: 30, bottom: 4 }}
                        />
                        <Tooltip
                          formatter={(value: number) => [formatUsdt(value, locale), t("performance.metrics.equity")]}
                          labelFormatter={(value) =>
                            new Date(Number(value)).toLocaleString(resolveIntlLocale(locale), {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit"
                            })
                          }
                          contentStyle={{
                            border: "1px solid rgba(255,193,7,0.34)",
                            background: "rgba(7, 17, 26, 0.95)",
                            borderRadius: 10
                          }}
                          labelStyle={{ color: "var(--muted)" }}
                          itemStyle={{ color: "var(--text)" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="totalEquity"
                          stroke="rgba(16, 185, 199, 0.95)"
                          strokeWidth={2}
                          fill="url(#dashboardPerformanceAreaFill)"
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="dashboardPerformanceMetrics">
                  <div className="dashboardPerformanceMetricCard">
                    <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.equity")}</div>
                    <div className="dashboardPerformanceMetricValue">
                      <span className="dashboardPerformanceMetricValueNumber">
                        {formatAmount(fallbackPerformanceTotals.totalEquity, locale)}
                      </span>
                      <span className="dashboardPerformanceMetricValueUnit">USDT</span>
                    </div>
                  </div>
                  <div className="dashboardPerformanceMetricCard">
                    <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.margin")}</div>
                    <div className="dashboardPerformanceMetricValue">
                      <span className="dashboardPerformanceMetricValueNumber">
                        {formatAmount(fallbackPerformanceTotals.totalAvailableMargin, locale)}
                      </span>
                      <span className="dashboardPerformanceMetricValueUnit">USDT</span>
                    </div>
                  </div>
                  <div className="dashboardPerformanceMetricCard">
                    <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.pnl")}</div>
                    <div
                      className={`dashboardPerformanceMetricValue ${
                        Number(fallbackPerformanceTotals.totalTodayPnl ?? 0) < 0
                        ? "dashboardPerformanceMetricValueNegative"
                        : "dashboardPerformanceMetricValuePositive"
                    }`}
                  >
                      <span className="dashboardPerformanceMetricValueNumber">
                        {formatAmount(fallbackPerformanceTotals.totalTodayPnl, locale)}
                      </span>
                      <span className="dashboardPerformanceMetricValueUnit">USDT</span>
                    </div>
                  </div>
                  <div className="dashboardPerformanceMetricCard">
                    <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.bots")}</div>
                    <div className="dashboardPerformanceMetricValue">
                      {headlineStats.running} / {headlineStats.errors}
                    </div>
                  </div>
                </div>
              </div>

              <aside className="dashboardLossAnalysisCard">
                <div className="dashboardLossAnalysisHead">
                  <div className="dashboardLossAnalysisTitle">{t("lossAnalysis.title")}</div>
                  <div className="dashboardLossAnalysisSubtitle">{t("lossAnalysis.subtitle")}</div>
                  <div className="dashboardLossSummary">
                    <span className="dashboardLossSeverity dashboardLossSeverityCritical">
                      {t("lossAnalysis.severity.critical")}: {riskSummary.critical}
                    </span>
                    <span className="dashboardLossSeverity dashboardLossSeverityWarning">
                      {t("lossAnalysis.severity.warning")}: {riskSummary.warning}
                    </span>
                    <span className="dashboardLossSeverity dashboardLossSeverityOk">
                      {t("lossAnalysis.severity.ok")}: {riskSummary.ok}
                    </span>
                  </div>
                </div>

                {riskLoadError ? (
                  <div className="dashboardPerformanceState">{t("lossAnalysis.unavailable")}</div>
                ) : loading && riskItems.length === 0 ? (
                  <div className="dashboardPerformanceState">{t("lossAnalysis.loading")}</div>
                ) : riskItems.length === 0 ? (
                  <div className="dashboardPerformanceState">{t("lossAnalysis.none")}</div>
                ) : (
                  <div className="dashboardLossAnalysisList">
                    {riskItems.map((item) => (
                      <div key={item.exchangeAccountId} className="dashboardLossRow">
                        <div className="dashboardLossRowTop">
                          <div className="dashboardLossRowAccount">
                            {item.label} · {item.exchange.toUpperCase()}
                          </div>
                          <span
                            className={`dashboardLossSeverity ${
                              item.severity === "critical"
                                ? "dashboardLossSeverityCritical"
                                : item.severity === "warning"
                                  ? "dashboardLossSeverityWarning"
                                  : "dashboardLossSeverityOk"
                            }`}
                          >
                            {item.severity === "critical"
                              ? t("lossAnalysis.severity.critical")
                              : item.severity === "warning"
                                ? t("lossAnalysis.severity.warning")
                                : t("lossAnalysis.severity.ok")}
                          </span>
                        </div>
                        <div className="dashboardLossTriggerRow">
                          {item.triggers.map((trigger) => (
                            <span key={`${item.exchangeAccountId}-${trigger}`} className="dashboardLossTriggerChip">
                              {trigger === "dailyLoss"
                                ? t("lossAnalysis.triggers.dailyLoss")
                                : trigger === "margin"
                                  ? t("lossAnalysis.triggers.margin")
                                  : t("lossAnalysis.triggers.insufficientData")}
                            </span>
                          ))}
                        </div>
                        <div className="dashboardLossMeta">
                          <span>
                            {t("performance.metrics.pnl")}: {formatSignedUsdt(item.pnlTodayUsd, locale)}
                          </span>
                          <span>
                            {t("lossAnalysis.triggers.dailyLoss")}: {formatUsdt(item.lossUsd, locale)} ({formatPct(item.lossPct, locale)})
                          </span>
                          <span>
                            {t("lossAnalysis.triggers.margin")}: {formatPct(item.marginPct, locale)}
                          </span>
                        </div>
                        <Link
                          href={`${withLocalePath("/trade", locale)}?exchangeAccountId=${encodeURIComponent(item.exchangeAccountId)}`}
                          className="dashboardLossRowAction"
                        >
                          {t("actions.manualTrading")}
                        </Link>
                      </div>
                    ))}
                  </div>
                )}

                <div className="dashboardLossAnalysisFooter">
                  <Link href={withLocalePath("/settings/risk", locale)} className="btn">
                    {t("lossAnalysis.openRiskSettings")}
                  </Link>
                </div>
              </aside>
            </div>
          </div>

          <div className="card dashboardInsightCard dashboardCalendarProCard">
            <div className="dashboardCalendarProHead">
              <div className="dashboardCalendarProTitle">{t("calendar.title")}</div>
              {accessVisibility.economicCalendar ? (
                <Link href={withLocalePath("/calendar", locale)} className="btn">{t("calendar.open")}</Link>
              ) : null}
            </div>
            {calendarLoadError ? (
              <div className="dashboardCalendarProMeta">{t("calendar.unavailable")}</div>
            ) : loading && calendarEvents.length === 0 ? (
              <div className="dashboardCalendarProMeta">{t("calendar.loading")}</div>
            ) : calendarEvents.length === 0 ? (
              <div className="dashboardCalendarProMeta">{t("calendar.none")}</div>
            ) : (
              <div className="dashboardCalendarProList">
                <div className="dashboardCalendarProCount">
                  {t("calendar.todayCount", { count: calendarEvents.length })}
                </div>
                {calendarEvents.slice(0, 5).map((event) => (
                  <div key={event.id} className="dashboardCalendarProRow">
                    <span className={`badge ${
                      event.impact === "high"
                        ? "calendarImpactBadgeHigh"
                        : event.impact === "medium"
                          ? "calendarImpactBadgeMedium"
                          : "calendarImpactBadgeLow"
                    }`}>
                      {event.impact.toUpperCase()}
                    </span>
                    <span className="dashboardCalendarProMeta">
                      {new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {event.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {accessVisibility.news ? (
            <div className="card dashboardInsightCard dashboardNewsProCard">
              <div className="dashboardNewsProHead">
                <div className="dashboardNewsProTitle">{t("news.title")}</div>
                <Link href={withLocalePath("/news", locale)} className="btn">{t("news.open")}</Link>
              </div>
              {newsLoadError ? (
                <div className="dashboardNewsProMeta">{t("news.unavailable")}</div>
              ) : loading && newsItems.length === 0 ? (
                <div className="dashboardNewsProMeta">{t("news.loading")}</div>
              ) : newsItems.length === 0 ? (
                <div className="dashboardNewsProMeta">{t("news.none")}</div>
              ) : (
                <div className="dashboardNewsProList">
                  {newsItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="dashboardNewsProRow"
                    >
                      <div className="dashboardNewsProBadges">
                        <span className={`badge ${item.feed === "crypto" ? "newsBadgeCrypto" : "newsBadgeGeneral"}`}>
                          {item.feed.toUpperCase()}
                        </span>
                        {item.symbol ? <span className="badge">{item.symbol}</span> : null}
                      </div>
                      <div className="dashboardNewsProContent">
                        <span className="dashboardNewsProTime">
                          {new Date(item.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="dashboardNewsProTitleText">{item.title}</span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : null}

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
      </section>

      <section id="accounts" className="dashboardSectionAnchor">
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
      </section>

      {accessVisibility.tradingDesk ? (
        <section id="open-positions" className="dashboardSectionAnchor">
          <div className="card dashboardInsightCard dashboardOpenPositionsCard">
            <div className="dashboardOpenPositionsHead">
              <div>
                <div className="dashboardOpenPositionsTitle">{t("openPositions.title")}</div>
                <div className="dashboardOpenPositionsSubtitle">{t("openPositions.subtitle")}</div>
              </div>
              <label className="dashboardOpenPositionsFilter">
                <span>{t("openPositions.filterLabel")}</span>
                <select
                  className="select"
                  value={openPositionsExchangeFilter}
                  onChange={(event) => setOpenPositionsExchangeFilter(event.target.value)}
                >
                  <option value="all">{t("openPositions.filterAll")}</option>
                  {openPositionsExchanges.map((item) => (
                    <option key={item.exchangeAccountId} value={item.exchangeAccountId}>
                      {item.exchange.toUpperCase()} · {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!openPositionsLoadError && (openPositionsMeta?.partialErrors ?? 0) > 0 ? (
              <div className="dashboardOpenPositionsMeta">
                {t("openPositions.partial", { count: openPositionsMeta?.partialErrors ?? 0 })}
              </div>
            ) : null}

            {openPositionsLoadError ? (
              <div className="dashboardOpenPositionsState">{t("openPositions.unavailable")}</div>
            ) : loading && openPositions.length === 0 ? (
              <div className="dashboardOpenPositionsState">{t("openPositions.loading")}</div>
            ) : filteredOpenPositions.length === 0 ? (
              <div className="dashboardOpenPositionsState">{t("openPositions.none")}</div>
            ) : (
              <>
                <div className="dashboardOpenPositionsTableWrap">
                  <table className="dashboardOpenPositionsTable">
                    <thead>
                      <tr>
                        <th>{t("openPositions.columns.exchange")}</th>
                        <th>{t("openPositions.columns.side")}</th>
                        <th>{t("openPositions.columns.size")}</th>
                        <th>{t("openPositions.columns.entry")}</th>
                        <th>{t("openPositions.columns.stopLoss")}</th>
                        <th>{t("openPositions.columns.takeProfit")}</th>
                        <th>{t("openPositions.columns.pnl")}</th>
                        <th>{t("openPositions.columns.action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOpenPositions.map((item) => {
                        const pnl = Number(item.unrealizedPnl ?? 0);
                        const pnlClass =
                          pnl > 0
                            ? "dashboardOpenPositionsPnlPositive"
                            : pnl < 0
                              ? "dashboardOpenPositionsPnlNegative"
                              : "";
                        return (
                          <tr key={`${item.exchangeAccountId}-${item.symbol}-${item.side}`} className="dashboardOpenPositionsRow">
                            <td>
                              <span className="dashboardOpenPositionsExchange">
                                {item.exchange.toUpperCase()} · {item.exchangeLabel}
                              </span>
                              <span className="dashboardOpenPositionsSymbol">{item.symbol}</span>
                            </td>
                            <td>
                              <span
                                className={`dashboardOpenPositionsSide ${
                                  item.side === "long"
                                    ? "dashboardOpenPositionsSideLong"
                                    : "dashboardOpenPositionsSideShort"
                                }`}
                              >
                                {item.side === "long" ? t("openPositions.side.long") : t("openPositions.side.short")}
                              </span>
                            </td>
                            <td>{formatAmount(item.size, locale, 6)}</td>
                            <td>{formatAmount(item.entryPrice, locale, 4)}</td>
                            <td>{formatAmount(item.stopLossPrice, locale, 4)}</td>
                            <td>{formatAmount(item.takeProfitPrice, locale, 4)}</td>
                            <td className={pnlClass}>{formatSignedUsdt(item.unrealizedPnl, locale)}</td>
                            <td>
                              <Link
                                href={`${withLocalePath("/trade", locale)}?exchangeAccountId=${encodeURIComponent(item.exchangeAccountId)}&symbol=${encodeURIComponent(item.symbol)}`}
                                className="dashboardOpenPositionsAction"
                              >
                                {t("openPositions.actionOpenDesk")}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="dashboardOpenPositionsMobileList">
                  {filteredOpenPositions.map((item) => {
                    const pnl = Number(item.unrealizedPnl ?? 0);
                    const pnlClass =
                      pnl > 0
                        ? "dashboardOpenPositionsPnlPositive"
                        : pnl < 0
                          ? "dashboardOpenPositionsPnlNegative"
                          : "";
                    return (
                      <article
                        key={`${item.exchangeAccountId}-${item.symbol}-${item.side}-mobile`}
                        className="dashboardOpenPositionsMobileCard"
                      >
                        <div className="dashboardOpenPositionsMobileHead">
                          <strong>{item.symbol}</strong>
                          <span
                            className={`dashboardOpenPositionsSide ${
                              item.side === "long"
                                ? "dashboardOpenPositionsSideLong"
                                : "dashboardOpenPositionsSideShort"
                            }`}
                          >
                            {item.side === "long" ? t("openPositions.side.long") : t("openPositions.side.short")}
                          </span>
                        </div>
                        <div className="dashboardOpenPositionsMobileMeta">
                          {item.exchange.toUpperCase()} · {item.exchangeLabel}
                        </div>
                        <div className="dashboardOpenPositionsMobileGrid">
                          <span>{t("openPositions.columns.size")}: {formatAmount(item.size, locale, 6)}</span>
                          <span>{t("openPositions.columns.entry")}: {formatAmount(item.entryPrice, locale, 4)}</span>
                          <span>{t("openPositions.columns.stopLoss")}: {formatAmount(item.stopLossPrice, locale, 4)}</span>
                          <span>{t("openPositions.columns.takeProfit")}: {formatAmount(item.takeProfitPrice, locale, 4)}</span>
                          <span className={pnlClass}>{t("openPositions.columns.pnl")}: {formatSignedUsdt(item.unrealizedPnl, locale)}</span>
                        </div>
                        <Link
                          href={`${withLocalePath("/trade", locale)}?exchangeAccountId=${encodeURIComponent(item.exchangeAccountId)}&symbol=${encodeURIComponent(item.symbol)}`}
                          className="dashboardOpenPositionsAction"
                        >
                          {t("openPositions.actionOpenDesk")}
                        </Link>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
