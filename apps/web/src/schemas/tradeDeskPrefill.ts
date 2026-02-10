import { z } from "zod";

export const TRADE_DESK_PREFILL_SESSION_KEY = "tradeDeskPrefill";

const suggestedEntrySchema = z.object({
  type: z.enum(["market", "limit"]),
  price: z.number().positive().optional()
});

const positionSizeHintSchema = z.object({
  mode: z.enum(["percent_balance", "fixed_quote"]),
  value: z.number().positive()
});

const keyDriverSchema = z.object({
  name: z.string().min(1),
  value: z.unknown()
});

export const tradeDeskPrefillSchema = z.object({
  exchange: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  predictionId: z.string().trim().min(1),
  tsCreated: z.string().datetime(),
  signal: z.enum(["up", "down", "neutral"]),
  confidence: z.number().min(0).max(100),
  leverage: z.number().int().min(1).max(125).optional(),
  side: z.enum(["long", "short"]).optional(),
  suggestedEntry: suggestedEntrySchema.optional(),
  suggestedStopLoss: z.number().positive().optional(),
  suggestedTakeProfit: z.number().positive().optional(),
  positionSizeHint: positionSizeHintSchema.optional(),
  tags: z.array(z.string()).max(20).optional(),
  explanation: z.string().max(400).optional(),
  keyDrivers: z.array(keyDriverSchema).max(5).optional()
});

export type TradeDeskPrefillPayload = z.infer<typeof tradeDeskPrefillSchema>;

export type PredictionPrefillSource = {
  predictionId: string;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  tsCreated: string;
  signal: "up" | "down" | "neutral";
  confidence: number;
  leverage?: number | null;
  suggestedEntry?: { type: "market" | "limit"; price?: number } | null;
  suggestedStopLoss?: number | null;
  suggestedTakeProfit?: number | null;
  positionSizeHint?: { mode: "percent_balance" | "fixed_quote"; value: number } | null;
  tags?: string[] | null;
  explanation?: string | null;
  keyDrivers?: { name: string; value: unknown }[] | null;
};

export function toConfidencePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

export function mapSignalToSide(
  signal: "up" | "down" | "neutral",
  marketType: "spot" | "perp"
): { side?: "long" | "short"; info?: string } {
  if (signal === "up") return { side: "long" };
  if (signal === "down") {
    if (marketType === "spot") {
      return {
        info: "Spot short not supported. Please choose a valid spot action manually."
      };
    }
    return { side: "short" };
  }
  return {};
}

export function buildTradeDeskPrefillPayload(
  source: PredictionPrefillSource
): { payload: TradeDeskPrefillPayload; info?: string } {
  const sideMapped = mapSignalToSide(source.signal, source.marketType);

  const candidate: TradeDeskPrefillPayload = {
    exchange: source.exchange,
    accountId: source.accountId,
    symbol: source.symbol,
    marketType: source.marketType,
    timeframe: source.timeframe,
    predictionId: source.predictionId,
    tsCreated: source.tsCreated,
    signal: source.signal,
    confidence: toConfidencePercent(source.confidence),
    leverage: source.leverage ?? undefined,
    side: sideMapped.side,
    suggestedEntry: source.suggestedEntry ?? undefined,
    suggestedStopLoss: source.suggestedStopLoss ?? undefined,
    suggestedTakeProfit: source.suggestedTakeProfit ?? undefined,
    positionSizeHint: source.positionSizeHint ?? undefined,
    tags: source.tags ?? undefined,
    explanation: source.explanation ?? undefined,
    keyDrivers: source.keyDrivers ?? undefined
  };

  const validated = tradeDeskPrefillSchema.parse(candidate);
  return {
    payload: validated,
    info: sideMapped.info
  };
}

export function parseTradeDeskPrefill(value: unknown): TradeDeskPrefillPayload | null {
  const parsed = tradeDeskPrefillSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}
