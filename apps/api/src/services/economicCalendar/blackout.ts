import type {
  EconomicBlackoutResult,
  EconomicCalendarConfigSnapshot,
  EconomicEventNormalized,
  EconomicEventView,
  EconomicImpact
} from "./types.js";

function impactWeight(value: EconomicImpact): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function normalizeImpact(value: unknown): EconomicImpact {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function normalizeCurrency(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}

function parseCurrenciesCsv(csv: string | null | undefined): Set<string> | null {
  if (!csv) return null;
  const tokens = csv
    .split(",")
    .map((item) => normalizeCurrency(item))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return new Set(tokens);
}

function eventToView(event: EconomicEventNormalized): EconomicEventView {
  return {
    id: event.sourceId,
    sourceId: event.sourceId,
    ts: event.ts.toISOString(),
    country: event.country,
    currency: event.currency,
    title: event.title,
    impact: event.impact,
    forecast: event.forecast,
    previous: event.previous,
    actual: event.actual,
    source: event.source
  };
}

export function evaluateNewsBlackout(params: {
  now: Date;
  currency: string;
  events: EconomicEventNormalized[];
  config: Pick<EconomicCalendarConfigSnapshot, "enabled" | "impactMin" | "preMinutes" | "postMinutes" | "currencies">;
}): EconomicBlackoutResult {
  const nowMs = params.now.getTime();
  const targetCurrency = normalizeCurrency(params.currency);
  const minImpactWeight = impactWeight(normalizeImpact(params.config.impactMin));
  const allowedCurrencies = parseCurrenciesCsv(params.config.currencies);

  if (!params.config.enabled) {
    return {
      newsRisk: false,
      currency: targetCurrency,
      nextEvent: null,
      activeWindow: null
    };
  }

  if (allowedCurrencies && !allowedCurrencies.has(targetCurrency)) {
    return {
      newsRisk: false,
      currency: targetCurrency,
      nextEvent: null,
      activeWindow: null
    };
  }

  const filtered = params.events
    .filter((event) => normalizeCurrency(event.currency) === targetCurrency)
    .filter((event) => impactWeight(normalizeImpact(event.impact)) >= minImpactWeight)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());

  let activeWindow: {
    from: Date;
    to: Date;
    event: EconomicEventNormalized;
  } | null = null;
  let nextEvent: EconomicEventNormalized | null = null;

  for (const event of filtered) {
    const eventMs = event.ts.getTime();
    const fromMs = eventMs - params.config.preMinutes * 60_000;
    const toMs = eventMs + params.config.postMinutes * 60_000;

    if (nowMs >= fromMs && nowMs <= toMs) {
      if (!activeWindow || toMs < activeWindow.to.getTime()) {
        activeWindow = {
          from: new Date(fromMs),
          to: new Date(toMs),
          event
        };
      }
    }

    if (eventMs >= nowMs && !nextEvent) {
      nextEvent = event;
    }
  }

  return {
    newsRisk: Boolean(activeWindow),
    currency: targetCurrency,
    nextEvent: nextEvent ? eventToView(nextEvent) : null,
    activeWindow: activeWindow
      ? {
          from: activeWindow.from.toISOString(),
          to: activeWindow.to.toISOString(),
          event: eventToView(activeWindow.event)
        }
      : null
  };
}
