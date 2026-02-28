import { z } from "zod";
import { logger } from "../../logger.js";
import type { Timeframe } from "../../market/timeframe.js";
import type { ChatToolDefinition } from "../provider.js";
import {
  getBinanceIndicators,
  getBinanceOhlcv,
  getBinanceOrderbook,
  getBinanceTicker,
  type BinanceMarketType
} from "./binance.js";

export const MAX_TOOL_ITERATIONS = Math.max(
  1,
  Number(process.env.AI_AGENT_MAX_TOOL_ITERATIONS ?? "3")
);

const TOOL_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.AI_TOOL_TIMEOUT_MS ?? process.env.AI_TIMEOUT_MS ?? "8000")
);

const TOOL_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.AI_TOOL_CACHE_TTL_MS ?? "3000")
);

const TOOL_RATE_LIMIT_PER_MIN = Math.max(
  1,
  Number(process.env.AI_TOOL_RATE_LIMIT_PER_MIN ?? "120")
);

type ToolName = "get_ohlcv" | "get_indicators" | "get_ticker" | "get_orderbook";

const timeframeSchema = z.enum(["5m", "15m", "1h", "4h", "1d"]);
const marketTypeSchema = z.enum(["spot", "perp"]).default("perp");

const ohlcvArgsSchema = z.object({
  symbol: z.string().trim().min(3).max(32),
  interval: timeframeSchema,
  limit: z.number().int().min(20).max(1000).default(200),
  marketType: marketTypeSchema
});

const indicatorsArgsSchema = z.object({
  symbol: z.string().trim().min(3).max(32),
  interval: timeframeSchema,
  lookback: z.number().int().min(20).max(1000).default(300),
  indicators: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  marketType: marketTypeSchema
});

const tickerArgsSchema = z.object({
  symbol: z.string().trim().min(3).max(32),
  marketType: marketTypeSchema
});

const orderbookArgsSchema = z.object({
  symbol: z.string().trim().min(3).max(32),
  limit: z.number().int().min(5).max(1000).default(50),
  marketType: marketTypeSchema
});

const toolCache = new Map<string, { expiresAt: number; value: unknown }>();
const toolRateWindow: number[] = [];

function nowMs() {
  return Date.now();
}

function pruneRateWindow(now: number) {
  const threshold = now - 60_000;
  while (toolRateWindow.length > 0 && toolRateWindow[0] < threshold) {
    toolRateWindow.shift();
  }
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(",")}}`;
}

function parseArgs(raw: string): unknown {
  const text = raw.trim();
  if (!text) return {};
  return JSON.parse(text);
}

export const AI_AGENT_TOOL_DEFINITIONS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_ohlcv",
      description: "Load OHLCV candles from Binance spot/perp.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] },
          limit: { type: "integer", minimum: 20, maximum: 1000 },
          marketType: { type: "string", enum: ["spot", "perp"] }
        },
        required: ["symbol", "interval"]
      },
      strict: true
    }
  },
  {
    type: "function",
    function: {
      name: "get_indicators",
      description: "Compute deterministic indicators from Binance OHLCV in backend.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] },
          lookback: { type: "integer", minimum: 20, maximum: 1000 },
          indicators: {
            type: "array",
            items: { type: "string" },
            maxItems: 40
          },
          marketType: { type: "string", enum: ["spot", "perp"] }
        },
        required: ["symbol", "interval"]
      },
      strict: true
    }
  },
  {
    type: "function",
    function: {
      name: "get_ticker",
      description: "Load current top-of-book ticker from Binance.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          marketType: { type: "string", enum: ["spot", "perp"] }
        },
        required: ["symbol"]
      },
      strict: true
    }
  },
  {
    type: "function",
    function: {
      name: "get_orderbook",
      description: "Load order book snapshot from Binance.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          limit: { type: "integer", minimum: 5, maximum: 1000 },
          marketType: { type: "string", enum: ["spot", "perp"] }
        },
        required: ["symbol"]
      },
      strict: true
    }
  }
];

async function executeToolInternal(name: ToolName, args: unknown): Promise<unknown> {
  if (name === "get_ohlcv") {
    const parsed = ohlcvArgsSchema.parse(args);
    return getBinanceOhlcv({
      symbol: parsed.symbol,
      interval: parsed.interval as Timeframe,
      limit: parsed.limit,
      marketType: parsed.marketType as BinanceMarketType,
      timeoutMs: TOOL_TIMEOUT_MS
    });
  }

  if (name === "get_indicators") {
    const parsed = indicatorsArgsSchema.parse(args);
    return getBinanceIndicators({
      symbol: parsed.symbol,
      interval: parsed.interval as Timeframe,
      lookback: parsed.lookback,
      indicators: parsed.indicators,
      marketType: parsed.marketType as BinanceMarketType,
      timeoutMs: TOOL_TIMEOUT_MS
    });
  }

  if (name === "get_ticker") {
    const parsed = tickerArgsSchema.parse(args);
    return getBinanceTicker({
      symbol: parsed.symbol,
      marketType: parsed.marketType as BinanceMarketType,
      timeoutMs: TOOL_TIMEOUT_MS
    });
  }

  if (name === "get_orderbook") {
    const parsed = orderbookArgsSchema.parse(args);
    return getBinanceOrderbook({
      symbol: parsed.symbol,
      limit: parsed.limit,
      marketType: parsed.marketType as BinanceMarketType,
      timeoutMs: TOOL_TIMEOUT_MS
    });
  }

  throw new Error(`ai_tool_not_allowed:${name}`);
}

export function isAllowedToolName(value: string): value is ToolName {
  return value === "get_ohlcv" || value === "get_indicators" || value === "get_ticker" || value === "get_orderbook";
}

export async function executeAiTool(name: string, argumentsText: string): Promise<unknown> {
  if (!isAllowedToolName(name)) {
    throw new Error(`ai_tool_not_allowed:${name}`);
  }

  const now = nowMs();
  pruneRateWindow(now);
  if (toolRateWindow.length >= TOOL_RATE_LIMIT_PER_MIN) {
    throw new Error(`ai_tool_rate_limited:${name}`);
  }

  const argsRaw = parseArgs(argumentsText);
  const cacheKey = `${name}:${stableStringify(argsRaw)}`;
  if (TOOL_CACHE_TTL_MS > 0) {
    const cached = toolCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
  }

  toolRateWindow.push(now);
  const startedAt = Date.now();
  const result = await executeToolInternal(name, argsRaw);

  if (TOOL_CACHE_TTL_MS > 0) {
    toolCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + TOOL_CACHE_TTL_MS
    });
  }

  logger.info("ai_agent_tool_ok", {
    tool_name: name,
    duration_ms: Date.now() - startedAt
  });

  return result;
}
