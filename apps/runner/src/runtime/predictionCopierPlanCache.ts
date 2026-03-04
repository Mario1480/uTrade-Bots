import type { PredictionCopierPreparedTickReady } from "../prediction-copier.js";

const PLAN_TTL_MS = 120_000;

type CachedPlan = {
  botId: string;
  expiresAt: number;
  plan: PredictionCopierPreparedTickReady;
};

const cache = new Map<string, CachedPlan>();

function nowMs(): number {
  return Date.now();
}

function pruneExpired(): void {
  const now = nowMs();
  for (const [planId, row] of cache.entries()) {
    if (row.expiresAt <= now) {
      cache.delete(planId);
    }
  }
}

function createPlanId(botId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `pc_plan_${botId}_${Date.now()}_${rand}`;
}

export function storePredictionCopierPlan(botId: string, plan: PredictionCopierPreparedTickReady): string {
  pruneExpired();
  const planId = createPlanId(botId);
  cache.set(planId, {
    botId,
    expiresAt: nowMs() + PLAN_TTL_MS,
    plan
  });
  return planId;
}

export function consumePredictionCopierPlan(botId: string, planId: string): PredictionCopierPreparedTickReady | null {
  pruneExpired();
  const row = cache.get(planId);
  if (!row) return null;
  cache.delete(planId);
  if (row.botId !== botId) return null;
  if (row.expiresAt <= nowMs()) return null;
  return row.plan;
}
