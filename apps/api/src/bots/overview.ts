import { normalizeSymbolInput } from "../trading.js";

export type BotTradeStateOverviewRow = {
  botId: string;
  symbol: string;
  lastSignal: string | null;
  lastSignalTs: Date | null;
  lastTradeTs: Date | null;
  dailyTradeCount: number;
  openSide: string | null;
  openQty: number | null;
  openEntryPrice: number | null;
  openTs: Date | null;
};

export function readBotPrimaryTradeState(
  rows: BotTradeStateOverviewRow[],
  botId: string,
  symbol: string
) {
  const normalizedSymbol = normalizeSymbolInput(symbol);
  return rows.find((row) => row.botId === botId && normalizeSymbolInput(row.symbol) === normalizedSymbol) ?? null;
}

export function normalizeRuntimeReason(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized === "stopped_by_user") return "Stopped by user";
  if (normalized === "start_requested") return "Start requested";
  if (normalized.startsWith("queue_enqueue_failed")) return "Queue enqueue failed";
  if (normalized.startsWith("loop_error")) return "Loop error";
  return normalized;
}

export function deriveStoppedWhy(params: {
  botStatus: string;
  runtimeReason?: string | null;
  runtimeLastError?: string | null;
  botLastError?: string | null;
}): string | null {
  if (params.botStatus === "running") return null;
  const lastError = String(
    params.runtimeLastError
    ?? params.botLastError
    ?? ""
  ).trim();
  if (lastError) return lastError;
  const reason = normalizeRuntimeReason(params.runtimeReason);
  if (reason) return reason;
  if (params.botStatus === "stopped") return "Stopped";
  if (params.botStatus === "error") return "Runtime error";
  return null;
}

export function normalizeConfidencePercentValue(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 1) return Number((parsed * 100).toFixed(2));
  return Number(parsed.toFixed(2));
}

export function extractLastDecisionConfidence(
  events: Array<{ type: string; meta: unknown }>
): number | null {
  for (const event of events) {
    if (event.type !== "PREDICTION_COPIER_DECISION") continue;
    const meta = (event.meta && typeof event.meta === "object" && !Array.isArray(event.meta))
      ? event.meta as Record<string, unknown>
      : {};
    const confidence = normalizeConfidencePercentValue(meta.confidence);
    if (confidence !== null) return confidence;
  }
  return null;
}

export function computeRuntimeMarkPrice(params: {
  mid?: number | null;
  bid?: number | null;
  ask?: number | null;
}): number | null {
  const mid = Number(params.mid);
  if (Number.isFinite(mid) && mid > 0) return mid;

  const bid = Number(params.bid);
  const ask = Number(params.ask);
  if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) {
    return (bid + ask) / 2;
  }
  return null;
}

export function computeOpenPnlUsd(params: {
  side?: string | null;
  qty?: number | null;
  entryPrice?: number | null;
  markPrice?: number | null;
}): number | null {
  const qty = Number(params.qty);
  const entry = Number(params.entryPrice);
  const mark = Number(params.markPrice);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(mark) || mark <= 0) return null;

  const side = String(params.side ?? "").toLowerCase();
  let pnl = 0;
  if (side === "long") {
    pnl = (mark - entry) * qty;
  } else if (side === "short") {
    pnl = (entry - mark) * qty;
  } else {
    return null;
  }
  return Number(pnl.toFixed(4));
}

export function extractRealizedPnlUsdFromTradeEvent(event: {
  message?: string | null;
  meta: unknown;
}): number | null {
  const message = String(event.message ?? "").trim().toLowerCase();
  if (!message.startsWith("exit:")) return null;
  const meta = (event.meta && typeof event.meta === "object" && !Array.isArray(event.meta))
    ? event.meta as Record<string, unknown>
    : {};
  const realized = Number(meta.realizedPnlUsd);
  if (!Number.isFinite(realized)) return null;
  return Number(realized.toFixed(4));
}

export function sumRealizedPnlUsdFromTradeEvents(
  events: Array<{ message?: string | null; meta: unknown }>
): number {
  let sum = 0;
  for (const event of events) {
    const value = extractRealizedPnlUsdFromTradeEvent(event);
    if (value === null) continue;
    sum += value;
  }
  return Number(sum.toFixed(4));
}
