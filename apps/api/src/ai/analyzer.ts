export type AiInsightSeverity = "info" | "warning" | "critical";
export type AiInsightCategory = "spread" | "inventory" | "volume" | "risk" | "price_follow";

export type AiInsight = {
  severity: AiInsightSeverity;
  category: AiInsightCategory;
  title: string;
  message: string;
  recommendation: string;
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
  now?: Date;
};

function avg(values: number[]) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function dayProgress(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const ms = now.getTime() - start.getTime();
  return Math.max(0, Math.min(1, ms / (24 * 60 * 60_000)));
}

export function analyzeBotMetrics({ bot, points, now = new Date() }: AnalyzerInput): AiInsight[] {
  if (!points || points.length < 5) return [];
  const insights: AiInsight[] = [];
  const mm = bot?.mmConfig;
  const vol = bot?.volConfig;

  const spreadValues = points
    .map((p) => (typeof p.spreadPct === "number" && Number.isFinite(p.spreadPct) ? p.spreadPct : null))
    .filter((v): v is number => v !== null);
  const avgSpread = avg(spreadValues);

  const midValues = points
    .map((p) => (typeof p.mid === "number" && Number.isFinite(p.mid) ? p.mid : null))
    .filter((v): v is number => v !== null);

  const freeBaseValues = points
    .map((p) => (typeof p.freeBase === "number" && Number.isFinite(p.freeBase) ? p.freeBase : null))
    .filter((v): v is number => v !== null);
  const freeQuoteValues = points
    .map((p) => (typeof p.freeQuote === "number" && Number.isFinite(p.freeQuote) ? p.freeQuote : null))
    .filter((v): v is number => v !== null);

  const openOrderValues = points
    .map((p) => (typeof p.openOrders === "number" && Number.isFinite(p.openOrders) ? p.openOrders : null))
    .filter((v): v is number => v !== null);

  const notRunningCount = points.filter((p) => p.status && p.status !== "RUNNING").length;

  // RULE 1 — Wide Spread
  if (avgSpread !== null && mm?.spreadPct !== undefined && mm?.spreadPct !== null) {
    const configuredPct = Number(mm.spreadPct) * 100;
    if (Number.isFinite(configuredPct) && avgSpread > configuredPct * 1.5) {
      insights.push({
        severity: "warning",
        category: "spread",
        title: "Spread consistently wider than configured",
        message: `Average spread is ${avgSpread.toFixed(3)}% vs configured ${configuredPct.toFixed(3)}%.`,
        recommendation: "Consider reducing spreadPct or increasing budget to improve liquidity."
      });
    }
  }

  // RULE 2 — Inventory Drift
  if (freeBaseValues.length >= 5) {
    const first = freeBaseValues[0];
    const last = freeBaseValues[freeBaseValues.length - 1];
    const avgBase = avg(freeBaseValues);
    if (avgBase && avgBase > 0) {
      const driftRatio = Math.abs(last - first) / avgBase;
      const skewFactor = Number(mm?.skewFactor ?? 0);
      const maxSkew = Number(mm?.maxSkew ?? 0);
      if (driftRatio > 0.3 && (skewFactor <= 0.001 || maxSkew <= 0.01)) {
        insights.push({
          severity: "info",
          category: "inventory",
          title: "Inventory imbalance detected",
          message: `Base balance drifted by ${(driftRatio * 100).toFixed(1)}% over the range.`,
          recommendation: "Enable or increase skewFactor to rebalance inventory."
        });
      }
    }
  }

  // RULE 3 — Volume Not Reaching Target (late in day)
  if (vol?.dailyNotionalUsdt && Number(vol.dailyNotionalUsdt) > 0) {
    const latestNotional = [...points].reverse().find((p) => Number.isFinite(p.tradedNotionalToday ?? NaN))
      ?.tradedNotionalToday as number | undefined;
    const progress = dayProgress(now);
    if (latestNotional !== undefined && progress >= 0.7 && latestNotional < Number(vol.dailyNotionalUsdt) * 0.6) {
      insights.push({
        severity: "warning",
        category: "volume",
        title: "Volume target likely not reached",
        message: `Traded notional is ${latestNotional.toFixed(2)} vs daily target ${Number(
          vol.dailyNotionalUsdt
        ).toFixed(2)}.`,
        recommendation: "Consider increasing maxTradeUsdt or widening the active window."
      });
    }
  }

  // RULE 4 — Frequent Runtime Errors
  if (points.length >= 5) {
    const ratio = notRunningCount / points.length;
    if (notRunningCount >= 3 && ratio >= 0.2) {
      insights.push({
        severity: "critical",
        category: "risk",
        title: "Frequent runtime errors detected",
        message: `${notRunningCount} of ${points.length} metric points are not RUNNING.`,
        recommendation: "Check exchange stability, rate limits, or balances."
      });
    }
  }

  // RULE 5 — Idle Budget
  if (freeQuoteValues.length >= 3 && midValues.length >= 3) {
    const avgFreeQuote = avg(freeQuoteValues);
    const invValues: number[] = [];
    points.forEach((p) => {
      const mid = p.mid;
      const fq = p.freeQuote;
      const fb = p.freeBase;
      if (Number.isFinite(mid) && Number.isFinite(fq) && Number.isFinite(fb)) {
        invValues.push((fq as number) + (fb as number) * (mid as number));
      }
    });
    const avgInv = avg(invValues);
    const avgOpen = avg(openOrderValues);
    if (avgInv && avgInv > 0 && avgFreeQuote && avgOpen !== null) {
      const ratio = avgFreeQuote / avgInv;
      if (ratio > 0.8 && avgOpen <= 1) {
        insights.push({
          severity: "info",
          category: "inventory",
          title: "Large unused budget detected",
          message: `Free quote is ${(ratio * 100).toFixed(1)}% of inventory value with low open orders.`,
          recommendation: "Consider increasing levels or reducing spreadPct to use more budget."
        });
      }
    }
  }

  return insights;
}
