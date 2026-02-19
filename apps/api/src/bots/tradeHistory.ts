export type BotTradeHistoryOutcome =
  | "tp_hit"
  | "sl_hit"
  | "signal_exit"
  | "manual_exit"
  | "time_stop"
  | "unknown";

export type BotTradeHistoryCoreTrade = {
  id: string;
  side: string | null;
  entryTs: Date | null;
  exitTs: Date | null;
  entryPrice: number | null;
  exitPrice: number | null;
  realizedPnlUsd: number | null;
};

export type BotTradeHistoryCoreMetrics = {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  profitFactor: number | null;
  netPnlUsd: number;
  maxDrawdownUsd: number;
  avgHoldMinutes: number | null;
};

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export function computeRealizedPnlPct(params: {
  side: string | null | undefined;
  entryPrice: number | null | undefined;
  exitPrice: number | null | undefined;
}): number | null {
  const entry = toFiniteNumber(params.entryPrice);
  const exit = toFiniteNumber(params.exitPrice);
  if (entry === null || exit === null || entry <= 0 || exit <= 0) return null;

  const side = String(params.side ?? "").trim().toLowerCase();
  if (side === "long") {
    return round(((exit / entry) - 1) * 100, 4);
  }
  if (side === "short") {
    return round(((entry / exit) - 1) * 100, 4);
  }
  return null;
}

export function classifyOutcomeFromClose(params: {
  exitReason?: string | null;
  tpHit?: boolean;
  slHit?: boolean;
}): BotTradeHistoryOutcome {
  if (params.tpHit) return "tp_hit";
  if (params.slHit) return "sl_hit";

  const normalized = String(params.exitReason ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("time_stop")) return "time_stop";
  if (normalized.includes("manual")) return "manual_exit";
  if (
    normalized.includes("signal") ||
    normalized.includes("confidence_below_min") ||
    normalized.includes("blocked_tag") ||
    normalized.includes("missing_required_tags") ||
    normalized.includes("expected_move_below_min")
  ) {
    return "signal_exit";
  }
  return "unknown";
}

export function computeCoreMetricsFromClosedTrades(
  trades: BotTradeHistoryCoreTrade[]
): BotTradeHistoryCoreMetrics {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      winRatePct: null,
      avgWinUsd: null,
      avgLossUsd: null,
      profitFactor: null,
      netPnlUsd: 0,
      maxDrawdownUsd: 0,
      avgHoldMinutes: null
    };
  }

  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let netPnl = 0;
  let holdMinutesSum = 0;
  let holdMinutesCount = 0;

  const sortedByExit = trades
    .slice()
    .sort((a, b) => {
      const tsA = a.exitTs instanceof Date ? a.exitTs.getTime() : 0;
      const tsB = b.exitTs instanceof Date ? b.exitTs.getTime() : 0;
      return tsA - tsB;
    });

  let equityCurve = 0;
  let equityPeak = 0;
  let maxDrawdown = 0;

  for (const trade of sortedByExit) {
    const pnl = toFiniteNumber(trade.realizedPnlUsd) ?? 0;
    netPnl += pnl;
    if (pnl > 0) {
      wins += 1;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losses += 1;
      grossLossAbs += Math.abs(pnl);
    }

    equityCurve += pnl;
    if (equityCurve > equityPeak) equityPeak = equityCurve;
    const drawdown = equityPeak - equityCurve;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    if (trade.entryTs instanceof Date && trade.exitTs instanceof Date) {
      const holdMs = trade.exitTs.getTime() - trade.entryTs.getTime();
      if (Number.isFinite(holdMs) && holdMs >= 0) {
        holdMinutesSum += holdMs / 60_000;
        holdMinutesCount += 1;
      }
    }
  }

  const tradeCount = sortedByExit.length;
  const winRatePct = tradeCount > 0 ? round((wins / tradeCount) * 100, 2) : null;
  const avgWinUsd = wins > 0 ? round(grossProfit / wins, 4) : null;
  const avgLossUsd = losses > 0 ? round(-grossLossAbs / losses, 4) : null;
  const profitFactor = grossLossAbs > 0 ? round(grossProfit / grossLossAbs, 4) : null;
  const avgHoldMinutes = holdMinutesCount > 0 ? round(holdMinutesSum / holdMinutesCount, 2) : null;

  return {
    trades: tradeCount,
    wins,
    losses,
    winRatePct,
    avgWinUsd,
    avgLossUsd,
    profitFactor,
    netPnlUsd: round(netPnl, 4),
    maxDrawdownUsd: round(maxDrawdown, 4),
    avgHoldMinutes
  };
}

export function encodeTradeHistoryCursor(entryTs: Date, id: string): string {
  const payload = JSON.stringify({
    ts: entryTs.toISOString(),
    id: String(id)
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeTradeHistoryCursor(cursorRaw: string | null | undefined): {
  entryTs: Date;
  id: string;
} | null {
  const cursor = String(cursorRaw ?? "").trim();
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { ts?: string; id?: string };
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const date = new Date(typeof parsed.ts === "string" ? parsed.ts : "");
    if (!id || Number.isNaN(date.getTime())) return null;
    return {
      entryTs: date,
      id
    };
  } catch {
    return null;
  }
}
