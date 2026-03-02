import { logger } from "../logger.js";
import {
  DAILY_ECONOMIC_CALENDAR_SETTINGS_KEY_PREFIX,
  extractUserIdFromDailyEconomicCalendarSettingsKey,
  isDailyEconomicCalendarSendDue,
  mergeDailyEconomicCalendarSettings,
  parseStoredDailyEconomicCalendarSettings
} from "../telegram/dailyEconomicCalendarSettings.js";
import { sendDailyEconomicCalendarDigestForUser } from "../telegram/notifications.js";

const ECON_DAILY_TELEGRAM_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.ECON_DAILY_TELEGRAM_ENABLED ?? "1").trim().toLowerCase()
);
const ECON_DAILY_TELEGRAM_INTERVAL_MS =
  Math.max(15, Number(process.env.ECON_DAILY_TELEGRAM_INTERVAL_SECONDS ?? "60")) * 1000;

export type EconomicCalendarDailyTelegramStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastCandidateCount: number;
  lastDueCount: number;
  lastDeliveredCount: number;
  lastFailedCount: number;
  lastSkippedNoTelegramCount: number;
};

export function createEconomicCalendarDailyTelegramJob(db: any) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastCandidateCount = 0;
  let lastDueCount = 0;
  let lastDeliveredCount = 0;
  let lastFailedCount = 0;
  let lastSkippedNoTelegramCount = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!ECON_DAILY_TELEGRAM_ENABLED) return;
    if (running) return;
    running = true;
    lastStartedAt = new Date();
    const now = new Date();
    let candidateCount = 0;
    let dueCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let skippedNoTelegramCount = 0;
    try {
      const rows = await db.globalSetting.findMany({
        where: {
          key: {
            startsWith: DAILY_ECONOMIC_CALENDAR_SETTINGS_KEY_PREFIX
          }
        },
        select: {
          key: true,
          value: true
        }
      });

      candidateCount = rows.length;
      for (const row of rows) {
        const userId = extractUserIdFromDailyEconomicCalendarSettingsKey(row.key);
        if (!userId) continue;
        const settings = parseStoredDailyEconomicCalendarSettings(row.value);
        const sendWindow = isDailyEconomicCalendarSendDue({
          settings,
          now
        });
        if (!sendWindow.due) continue;
        dueCount += 1;

        try {
          const sent = await sendDailyEconomicCalendarDigestForUser({
            userId,
            settings,
            now,
            dbClient: db
          });
          if (!sent.sent) {
            skippedNoTelegramCount += 1;
            continue;
          }

          const updated = mergeDailyEconomicCalendarSettings(settings, {
            lastSentLocalDate: sent.localDate,
            lastSentAt: now.toISOString()
          });
          await db.globalSetting.upsert({
            where: { key: row.key },
            update: { value: updated },
            create: { key: row.key, value: updated }
          });
          deliveredCount += 1;
        } catch (error) {
          failedCount += 1;
          logger.warn("economic_calendar_daily_telegram_user_failed", {
            userId,
            reason: String(error)
          });
        }
      }

      lastError = null;
      lastErrorAt = null;
      logger.info("economic_calendar_daily_telegram_cycle", {
        reason,
        candidates: candidateCount,
        due_count: dueCount,
        delivered_count: deliveredCount,
        failed_count: failedCount,
        skipped_no_telegram_count: skippedNoTelegramCount
      });
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      logger.warn("economic_calendar_daily_telegram_cycle_failed", {
        reason,
        error: lastError
      });
    } finally {
      lastCandidateCount = candidateCount;
      lastDueCount = dueCount;
      lastDeliveredCount = deliveredCount;
      lastFailedCount = failedCount;
      lastSkippedNoTelegramCount = skippedNoTelegramCount;
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!ECON_DAILY_TELEGRAM_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, ECON_DAILY_TELEGRAM_INTERVAL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): EconomicCalendarDailyTelegramStatus {
    return {
      enabled: ECON_DAILY_TELEGRAM_ENABLED,
      running,
      pollMs: ECON_DAILY_TELEGRAM_INTERVAL_MS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastCandidateCount,
      lastDueCount,
      lastDeliveredCount,
      lastFailedCount,
      lastSkippedNoTelegramCount
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
