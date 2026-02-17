import { z } from "zod";

export const TRADE_DESK_PREFILL_SESSION_KEY = "tradeDeskPrefill";
const TRADE_DESK_PREFILL_EXPLANATION_MAX_CHARS = 1000;

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

const indicatorsSchema = z.object({
  rsi_14: z.number().nullable().optional(),
  macd: z.object({
    line: z.number().nullable().optional(),
    signal: z.number().nullable().optional(),
    hist: z.number().nullable().optional()
  }).nullable().optional(),
  bb: z.object({
    upper: z.number().nullable().optional(),
    mid: z.number().nullable().optional(),
    lower: z.number().nullable().optional(),
    width_pct: z.number().nullable().optional(),
    pos: z.number().nullable().optional()
  }).nullable().optional(),
  vwap: z.object({
    value: z.number().nullable().optional(),
    dist_pct: z.number().nullable().optional(),
    mode: z.string().optional(),
    sessionStartUtcMs: z.number().nullable().optional()
  }).nullable().optional(),
  adx: z.object({
    adx_14: z.number().nullable().optional(),
    plus_di_14: z.number().nullable().optional(),
    minus_di_14: z.number().nullable().optional()
  }).nullable().optional(),
  stochrsi: z.object({
    rsi_len: z.number().int().positive().optional(),
    stoch_len: z.number().int().positive().optional(),
    smooth_k: z.number().int().positive().optional(),
    smooth_d: z.number().int().positive().optional(),
    k: z.number().nullable().optional(),
    d: z.number().nullable().optional(),
    value: z.number().nullable().optional()
  }).nullable().optional(),
  volume: z.object({
    lookback: z.number().int().positive().optional(),
    vol_z: z.number().nullable().optional(),
    rel_vol: z.number().nullable().optional(),
    vol_ema_fast: z.number().nullable().optional(),
    vol_ema_slow: z.number().nullable().optional(),
    vol_trend: z.number().nullable().optional()
  }).nullable().optional(),
  fvg: z.object({
    lookback: z.number().int().positive().optional(),
    fill_rule: z.enum(["overlap", "mid_touch"]).optional(),
    open_bullish_count: z.number().int().nonnegative().optional(),
    open_bearish_count: z.number().int().nonnegative().optional(),
    nearest_bullish_gap: z.object({
      upper: z.number().nullable().optional(),
      lower: z.number().nullable().optional(),
      mid: z.number().nullable().optional(),
      dist_pct: z.number().nullable().optional(),
      age_bars: z.number().nullable().optional()
    }).nullable().optional(),
    nearest_bearish_gap: z.object({
      upper: z.number().nullable().optional(),
      lower: z.number().nullable().optional(),
      mid: z.number().nullable().optional(),
      dist_pct: z.number().nullable().optional(),
      age_bars: z.number().nullable().optional()
    }).nullable().optional(),
    last_created: z.object({
      type: z.enum(["bullish", "bearish"]).nullable().optional(),
      age_bars: z.number().nullable().optional()
    }).nullable().optional(),
    last_filled: z.object({
      type: z.enum(["bullish", "bearish"]).nullable().optional(),
      age_bars: z.number().nullable().optional()
    }).nullable().optional()
  }).nullable().optional()
}).optional();

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
  expectedMovePct: z.number().optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  side: z.enum(["long", "short"]).optional(),
  suggestedEntry: suggestedEntrySchema.optional(),
  suggestedStopLoss: z.number().positive().optional(),
  suggestedTakeProfit: z.number().positive().optional(),
  positionSizeHint: positionSizeHintSchema.optional(),
  tags: z.array(z.string()).max(5).optional(),
  explanation: z.string().max(TRADE_DESK_PREFILL_EXPLANATION_MAX_CHARS).optional(),
  keyDrivers: z.array(keyDriverSchema).max(5).optional(),
  indicators: indicatorsSchema
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
  expectedMovePct?: number | null;
  leverage?: number | null;
  suggestedEntry?: { type: "market" | "limit"; price?: number } | null;
  suggestedStopLoss?: number | null;
  suggestedTakeProfit?: number | null;
  positionSizeHint?: { mode: "percent_balance" | "fixed_quote"; value: number } | null;
  tags?: string[] | null;
  explanation?: string | null;
  keyDrivers?: { name: string; value: unknown }[] | null;
  indicators?: {
    rsi_14?: number | null;
    macd?: { line?: number | null; signal?: number | null; hist?: number | null } | null;
    bb?: {
      upper?: number | null;
      mid?: number | null;
      lower?: number | null;
      width_pct?: number | null;
      pos?: number | null;
    } | null;
    vwap?: {
      value?: number | null;
      dist_pct?: number | null;
      mode?: string;
      sessionStartUtcMs?: number | null;
    } | null;
    adx?: { adx_14?: number | null; plus_di_14?: number | null; minus_di_14?: number | null } | null;
    stochrsi?: {
      rsi_len?: number | null;
      stoch_len?: number | null;
      smooth_k?: number | null;
      smooth_d?: number | null;
      k?: number | null;
      d?: number | null;
      value?: number | null;
    } | null;
    volume?: {
      lookback?: number | null;
      vol_z?: number | null;
      rel_vol?: number | null;
      vol_ema_fast?: number | null;
      vol_ema_slow?: number | null;
      vol_trend?: number | null;
    } | null;
    fvg?: {
      lookback?: number | null;
      fill_rule?: "overlap" | "mid_touch" | null;
      open_bullish_count?: number | null;
      open_bearish_count?: number | null;
      nearest_bullish_gap?: {
        upper?: number | null;
        lower?: number | null;
        mid?: number | null;
        dist_pct?: number | null;
        age_bars?: number | null;
      } | null;
      nearest_bearish_gap?: {
        upper?: number | null;
        lower?: number | null;
        mid?: number | null;
        dist_pct?: number | null;
        age_bars?: number | null;
      } | null;
      last_created?: {
        type?: "bullish" | "bearish" | null;
        age_bars?: number | null;
      } | null;
      last_filled?: {
        type?: "bullish" | "bearish" | null;
        age_bars?: number | null;
      } | null;
    } | null;
  } | null;
};

function round(value: unknown, decimals: number): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Number(parsed.toFixed(decimals));
}

function normalizeIndicators(source: PredictionPrefillSource["indicators"]) {
  if (!source) return undefined;
  const normalizedFvgFillRule: "overlap" | "mid_touch" | undefined =
    source.fvg?.fill_rule === "mid_touch"
      ? "mid_touch"
      : source.fvg?.fill_rule === "overlap"
        ? "overlap"
        : undefined;
  return {
    rsi_14: round(source.rsi_14, 1),
    macd: source.macd
      ? {
          line: round(source.macd.line, 4),
          signal: round(source.macd.signal, 4),
          hist: round(source.macd.hist, 4)
        }
      : undefined,
    bb: source.bb
      ? {
          upper: round(source.bb.upper, 4),
          mid: round(source.bb.mid, 4),
          lower: round(source.bb.lower, 4),
          width_pct: round(source.bb.width_pct, 2),
          pos: round(source.bb.pos, 3)
        }
      : undefined,
    vwap: source.vwap
      ? {
          value: round(source.vwap.value, 4),
          dist_pct: round(source.vwap.dist_pct, 2),
          mode: source.vwap.mode,
          sessionStartUtcMs:
            typeof source.vwap.sessionStartUtcMs === "number" && Number.isFinite(source.vwap.sessionStartUtcMs)
              ? source.vwap.sessionStartUtcMs
              : undefined
        }
      : undefined,
    adx: source.adx
      ? {
          adx_14: round(source.adx.adx_14, 1),
          plus_di_14: round(source.adx.plus_di_14, 1),
          minus_di_14: round(source.adx.minus_di_14, 1)
        }
      : undefined,
    stochrsi: source.stochrsi
      ? {
          rsi_len: round(source.stochrsi.rsi_len, 0),
          stoch_len: round(source.stochrsi.stoch_len, 0),
          smooth_k: round(source.stochrsi.smooth_k, 0),
          smooth_d: round(source.stochrsi.smooth_d, 0),
          k: round(source.stochrsi.k, 1),
          d: round(source.stochrsi.d, 1),
          value: round(source.stochrsi.value, 1)
        }
      : undefined,
    volume: source.volume
      ? {
          lookback: round(source.volume.lookback, 0),
          vol_z: round(source.volume.vol_z, 3),
          rel_vol: round(source.volume.rel_vol, 3),
          vol_ema_fast: round(source.volume.vol_ema_fast, 4),
          vol_ema_slow: round(source.volume.vol_ema_slow, 4),
          vol_trend: round(source.volume.vol_trend, 2)
        }
      : undefined,
    fvg: source.fvg
      ? {
          lookback: round(source.fvg.lookback, 0),
          fill_rule: normalizedFvgFillRule,
          open_bullish_count: round(source.fvg.open_bullish_count, 0),
          open_bearish_count: round(source.fvg.open_bearish_count, 0),
          nearest_bullish_gap: source.fvg.nearest_bullish_gap
            ? {
                upper: round(source.fvg.nearest_bullish_gap.upper, 4),
                lower: round(source.fvg.nearest_bullish_gap.lower, 4),
                mid: round(source.fvg.nearest_bullish_gap.mid, 4),
                dist_pct: round(source.fvg.nearest_bullish_gap.dist_pct, 2),
                age_bars: round(source.fvg.nearest_bullish_gap.age_bars, 0)
              }
            : undefined,
          nearest_bearish_gap: source.fvg.nearest_bearish_gap
            ? {
                upper: round(source.fvg.nearest_bearish_gap.upper, 4),
                lower: round(source.fvg.nearest_bearish_gap.lower, 4),
                mid: round(source.fvg.nearest_bearish_gap.mid, 4),
                dist_pct: round(source.fvg.nearest_bearish_gap.dist_pct, 2),
                age_bars: round(source.fvg.nearest_bearish_gap.age_bars, 0)
              }
            : undefined,
          last_created: source.fvg.last_created
            ? {
                type:
                  source.fvg.last_created.type === "bullish" ||
                  source.fvg.last_created.type === "bearish"
                    ? source.fvg.last_created.type
                    : undefined,
                age_bars: round(source.fvg.last_created.age_bars, 0)
              }
            : undefined,
          last_filled: source.fvg.last_filled
            ? {
                type:
                  source.fvg.last_filled.type === "bullish" ||
                  source.fvg.last_filled.type === "bearish"
                    ? source.fvg.last_filled.type
                    : undefined,
                age_bars: round(source.fvg.last_filled.age_bars, 0)
              }
            : undefined
        }
      : undefined
  };
}

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
    expectedMovePct:
      typeof source.expectedMovePct === "number" && Number.isFinite(source.expectedMovePct)
        ? Number(source.expectedMovePct.toFixed(2))
        : undefined,
    leverage: source.leverage ?? undefined,
    side: sideMapped.side,
    suggestedEntry: source.suggestedEntry ?? undefined,
    suggestedStopLoss: source.suggestedStopLoss ?? undefined,
    suggestedTakeProfit: source.suggestedTakeProfit ?? undefined,
    positionSizeHint: source.positionSizeHint ?? undefined,
    tags: source.tags?.slice(0, 5) ?? undefined,
    explanation: source.explanation ?? undefined,
    keyDrivers: source.keyDrivers?.slice(0, 5) ?? undefined,
    indicators: normalizeIndicators(source.indicators)
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
