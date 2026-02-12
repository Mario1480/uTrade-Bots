import { logger } from "../logger.js";
import { refreshEconomicCalendarData } from "../services/economicCalendar/index.js";

const ECON_CALENDAR_REFRESH_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.ECON_CALENDAR_REFRESH_ENABLED ?? "1").trim().toLowerCase()
);
const ECON_CALENDAR_REFRESH_INTERVAL_MS =
  Math.max(5, Number(process.env.ECON_CALENDAR_REFRESH_INTERVAL_MINUTES ?? "15")) * 60 * 1000;

export type EconomicCalendarRefreshStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastFetchedCount: number;
  lastUpsertedCount: number;
};

export function createEconomicCalendarRefreshJob(db: any) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastFetchedCount = 0;
  let lastUpsertedCount = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!ECON_CALENDAR_REFRESH_ENABLED) return;
    if (running) return;
    running = true;
    lastStartedAt = new Date();
    try {
      const summary = await refreshEconomicCalendarData({ db });
      lastFetchedCount = summary.fetchedCount;
      lastUpsertedCount = summary.upsertedCount;
      lastError = null;
      lastErrorAt = null;
      logger.info("economic_calendar_refresh_cycle", {
        reason,
        fetched_count: summary.fetchedCount,
        upserted_count: summary.upsertedCount,
        window_from: summary.windowFrom,
        window_to: summary.windowTo
      });
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      logger.warn("economic_calendar_refresh_failed", {
        reason,
        error: lastError
      });
    } finally {
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!ECON_CALENDAR_REFRESH_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, ECON_CALENDAR_REFRESH_INTERVAL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): EconomicCalendarRefreshStatus {
    return {
      enabled: ECON_CALENDAR_REFRESH_ENABLED,
      running,
      pollMs: ECON_CALENDAR_REFRESH_INTERVAL_MS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastFetchedCount,
      lastUpsertedCount
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
