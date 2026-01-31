import { callAi } from "./provider.js";
import { buildAiPrompt } from "./prompt.js";

export type AiInsightSeverity = "info" | "warning" | "critical";
export type AiInsightCategory = "spread" | "inventory" | "volume" | "risk" | "price_follow";
export type AiInsightConfidence = "low" | "medium" | "high";

export type AiInsight = {
  severity: AiInsightSeverity;
  category: AiInsightCategory;
  title: string;
  message: string;
  recommendation: string;
  confidence?: AiInsightConfidence;
  evidence?: Record<string, any>;
  suggestedConfig?: {
    mm?: Partial<Record<string, any>>;
    vol?: Partial<Record<string, any>>;
    risk?: Partial<Record<string, any>>;
  };
  impactEstimate?: {
    expectedSpreadChangePct?: number;
    expectedInventoryDriftReduction?: "low" | "medium" | "high";
    expectedVolumeProgress?: "low" | "medium" | "high";
  };
};

export type AnalyzerResult = {
  insights: AiInsight[];
  healthScore: number;
  aiEnabled: boolean;
  warning?: string;
};

type MetricPoint = {
  ts: Date;
  mid?: number | null;
  spreadPct?: number | null;
  freeQuote?: number | null;
  freeBase?: number | null;
  openOrders?: number | null;
  tradedNotionalToday?: number | null;
  status?: string | null;
};

type AnalyzerInput = {
  bot: any;
  points: MetricPoint[];
  range: "24h" | "7d";
  aiEnabled: boolean;
  workspaceId: string;
  now?: Date;
};

type Summary = {
  avgSpreadPct: number | null;
  spreadTargetPct: number | null;
  inventoryDriftPct: number | null;
  freeQuoteAvg: number | null;
  inventoryValueAvg: number | null;
  openOrdersAvg: number | null;
  errorCount: number;
  totalPoints: number;
  volumeToday: number | null;
  volumeTarget: number | null;
  dayProgress: number;
};

const aiCache = new Map<string, { ts: number; insights: AiInsight[] }>();
const rateWindowMs = 60_000;
const rateBuckets = new Map<string, number[]>();

function avg(values: number[]) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function dayProgress(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const ms = now.getTime() - start.getTime();
  return clamp(ms / (24 * 60 * 60_000), 0, 1);
}

function buildSummary(bot: any, points: MetricPoint[], now: Date): Summary {
  const spreadValues = points
    .map((p) => (typeof p.spreadPct === "number" && Number.isFinite(p.spreadPct) ? p.spreadPct : null))
    .filter((v): v is number => v !== null);
  const avgSpreadPct = avg(spreadValues);

  const freeBaseValues = points
    .map((p) => (typeof p.freeBase === "number" && Number.isFinite(p.freeBase) ? p.freeBase : null))
    .filter((v): v is number => v !== null);
  const freeQuoteValues = points
    .map((p) => (typeof p.freeQuote === "number" && Number.isFinite(p.freeQuote) ? p.freeQuote : null))
    .filter((v): v is number => v !== null);
  const openOrderValues = points
    .map((p) => (typeof p.openOrders === "number" && Number.isFinite(p.openOrders) ? p.openOrders : null))
    .filter((v): v is number => v !== null);
  const midValues = points
    .map((p) => (typeof p.mid === "number" && Number.isFinite(p.mid) ? p.mid : null))
    .filter((v): v is number => v !== null);

  const firstBase = freeBaseValues.length ? freeBaseValues[0] : null;
  const lastBase = freeBaseValues.length ? freeBaseValues[freeBaseValues.length - 1] : null;
  const avgBase = avg(freeBaseValues);
  const inventoryDriftPct =
    avgBase && firstBase !== null && lastBase !== null ? (Math.abs(lastBase - firstBase) / avgBase) * 100 : null;

  const invValues: number[] = [];
  points.forEach((p) => {
    const mid = p.mid;
    const fq = p.freeQuote;
    const fb = p.freeBase;
    if (Number.isFinite(mid) && Number.isFinite(fq) && Number.isFinite(fb)) {
      invValues.push((fq as number) + (fb as number) * (mid as number));
    }
  });
  const inventoryValueAvg = avg(invValues);

  const errorCount = points.filter((p) => p.status && p.status !== "RUNNING").length;
  const volumeToday = [...points].reverse().find((p) => Number.isFinite(p.tradedNotionalToday ?? NaN))
    ?.tradedNotionalToday as number | null;

  const mm = bot?.mmConfig;
  const vol = bot?.volConfig;
  const spreadTargetPct = mm?.spreadPct !== undefined ? Number(mm.spreadPct) * 100 : null;

  return {
    avgSpreadPct,
    spreadTargetPct,
    inventoryDriftPct,
    freeQuoteAvg: avg(freeQuoteValues),
    inventoryValueAvg,
    openOrdersAvg: avg(openOrderValues),
    errorCount,
    totalPoints: points.length,
    volumeToday: volumeToday ?? null,
    volumeTarget: vol?.dailyNotionalUsdt ?? null,
    dayProgress: dayProgress(now)
  };
}

function ruleInsights(bot: any, summary: Summary): AiInsight[] {
  const insights: AiInsight[] = [];
  const mm = bot?.mmConfig;
  const vol = bot?.volConfig;

  // RULE 1 — Wide Spread
  if (summary.avgSpreadPct !== null && summary.spreadTargetPct !== null) {
    if (summary.avgSpreadPct > summary.spreadTargetPct * 1.5) {
      insights.push({
        severity: "warning",
        category: "spread",
        title: "Spread consistently wider than configured",
        message: `Average spread is ${summary.avgSpreadPct.toFixed(3)}% vs configured ${summary.spreadTargetPct.toFixed(3)}%.`,
        recommendation: "Consider reducing spreadPct or increasing budget to improve liquidity.",
        confidence: "medium",
        evidence: {
          avgSpreadPct: summary.avgSpreadPct,
          spreadTargetPct: summary.spreadTargetPct
        }
      });
    }
  }

  // RULE 2 — Inventory Drift
  if (summary.inventoryDriftPct !== null) {
    const skewFactor = Number(mm?.skewFactor ?? 0);
    const maxSkew = Number(mm?.maxSkew ?? 0);
    if (summary.inventoryDriftPct > 30 && (skewFactor <= 0.001 || maxSkew <= 0.01)) {
      insights.push({
        severity: "info",
        category: "inventory",
        title: "Inventory imbalance detected",
        message: `Base balance drifted by ${summary.inventoryDriftPct.toFixed(1)}% over the range.`,
        recommendation: "Enable or increase skewFactor to rebalance inventory.",
        confidence: "low",
        evidence: { inventoryDriftPct: summary.inventoryDriftPct }
      });
    }
  }

  // RULE 3 — Volume Not Reaching Target
  if (vol?.dailyNotionalUsdt && summary.volumeToday !== null && summary.dayProgress >= 0.7) {
    if (summary.volumeToday < Number(vol.dailyNotionalUsdt) * 0.6) {
      insights.push({
        severity: "warning",
        category: "volume",
        title: "Volume target likely not reached",
        message: `Traded notional is ${summary.volumeToday.toFixed(2)} vs daily target ${Number(
          vol.dailyNotionalUsdt
        ).toFixed(2)}.`,
        recommendation: "Consider increasing maxTradeUsdt or widening the active window.",
        confidence: "medium",
        evidence: {
          volumeToday: summary.volumeToday,
          volumeTarget: Number(vol.dailyNotionalUsdt),
          dayProgress: summary.dayProgress
        }
      });
    }
  }

  // RULE 4 — Frequent Runtime Errors
  if (summary.totalPoints >= 5 && summary.errorCount >= 3 && summary.errorCount / summary.totalPoints >= 0.2) {
    insights.push({
      severity: "critical",
      category: "risk",
      title: "Frequent runtime errors detected",
      message: `${summary.errorCount} of ${summary.totalPoints} metric points are not RUNNING.`,
      recommendation: "Check exchange stability, rate limits, or balances.",
      confidence: "high",
      evidence: {
        errorCount: summary.errorCount,
        totalPoints: summary.totalPoints
      }
    });
  }

  // RULE 5 — Idle Budget
  if (summary.inventoryValueAvg && summary.freeQuoteAvg !== null && summary.openOrdersAvg !== null) {
    const ratio = summary.freeQuoteAvg / summary.inventoryValueAvg;
    if (ratio > 0.8 && summary.openOrdersAvg <= 1) {
      insights.push({
        severity: "info",
        category: "inventory",
        title: "Large unused budget detected",
        message: `Free quote is ${(ratio * 100).toFixed(1)}% of inventory value with low open orders.`,
        recommendation: "Consider increasing levels or reducing spreadPct to use more budget.",
        confidence: "low",
        evidence: {
          freeQuoteRatio: ratio,
          openOrdersAvg: summary.openOrdersAvg
        }
      });
    }
  }

  return insights;
}

function computeHealthScore(summary: Summary): number {
  let score = 100;

  if (summary.avgSpreadPct !== null && summary.spreadTargetPct !== null) {
    if (summary.avgSpreadPct > summary.spreadTargetPct * 2) score -= 25;
    else if (summary.avgSpreadPct > summary.spreadTargetPct * 1.5) score -= 15;
  }

  if (summary.totalPoints >= 5 && summary.errorCount > 0) {
    const ratio = summary.errorCount / summary.totalPoints;
    if (ratio >= 0.4) score -= 50;
    else if (ratio >= 0.2) score -= 30;
    else if (ratio >= 0.1) score -= 15;
  }

  if (summary.volumeTarget && summary.volumeToday !== null && summary.dayProgress >= 0.7) {
    if (summary.volumeToday < summary.volumeTarget * 0.6) score -= 15;
  }

  if (summary.inventoryDriftPct !== null) {
    if (summary.inventoryDriftPct > 50) score -= 20;
    else if (summary.inventoryDriftPct > 30) score -= 10;
  }

  return clamp(Math.round(score), 0, 100);
}

function dedupeInsights(list: AiInsight[]) {
  const seen = new Set<string>();
  const out: AiInsight[] = [];
  for (const ins of list) {
    const key = `${ins.category}:${ins.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ins);
  }
  return out;
}

function isTimeHHMM(v: string) {
  return /^\d{2}:\d{2}$/.test(v);
}

function sanitizeSuggestedConfig(raw: any) {
  if (!raw || typeof raw !== "object") return undefined;
  const out: { mm?: Record<string, any>; vol?: Record<string, any>; risk?: Record<string, any> } = {};

  const mm = raw.mm;
  if (mm && typeof mm === "object") {
    const next: Record<string, any> = {};
    const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : null);

    const spreadPct = num(mm.spreadPct);
    if (spreadPct !== null && spreadPct > 0 && spreadPct <= 0.5) next.spreadPct = spreadPct;
    const maxSpreadPct = num(mm.maxSpreadPct);
    if (maxSpreadPct !== null && maxSpreadPct > 0 && maxSpreadPct <= 0.8) next.maxSpreadPct = maxSpreadPct;
    const levelsUp = num(mm.levelsUp);
    if (levelsUp !== null && levelsUp >= 0 && levelsUp <= 30) next.levelsUp = Math.round(levelsUp);
    const levelsDown = num(mm.levelsDown);
    if (levelsDown !== null && levelsDown >= 0 && levelsDown <= 30) next.levelsDown = Math.round(levelsDown);
    const minOrderUsdt = num(mm.minOrderUsdt);
    if (minOrderUsdt !== null && minOrderUsdt >= 0) next.minOrderUsdt = minOrderUsdt;
    const maxOrderUsdt = num(mm.maxOrderUsdt);
    if (maxOrderUsdt !== null && maxOrderUsdt >= 0) next.maxOrderUsdt = maxOrderUsdt;
    if (minOrderUsdt !== null && maxOrderUsdt !== null && maxOrderUsdt < minOrderUsdt) {
      delete next.maxOrderUsdt;
    }
    const jitterPct = num(mm.jitterPct);
    if (jitterPct !== null && jitterPct >= 0 && jitterPct <= 0.2) next.jitterPct = jitterPct;
    const skewFactor = num(mm.skewFactor);
    if (skewFactor !== null && skewFactor >= 0 && skewFactor <= 1) next.skewFactor = skewFactor;
    const maxSkew = num(mm.maxSkew);
    if (maxSkew !== null && maxSkew >= 0 && maxSkew <= 1) next.maxSkew = maxSkew;

    if (Object.keys(next).length) out.mm = next;
  }

  const vol = raw.vol;
  if (vol && typeof vol === "object") {
    const next: Record<string, any> = {};
    const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const dailyNotionalUsdt = num(vol.dailyNotionalUsdt);
    if (dailyNotionalUsdt !== null && dailyNotionalUsdt > 0) next.dailyNotionalUsdt = dailyNotionalUsdt;
    const minTradeUsdt = num(vol.minTradeUsdt);
    if (minTradeUsdt !== null && minTradeUsdt >= 0) next.minTradeUsdt = minTradeUsdt;
    const maxTradeUsdt = num(vol.maxTradeUsdt);
    if (maxTradeUsdt !== null && maxTradeUsdt >= 0) next.maxTradeUsdt = maxTradeUsdt;
    if (minTradeUsdt !== null && maxTradeUsdt !== null && maxTradeUsdt < minTradeUsdt) {
      delete next.maxTradeUsdt;
    }
    const buyPct = num(vol.buyPct);
    if (buyPct !== null && buyPct >= 0 && buyPct <= 1) next.buyPct = buyPct;
    const buyBumpTicks = num(vol.buyBumpTicks);
    if (buyBumpTicks !== null && buyBumpTicks >= 0 && buyBumpTicks <= 20) next.buyBumpTicks = buyBumpTicks;
    const sellBumpTicks = num(vol.sellBumpTicks);
    if (sellBumpTicks !== null && sellBumpTicks >= 0 && sellBumpTicks <= 20) next.sellBumpTicks = sellBumpTicks;
    if (typeof vol.activeFrom === "string" && isTimeHHMM(vol.activeFrom)) next.activeFrom = vol.activeFrom;
    if (typeof vol.activeTo === "string" && isTimeHHMM(vol.activeTo)) next.activeTo = vol.activeTo;

    if (Object.keys(next).length) out.vol = next;
  }

  const risk = raw.risk;
  if (risk && typeof risk === "object") {
    const next: Record<string, any> = {};
    const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const minUsdt = num(risk.minUsdt);
    if (minUsdt !== null && minUsdt >= 0) next.minUsdt = minUsdt;
    const maxDeviationPct = num(risk.maxDeviationPct);
    if (maxDeviationPct !== null && maxDeviationPct >= 0 && maxDeviationPct <= 0.5) next.maxDeviationPct = maxDeviationPct;
    const maxOpenOrders = num(risk.maxOpenOrders);
    if (maxOpenOrders !== null && maxOpenOrders >= 0 && maxOpenOrders <= 10000) next.maxOpenOrders = Math.round(maxOpenOrders);
    const maxDailyLoss = num(risk.maxDailyLoss);
    if (maxDailyLoss !== null && maxDailyLoss >= 0) next.maxDailyLoss = maxDailyLoss;
    if (Object.keys(next).length) out.risk = next;
  }

  if (!out.mm && !out.vol && !out.risk) return undefined;
  return out;
}

function sanitizeAiInsights(raw: any): AiInsight[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: AiInsight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const severity = item.severity as AiInsightSeverity;
    const category = item.category as AiInsightCategory;
    if (!severity || !category) continue;
    if (typeof item.title !== "string" || typeof item.message !== "string" || typeof item.recommendation !== "string")
      continue;
    const insight: AiInsight = {
      severity,
      category,
      title: item.title.trim(),
      message: item.message.trim(),
      recommendation: item.recommendation.trim()
    };
    if (item.confidence === "low" || item.confidence === "medium" || item.confidence === "high") {
      insight.confidence = item.confidence;
    }
    if (item.evidence && typeof item.evidence === "object") {
      insight.evidence = item.evidence;
    }
    const suggested = sanitizeSuggestedConfig(item.suggestedConfig);
    if (suggested) {
      insight.suggestedConfig = suggested;
    }
    const impact = item.impactEstimate;
    if (impact && typeof impact === "object") {
      const next: AiInsight["impactEstimate"] = {};
      if (Number.isFinite(Number(impact.expectedSpreadChangePct))) {
        next.expectedSpreadChangePct = Number(impact.expectedSpreadChangePct);
      }
      if (impact.expectedInventoryDriftReduction === "low" || impact.expectedInventoryDriftReduction === "medium" || impact.expectedInventoryDriftReduction === "high") {
        next.expectedInventoryDriftReduction = impact.expectedInventoryDriftReduction;
      }
      if (impact.expectedVolumeProgress === "low" || impact.expectedVolumeProgress === "medium" || impact.expectedVolumeProgress === "high") {
        next.expectedVolumeProgress = impact.expectedVolumeProgress;
      }
      if (Object.keys(next).length) insight.impactEstimate = next;
    }
    cleaned.push(insight);
  }
  return cleaned;
}

function rateLimitAllows(workspaceId: string, limitPerMin: number) {
  const now = Date.now();
  const bucket = rateBuckets.get(workspaceId) ?? [];
  const next = bucket.filter((ts) => now - ts < rateWindowMs);
  if (next.length >= limitPerMin) {
    rateBuckets.set(workspaceId, next);
    return false;
  }
  next.push(now);
  rateBuckets.set(workspaceId, next);
  return true;
}

export async function analyzeBotMetrics(input: AnalyzerInput): Promise<AnalyzerResult> {
  const { bot, points, range, aiEnabled, workspaceId, now = new Date() } = input;
  if (!points || points.length < 5) {
    return { insights: [], healthScore: 100, aiEnabled };
  }

  const summary = buildSummary(bot, points, now);
  const rule = ruleInsights(bot, summary);
  const healthScore = computeHealthScore(summary);

  if (!aiEnabled) {
    return { insights: rule, healthScore, aiEnabled };
  }

  const cacheKey = `${bot.id}:${range}`;
  const cacheTtlMs = (Number(process.env.AI_CACHE_TTL_SEC ?? "300") || 300) * 1000;
  const cached = aiCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cacheTtlMs) {
    return { insights: dedupeInsights(rule.concat(cached.insights)), healthScore, aiEnabled };
  }

  const limitPerMin = Number(process.env.AI_RATE_LIMIT_PER_MIN ?? "30") || 30;
  if (!rateLimitAllows(workspaceId, limitPerMin)) {
    return {
      insights: rule,
      healthScore,
      aiEnabled,
      warning: "ai_rate_limited"
    };
  }

  const payload = {
    bot: {
      exchange: bot.exchange,
      symbol: bot.symbol,
      priceSourceMode: bot.priceSourceMode ?? "CEX"
    },
    mm: bot.mmConfig ?? null,
    vol: bot.volConfig ?? null,
    risk: bot.riskConfig ?? null,
    summary
  };
  const prompt = buildAiPrompt(payload);

  let ai: { ok: boolean; data?: any } | null = null;
  try {
    ai = await callAi(prompt);
  } catch {
    ai = null;
  }

  if (!ai || !ai.ok || !ai.data) {
    return {
      insights: rule,
      healthScore,
      aiEnabled,
      warning: "ai_unavailable"
    };
  }

  const aiInsights = sanitizeAiInsights(ai.data);
  aiCache.set(cacheKey, { ts: Date.now(), insights: aiInsights });
  return {
    insights: dedupeInsights(rule.concat(aiInsights)),
    healthScore,
    aiEnabled
  };
}
