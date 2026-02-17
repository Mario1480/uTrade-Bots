import type express from "express";
import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import {
  getEconomicCalendarConfig,
  getEconomicCalendarNextSummary,
  listEconomicEvents,
  updateEconomicCalendarConfig
} from "../services/economicCalendar/index.js";

const impactSchema = z.enum(["low", "medium", "high"]);

const listQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  impact: impactSchema.optional(),
  impacts: z.string().trim().max(64).optional(),
  currency: z.string().trim().min(1).max(16).optional()
});

const nextQuerySchema = z.object({
  currency: z.string().trim().min(1).max(16).default("USD"),
  impact: impactSchema.default("high")
});

const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  impactMin: impactSchema.optional(),
  currencies: z.string().trim().max(128).nullable().optional(),
  preMinutes: z.number().int().min(0).max(240).optional(),
  postMinutes: z.number().int().min(0).max(240).optional(),
  provider: z.literal("fmp").optional()
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

export function registerEconomicCalendarRoutes(
  app: Express,
  deps: RegisterEconomicCalendarRoutesDeps
) {
  app.get("/economic-calendar", requireAuth, async (req, res) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
      }

      const events = await listEconomicEvents({
        db: deps.db,
        from: parsed.data.from ?? null,
        to: parsed.data.to ?? null,
        currency: parsed.data.currency ?? null,
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

      const summary = await getEconomicCalendarNextSummary({
        db: deps.db,
        currency: parsed.data.currency,
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
