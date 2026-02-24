import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { listNews } from "../services/news/index.js";

const newsModeSchema = z.enum(["all", "crypto", "general"]);

const newsQuerySchema = z.object({
  mode: newsModeSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  page: z.coerce.number().int().min(1).max(100).default(1),
  q: z.string().trim().max(120).optional(),
  symbols: z.string().trim().max(300).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fromTs: z.string().datetime({ offset: true }).optional(),
  toTs: z.string().datetime({ offset: true }).optional()
});

export { newsQuerySchema };

function parseSymbols(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, 30);
}

function isProviderError(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("fmp_api_key_missing") ||
    normalized.includes("http_") ||
    normalized.includes("fetch") ||
    normalized.includes("aborted") ||
    normalized.includes("news_provider_unavailable")
  );
}

export function registerNewsRoutes(app: Express, deps: { db: any }) {
  app.get("/news", requireAuth, async (req, res) => {
    try {
      const parsed = newsQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
      }

      const payload = await listNews({
        db: deps.db,
        mode: parsed.data.mode,
        limit: parsed.data.limit,
        page: parsed.data.page,
        q: parsed.data.q ?? null,
        symbols: parseSymbols(parsed.data.symbols),
        from: parsed.data.from ?? null,
        to: parsed.data.to ?? null,
        fromTs: parsed.data.fromTs ?? null,
        toTs: parsed.data.toTs ?? null
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      if (isProviderError(reason)) {
        return res.status(503).json({
          error: "news_provider_unavailable",
          reason
        });
      }
      return res.status(500).json({
        error: "news_unexpected_error",
        reason
      });
    }
  });
}
