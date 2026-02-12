"use client";

import { useEffect, useMemo, useState } from "react";
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
  if (impact === "high") return "predictionReasonBadgeTrigger";
  if (impact === "medium") return "predictionReasonBadgeScheduled";
  return "predictionReasonBadgeUnknown";
}

export default function CalendarPage() {
  const [currency, setCurrency] = useState("USD");
  const [impact, setImpact] = useState<CalendarImpact>("high");
  const [from, setFrom] = useState(() => toDateInput(new Date()));
  const [to, setTo] = useState(() => toDateInput(addDays(new Date(), 3)));
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [nextSummary, setNextSummary] = useState<NextSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [eventsResp, nextResp] = await Promise.all([
        apiGet<{ events: EconomicEvent[] }>(
          `/economic-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&impact=${impact}&currency=${encodeURIComponent(currency)}`
        ),
        apiGet<NextSummary>(
          `/economic-calendar/next?currency=${encodeURIComponent(currency)}&impact=${impact}`
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
  }, [currency, impact, from, to]);

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
    <div>
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>Economic Calendar</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            High-impact macro events and blackout status.
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <label>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Currency</div>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Impact</div>
            <select className="input" value={impact} onChange={(e) => setImpact(e.target.value as CalendarImpact)}>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>From</div>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>To</div>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button className="btn" onClick={() => setFrom(toDateInput(new Date()))} type="button">Today</button>
            <button className="btn" onClick={() => setTo(toDateInput(addDays(new Date(), 3)))} type="button">Next 3d</button>
            <button className="btn btnPrimary" onClick={() => void load()} type="button">Refresh</button>
          </div>
        </div>
      </div>

      {nextSummary ? (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 12,
            borderColor: nextSummary.blackoutActive ? "#ef4444" : undefined
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {nextSummary.blackoutActive ? "Blackout active" : "No active blackout"} ({nextSummary.currency})
          </div>
          {nextSummary.blackoutActive && nextSummary.activeWindow ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Until {new Date(nextSummary.activeWindow.to).toLocaleString()} · {nextSummary.activeWindow.event.title}
            </div>
          ) : nextSummary.nextEvent ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Next {nextSummary.impactMin} event: {nextSummary.nextEvent.title} at{" "}
              {new Date(nextSummary.nextEvent.ts).toLocaleString()}
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>No upcoming events in selected range.</div>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
          <strong>Load error:</strong> {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Events</div>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>Loading events...</div>
        ) : grouped.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No events found for the selected filters.</div>
        ) : (
          grouped.map(([day, rows]) => (
            <div key={day} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{day}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rows.map((event) => (
                  <div key={event.id} className="card" style={{ margin: 0, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700 }}>{event.title}</div>
                      <span className={`badge ${impactClass(event.impact)}`}>{event.impact}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      {new Date(event.ts).toLocaleString()} · {event.country} · {event.currency}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      Forecast: {fmtNumber(event.forecast)} · Previous: {fmtNumber(event.previous)} · Actual: {fmtNumber(event.actual)}
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
