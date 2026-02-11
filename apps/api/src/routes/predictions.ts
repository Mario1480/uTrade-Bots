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
    const result = await getPredictionDetailController({
      db,
      predictionId: String(req.params.id ?? ""),
      userId: user.id
    });
    return res.status(result.status).json(result.body);
  });
}
