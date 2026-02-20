"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";

type CalendarImpact = "low" | "medium" | "high";
type CalendarDayTab = "today" | "tomorrow" | "next3d" | "custom";

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

function fmtDateTimeEu(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function impactClass(impact: CalendarImpact): string {
  if (impact === "high") return "calendarImpactBadgeHigh";
  if (impact === "medium") return "calendarImpactBadgeMedium";
  return "calendarImpactBadgeLow";
}

function dateRangeFromTab(tab: Exclude<CalendarDayTab, "custom">): { from: string; to: string } {
  const now = new Date();

  if (tab === "today") {
    const day = toDateInput(now);
    return { from: day, to: day };
  }

  if (tab === "tomorrow") {
    const tomorrow = toDateInput(addDays(now, 1));
    return { from: tomorrow, to: tomorrow };
  }

  return {
    from: toDateInput(now),
    to: toDateInput(addDays(now, 3))
  };
}

export default function CalendarPage() {
  const t = useTranslations("system.calendar");
  const locale = useLocale();
  const dateLocale = locale === "de" ? "de-DE" : "en-GB";

  const initialRange = useMemo(() => dateRangeFromTab("next3d"), []);
  const [currency, setCurrency] = useState("USD");
  const [impacts, setImpacts] = useState<CalendarImpact[]>(["high"]);
  const [dayTab, setDayTab] = useState<CalendarDayTab>("next3d");
  const [searchQuery, setSearchQuery] = useState("");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
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

  function applyDayTab(nextTab: CalendarDayTab) {
    setDayTab(nextTab);
    if (nextTab === "custom") return;

    const range = dateRangeFromTab(nextTab);
    setFrom(range.from);
    setTo(range.to);
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

  const sortedEvents = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      const left = new Date(a.ts).getTime();
      const right = new Date(b.ts).getTime();
      if (Number.isNaN(left) || Number.isNaN(right)) {
        return a.ts.localeCompare(b.ts);
      }
      return left - right;
    });
    return copy;
  }, [events]);

  const filteredEvents = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return sortedEvents;

    return sortedEvents.filter((event) => {
      const haystack = `${event.title} ${event.country} ${event.currency}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [searchQuery, sortedEvents]);

  const showNoSearchResults =
    !loading
    && !error
    && sortedEvents.length > 0
    && filteredEvents.length === 0
    && searchQuery.trim().length > 0;

  const tabDefs: Array<{ key: CalendarDayTab; label: string }> = [
    { key: "today", label: t("tabs.today") },
    { key: "tomorrow", label: t("tabs.tomorrow") },
    { key: "next3d", label: t("tabs.next3d") },
    { key: "custom", label: t("tabs.custom") }
  ];

  return (
    <div className="calendarPage calendarProPage">
      <div className="calendarProTopbar">
        <div className="calendarProTitleRow">
          <h2 style={{ margin: 0 }}>{t("title")}</h2>
          <div className="calendarProSubtitle">{t("subtitle")}</div>
        </div>
      </div>

      <div className="card calendarFilterCard calendarProControls">
        <div className="calendarProTabRow" role="group" aria-label={t("title")}>
          {tabDefs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`calendarProTab ${dayTab === tab.key ? "calendarProTabActive" : ""}`}
              onClick={() => applyDayTab(tab.key)}
              aria-pressed={dayTab === tab.key}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="calendarFilterGrid calendarProFilterGrid">
          <label className="calendarFilterField">
            <div className="calendarProFilterLabel">{t("filters.currency")}</div>
            <select className="input" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>

          <label className="calendarFilterField">
            <div className="calendarProFilterLabel">{t("filters.impact")}</div>
            <div className="calendarImpactToggleRow">
              {IMPACT_ORDER.map((entry) => {
                const active = impacts.includes(entry);
                return (
                  <button
                    key={entry}
                    type="button"
                    className={`badge ${impactClass(entry)} ${active ? "calendarProImpactToggleActive" : "calendarProImpactToggleInactive"}`}
                    onClick={() => toggleImpact(entry)}
                    aria-pressed={active}
                  >
                    {t(`impact.${entry}`)}
                  </button>
                );
              })}
            </div>
          </label>

          <label className="calendarFilterField">
            <div className="calendarProFilterLabel">{t("search.placeholder")}</div>
            <input
              className="input calendarProSearch"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              autoComplete="off"
            />
          </label>

          <label className="calendarFilterField calendarFilterFieldDate">
            <div className="calendarProFilterLabel">{t("filters.from")}</div>
            <input
              className="input calendarDateInput"
              type="date"
              lang={dateLocale}
              value={from}
              onChange={(event) => {
                setDayTab("custom");
                setFrom(event.target.value);
              }}
              disabled={dayTab !== "custom"}
            />
          </label>

          <label className="calendarFilterField calendarFilterFieldDate">
            <div className="calendarProFilterLabel">{t("filters.to")}</div>
            <input
              className="input calendarDateInput"
              type="date"
              lang={dateLocale}
              value={to}
              onChange={(event) => {
                setDayTab("custom");
                setTo(event.target.value);
              }}
              disabled={dayTab !== "custom"}
            />
          </label>

          <div className="calendarFilterActions calendarProFilterActions">
            <button className="btn btnPrimary" onClick={() => void load()} type="button">{t("actions.refresh")}</button>
          </div>
        </div>
      </div>

      {nextSummary ? (
        <div className={`card calendarSummaryCard calendarProStatusStrip ${nextSummary.blackoutActive ? "calendarProStatusStripAlert" : ""}`}>
          <div className="calendarProStatusTitle">
            {nextSummary.blackoutActive ? t("summary.blackoutActive") : t("summary.noBlackout")} ({nextSummary.currency})
          </div>
          {nextSummary.blackoutActive && nextSummary.activeWindow ? (
            <div className="calendarProStatusText">
              {t("summary.until")} {fmtDateTimeEu(nextSummary.activeWindow.to, dateLocale)} · {nextSummary.activeWindow.event.title}
            </div>
          ) : nextSummary.nextEvent ? (
            <div className="calendarProStatusText">
              {t("summary.nextEvent", { impact: nextSummary.impactMin })}: {nextSummary.nextEvent.title} {t("summary.at")} {fmtDateTimeEu(nextSummary.nextEvent.ts, dateLocale)}
            </div>
          ) : (
            <div className="calendarProStatusText">{t("summary.noUpcoming")}</div>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="card calendarErrorCard calendarProErrorCard">
          <strong>{t("loadError")}:</strong> {error}
        </div>
      ) : null}

      <div className="card calendarEventsCard calendarProEventsCard">
        <div className="calendarProEventsHeader">
          <div className="calendarProEventsTitle">{t("eventsTitle")}</div>
          {!loading ? <div className="calendarProEventsCount">{filteredEvents.length}</div> : null}
        </div>

        {loading ? (
          <div className="calendarProStateText">{t("loadingEvents")}</div>
        ) : sortedEvents.length === 0 ? (
          <div className="calendarProStateText">{t("noEvents")}</div>
        ) : showNoSearchResults ? (
          <div className="calendarProStateText">{t("table.noSearchResults")}</div>
        ) : (
          <>
            <div className="calendarProTableWrap">
              <table className="calendarProTable">
                <thead>
                  <tr>
                    <th scope="col">{t("table.event")}</th>
                    <th scope="col">{t("table.impact")}</th>
                    <th scope="col">{t("table.currency")}</th>
                    <th scope="col">{t("table.date")}</th>
                    <th scope="col">{t("table.forecast")}</th>
                    <th scope="col">{t("table.previous")}</th>
                    <th scope="col">{t("table.actual")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id} className="calendarProRow">
                      <td>
                        <span className="calendarProEventTitle" title={event.title}>{event.title}</span>
                      </td>
                      <td>
                        <span className={`badge ${impactClass(event.impact)}`}>{t(`impact.${event.impact}`)}</span>
                      </td>
                      <td>
                        <div className="calendarProCurrencyCell">
                          <span>{event.currency}</span>
                          <span className="calendarProCountry">{event.country}</span>
                        </div>
                      </td>
                      <td className="calendarProDateCell">{fmtDateTimeEu(event.ts, dateLocale)}</td>
                      <td className="calendarProValueCell">{fmtNumber(event.forecast)}</td>
                      <td className="calendarProValueCell">{fmtNumber(event.previous)}</td>
                      <td className="calendarProValueCell">{fmtNumber(event.actual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="calendarProMobileList">
              {filteredEvents.map((event) => (
                <article key={event.id} className="card calendarProMobileCard">
                  <div className="calendarProMobileHead">
                    <div className="calendarProMobileTitle">{event.title}</div>
                    <span className={`badge ${impactClass(event.impact)}`}>{t(`impact.${event.impact}`)}</span>
                  </div>
                  <div className="calendarProMobileMeta">
                    {fmtDateTimeEu(event.ts, dateLocale)} · {event.country} · {event.currency}
                  </div>
                  <div className="calendarProMobileValues">
                    <span>{t("table.forecast")}: {fmtNumber(event.forecast)}</span>
                    <span>{t("table.previous")}: {fmtNumber(event.previous)}</span>
                    <span>{t("table.actual")}: {fmtNumber(event.actual)}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
