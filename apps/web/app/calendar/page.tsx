"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";

type CalendarImpact = "low" | "medium" | "high";

type EconomicEvent = {
  id: string;
  sourceId: string;
  ts: string;
  country: string;
  currency: string;
  title: string;
  impact: CalendarImpact;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  source: string;
};

type NextSummary = {
  currency: string;
  impactMin: CalendarImpact;
  blackoutActive: boolean;
  activeWindow: {
    from: string;
    to: string;
    event: EconomicEvent;
  } | null;
  nextEvent: EconomicEvent | null;
  asOf: string;
};

const IMPACT_ORDER: CalendarImpact[] = ["high", "medium", "low"];

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function fmtNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function impactClass(impact: CalendarImpact): string {
  if (impact === "high") return "calendarImpactBadgeHigh";
  if (impact === "medium") return "calendarImpactBadgeMedium";
  return "calendarImpactBadgeLow";
}

export default function CalendarPage() {
  const t = useTranslations("system.calendar");
  const [currency, setCurrency] = useState("USD");
  const [impacts, setImpacts] = useState<CalendarImpact[]>(["high"]);
  const [from, setFrom] = useState(() => toDateInput(new Date()));
  const [to, setTo] = useState(() => toDateInput(addDays(new Date(), 3)));
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [nextSummary, setNextSummary] = useState<NextSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sortedImpacts = useMemo(
    () => IMPACT_ORDER.filter((impact) => impacts.includes(impact)),
    [impacts]
  );

  const summaryImpact = useMemo<CalendarImpact>(() => {
    if (sortedImpacts.includes("high")) return "high";
    if (sortedImpacts.includes("medium")) return "medium";
    return "low";
  }, [sortedImpacts]);

  function toggleImpact(nextImpact: CalendarImpact) {
    setImpacts((current) => {
      const has = current.includes(nextImpact);
      if (has) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== nextImpact);
      }
      const merged = [...current, nextImpact];
      return IMPACT_ORDER.filter((entry) => merged.includes(entry));
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const impactList = sortedImpacts.join(",");
      const [eventsResp, nextResp] = await Promise.all([
        apiGet<{ events: EconomicEvent[] }>(
          `/economic-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&impacts=${encodeURIComponent(impactList)}&currency=${encodeURIComponent(currency)}`
        ),
        apiGet<NextSummary>(
          `/economic-calendar/next?currency=${encodeURIComponent(currency)}&impact=${summaryImpact}`
        )
      ]);
      setEvents(Array.isArray(eventsResp.events) ? eventsResp.events : []);
      setNextSummary(nextResp);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, sortedImpacts.join(","), summaryImpact, from, to]);

  const grouped = useMemo(() => {
    const map = new Map<string, EconomicEvent[]>();
    for (const event of events) {
      const day = event.ts.slice(0, 10);
      const current = map.get(day) ?? [];
      current.push(event);
      map.set(day, current);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  return (
    <div className="calendarPage">
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{t("title")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {t("subtitle")}
          </div>
        </div>
      </div>

      <div className="card calendarFilterCard">
        <div className="calendarFilterGrid">
          <label className="calendarFilterField">
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("filters.currency")}</div>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label className="calendarFilterField">
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("filters.impact")}</div>
            <div className="calendarImpactToggleRow">
              {IMPACT_ORDER.map((entry) => {
                const active = impacts.includes(entry);
                return (
                  <button
                    key={entry}
                    type="button"
                    className={`badge ${impactClass(entry)}`}
                    style={{
                      background: active ? "rgba(255,255,255,0.08)" : "transparent",
                      opacity: active ? 1 : 0.6,
                      cursor: "pointer"
                    }}
                    onClick={() => toggleImpact(entry)}
                  >
                    {t(`impact.${entry}`)}
                  </button>
                );
              })}
            </div>
          </label>
          <label className="calendarFilterField">
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("filters.from")}</div>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="calendarFilterField">
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("filters.to")}</div>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="calendarFilterActions">
            <button className="btn" onClick={() => setFrom(toDateInput(new Date()))} type="button">{t("actions.today")}</button>
            <button className="btn" onClick={() => setTo(toDateInput(addDays(new Date(), 3)))} type="button">{t("actions.next3d")}</button>
            <button className="btn btnPrimary" onClick={() => void load()} type="button">{t("actions.refresh")}</button>
          </div>
        </div>
      </div>

      {nextSummary ? (
        <div
          className="card calendarSummaryCard"
          style={{ borderColor: nextSummary.blackoutActive ? "#ef4444" : undefined }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {nextSummary.blackoutActive ? t("summary.blackoutActive") : t("summary.noBlackout")} ({nextSummary.currency})
          </div>
          {nextSummary.blackoutActive && nextSummary.activeWindow ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {t("summary.until")} {new Date(nextSummary.activeWindow.to).toLocaleString()} · {nextSummary.activeWindow.event.title}
            </div>
          ) : nextSummary.nextEvent ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {t("summary.nextEvent", { impact: nextSummary.impactMin })}: {nextSummary.nextEvent.title} {t("summary.at")}{" "}
              {new Date(nextSummary.nextEvent.ts).toLocaleString()}
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("summary.noUpcoming")}</div>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="card calendarErrorCard">
          <strong>{t("loadError")}:</strong> {error}
        </div>
      ) : null}

      <div className="card calendarEventsCard">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("eventsTitle")}</div>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>{t("loadingEvents")}</div>
        ) : grouped.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>{t("noEvents")}</div>
        ) : (
          grouped.map(([day, rows]) => (
            <div key={day} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{day}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rows.map((event) => (
                  <div key={event.id} className="card calendarEventCard">
                    <div className="calendarEventHeader">
                      <div style={{ fontWeight: 700 }}>{event.title}</div>
                      <span className={`badge ${impactClass(event.impact)}`}>{event.impact}</span>
                    </div>
                    <div className="calendarEventMeta">
                      {new Date(event.ts).toLocaleString()} · {event.country} · {event.currency}
                    </div>
                    <div className="calendarEventValues">
                      <span>{t("forecast")}: {fmtNumber(event.forecast)}</span>
                      <span>{t("previous")}: {fmtNumber(event.previous)}</span>
                      <span>{t("actual")}: {fmtNumber(event.actual)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
