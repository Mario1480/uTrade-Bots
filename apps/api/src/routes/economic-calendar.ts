import type express from "express";
import type { Express } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  getEconomicCalendarConfig,
  getEconomicCalendarNextSummary,
  listEconomicEvents,
  updateEconomicCalendarConfig
} from "../services/economicCalendar/index.js";

const impactSchema = z.enum(["low", "medium", "high"]);
const CALENDAR_PREFERENCES_KEY_PREFIX = "economic_calendar_preferences:";
const DEFAULT_CALENDAR_CURRENCIES = ["USD"];
const DEFAULT_CALENDAR_IMPACTS: ("low" | "medium" | "high")[] = ["high"];

const listQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  impact: impactSchema.optional(),
  impacts: z.string().trim().max(64).optional(),
  currency: z.string().trim().min(1).max(64).optional(),
  currencies: z.string().trim().max(256).optional()
});

const nextQuerySchema = z.object({
  currency: z.string().trim().min(1).max(64).optional(),
  currencies: z.string().trim().max(256).optional(),
  impact: impactSchema.default("high")
});

const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  enforceNewsRiskBlock: z.boolean().optional(),
  impactMin: impactSchema.optional(),
  currencies: z.string().trim().max(128).nullable().optional(),
  preMinutes: z.number().int().min(0).max(240).optional(),
  postMinutes: z.number().int().min(0).max(240).optional(),
  provider: z.literal("fmp").optional()
});

const preferencesUpdateSchema = z.object({
  currencies: z.array(z.string().trim().min(1).max(16)).max(16).optional(),
  impacts: z.array(impactSchema).min(1).max(3).optional()
});

type RegisterEconomicCalendarRoutesDeps = {
  db: any;
  requireSuperadmin: (res: express.Response) => Promise<boolean>;
  refreshJob?: {
    runCycle: (reason: "startup" | "scheduled" | "manual") => Promise<void>;
    getStatus: () => {
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
  };
};

function parseImpactList(raw: string | undefined): ("low" | "medium" | "high")[] | undefined {
  if (!raw) return undefined;
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is "low" | "medium" | "high" => (
      entry === "low" || entry === "medium" || entry === "high"
    ));
  if (parsed.length === 0) return undefined;
  return Array.from(new Set(parsed));
}

function parseCurrencyList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => /^[A-Z0-9]{2,10}$/.test(entry));
  if (parsed.length === 0) return undefined;
  return Array.from(new Set(parsed)).slice(0, 16);
}

function normalizeCalendarImpacts(raw: unknown): ("low" | "medium" | "high")[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CALENDAR_IMPACTS];
  const parsed = raw
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry): entry is "low" | "medium" | "high" => (
      entry === "low" || entry === "medium" || entry === "high"
    ));
  if (parsed.length === 0) return [...DEFAULT_CALENDAR_IMPACTS];
  return Array.from(new Set(parsed));
}

function normalizeCalendarCurrencies(raw: unknown): string[] {
  let values: string[] = [];
  if (Array.isArray(raw)) {
    values = raw.map((entry) => String(entry));
  } else if (typeof raw === "string") {
    values = raw.split(",");
  }

  const parsed = values
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => /^[A-Z0-9]{2,10}$/.test(entry));
  if (parsed.length === 0) return [...DEFAULT_CALENDAR_CURRENCIES];
  return Array.from(new Set(parsed)).slice(0, 16);
}

function parseStoredCalendarPreferences(value: unknown): {
  currencies: string[];
  impacts: ("low" | "medium" | "high")[];
} {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    currencies: normalizeCalendarCurrencies(raw.currencies),
    impacts: normalizeCalendarImpacts(raw.impacts)
  };
}

function calendarPreferencesKey(userId: string): string {
  return `${CALENDAR_PREFERENCES_KEY_PREFIX}${userId}`;
}

export function registerEconomicCalendarRoutes(
  app: Express,
  deps: RegisterEconomicCalendarRoutesDeps
) {
  app.get("/economic-calendar/preferences", requireAuth, async (_req, res) => {
    try {
      const user = getUserFromLocals(res);
      const row = await deps.db.globalSetting.findUnique({
        where: { key: calendarPreferencesKey(user.id) },
        select: { value: true, updatedAt: true }
      });
      const preferences = parseStoredCalendarPreferences(row?.value);
      return res.json({
        ...preferences,
        updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
      });
    } catch (error) {
      return res.status(500).json({
        error: "economic_calendar_preferences_unexpected_error",
        reason: String(error)
      });
    }
  });

  app.put("/economic-calendar/preferences", requireAuth, async (req, res) => {
    try {
      const parsed = preferencesUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      }

      const user = getUserFromLocals(res);
      const key = calendarPreferencesKey(user.id);
      const existing = await deps.db.globalSetting.findUnique({
        where: { key },
        select: { value: true }
      });
      const current = parseStoredCalendarPreferences(existing?.value);
      const next = {
        currencies:
          parsed.data.currencies !== undefined
            ? normalizeCalendarCurrencies(parsed.data.currencies)
            : current.currencies,
        impacts:
          parsed.data.impacts !== undefined
            ? normalizeCalendarImpacts(parsed.data.impacts)
            : current.impacts
      };

      const saved = await deps.db.globalSetting.upsert({
        where: { key },
        update: { value: next },
        create: { key, value: next },
        select: { updatedAt: true }
      });

      return res.json({
        ...next,
        updatedAt: saved.updatedAt instanceof Date ? saved.updatedAt.toISOString() : null
      });
    } catch (error) {
      return res.status(500).json({
        error: "economic_calendar_preferences_update_failed",
        reason: String(error)
      });
    }
  });

  app.get("/economic-calendar", requireAuth, async (req, res) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
      }

      const currencies = parseCurrencyList(parsed.data.currencies ?? parsed.data.currency);
      const events = await listEconomicEvents({
        db: deps.db,
        from: parsed.data.from ?? null,
        to: parsed.data.to ?? null,
        currency: currencies && currencies.length === 1 ? currencies[0] : null,
        currencies: currencies ?? null,
        impactMin: parsed.data.impact ?? "low",
        impacts: parseImpactList(parsed.data.impacts)
      });
      return res.json({ events });
    } catch (error) {
      return res.status(500).json({
        error: "economic_calendar_unexpected_error",
        reason: String(error)
      });
    }
  });

  app.get("/economic-calendar/next", requireAuth, async (req, res) => {
    try {
      const parsed = nextQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
      }

      const currencies = parseCurrencyList(parsed.data.currencies ?? parsed.data.currency);
      const summary = await getEconomicCalendarNextSummary({
        db: deps.db,
        currency: currencies?.[0] ?? "USD",
        impact: parsed.data.impact
      });
      return res.json(summary);
    } catch (error) {
      return res.status(500).json({
        error: "economic_calendar_unexpected_error",
        reason: String(error)
      });
    }
  });

  app.get("/economic-calendar/config", requireAuth, async (_req, res) => {
    try {
      const config = await getEconomicCalendarConfig(deps.db);
      return res.json(config);
    } catch (error) {
      return res.status(500).json({
        error: "economic_calendar_config_unexpected_error",
        reason: String(error)
      });
    }
  });

  app.put("/economic-calendar/config", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const parsed = configUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      }

      const config = await updateEconomicCalendarConfig(deps.db, parsed.data);
      return res.json(config);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("schema_not_ready") ? 503 : 500;
      return res.status(status).json({
        error: "economic_calendar_config_update_failed",
        reason
      });
    }
  });

  app.get("/economic-calendar/refresh-status", requireAuth, async (_req, res) => {
    if (!deps.refreshJob) {
      return res.status(404).json({ error: "economic_calendar_refresh_not_available" });
    }
    return res.json(deps.refreshJob.getStatus());
  });

  app.post("/economic-calendar/refresh", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!deps.refreshJob) {
      return res.status(404).json({ error: "economic_calendar_refresh_not_available" });
    }
    try {
      await deps.refreshJob.runCycle("manual");
      return res.json({ ok: true, status: deps.refreshJob.getStatus() });
    } catch (error) {
      return res.status(500).json({
        error: "economic_calendar_refresh_failed",
        reason: String(error)
      });
    }
  });
}
