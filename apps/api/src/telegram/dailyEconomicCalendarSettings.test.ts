import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultDailyEconomicCalendarSettings,
  getLocalDateTimeByTimezone,
  isDailyEconomicCalendarSendDue,
  mergeDailyEconomicCalendarSettings,
  parseStoredDailyEconomicCalendarSettings
} from "./dailyEconomicCalendarSettings.js";

test("parseStoredDailyEconomicCalendarSettings returns defaults for empty payload", () => {
  const parsed = parseStoredDailyEconomicCalendarSettings(null);
  assert.deepEqual(parsed, {
    enabled: false,
    currencies: ["USD"],
    impacts: ["high"],
    sendTimeLocal: "08:00",
    timezone: "UTC",
    lastSentLocalDate: null,
    lastSentAt: null
  });
});

test("parseStoredDailyEconomicCalendarSettings normalizes invalid values", () => {
  const parsed = parseStoredDailyEconomicCalendarSettings({
    enabled: "yes",
    currencies: ["usd", "EUR", "XAU"],
    impacts: ["medium", "unknown"],
    sendTimeLocal: "25:70",
    timezone: "Not/AZone",
    lastSentLocalDate: "2026-03-02",
    lastSentAt: "2026-03-02T08:15:00.000Z"
  });
  assert.deepEqual(parsed, {
    enabled: true,
    currencies: ["USD", "EUR"],
    impacts: ["medium"],
    sendTimeLocal: "08:00",
    timezone: "UTC",
    lastSentLocalDate: "2026-03-02",
    lastSentAt: "2026-03-02T08:15:00.000Z"
  });
});

test("mergeDailyEconomicCalendarSettings keeps existing values when patch is partial", () => {
  const current = defaultDailyEconomicCalendarSettings();
  const merged = mergeDailyEconomicCalendarSettings(current, {
    enabled: true,
    sendTimeLocal: "09:30",
    timezone: "Europe/Berlin"
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.sendTimeLocal, "09:30");
  assert.equal(merged.timezone, "Europe/Berlin");
  assert.deepEqual(merged.currencies, ["USD"]);
  assert.deepEqual(merged.impacts, ["high"]);
});

test("isDailyEconomicCalendarSendDue evaluates local day send window", () => {
  const due = isDailyEconomicCalendarSendDue({
    settings: {
      enabled: true,
      currencies: ["USD"],
      impacts: ["high"],
      sendTimeLocal: "09:00",
      timezone: "Europe/Berlin",
      lastSentLocalDate: null,
      lastSentAt: null
    },
    now: new Date("2026-03-02T08:05:00.000Z")
  });
  assert.equal(due.due, true);
  assert.equal(due.localDate, "2026-03-02");
  assert.equal(due.localTime, "09:05");

  const alreadySent = isDailyEconomicCalendarSendDue({
    settings: {
      enabled: true,
      currencies: ["USD"],
      impacts: ["high"],
      sendTimeLocal: "09:00",
      timezone: "Europe/Berlin",
      lastSentLocalDate: "2026-03-02",
      lastSentAt: null
    },
    now: new Date("2026-03-02T09:15:00.000Z")
  });
  assert.equal(alreadySent.due, false);
});

test("getLocalDateTimeByTimezone normalizes midnight hour to 00", () => {
  const local = getLocalDateTimeByTimezone(
    new Date("2026-03-03T23:05:00.000Z"),
    "Europe/Berlin"
  );
  assert.equal(local.localDate, "2026-03-04");
  assert.equal(local.localTime, "00:05");
});

test("isDailyEconomicCalendarSendDue does not trigger before send time after midnight", () => {
  const due = isDailyEconomicCalendarSendDue({
    settings: {
      enabled: true,
      currencies: ["USD"],
      impacts: ["high"],
      sendTimeLocal: "00:30",
      timezone: "Europe/Berlin",
      lastSentLocalDate: null,
      lastSentAt: null
    },
    now: new Date("2026-03-03T23:05:00.000Z")
  });
  assert.equal(due.localDate, "2026-03-04");
  assert.equal(due.localTime, "00:05");
  assert.equal(due.due, false);
});
