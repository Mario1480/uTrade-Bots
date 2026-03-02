export type DailyEconomicCalendarImpact = "low" | "medium" | "high";

export type DailyEconomicCalendarSettings = {
  enabled: boolean;
  currencies: string[];
  impacts: DailyEconomicCalendarImpact[];
  sendTimeLocal: string;
  timezone: string;
  lastSentLocalDate: string | null;
  lastSentAt: string | null;
};

export type DailyEconomicCalendarSettingsPatch = {
  enabled?: unknown;
  currencies?: unknown;
  impacts?: unknown;
  sendTimeLocal?: unknown;
  timezone?: unknown;
  lastSentLocalDate?: unknown;
  lastSentAt?: unknown;
};

export const DAILY_ECONOMIC_CALENDAR_SETTINGS_KEY_PREFIX = "settings.alerts.dailyEconomicCalendar.v1:";
export const DAILY_ECONOMIC_CALENDAR_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "CNY"
] as const;
export const DAILY_ECONOMIC_CALENDAR_IMPACT_ORDER: DailyEconomicCalendarImpact[] = ["high", "medium", "low"];

const DEFAULT_DAILY_SETTINGS: DailyEconomicCalendarSettings = {
  enabled: false,
  currencies: ["USD"],
  impacts: ["high"],
  sendTimeLocal: "08:00",
  timezone: "UTC",
  lastSentLocalDate: null,
  lastSentAt: null
};

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function dailyEconomicCalendarSettingsKey(userId: string): string {
  return `${DAILY_ECONOMIC_CALENDAR_SETTINGS_KEY_PREFIX}${userId}`;
}

export function extractUserIdFromDailyEconomicCalendarSettingsKey(key: string): string | null {
  if (typeof key !== "string") return null;
  if (!key.startsWith(DAILY_ECONOMIC_CALENDAR_SETTINGS_KEY_PREFIX)) return null;
  const userId = key.slice(DAILY_ECONOMIC_CALENDAR_SETTINGS_KEY_PREFIX.length).trim();
  return userId.length > 0 ? userId : null;
}

export function isValidIanaTimezone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeDailyEconomicCalendarTimezone(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DAILY_SETTINGS.timezone;
  const trimmed = value.trim();
  if (!trimmed || !isValidIanaTimezone(trimmed)) return DEFAULT_DAILY_SETTINGS.timezone;
  return trimmed;
}

export function normalizeDailyEconomicCalendarSendTime(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DAILY_SETTINGS.sendTimeLocal;
  const trimmed = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)
    ? trimmed
    : DEFAULT_DAILY_SETTINGS.sendTimeLocal;
}

export function normalizeDailyEconomicCalendarCurrencies(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const allowed = new Set<string>(DAILY_ECONOMIC_CALENDAR_CURRENCIES);
  const parsed = raw
    .map((entry) => String(entry).trim().toUpperCase())
    .filter((entry) => allowed.has(entry))
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, DAILY_ECONOMIC_CALENDAR_CURRENCIES.length);
  return parsed.length > 0 ? parsed : [...DEFAULT_DAILY_SETTINGS.currencies];
}

export function normalizeDailyEconomicCalendarImpacts(value: unknown): DailyEconomicCalendarImpact[] {
  const raw = Array.isArray(value) ? value : [];
  const parsed = raw
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry): entry is DailyEconomicCalendarImpact => (
      entry === "low" || entry === "medium" || entry === "high"
    ))
    .filter((entry, index, list) => list.indexOf(entry) === index);
  if (parsed.length === 0) return [...DEFAULT_DAILY_SETTINGS.impacts];
  return DAILY_ECONOMIC_CALENDAR_IMPACT_ORDER.filter((entry) => parsed.includes(entry));
}

function normalizeLastSentLocalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeLastSentAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function defaultDailyEconomicCalendarSettings(): DailyEconomicCalendarSettings {
  return {
    ...DEFAULT_DAILY_SETTINGS,
    currencies: [...DEFAULT_DAILY_SETTINGS.currencies],
    impacts: [...DEFAULT_DAILY_SETTINGS.impacts]
  };
}

export function parseStoredDailyEconomicCalendarSettings(value: unknown): DailyEconomicCalendarSettings {
  const raw = parseRecord(value);
  return {
    enabled: parseBoolean(raw.enabled, DEFAULT_DAILY_SETTINGS.enabled),
    currencies: normalizeDailyEconomicCalendarCurrencies(raw.currencies),
    impacts: normalizeDailyEconomicCalendarImpacts(raw.impacts),
    sendTimeLocal: normalizeDailyEconomicCalendarSendTime(raw.sendTimeLocal),
    timezone: normalizeDailyEconomicCalendarTimezone(raw.timezone),
    lastSentLocalDate: normalizeLastSentLocalDate(raw.lastSentLocalDate),
    lastSentAt: normalizeLastSentAt(raw.lastSentAt)
  };
}

export function mergeDailyEconomicCalendarSettings(
  current: DailyEconomicCalendarSettings,
  patch: DailyEconomicCalendarSettingsPatch
): DailyEconomicCalendarSettings {
  const has = (key: keyof DailyEconomicCalendarSettingsPatch) =>
    Object.prototype.hasOwnProperty.call(patch, key);
  return {
    enabled: has("enabled") ? parseBoolean(patch.enabled, current.enabled) : current.enabled,
    currencies: has("currencies")
      ? normalizeDailyEconomicCalendarCurrencies(patch.currencies)
      : current.currencies,
    impacts: has("impacts")
      ? normalizeDailyEconomicCalendarImpacts(patch.impacts)
      : current.impacts,
    sendTimeLocal: has("sendTimeLocal")
      ? normalizeDailyEconomicCalendarSendTime(patch.sendTimeLocal)
      : current.sendTimeLocal,
    timezone: has("timezone")
      ? normalizeDailyEconomicCalendarTimezone(patch.timezone)
      : current.timezone,
    lastSentLocalDate: has("lastSentLocalDate")
      ? normalizeLastSentLocalDate(patch.lastSentLocalDate)
      : current.lastSentLocalDate,
    lastSentAt: has("lastSentAt")
      ? normalizeLastSentAt(patch.lastSentAt)
      : current.lastSentAt
  };
}

function formatPartsByTimezone(now: Date, timezone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute")
  };
}

export function getLocalDateTimeByTimezone(now: Date, timezone: string): {
  localDate: string;
  localTime: string;
} {
  const safeTimezone = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_SETTINGS.timezone;
  const parts = formatPartsByTimezone(now, safeTimezone);
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}`
  };
}

export function isDailyEconomicCalendarSendDue(params: {
  settings: DailyEconomicCalendarSettings;
  now: Date;
}): { due: boolean; localDate: string; localTime: string } {
  const local = getLocalDateTimeByTimezone(params.now, params.settings.timezone);
  const due =
    params.settings.enabled &&
    local.localTime >= params.settings.sendTimeLocal &&
    params.settings.lastSentLocalDate !== local.localDate;
  return {
    due,
    localDate: local.localDate,
    localTime: local.localTime
  };
}
