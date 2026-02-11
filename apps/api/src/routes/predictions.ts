import type { Express } from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  getPredictionDetailController,
  type PredictionDetailControllerInput
} from "../controllers/predictionsController.js";

type PredictionDetailDb = PredictionDetailControllerInput["db"];

export function registerPredictionDetailRoute(app: Express, db: PredictionDetailDb) {
  app.get("/api/predictions/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const includeEventsRaw = String(req.query.events ?? "").trim().toLowerCase();
    const includeEvents = ["1", "true", "yes", "on"].includes(includeEventsRaw);
    const limitRaw = Number(req.query.eventsLimit ?? req.query.limit ?? 20);
    const eventsLimit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
    const result = await getPredictionDetailController({
      db,
      predictionId: String(req.params.id ?? ""),
      userId: user.id,
      includeEvents,
      eventsLimit
    });
    return res.status(result.status).json(result.body);
  });
}
