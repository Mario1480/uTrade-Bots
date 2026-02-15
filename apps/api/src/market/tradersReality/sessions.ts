import type { Candle } from "../timeframe.js";

type NullableNumber = number | null;
type DstRegion = "uk" | "ny" | "sydney" | null;

type SessionDefinition = {
  key: string;
  label: string;
  standardUtc: string;
  dstUtc?: string;
  dstRegion: DstRegion;
};

type SessionWindowCandidate = {
  startMs: number;
  endMs: number;
  dstActive: boolean;
};

type SessionWindow = SessionWindowCandidate & {
  activeNow: boolean;
};

export type SessionStats = {
  label: string;
  isInSessionNow: boolean;
  dstActive: boolean;
  sessionStartUtc: string | null;
  sessionEndUtc: string | null;
  sessionOpen: NullableNumber;
  sessionHigh: NullableNumber;
  sessionLow: NullableNumber;
  openingRangeHigh: NullableNumber;
  openingRangeLow: NullableNumber;
};

export type TradersRealitySessionsSnapshot = {
  activeSession: string | null;
  openingRangeMinutes: number;
  sessions: Record<string, SessionStats>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const OPENING_RANGE_MINUTES_DEFAULT = 30;

const SESSION_DEFS: SessionDefinition[] = [
  {
    key: "london",
    label: "London",
    standardUtc: "0800-1630",
    dstUtc: "0700-1530",
    dstRegion: "uk"
  },
  {
    key: "newYork",
    label: "New York",
    standardUtc: "1430-2100",
    dstUtc: "1330-2000",
    dstRegion: "ny"
  },
  {
    key: "tokyo",
    label: "Tokyo",
    standardUtc: "0000-0600",
    dstRegion: null
  },
  {
    key: "hongKong",
    label: "Hong Kong",
    standardUtc: "0130-0800",
    dstRegion: null
  },
  {
    key: "sydney",
    label: "Sydney",
    standardUtc: "2200-0600",
    dstUtc: "2100-0500",
    dstRegion: "sydney"
  },
  {
    key: "euBrinks",
    label: "EU Brinks",
    standardUtc: "0800-0900",
    dstUtc: "0700-0800",
    dstRegion: "uk"
  },
  {
    key: "usBrinks",
    label: "US Brinks",
    standardUtc: "1400-1500",
    dstUtc: "1300-1400",
    dstRegion: "ny"
  },
  {
    key: "frankfurt",
    label: "Frankfurt",
    standardUtc: "0700-1630",
    dstUtc: "0600-1530",
    dstRegion: "uk"
  }
];

function round(value: number | null, decimals = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

function firstDayOfMonthUtc(year: number, month: number): number {
  return Date.UTC(year, month, 1, 0, 0, 0, 0);
}

function firstSundayOfMonthUtc(year: number, month: number): number {
  const first = new Date(firstDayOfMonthUtc(year, month));
  const offset = (7 - first.getUTCDay()) % 7;
  return Date.UTC(year, month, 1 + offset, 0, 0, 0, 0);
}

function secondSundayOfMonthUtc(year: number, month: number): number {
  return firstSundayOfMonthUtc(year, month) + (7 * DAY_MS);
}

function lastSundayOfMonthUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0, 0, 0, 0, 0));
  const offset = last.getUTCDay();
  return Date.UTC(year, month, last.getUTCDate() - offset, 0, 0, 0, 0);
}

function isUkDstActive(dayStartMs: number): boolean {
  const d = new Date(dayStartMs);
  const year = d.getUTCFullYear();
  const start = lastSundayOfMonthUtc(year, 2); // March
  const end = lastSundayOfMonthUtc(year, 9); // October
  return dayStartMs >= start && dayStartMs < end;
}

function isNyDstActive(dayStartMs: number): boolean {
  const d = new Date(dayStartMs);
  const year = d.getUTCFullYear();
  const start = secondSundayOfMonthUtc(year, 2); // March
  const end = firstSundayOfMonthUtc(year, 10); // November
  return dayStartMs >= start && dayStartMs < end;
}

function isSydneyDstActive(dayStartMs: number): boolean {
  const d = new Date(dayStartMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  if (month >= 9) {
    const start = firstSundayOfMonthUtc(year, 9); // Oct this year
    const end = firstSundayOfMonthUtc(year + 1, 3); // Apr next year
    return dayStartMs >= start && dayStartMs < end;
  }
  const start = firstSundayOfMonthUtc(year - 1, 9); // Oct previous year
  const end = firstSundayOfMonthUtc(year, 3); // Apr this year
  return dayStartMs >= start && dayStartMs < end;
}

function isDstActive(region: DstRegion, dayStartMs: number, useDst: boolean): boolean {
  if (!useDst) return false;
  if (!region) return false;
  if (region === "uk") return isUkDstActive(dayStartMs);
  if (region === "ny") return isNyDstActive(dayStartMs);
  return isSydneyDstActive(dayStartMs);
}

function parseTimeRangeUtc(range: string): { startMinute: number; endMinute: number } {
  const [startRaw, endRaw] = range.split("-");
  const startHour = Number(startRaw.slice(0, 2));
  const startMinute = Number(startRaw.slice(2, 4));
  const endHour = Number(endRaw.slice(0, 2));
  const endMinute = Number(endRaw.slice(2, 4));
  const start = (startHour * 60) + startMinute;
  const end = (endHour * 60) + endMinute;
  return { startMinute: start, endMinute: end };
}

function buildWindowCandidate(
  dayStartMs: number,
  def: SessionDefinition,
  useDst: boolean
): SessionWindowCandidate {
  const dstActive = def.dstRegion ? isDstActive(def.dstRegion, dayStartMs, useDst) : false;
  const range = dstActive && def.dstUtc ? def.dstUtc : def.standardUtc;
  const parsed = parseTimeRangeUtc(range);
  const startMs = dayStartMs + (parsed.startMinute * 60 * 1000);
  let endMs = dayStartMs + (parsed.endMinute * 60 * 1000);
  if (parsed.endMinute <= parsed.startMinute) {
    endMs += DAY_MS;
  }
  return {
    startMs,
    endMs,
    dstActive
  };
}

function resolveSessionWindow(nowMs: number, def: SessionDefinition, useDst: boolean): SessionWindow {
  const dayStart = startOfUtcDay(nowMs);
  const yesterday = buildWindowCandidate(dayStart - DAY_MS, def, useDst);
  const today = buildWindowCandidate(dayStart, def, useDst);
  const tomorrow = buildWindowCandidate(dayStart + DAY_MS, def, useDst);
  const candidates = [yesterday, today, tomorrow].sort((a, b) => a.startMs - b.startMs);

  const active = candidates.find((item) => nowMs >= item.startMs && nowMs < item.endMs);
  if (active) {
    return { ...active, activeNow: true };
  }

  // If we are before today's session start, show the upcoming session for the current date.
  if (nowMs < today.startMs) {
    return { ...today, activeNow: false };
  }
  // If today's session already ended, keep today's schedule (closest completed window).
  if (nowMs >= today.endMs) {
    return { ...today, activeNow: false };
  }

  const previous = [...candidates]
    .reverse()
    .find((item) => item.startMs <= nowMs);
  if (previous) {
    return { ...previous, activeNow: false };
  }

  return { ...candidates[0], activeNow: false };
}

export function computeTradersRealitySessions(
  candles: Candle[],
  options: { openingRangeMinutes?: number; useDst?: boolean } = {}
): TradersRealitySessionsSnapshot {
  const openingRangeMinutes = Number.isFinite(options.openingRangeMinutes)
    ? Math.max(1, Math.trunc(options.openingRangeMinutes as number))
    : OPENING_RANGE_MINUTES_DEFAULT;
  const useDst = options.useDst ?? true;
  const sorted = candles
    .filter((row): row is Candle & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .sort((a, b) => (a.ts as number) - (b.ts as number));
  const nowMs = sorted.length > 0 ? (sorted[sorted.length - 1].ts as number) : Date.now();
  const sessions: Record<string, SessionStats> = {};
  let activeSession: string | null = null;

  for (const def of SESSION_DEFS) {
    const window = resolveSessionWindow(nowMs, def, useDst);
    const inWindow = sorted.filter(
      (row) => (row.ts as number) >= window.startMs && (row.ts as number) < window.endMs
    );
    const openingRangeEnd = window.startMs + (openingRangeMinutes * 60 * 1000);
    const openingRange = inWindow.filter((row) => (row.ts as number) < openingRangeEnd);
    const first = inWindow.length > 0 ? inWindow[0] : null;
    const sessionHigh =
      inWindow.length > 0 ? Math.max(...inWindow.map((row) => row.high)) : null;
    const sessionLow =
      inWindow.length > 0 ? Math.min(...inWindow.map((row) => row.low)) : null;
    const openingHigh =
      openingRange.length > 0 ? Math.max(...openingRange.map((row) => row.high)) : null;
    const openingLow =
      openingRange.length > 0 ? Math.min(...openingRange.map((row) => row.low)) : null;

    if (window.activeNow && activeSession === null) {
      activeSession = def.key;
    }

    sessions[def.key] = {
      label: def.label,
      isInSessionNow: window.activeNow,
      dstActive: window.dstActive,
      sessionStartUtc: new Date(window.startMs).toISOString(),
      sessionEndUtc: new Date(window.endMs).toISOString(),
      sessionOpen: round(first?.open ?? null, 6),
      sessionHigh: round(sessionHigh, 6),
      sessionLow: round(sessionLow, 6),
      openingRangeHigh: round(openingHigh, 6),
      openingRangeLow: round(openingLow, 6)
    };
  }

  return {
    activeSession,
    openingRangeMinutes,
    sessions
  };
}
