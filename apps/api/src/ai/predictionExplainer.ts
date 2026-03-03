import { z } from "zod";
import { logger } from "../logger.js";
import { analyzeWithAiGuards, hashStableObject } from "./analyzer.js";
import {
  runSignalAgent,
  mapDecisionToSignal,
  type AgentSignal,
  type AgentAnalysisMode,
  type AgentSignalProfile
} from "./agent.js";
import { callAi, getAiModelAsync, getAiProviderAsync } from "./provider.js";
import {
  filterFeatureSnapshotForAiPrompt,
  getAiPromptRuntimeSettings,
  type AiPromptScopeContext,
  type AiPromptRuntimeSettings
} from "./promptSettings.js";
import { recordAiTraceLog } from "./traceLog.js";
import {
  HISTORY_CONTEXT_HARD_CAP_BYTES,
  trimHistoryContextForAi,
  type HistoryContextPack
} from "./historyContext.js";
import {
  applyAiPayloadBudget,
  recordAiExplainerCacheTelemetry,
  recordAiPayloadBudgetTelemetry,
  type AiPayloadBudgetMetrics
} from "./payloadBudget.js";

export type ExplainerInput = {
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  tsCreated: string;
  prediction: {
    signal: "up" | "down" | "neutral";
    expectedMovePct: number;
    confidence: number;
  };
  featureSnapshot: Record<string, unknown>;
};

export type ExplainerOutput = {
  explanation: string;
  tags: string[];
  keyDrivers: { name: string; value: unknown }[];
  levels?: {
    entryPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
  };
  aiPrediction: {
    signal: "up" | "down" | "neutral";
    expectedMovePct: number;
    confidence: number;
  };
  disclaimer: "grounded_features_only";
};

export const EXPLAINER_TAG_ALLOWLIST = [
  "high_vol",
  "low_vol",
  "trend_up",
  "trend_down",
  "range_bound",
  "breakout_risk",
  "mean_reversion",
  "low_liquidity",
  "funding_risk",
  "news_risk",
  "data_gap"
] as const;

type ExplainerTag = (typeof EXPLAINER_TAG_ALLOWLIST)[number];

const allowlist = new Set<string>(EXPLAINER_TAG_ALLOWLIST);
const EXPLAINER_MAX_EXPLANATION_CHARS = 1000;

const baseOutputSchema = z.object({
  // Keep this loose and enforce final constraints in validateExplainerOutput.
  // Some model responses are valid enough except explanation length/emptiness.
  explanation: z.string().max(4000).optional(),
  tags: z.array(z.string()).max(5).optional(),
  keyDrivers: z.array(
    z.object({
      name: z.string().min(1).max(120),
      value: z.unknown()
    })
  ).max(5).optional(),
  aiPrediction: z
    .object({
      signal: z.enum(["up", "down", "neutral"]),
      expectedMovePct: z.number(),
      confidence: z.number()
    })
    .optional(),
  levels: z
    .object({
      entry_ref: z.number().optional(),
      entryRef: z.number().optional(),
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      stopLoss: z.number().optional(),
      stopLossPrice: z.number().optional(),
      sl: z.number().optional(),
      take_profit: z.number().optional(),
      takeProfit: z.number().optional(),
      takeProfitPrice: z.number().optional(),
      tp: z.number().optional()
    })
    .optional(),
  disclaimer: z.literal("grounded_features_only").optional()
});

type GenerateDeps = {
  callAiFn?: typeof callAi;
  promptSettings?: AiPromptRuntimeSettings;
  promptScopeContext?: AiPromptScopeContext;
  traceUserId?: string | null;
  requireSuccessfulAi?: boolean;
};

export type ExplainerPromptPreview = {
  aiProvider: "openai" | "ollama" | "disabled";
  scopeContext: AiPromptScopeContext;
  runtimeSettings: AiPromptRuntimeSettings;
  runtimeProfile: ExplainerRuntimeProfile;
  payloadProfile: ResolvedPayloadProfile["profile"];
  systemMessage: string;
  userPayload: Record<string, unknown>;
  payloadDroppedPaths: string[];
  payloadTraceMeta: PayloadTraceMeta;
  payloadBudgetMetrics: AiPayloadBudgetMetrics;
  promptInput: ExplainerInput;
  cacheKey: string;
};

type ExplainerAnalysisMode = AgentAnalysisMode;

type ExplanationQualityMetrics = {
  explanationLength: number;
  explanationSentenceCount: number;
  explanationParagraphCount: number;
  meetsLength: boolean;
  meetsSentenceCount: boolean;
  meetsParagraphs: boolean;
};

type ExplainerRuntimeProfile = {
  provider: "openai" | "ollama" | "disabled";
  timeframe: ExplainerInput["timeframe"];
  analysisMode: ExplainerAnalysisMode;
  enforceNeutralPrediction: boolean;
  explanationMinChars: number;
  explanationMinSentences: number;
  requiredParagraphs: number;
  paragraphFormatRequired: boolean;
  runtimeHints: string[];
  agentSignalProfile: AgentSignalProfile;
};

type PayloadProfileMode = "legacy" | "minimal_v1" | "minimal_v2";

type ResolvedPayloadProfile = {
  mode: PayloadProfileMode;
  profile:
    | "legacy"
    | "minimal_v1_trading_explainer"
    | "minimal_v1_market_analysis"
    | "minimal_v2_trading_explainer"
    | "minimal_v2_market_analysis";
  analysisMode: ExplainerAnalysisMode;
};

type PayloadCompactionProfile = "none" | "minimal_v2_trading" | "minimal_v2_analysis";

type PayloadBuildResult = {
  payload: Record<string, unknown>;
  droppedPaths: string[];
};

type PayloadTraceMeta = {
  payloadProfile: ResolvedPayloadProfile["profile"];
  payloadCompactionProfile: PayloadCompactionProfile;
  payloadTopLevelKeys: string[];
  payloadFeatureSnapshotKeys: string[];
  payloadDroppedPaths: string[];
  payloadCompactionDroppedPaths: string[];
  payloadBytes: number;
};

const SYSTEM_MESSAGE =
  "You are a trading assistant. You must only use the provided JSON featureSnapshot. " +
  "If a value is missing, say 'unknown' or omit it. Do not mention news unless featureSnapshot contains a 'newsRisk' flag. " +
  "You may reference indicators only when values exist under featureSnapshot.indicators (including stochrsi, volume, fvg) " +
  "or under featureSnapshot.advancedIndicators (emas, cloud, levels, ranges, sessions, pvsra, smartMoneyConcepts). " +
  "You may reference featureSnapshot.historyContext only when it is present. " +
  "Do not claim volume spikes or fair value gaps unless those fields explicitly support it. " +
  "Never mention TradingView.";

const MINIMAL_V1_FEATURE_DROP_COMMON = [
  "prefillExchange",
  "prefillExchangeAccountId",
  "autoScheduleEnabled",
  "autoSchedulePaused",
  "requestedLeverage",
  "positionSizeHint",
  "thresholdSource",
  "thresholdVersion",
  "thresholdWindowFrom",
  "thresholdWindowTo",
  "thresholdComputedAt",
  "thresholdBars"
] as const;

const MINIMAL_V1_FEATURE_DROP_MARKET_ANALYSIS = [
  "suggestedEntryPrice",
  "suggestedStopLoss",
  "suggestedTakeProfit",
  "qualitySampleSize",
  "qualityWinRatePct",
  "qualityAvgOutcomePnlPct"
] as const;

const MINIMAL_V1_TOP_LEVEL_DROP_COMMON = [
  "meta",
  "outputSchema",
  "groundingRules",
  "promptTimeframes",
  "promptRunTimeframe",
  "selectedIndicatorKeys",
  "tsCreated"
] as const;

const MINIMAL_V1_TOP_LEVEL_DROP_MARKET_ANALYSIS = [
  "prediction",
  "slTpSource"
] as const;

function readEnvNumber(
  value: string | undefined,
  fallback: number,
  min: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function normalizePayloadProfileMode(value: unknown): PayloadProfileMode {
  if (typeof value !== "string") return "legacy";
  const normalized = value.trim().toLowerCase();
  if (normalized === "minimal_v1") return "minimal_v1";
  if (normalized === "minimal_v2") return "minimal_v2";
  return "legacy";
}

const EXPLAINER_TIMEOUT_MS = readEnvNumber(
  process.env.AI_EXPLAINER_TIMEOUT_MS ?? process.env.AI_TIMEOUT_MS,
  15000,
  1000
);
const OLLAMA_EXPLAINER_TIMEOUT_MS = readEnvNumber(
  process.env.AI_OLLAMA_EXPLAINER_TIMEOUT_MS,
  90000,
  1000
);
const OLLAMA_MAX_PAYLOAD_BYTES = readEnvNumber(
  process.env.AI_OLLAMA_MAX_PAYLOAD_BYTES,
  8 * 1024,
  1024
);
const OLLAMA_MAX_HISTORY_BYTES = readEnvNumber(
  process.env.AI_OLLAMA_MAX_HISTORY_BYTES,
  3 * 1024,
  512
);
const OLLAMA_EXPLAINER_MAX_ATTEMPTS = Math.max(
  1,
  Math.trunc(readEnvNumber(process.env.AI_OLLAMA_EXPLAINER_MAX_ATTEMPTS, 1, 1))
);
const GPT5_EXPLAINER_MAX_ATTEMPTS = Math.max(
  2,
  Math.trunc(readEnvNumber(process.env.AI_GPT5_EXPLAINER_MAX_ATTEMPTS, 3, 2))
);
const OLLAMA_4H_MIN_EXPLANATION_CHARS = readEnvNumber(
  process.env.AI_OLLAMA_4H_MIN_EXPLANATION_CHARS,
  200,
  120
);
const OLLAMA_4H_MIN_EXPLANATION_SENTENCES = Math.max(
  2,
  Math.trunc(readEnvNumber(process.env.AI_OLLAMA_4H_MIN_EXPLANATION_SENTENCES, 8, 2))
);
const EXPLAINER_MAX_TOKENS = readEnvNumber(
  process.env.AI_EXPLAINER_MAX_TOKENS,
  650,
  300
);
const EXPLAINER_RETRY_MAX_TOKENS = readEnvNumber(
  process.env.AI_EXPLAINER_RETRY_MAX_TOKENS,
  Math.max(EXPLAINER_MAX_TOKENS + 350, Math.trunc(EXPLAINER_MAX_TOKENS * 1.5)),
  EXPLAINER_MAX_TOKENS
);
const GPT5_EXPLAINER_MAX_TOKENS = readEnvNumber(
  process.env.AI_GPT5_EXPLAINER_MAX_TOKENS,
  3200,
  EXPLAINER_MAX_TOKENS
);
const GPT5_EXPLAINER_RETRY_MAX_TOKENS = readEnvNumber(
  process.env.AI_GPT5_EXPLAINER_RETRY_MAX_TOKENS,
  Math.max(GPT5_EXPLAINER_MAX_TOKENS + 800, Math.trunc(GPT5_EXPLAINER_MAX_TOKENS * 1.5)),
  GPT5_EXPLAINER_MAX_TOKENS
);
const GPT5_EXPLAINER_FINAL_MAX_TOKENS = readEnvNumber(
  process.env.AI_GPT5_EXPLAINER_FINAL_MAX_TOKENS,
  Math.max(GPT5_EXPLAINER_RETRY_MAX_TOKENS, Math.trunc(GPT5_EXPLAINER_RETRY_MAX_TOKENS * 1.6)),
  GPT5_EXPLAINER_RETRY_MAX_TOKENS
);
const EXPLAINER_HISTORY_CONTEXT_MAX_EVENTS = normalizeHistoryContextMaxEvents(
  process.env.AI_EXPLAINER_HISTORY_CONTEXT_MAX_EVENTS
);
const EXPLAINER_HISTORY_CONTEXT_LAST_BARS = normalizeHistoryContextLastBars(
  process.env.AI_EXPLAINER_HISTORY_CONTEXT_LAST_BARS
);
const EXPLAINER_HISTORY_CONTEXT_MAX_BYTES = normalizeHistoryContextMaxBytes(
  process.env.AI_EXPLAINER_HISTORY_CONTEXT_MAX_BYTES
);
const EXPLAINER_CACHE_TTL_DEFAULT_SEC = readEnvNumber(
  process.env.AI_CACHE_TTL_SEC,
  300,
  60
);
const EXPLAINER_CACHE_TTL_5M_SEC = readEnvNumber(
  process.env.AI_EXPLAINER_CACHE_TTL_5M_SEC,
  600,
  60
);
const EXPLAINER_CACHE_TTL_15M_SEC = readEnvNumber(
  process.env.AI_EXPLAINER_CACHE_TTL_15M_SEC,
  EXPLAINER_CACHE_TTL_DEFAULT_SEC,
  60
);
const EXPLAINER_CACHE_TTL_1H_SEC = readEnvNumber(
  process.env.AI_EXPLAINER_CACHE_TTL_1H_SEC,
  7200,
  60
);
const EXPLAINER_CACHE_TTL_4H_SEC = readEnvNumber(
  process.env.AI_EXPLAINER_CACHE_TTL_4H_SEC,
  EXPLAINER_CACHE_TTL_DEFAULT_SEC,
  60
);
const EXPLAINER_CACHE_TTL_1D_SEC = readEnvNumber(
  process.env.AI_EXPLAINER_CACHE_TTL_1D_SEC,
  EXPLAINER_CACHE_TTL_DEFAULT_SEC,
  60
);

function withTraceMetaPayload(
  userPayload: Record<string, unknown>,
  input: {
    retryUsed: boolean;
    retryCount: number;
    totalTokens: number | null;
    analysisMode?: ExplainerAnalysisMode;
    neutralEnforced?: boolean;
    explanationLength?: number | null;
    explanationSentenceCount?: number | null;
    explanationParagraphCount?: number | null;
    paragraphFormatRequired?: boolean;
    requestedModel?: string | null;
    resolvedModel?: string | null;
    attemptedModels?: string[];
    fallbackReason?: string | null;
    payloadProfile?: PayloadTraceMeta["payloadProfile"] | null;
    payloadCompactionProfile?: PayloadTraceMeta["payloadCompactionProfile"] | null;
    payloadTopLevelKeys?: string[];
    payloadFeatureSnapshotKeys?: string[];
    payloadDroppedPaths?: string[];
    payloadCompactionDroppedPaths?: string[];
    payloadBytes?: number | null;
  }
): Record<string, unknown> {
  const normalizedTokens =
    Number.isFinite(Number(input.totalTokens)) && input.totalTokens !== null
      ? Math.max(0, Math.trunc(Number(input.totalTokens)))
      : null;
  const normalizedExplanationLength =
    Number.isFinite(Number(input.explanationLength)) && input.explanationLength !== null
      ? Math.max(0, Math.trunc(Number(input.explanationLength)))
      : null;
  const normalizedExplanationSentenceCount =
    Number.isFinite(Number(input.explanationSentenceCount)) && input.explanationSentenceCount !== null
      ? Math.max(0, Math.trunc(Number(input.explanationSentenceCount)))
      : null;
  const normalizedExplanationParagraphCount =
    Number.isFinite(Number(input.explanationParagraphCount)) && input.explanationParagraphCount !== null
      ? Math.max(0, Math.trunc(Number(input.explanationParagraphCount)))
      : null;
  const requestedModel =
    typeof input.requestedModel === "string" && input.requestedModel.trim()
      ? input.requestedModel.trim()
      : null;
  const resolvedModel =
    typeof input.resolvedModel === "string" && input.resolvedModel.trim()
      ? input.resolvedModel.trim()
      : null;
  const attemptedModels = Array.isArray(input.attemptedModels)
    ? input.attemptedModels
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
      .slice(0, 10)
    : [];
  const fallbackReason =
    typeof input.fallbackReason === "string" && input.fallbackReason.trim()
      ? input.fallbackReason.trim().slice(0, 1000)
      : null;
  const payloadProfile =
    input.payloadProfile === "legacy"
    || input.payloadProfile === "minimal_v1_trading_explainer"
    || input.payloadProfile === "minimal_v1_market_analysis"
    || input.payloadProfile === "minimal_v2_trading_explainer"
    || input.payloadProfile === "minimal_v2_market_analysis"
      ? input.payloadProfile
      : "legacy";
  const payloadCompactionProfile =
    input.payloadCompactionProfile === "minimal_v2_trading"
    || input.payloadCompactionProfile === "minimal_v2_analysis"
    || input.payloadCompactionProfile === "none"
      ? input.payloadCompactionProfile
      : "none";
  const payloadTopLevelKeys = Array.isArray(input.payloadTopLevelKeys)
    ? [...new Set(input.payloadTopLevelKeys
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0))]
      .slice(0, 50)
    : [];
  const payloadFeatureSnapshotKeys = Array.isArray(input.payloadFeatureSnapshotKeys)
    ? [...new Set(input.payloadFeatureSnapshotKeys
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0))]
      .slice(0, 100)
    : [];
  const payloadDroppedPaths = Array.isArray(input.payloadDroppedPaths)
    ? [...new Set(input.payloadDroppedPaths
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0))]
      .slice(0, 100)
    : [];
  const payloadCompactionDroppedPaths = Array.isArray(input.payloadCompactionDroppedPaths)
    ? [...new Set(input.payloadCompactionDroppedPaths
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0))]
      .slice(0, 100)
    : [];
  const payloadBytes =
    Number.isFinite(Number(input.payloadBytes)) && input.payloadBytes !== null
      ? Math.max(0, Math.trunc(Number(input.payloadBytes)))
      : null;
  return {
    ...userPayload,
    __trace: {
      retryUsed: input.retryUsed,
      retryCount: Math.max(0, Math.trunc(input.retryCount)),
      totalTokens: normalizedTokens,
      analysisMode: input.analysisMode ?? "trading_explainer",
      neutralEnforced: input.neutralEnforced === true,
      explanationLength: normalizedExplanationLength,
      explanationSentenceCount: normalizedExplanationSentenceCount,
      explanationParagraphCount: normalizedExplanationParagraphCount,
      paragraphFormatRequired: input.paragraphFormatRequired === true,
      requestedModel,
      resolvedModel,
      attemptedModels,
      fallbackReason,
      payloadProfile,
      payloadCompactionProfile,
      payloadTopLevelKeys,
      payloadFeatureSnapshotKeys,
      payloadDroppedPaths,
      payloadCompactionDroppedPaths,
      payloadBytes
    }
  };
}

function resolvePayloadProfile(analysisMode: ExplainerAnalysisMode): ResolvedPayloadProfile {
  const payloadProfileMode = normalizePayloadProfileMode(process.env.AI_PAYLOAD_PROFILE_MODE);
  if (payloadProfileMode === "legacy") {
    return {
      mode: "legacy",
      profile: "legacy",
      analysisMode
    };
  }
  if (payloadProfileMode === "minimal_v1") {
    return {
      mode: "minimal_v1",
      profile: analysisMode === "market_analysis"
        ? "minimal_v1_market_analysis"
        : "minimal_v1_trading_explainer",
      analysisMode
    };
  }
  return {
    mode: "minimal_v2",
    profile: analysisMode === "market_analysis"
      ? "minimal_v2_market_analysis"
      : "minimal_v2_trading_explainer",
    analysisMode
  };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function asUniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function unsetByPath(target: Record<string, unknown>, path: string): boolean {
  const segments = path.split(".").map((part) => part.trim()).filter((part) => part.length > 0);
  if (segments.length === 0) return false;
  let cursor: unknown = target;
  for (let idx = 0; idx < segments.length - 1; idx += 1) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return false;
    const record = cursor as Record<string, unknown>;
    const next = record[segments[idx]];
    if (!next || typeof next !== "object" || Array.isArray(next)) return false;
    cursor = next;
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return false;
  const record = cursor as Record<string, unknown>;
  const leaf = segments[segments.length - 1];
  if (!(leaf in record)) return false;
  delete record[leaf];
  return true;
}

function dropPathsFromObject(
  source: Record<string, unknown>,
  paths: readonly string[],
  prefix: string
): { next: Record<string, unknown>; dropped: string[] } {
  const next = cloneRecord(source);
  const dropped: string[] = [];
  for (const path of paths) {
    if (unsetByPath(next, path)) {
      dropped.push(`${prefix}.${path}`);
    }
  }
  return { next, dropped };
}

function listObjectKeys(value: unknown): string[] {
  const record = asObject(value);
  if (!record) return [];
  return Object.keys(record).sort((a, b) => a.localeCompare(b));
}

function buildPayloadPromptHints(payloadProfile: ResolvedPayloadProfile): string[] {
  if (payloadProfile.mode === "legacy") return [];
  return [
    "Return only one strict JSON object with fields: explanation, tags, keyDrivers, aiPrediction, optional levels, disclaimer.",
    "Do not output markdown, code fences, commentary, or any preface/suffix text.",
    "Grounding: reference only values present in featureSnapshot; do not infer missing values.",
    "Only reference stochrsi/volume/fvg when present and non-null.",
    "Only reference advancedIndicators fields when present and non-null.",
    "historyContext may be used only when present; do not invent history fields.",
    "Do not claim volume spikes unless rel_vol or vol_z supports it.",
    "Do not claim fair value gaps unless counts or distances support it.",
    "Levels are optional; include numeric entry_ref/stop_loss/take_profit only when explicitly supported."
  ];
}

function buildLegacyPromptPayload(
  input: ExplainerInput,
  settings: Pick<
    AiPromptRuntimeSettings,
    "promptText" | "indicatorKeys" | "ohlcvBars" | "timeframes" | "runTimeframe" | "slTpSource"
  >
): Record<string, unknown> {
  return {
    symbol: input.symbol,
    marketType: input.marketType,
    timeframe: input.timeframe,
    tsCreated: input.tsCreated,
    prediction: input.prediction,
    featureSnapshot: input.featureSnapshot,
    tagsAllowlist: EXPLAINER_TAG_ALLOWLIST,
    outputSchema: {
      explanation: "string <= 1000 chars",
      tags: "string[] <= 5 items, must be from tagsAllowlist",
      keyDrivers: "{name: string, value: any}[] <= 5 items, names from featureSnapshot key paths only",
      aiPrediction: "{signal: up|down|neutral, expectedMovePct: number, confidence: number 0..1}",
      levels: "{optional: {entry_ref?: number, stop_loss?: number, take_profit?: number}}",
      disclaimer: "grounded_features_only"
    },
    selectedIndicatorKeys: settings.indicatorKeys,
    ohlcvBars: settings.ohlcvBars,
    slTpSource: settings.slTpSource,
    promptTimeframes: settings.timeframes,
    promptRunTimeframe: settings.runTimeframe,
    groundingRules: [
      "Only reference values that exist in featureSnapshot",
      "Only reference stochrsi/volume/fvg when present and non-null",
      "Only reference advancedIndicators fields when present and non-null",
      "historyContext is derived and may be referenced only when present; do not invent missing history fields",
      "Do not claim volume spikes unless rel_vol or vol_z supports it",
      "Do not claim fair value gaps unless fvg counts or distances support it",
      "aiPrediction must be inferred from featureSnapshot and can differ from prediction",
      "levels are optional; include only numeric entry_ref/stop_loss/take_profit when explicitly supported by featureSnapshot"
    ]
  };
}

function buildTradingExplainerPayload(
  input: ExplainerInput,
  settings: Pick<AiPromptRuntimeSettings, "slTpSource">
): PayloadBuildResult {
  const slTpSource =
    typeof settings.slTpSource === "string" && settings.slTpSource.trim()
      ? settings.slTpSource
      : "local";
  const trimmedFeature = dropPathsFromObject(
    input.featureSnapshot,
    MINIMAL_V1_FEATURE_DROP_COMMON,
    "featureSnapshot"
  );
  return {
    payload: {
      symbol: input.symbol,
      marketType: input.marketType,
      timeframe: input.timeframe,
      prediction: input.prediction,
      featureSnapshot: trimmedFeature.next,
      tagsAllowlist: EXPLAINER_TAG_ALLOWLIST,
      slTpSource
    },
    droppedPaths: asUniqueSortedStrings([
      ...trimmedFeature.dropped,
      ...MINIMAL_V1_TOP_LEVEL_DROP_COMMON.map((row) => `payload.${row}`)
    ])
  };
}

function buildMarketAnalysisPayload(input: ExplainerInput): PayloadBuildResult {
  const trimmedCommon = dropPathsFromObject(
    input.featureSnapshot,
    MINIMAL_V1_FEATURE_DROP_COMMON,
    "featureSnapshot"
  );
  const trimmedFeature = dropPathsFromObject(
    trimmedCommon.next,
    MINIMAL_V1_FEATURE_DROP_MARKET_ANALYSIS,
    "featureSnapshot"
  );
  return {
    payload: {
      symbol: input.symbol,
      marketType: input.marketType,
      timeframe: input.timeframe,
      featureSnapshot: trimmedFeature.next,
      tagsAllowlist: EXPLAINER_TAG_ALLOWLIST
    },
    droppedPaths: asUniqueSortedStrings([
      ...trimmedCommon.dropped,
      ...trimmedFeature.dropped,
      ...MINIMAL_V1_TOP_LEVEL_DROP_COMMON.map((row) => `payload.${row}`),
      ...MINIMAL_V1_TOP_LEVEL_DROP_MARKET_ANALYSIS.map((row) => `payload.${row}`)
    ])
  };
}

function buildPromptPayload(
  input: ExplainerInput,
  settings: Pick<
    AiPromptRuntimeSettings,
    "promptText" | "indicatorKeys" | "ohlcvBars" | "timeframes" | "runTimeframe" | "slTpSource"
  >,
  payloadProfile: ResolvedPayloadProfile
): PayloadBuildResult {
  if (payloadProfile.mode === "legacy") {
    return {
      payload: buildLegacyPromptPayload(input, settings),
      droppedPaths: []
    };
  }
  if (payloadProfile.analysisMode === "market_analysis") {
    return buildMarketAnalysisPayload(input);
  }
  return buildTradingExplainerPayload(input, settings);
}

function buildSystemMessage(
  customPromptText: string,
  runtimeHints: string[] = [],
  payloadHints: string[] = []
): string {
  const trimmed = customPromptText.trim();
  const hintText = [...runtimeHints, ...payloadHints]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join("\n");
  const sections: string[] = [SYSTEM_MESSAGE];
  if (trimmed) {
    sections.push(`Operator instructions:\n${trimmed}`);
  }
  if (hintText) {
    sections.push(`Runtime output hints:\n${hintText}`);
  }
  return sections.join("\n\n");
}

function countSentences(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const punctuationSplit = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  if (punctuationSplit.length > 0) return punctuationSplit.length;

  const clauseSplit = trimmed
    .split(/[;\n]+/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  if (clauseSplit.length > 0) return clauseSplit.length;

  return trimmed
    .split(/\n+/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0).length;
}

function countParagraphs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/\n\s*\n+/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0).length;
}

function splitIntoSentences(value: string): string[] {
  return value
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
}

function formatIntoParagraphs(value: string, requiredParagraphs: number): string {
  const target = Math.max(1, Math.trunc(requiredParagraphs));
  if (target <= 1) return value.trim();
  const sentences = splitIntoSentences(value);
  if (sentences.length < target) return value.trim();
  const paragraphSize = Math.ceil(sentences.length / target);
  const paragraphs: string[] = [];
  for (let idx = 0; idx < sentences.length; idx += paragraphSize) {
    paragraphs.push(sentences.slice(idx, idx + paragraphSize).join(" ").trim());
  }
  if (paragraphs.length < target) return value.trim();
  return paragraphs.slice(0, target).join("\n\n").trim();
}

function shouldRelaxSentenceRequirement(
  profile: ExplainerRuntimeProfile,
  explanationLength: number,
  explanationSentenceCount: number
): boolean {
  if (profile.provider !== "ollama") return false;
  if (profile.timeframe !== "4h") return false;
  if (profile.explanationMinSentences < 3) return false;
  if (explanationSentenceCount !== profile.explanationMinSentences - 1) return false;
  return explanationLength >= 900;
}

function evaluateExplanationQuality(
  explanation: string,
  profile: ExplainerRuntimeProfile
): ExplanationQualityMetrics {
  const explanationLength = explanation.trim().length;
  const explanationSentenceCount = countSentences(explanation);
  const explanationParagraphCount = countParagraphs(explanation);
  const meetsSentenceCount =
    explanationSentenceCount >= profile.explanationMinSentences
    || shouldRelaxSentenceRequirement(profile, explanationLength, explanationSentenceCount);
  const meetsParagraphs =
    profile.requiredParagraphs <= 0
      ? true
      : explanationParagraphCount >= profile.requiredParagraphs;
  return {
    explanationLength,
    explanationSentenceCount,
    explanationParagraphCount,
    meetsLength: explanationLength >= profile.explanationMinChars,
    meetsSentenceCount,
    meetsParagraphs
  };
}

function buildProviderRuntimeHints(profile: ExplainerRuntimeProfile): string[] {
  const hints: string[] = [];
  if (profile.provider === "ollama") {
    hints.push("For local Ollama: return strict JSON only and avoid prefacing text.");
  }

  if (profile.timeframe === "4h" && profile.analysisMode === "market_analysis") {
    hints.push("Write explanation as 8-12 complete sentences in flowing prose.");
    hints.push(
      "Follow this order in explanation: trend, momentum, structure, liquidity/FVG, volume, volatility, uncertainty, conclusion."
    );
    hints.push("Do not use bullet points inside explanation.");
  }
  if (profile.paragraphFormatRequired && profile.requiredParagraphs > 0) {
    hints.push(
      `Format explanation as exactly ${profile.requiredParagraphs} paragraphs separated by one blank line.`
    );
    hints.push("Paragraph 1: trend and momentum.");
    hints.push("Paragraph 2: structure, liquidity/FVG and volume.");
    hints.push("Paragraph 3: risk, uncertainty and conclusion.");
    hints.push("No markdown headings, no bullet points.");
  }

  if (profile.enforceNeutralPrediction) {
    hints.push("Set aiPrediction.signal to neutral.");
    hints.push("Set aiPrediction.confidence to 0 and aiPrediction.expectedMovePct to 0.");
    hints.push("Do not include long/short trade recommendations.");
  }

  return hints;
}

function buildExplainerRuntimeProfile(input: {
  aiProvider: "openai" | "ollama" | "disabled";
  timeframe: ExplainerInput["timeframe"];
  runtimeSettings: AiPromptRuntimeSettings;
}): ExplainerRuntimeProfile {
  const isMarketAnalysis = input.runtimeSettings.marketAnalysisUpdateEnabled && input.timeframe === "4h";
  const analysisMode: ExplainerAnalysisMode = isMarketAnalysis
    ? "market_analysis"
    : "trading_explainer";
  const requiredParagraphs = isMarketAnalysis ? 3 : 0;
  const explanationMinChars =
    input.aiProvider === "ollama" && input.timeframe === "4h"
      ? OLLAMA_4H_MIN_EXPLANATION_CHARS
      : 0;
  const explanationMinSentences =
    input.aiProvider === "ollama" && input.timeframe === "4h"
      ? OLLAMA_4H_MIN_EXPLANATION_SENTENCES
      : 0;
  const profileBase: ExplainerRuntimeProfile = {
    provider: input.aiProvider,
    timeframe: input.timeframe,
    analysisMode,
    enforceNeutralPrediction: isMarketAnalysis,
    explanationMinChars,
    explanationMinSentences,
    requiredParagraphs,
    paragraphFormatRequired: requiredParagraphs > 0,
    runtimeHints: [],
    agentSignalProfile: {
      analysisMode,
      explanationRequired: true,
      explanationMinLength: Math.max(1, Math.min(900, explanationMinChars))
    }
  };
  const runtimeHints = buildProviderRuntimeHints(profileBase);
  return {
    ...profileBase,
    runtimeHints
  };
}

function appendQualityRepairInstruction(
  systemMessage: string,
  profile: ExplainerRuntimeProfile
): string {
  if (profile.explanationMinChars <= 0 && profile.explanationMinSentences <= 0) {
    return systemMessage;
  }
  const instructionLines = [
    "Quality correction:",
    "You already returned valid JSON. Keep all fields and values unchanged except `explanation`.",
    `Expand explanation to at least ${Math.max(1, profile.explanationMinSentences)} sentences and at least ${Math.max(1, profile.explanationMinChars)} characters.`,
    profile.requiredParagraphs > 0
      ? `Use exactly ${profile.requiredParagraphs} paragraphs separated by one blank line.`
      : "",
    "Use flowing prose and keep factual grounding unchanged."
  ].filter((line) => line.length > 0);
  return `${systemMessage}\n\n${instructionLines.join("\n")}`;
}

function tryLocalExplanationRepair(
  parsedCandidate: unknown,
  profile: ExplainerRuntimeProfile
): unknown | null {
  if (!parsedCandidate || typeof parsedCandidate !== "object" || Array.isArray(parsedCandidate)) {
    return null;
  }
  const record = { ...(parsedCandidate as Record<string, unknown>) };
  const explanationRaw =
    typeof record.explanation === "string" ? record.explanation.trim() : "";
  if (!explanationRaw) return null;

  let explanation = clampText(explanationRaw).trim();
  const qualityInitial = evaluateExplanationQuality(explanation, profile);

  if (
    profile.provider === "ollama"
    && profile.timeframe === "4h"
    && !qualityInitial.meetsSentenceCount
    && qualityInitial.explanationSentenceCount >= profile.explanationMinSentences - 1
    && qualityInitial.explanationLength < EXPLAINER_MAX_EXPLANATION_CHARS - 100
  ) {
    explanation = clampText(
      `${explanation} Uncertainty remains elevated and this view should stay conditional until structure confirms.`
    ).trim();
  }
  if (profile.requiredParagraphs > 0) {
    const paragraphCandidate = formatIntoParagraphs(explanation, profile.requiredParagraphs);
    if (countParagraphs(paragraphCandidate) >= profile.requiredParagraphs) {
      explanation = clampText(paragraphCandidate).trim();
    }
  }
  const qualityFinal = evaluateExplanationQuality(explanation, profile);
  if (!qualityFinal.meetsLength || !qualityFinal.meetsSentenceCount || !qualityFinal.meetsParagraphs) {
    return null;
  }

  return {
    ...record,
    explanation
  };
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeHistoryContextMaxEvents(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(5, Math.min(30, Math.trunc(parsed)));
}

function normalizeHistoryContextLastBars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(10, Math.min(30, Math.trunc(parsed)));
}

function normalizeHistoryContextMaxBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return HISTORY_CONTEXT_HARD_CAP_BYTES;
  return Math.max(1024, Math.min(HISTORY_CONTEXT_HARD_CAP_BYTES, Math.trunc(parsed)));
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function getByPath(snapshot: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return snapshot[path];
  let cursor: unknown = snapshot;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    const record = cursor as Record<string, unknown>;
    cursor = record[segment];
    if (cursor === undefined && segment === "advancedIndicators") {
      cursor = record.tradersReality;
    } else if (cursor === undefined && segment === "tradersReality") {
      cursor = record.advancedIndicators;
    }
  }
  return cursor;
}

function pickNumberByPaths(snapshot: Record<string, unknown>, paths: string[]): number | null {
  for (const path of paths) {
    const val = toNumber(getByPath(snapshot, path));
    if (val !== null) return val;
  }
  return null;
}

function pickBooleanByPaths(snapshot: Record<string, unknown>, paths: string[]): boolean | null {
  for (const path of paths) {
    const val = toBoolean(getByPath(snapshot, path));
    if (val !== null) return val;
  }
  return null;
}

function boundedConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function confidenceLabel(value: number): "low" | "medium" | "high" {
  if (value >= 0.67) return "high";
  if (value >= 0.4) return "medium";
  return "low";
}

function normalizeTags(tags: string[]): ExplainerTag[] {
  const deduped = new Set<ExplainerTag>();
  for (const tag of tags) {
    if (!allowlist.has(tag)) continue;
    deduped.add(tag as ExplainerTag);
    if (deduped.size >= 5) break;
  }
  return [...deduped];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeOhlcvBarsLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(20, Math.min(500, Math.trunc(parsed)));
}

function trimSingleOhlcvSeries(
  seriesRaw: unknown,
  maxBars: number
): { next: Record<string, unknown> | null; changed: boolean } {
  if (!seriesRaw || typeof seriesRaw !== "object" || Array.isArray(seriesRaw)) {
    return { next: null, changed: false };
  }
  const series = seriesRaw as Record<string, unknown>;
  const bars = Array.isArray(series.bars) ? series.bars : [];
  const limit = normalizeOhlcvBarsLimit(maxBars);
  if (bars.length <= limit) {
    if (Number(series.count) === bars.length) return { next: series, changed: false };
    return {
      next: {
        ...series,
        count: bars.length
      },
      changed: true
    };
  }
  const trimmedBars = bars.slice(-limit);
  return {
    next: {
      ...series,
      bars: trimmedBars,
      count: trimmedBars.length
    },
    changed: true
  };
}

function applyOhlcvBarsLimit(
  snapshot: Record<string, unknown>,
  maxBars: number
): Record<string, unknown> {
  const topTrim = trimSingleOhlcvSeries(snapshot.ohlcvSeries, maxBars);
  let nextSnapshot = topTrim.changed
    ? {
      ...snapshot,
      ohlcvSeries: topTrim.next
    }
    : snapshot;

  const mtfRaw = asObject(nextSnapshot.mtf);
  const framesRaw = asObject(mtfRaw?.frames);
  if (!mtfRaw || !framesRaw) return nextSnapshot;

  let framesChanged = false;
  const nextFrames: Record<string, unknown> = {};
  for (const [timeframe, frameRaw] of Object.entries(framesRaw)) {
    const frame = asObject(frameRaw);
    if (!frame) {
      nextFrames[timeframe] = frameRaw;
      continue;
    }
    const frameTrim = trimSingleOhlcvSeries(frame.ohlcvSeries, maxBars);
    if (frameTrim.changed) {
      framesChanged = true;
      nextFrames[timeframe] = {
        ...frame,
        ohlcvSeries: frameTrim.next
      };
    } else {
      nextFrames[timeframe] = frame;
    }
  }
  if (!framesChanged) return nextSnapshot;
  return {
    ...nextSnapshot,
    mtf: {
      ...mtfRaw,
      frames: nextFrames
    }
  };
}

function trimSingleHistoryContext(
  historyContextRaw: unknown,
  options?: {
    maxEvents?: number;
    lastBars?: number;
    maxBytes?: number;
  }
): { next: HistoryContextPack | null; changed: boolean } {
  const parsed = asObject(historyContextRaw);
  if (!parsed) return { next: null, changed: false };
  if (Number(parsed.v) !== 1) return { next: null, changed: false };
  const lastBars = asObject(parsed.lastBars);
  if (!lastBars || !Array.isArray(lastBars.ohlc)) return { next: null, changed: false };
  if (!Array.isArray(parsed.ev)) return { next: null, changed: false };
  const trimmed = trimHistoryContextForAi(parsed as unknown as HistoryContextPack, {
    maxEvents: options?.maxEvents ?? EXPLAINER_HISTORY_CONTEXT_MAX_EVENTS,
    lastBars: options?.lastBars ?? EXPLAINER_HISTORY_CONTEXT_LAST_BARS,
    maxBytes: options?.maxBytes ?? EXPLAINER_HISTORY_CONTEXT_MAX_BYTES
  });
  const changed = JSON.stringify(trimmed) !== JSON.stringify(parsed);
  return { next: trimmed, changed };
}

function applyHistoryContextLimit(
  snapshot: Record<string, unknown>,
  options?: {
    maxEvents?: number;
    lastBars?: number;
    maxBytes?: number;
  }
): Record<string, unknown> {
  const topTrim = trimSingleHistoryContext(snapshot.historyContext, options);
  let nextSnapshot = topTrim.changed
    ? {
      ...snapshot,
      historyContext: topTrim.next
    }
    : snapshot;

  const mtfRaw = asObject(nextSnapshot.mtf);
  const framesRaw = asObject(mtfRaw?.frames);
  if (!mtfRaw || !framesRaw) return nextSnapshot;

  let framesChanged = false;
  const nextFrames: Record<string, unknown> = {};
  for (const [timeframe, frameRaw] of Object.entries(framesRaw)) {
      const frame = asObject(frameRaw);
      if (!frame) {
        nextFrames[timeframe] = frameRaw;
        continue;
      }
    const frameTrim = trimSingleHistoryContext(frame.historyContext, options);
    if (frameTrim.changed) {
      framesChanged = true;
      nextFrames[timeframe] = {
        ...frame,
        historyContext: frameTrim.next
      };
    } else {
      nextFrames[timeframe] = frame;
    }
  }
  if (!framesChanged) return nextSnapshot;
  return {
    ...nextSnapshot,
    mtf: {
      ...mtfRaw,
      frames: nextFrames
    }
  };
}

function getArrayLengthAtPath(source: Record<string, unknown>, path: string): number | null {
  const segments = path.split(".").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  let cursor: unknown = source;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return Array.isArray(cursor) ? cursor.length : null;
}

function compactMtfToRunTimeframe(
  snapshot: Record<string, unknown>
): { snapshot: Record<string, unknown>; droppedPaths: string[] } {
  const mtfRaw = asObject(snapshot.mtf);
  const framesRaw = asObject(mtfRaw?.frames);
  if (!mtfRaw || !framesRaw) {
    return { snapshot, droppedPaths: [] };
  }
  const frameKeys = Object.keys(framesRaw);
  if (frameKeys.length <= 1) {
    return { snapshot, droppedPaths: [] };
  }
  const runTimeframeRaw = typeof mtfRaw.runTimeframe === "string" ? mtfRaw.runTimeframe.trim() : "";
  const runTimeframe = runTimeframeRaw && framesRaw[runTimeframeRaw]
    ? runTimeframeRaw
    : frameKeys[0];
  const runFrame = framesRaw[runTimeframe];
  if (!runFrame) {
    return { snapshot, droppedPaths: [] };
  }
  const droppedPaths = frameKeys
    .filter((key) => key !== runTimeframe)
    .map((key) => `payload.featureSnapshot.mtf.frames.${key}`);
  if (droppedPaths.length === 0) {
    return { snapshot, droppedPaths: [] };
  }
  return {
    snapshot: {
      ...snapshot,
      mtf: {
        ...mtfRaw,
        runTimeframe,
        timeframes: [runTimeframe],
        frames: {
          [runTimeframe]: runFrame
        }
      }
    },
    droppedPaths
  };
}

function compactFeatureSnapshotForAi(input: {
  snapshot: Record<string, unknown>;
  payloadProfile: ResolvedPayloadProfile;
}): {
  snapshot: Record<string, unknown>;
  compactionProfile: PayloadCompactionProfile;
  droppedPaths: string[];
} {
  if (input.payloadProfile.mode !== "minimal_v2") {
    return {
      snapshot: input.snapshot,
      compactionProfile: "none",
      droppedPaths: []
    };
  }
  const isMarketAnalysis = input.payloadProfile.analysisMode === "market_analysis";
  const compactionProfile: PayloadCompactionProfile = isMarketAnalysis
    ? "minimal_v2_analysis"
    : "minimal_v2_trading";
  const ohlcvBarsLimit = isMarketAnalysis ? 60 : 80;
  const historyEventsLimit = isMarketAnalysis ? 12 : 20;
  const historyLastBarsLimit = isMarketAnalysis ? 16 : 20;

  const before = cloneRecord(input.snapshot);
  let compacted = cloneRecord(input.snapshot);
  const droppedPaths: string[] = [];

  const mtfCompaction = compactMtfToRunTimeframe(compacted);
  compacted = mtfCompaction.snapshot;
  droppedPaths.push(...mtfCompaction.droppedPaths);

  compacted = applyOhlcvBarsLimit(compacted, ohlcvBarsLimit);
  compacted = applyHistoryContextLimit(compacted, {
    maxEvents: historyEventsLimit,
    lastBars: historyLastBarsLimit,
    maxBytes: EXPLAINER_HISTORY_CONTEXT_MAX_BYTES
  });

  const runTimeframe = (() => {
    const mtf = asObject(compacted.mtf);
    const run = typeof mtf?.runTimeframe === "string" ? mtf.runTimeframe.trim() : "";
    return run.length > 0 ? run : null;
  })();

  const trackedArrayPaths = [
    "ohlcvSeries.bars",
    "historyContext.ev",
    "historyContext.lastBars.ohlc"
  ];
  for (const path of trackedArrayPaths) {
    const beforeLen = getArrayLengthAtPath(before, path);
    const afterLen = getArrayLengthAtPath(compacted, path);
    if (beforeLen !== null && afterLen !== null && afterLen < beforeLen) {
      droppedPaths.push(`payload.featureSnapshot.${path}`);
    }
  }
  if (runTimeframe) {
    for (const path of ["ohlcvSeries.bars", "historyContext.ev", "historyContext.lastBars.ohlc"]) {
      const fullPath = `mtf.frames.${runTimeframe}.${path}`;
      const beforeLen = getArrayLengthAtPath(before, fullPath);
      const afterLen = getArrayLengthAtPath(compacted, fullPath);
      if (beforeLen !== null && afterLen !== null && afterLen < beforeLen) {
        droppedPaths.push(`payload.featureSnapshot.${fullPath}`);
      }
    }
  }

  return {
    snapshot: compacted,
    compactionProfile,
    droppedPaths: asUniqueSortedStrings(droppedPaths)
  };
}

function applyPayloadCompactionForAi(input: {
  payload: Record<string, unknown>;
  payloadProfile: ResolvedPayloadProfile;
}): {
  payload: Record<string, unknown>;
  compactionProfile: PayloadCompactionProfile;
  droppedPaths: string[];
} {
  if (input.payloadProfile.mode !== "minimal_v2") {
    return {
      payload: input.payload,
      compactionProfile: "none",
      droppedPaths: []
    };
  }
  const nextPayload = cloneRecord(input.payload);
  const featureSnapshot = asObject(nextPayload.featureSnapshot);
  if (!featureSnapshot) {
    return {
      payload: nextPayload,
      compactionProfile: input.payloadProfile.analysisMode === "market_analysis"
        ? "minimal_v2_analysis"
        : "minimal_v2_trading",
      droppedPaths: []
    };
  }
  const compacted = compactFeatureSnapshotForAi({
    snapshot: featureSnapshot,
    payloadProfile: input.payloadProfile
  });
  nextPayload.featureSnapshot = compacted.snapshot;
  return {
    payload: nextPayload,
    compactionProfile: compacted.compactionProfile,
    droppedPaths: compacted.droppedPaths
  };
}

function normalizeAiPrediction(
  value: unknown
): { signal: "up" | "down" | "neutral"; expectedMovePct: number; confidence: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const signal = record.signal;
  if (signal !== "up" && signal !== "down" && signal !== "neutral") return null;
  const confidenceRaw = toNumber(record.confidence);
  const expectedMoveRaw = toNumber(record.expectedMovePct);
  if (confidenceRaw === null || expectedMoveRaw === null) return null;
  const confidence = confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100;
  return {
    signal,
    confidence: Number(clamp(confidence, 0, 1).toFixed(4)),
    expectedMovePct: Number(clamp(Math.abs(expectedMoveRaw), 0, 25).toFixed(2))
  };
}

function normalizePrice(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function normalizeAiLevels(value: unknown): {
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
} | null {
  const record = asObject(value);
  if (!record) return null;
  const entryPrice = normalizePrice(
    record.entry_ref ?? record.entryRef ?? record.entry
  );
  const stopLossPrice = normalizePrice(
    record.stop_loss ?? record.stopLoss ?? record.stopLossPrice ?? record.sl
  );
  const takeProfitPrice = normalizePrice(
    record.take_profit ?? record.takeProfit ?? record.takeProfitPrice ?? record.tp
  );
  if (entryPrice === null && stopLossPrice === null && takeProfitPrice === null) {
    return null;
  }
  return {
    entryPrice,
    stopLossPrice,
    takeProfitPrice
  };
}

function deriveFallbackAiPrediction(input: {
  featureSnapshot: Record<string, unknown>;
  baselinePrediction?: ExplainerInput["prediction"];
}): { signal: "up" | "down" | "neutral"; expectedMovePct: number; confidence: number } {
  const snapshot = input.featureSnapshot ?? {};
  const trend = pickNumberByPaths(snapshot, [
    "emaSpread",
    "trendScore",
    "trend",
    "indicators.macd.hist",
    "advancedIndicators.emas.emaDistancesPct.spread_13_50_pct"
  ]);
  const momentum = pickNumberByPaths(snapshot, ["momentum", "indicators.vwap.dist_pct"]);
  const rsi = pickNumberByPaths(snapshot, ["rsi", "indicators.rsi_14"]);
  const stochK = pickNumberByPaths(snapshot, ["indicators.stochrsi.k", "indicators.stochrsi.value"]);
  const bbPos = pickNumberByPaths(snapshot, ["indicators.bb.pos"]);
  const atrPct = pickNumberByPaths(snapshot, ["indicators.atr_pct", "atrPct"]);
  const baselineExpectedMove = toNumber(input.baselinePrediction?.expectedMovePct);

  let score = 0;
  if (trend !== null) {
    if (trend > 0.0006) score += 0.9;
    else if (trend < -0.0006) score -= 0.9;
  }
  if (momentum !== null) {
    if (momentum > 0.0006) score += 0.7;
    else if (momentum < -0.0006) score -= 0.7;
  }
  if (rsi !== null) {
    if (rsi >= 70) score -= 0.55;
    else if (rsi <= 30) score += 0.55;
  }
  if (stochK !== null) {
    if (stochK >= 80) score -= 0.35;
    else if (stochK <= 20) score += 0.35;
  }
  if (bbPos !== null) {
    if (bbPos >= 0.9) score -= 0.25;
    else if (bbPos <= 0.1) score += 0.25;
  }

  const signal: "up" | "down" | "neutral" =
    score > 0.65 ? "up" : score < -0.65 ? "down" : "neutral";
  const confidence = Number(clamp(0.35 + Math.min(1.5, Math.abs(score)) * 0.28, 0.2, 0.85).toFixed(4));
  const expectedMovePct = Number(
    clamp(
      atrPct !== null ? atrPct * 140 : baselineExpectedMove ?? 0.8,
      0.1,
      6
    ).toFixed(2)
  );
  return {
    signal,
    confidence,
    expectedMovePct
  };
}

function stripCodeFenceJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
}

function extractFirstJsonObject(raw: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (start >= 0) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return raw.slice(start, i + 1);
        }
      }
      continue;
    }

    if (ch === "{") {
      start = i;
      depth = 1;
      inString = false;
      escaped = false;
    }
  }
  return null;
}

function normalizeJsonCandidate(raw: string): string {
  return raw
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function countUnclosedBrackets(raw: string): { curlies: number; squares: number } {
  let curlies = 0;
  let squares = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") curlies += 1;
    else if (ch === "}" && curlies > 0) curlies -= 1;
    else if (ch === "[") squares += 1;
    else if (ch === "]" && squares > 0) squares -= 1;
  }

  return { curlies, squares };
}

function appendMissingClosers(raw: string): string {
  const unclosed = countUnclosedBrackets(raw);
  if (unclosed.curlies <= 0 && unclosed.squares <= 0) return raw;
  return `${raw}${"]".repeat(Math.max(0, unclosed.squares))}${"}".repeat(Math.max(0, unclosed.curlies))}`;
}

function parseAiResponseJson(raw: string): unknown {
  const stripped = stripCodeFenceJson(raw);
  const extracted = extractFirstJsonObject(stripped);
  const candidates = [
    stripped,
    extracted,
    normalizeJsonCandidate(stripped),
    extracted ? normalizeJsonCandidate(extracted) : null
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const uniqueCandidates = [...new Set(candidates)];

  let lastError: unknown = null;
  for (const candidate of uniqueCandidates) {
    const variants = [candidate, appendMissingClosers(candidate)];
    for (const variant of variants) {
      try {
        return JSON.parse(variant);
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw (lastError instanceof Error ? lastError : new SyntaxError("invalid_json"));
}

function collectFeaturePaths(
  value: unknown,
  prefix = "",
  out: Set<string> = new Set<string>(),
  depth = 0
): Set<string> {
  if (depth > 5) return out;
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const [key, next] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (path.startsWith("advancedIndicators")) {
      out.add(path.replace("advancedIndicators", "tradersReality"));
    } else if (path.startsWith("tradersReality")) {
      out.add(path.replace("tradersReality", "advancedIndicators"));
    }
    if (next && typeof next === "object" && !Array.isArray(next)) {
      collectFeaturePaths(next, path, out, depth + 1);
    }
  }
  return out;
}

function normalizeKeyDriverPath(path: string): string {
  let normalized = path.trim();
  if (!normalized) return normalized;
  if (normalized.startsWith("featureSnapshot.")) {
    normalized = normalized.slice("featureSnapshot.".length);
  } else if (normalized.startsWith("$.featureSnapshot.")) {
    normalized = normalized.slice("$.featureSnapshot.".length);
  } else if (normalized.startsWith("$.") && !normalized.startsWith("$.featureSnapshot.")) {
    normalized = normalized.slice(2);
  }

  // Accept JSONPath-like bracket notation from model output:
  // mtf.frames["1h"].advanced... -> mtf.frames.1h.advanced...
  normalized = normalized.replace(/\[(?:"([^"]+)"|'([^']+)'|([^\]]+))\]/g, (_m, g1, g2, g3) => {
    const segment = String(g1 ?? g2 ?? g3 ?? "").trim();
    return segment ? `.${segment}` : "";
  });

  // Normalize accidental duplicate separators after replacements.
  normalized = normalized.replace(/\.{2,}/g, ".").replace(/^\./, "");
  return normalized;
}

export function validateExplainerOutput(
  rawValue: unknown,
  featureSnapshot: Record<string, unknown>,
  baselinePrediction?: ExplainerInput["prediction"],
  options: {
    runtimeProfile?: ExplainerRuntimeProfile;
  } = {}
): ExplainerOutput {
  const parsed = baseOutputSchema.safeParse(rawValue);
  if (!parsed.success) {
    throw new Error(`schema_validation_failed:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`);
  }

  const inputDrivers = Array.isArray(parsed.data.keyDrivers) ? parsed.data.keyDrivers : [];
  const normalizedDrivers = inputDrivers.map((driver) => ({
    ...driver,
    name: normalizeKeyDriverPath(driver.name)
  }));
  const keySet = collectFeaturePaths(featureSnapshot);
  const validDrivers = normalizedDrivers.filter((driver) => keySet.has(driver.name));
  const invalidDrivers = normalizedDrivers.filter((driver) => !keySet.has(driver.name));
  if (invalidDrivers.length > 0) {
    logger.warn("ai_key_drivers_filtered", {
      reason: "outside_snapshot",
      invalid_count: invalidDrivers.length,
      invalid_paths: invalidDrivers.slice(0, 5).map((driver) => driver.name)
    });
  }

  const tags = normalizeTags(Array.isArray(parsed.data.tags) ? parsed.data.tags : []);
  const aiPrediction =
    normalizeAiPrediction(parsed.data.aiPrediction) ??
    deriveFallbackAiPrediction({
      featureSnapshot,
      baselinePrediction
    });
  const explanationRaw =
    typeof parsed.data.explanation === "string" ? parsed.data.explanation.trim() : "";
  const explanation =
    explanationRaw.length > 0
      ? explanationRaw.slice(0, EXPLAINER_MAX_EXPLANATION_CHARS)
      : clampText(
          `Signal ${aiPrediction.signal} with ${(aiPrediction.confidence * 100).toFixed(1)}% confidence ` +
          `and expected move ${aiPrediction.expectedMovePct.toFixed(2)}% based on provided features.`
        );
  const levels = normalizeAiLevels(parsed.data.levels);
  const output: ExplainerOutput = {
    explanation,
    tags,
    keyDrivers: validDrivers.slice(0, 5).map((driver) => ({
      name: driver.name,
      value: driver.value
    })),
    ...(levels ? { levels } : {}),
    aiPrediction,
    disclaimer: "grounded_features_only"
  };

  if (options.runtimeProfile) {
    const quality = evaluateExplanationQuality(output.explanation, options.runtimeProfile);
    if (!quality.meetsLength || !quality.meetsSentenceCount || !quality.meetsParagraphs) {
      throw new Error(
        `explanation_quality_failed:length=${quality.explanationLength},sentences=${quality.explanationSentenceCount},` +
        `paragraphs=${quality.explanationParagraphCount},required_chars=${options.runtimeProfile.explanationMinChars},` +
        `required_sentences=${options.runtimeProfile.explanationMinSentences},required_paragraphs=${options.runtimeProfile.requiredParagraphs}`
      );
    }
  }

  return output;
}

function applyAnalysisModePolicy(
  output: ExplainerOutput,
  runtimeProfile: ExplainerRuntimeProfile
): { output: ExplainerOutput; neutralEnforced: boolean } {
  if (!runtimeProfile.enforceNeutralPrediction) {
    return { output, neutralEnforced: false };
  }
  if (
    output.aiPrediction.signal === "neutral"
    && output.aiPrediction.confidence === 0
    && output.aiPrediction.expectedMovePct === 0
  ) {
    return { output, neutralEnforced: false };
  }
  return {
    output: {
      ...output,
      aiPrediction: {
        signal: "neutral",
        confidence: 0,
        expectedMovePct: 0
      }
    },
    neutralEnforced: true
  };
}

function clampText(value: string): string {
  if (value.length <= EXPLAINER_MAX_EXPLANATION_CHARS) return value;
  return value.slice(0, EXPLAINER_MAX_EXPLANATION_CHARS - 1).trimEnd() + ".";
}

export function fallbackExplain(input: ExplainerInput): ExplainerOutput {
  const snapshot = input.featureSnapshot ?? {};
  const tags: ExplainerTag[] = [];

  const vol = pickNumberByPaths(snapshot, [
    "volatility",
    "vol",
    "atrPct",
    "realizedVol",
    "volatilityPct",
    "indicators.atr_pct",
    "indicators.bb.width_pct"
  ]);
  const trend = pickNumberByPaths(snapshot, [
    "emaSpread",
    "trendScore",
    "trend",
    "ema_slope",
    "indicators.macd.hist",
    "indicators.vwap.dist_pct",
    "advancedIndicators.emas.emaDistancesPct.spread_13_50_pct",
    "advancedIndicators.emas.emaDistancesPct.spread_50_200_pct"
  ]);
  const adx = pickNumberByPaths(snapshot, ["adx", "trendStrength", "indicators.adx.adx_14"]);
  const breakoutProb = pickNumberByPaths(snapshot, ["breakoutProb", "breakoutRisk", "breakout_score"]);
  const meanReversionScore = pickNumberByPaths(snapshot, ["meanReversionScore", "mrScore", "mean_reversion_score"]);
  const rsi = pickNumberByPaths(snapshot, ["rsi", "indicators.rsi_14"]);
  const stochRsiK = pickNumberByPaths(snapshot, ["indicators.stochrsi.k", "indicators.stochrsi.value"]);
  const stochRsiD = pickNumberByPaths(snapshot, ["indicators.stochrsi.d"]);
  const bbPos = pickNumberByPaths(snapshot, ["indicators.bb.pos"]);
  const spreadBps = pickNumberByPaths(snapshot, ["spreadBps", "bookSpreadBps"]);
  const liquidity = pickNumberByPaths(snapshot, ["liquidityScore", "depthScore"]);
  const volZ = pickNumberByPaths(snapshot, ["indicators.volume.vol_z"]);
  const relVol = pickNumberByPaths(snapshot, ["indicators.volume.rel_vol"]);
  const volTrend = pickNumberByPaths(snapshot, ["indicators.volume.vol_trend"]);
  const trPvsraTier = getByPath(snapshot, "advancedIndicators.pvsra.vectorTier");
  const trCloudPos = pickNumberByPaths(snapshot, ["advancedIndicators.cloud.price_pos"]);
  const smcSwingEvent = getByPath(snapshot, "advancedIndicators.smartMoneyConcepts.swing.lastEvent.type");
  const smcSwingDirection = getByPath(
    snapshot,
    "advancedIndicators.smartMoneyConcepts.swing.lastEvent.direction"
  );
  const smcInternalBullBreaks = pickNumberByPaths(snapshot, [
    "advancedIndicators.smartMoneyConcepts.internal.bullishBreaks"
  ]);
  const smcInternalBearBreaks = pickNumberByPaths(snapshot, [
    "advancedIndicators.smartMoneyConcepts.internal.bearishBreaks"
  ]);
  const openBullishGaps = pickNumberByPaths(snapshot, ["indicators.fvg.open_bullish_count"]);
  const openBearishGaps = pickNumberByPaths(snapshot, ["indicators.fvg.open_bearish_count"]);
  const nearestBullGapDist = pickNumberByPaths(snapshot, ["indicators.fvg.nearest_bullish_gap.dist_pct"]);
  const nearestBearGapDist = pickNumberByPaths(snapshot, ["indicators.fvg.nearest_bearish_gap.dist_pct"]);
  const funding = pickNumberByPaths(snapshot, ["fundingRate", "fundingRatePct", "funding"]);
  const newsRisk = pickBooleanByPaths(snapshot, ["newsRisk", "news_risk"]);

  if (vol !== null) {
    if (vol >= 0.03) tags.push("high_vol");
    if (vol <= 0.008) tags.push("low_vol");
  } else {
    tags.push("data_gap");
  }

  if (trend !== null) {
    if (trend > 0) tags.push("trend_up");
    if (trend < 0) tags.push("trend_down");
    if (Math.abs(trend) < 0.0008 && (adx === null || adx < 20)) tags.push("range_bound");
  } else if (adx !== null && adx < 18) {
    tags.push("range_bound");
  }

  if (breakoutProb !== null && breakoutProb >= 0.6) tags.push("breakout_risk");
  if (meanReversionScore !== null && meanReversionScore >= 0.6) tags.push("mean_reversion");
  if (rsi !== null && (rsi >= 70 || rsi <= 30)) tags.push("mean_reversion");
  if (stochRsiK !== null && (stochRsiK >= 80 || stochRsiK <= 20)) tags.push("mean_reversion");
  if (
    (openBullishGaps !== null && openBullishGaps > 0 && nearestBullGapDist !== null && Math.abs(nearestBullGapDist) <= 0.35) ||
    (openBearishGaps !== null && openBearishGaps > 0 && nearestBearGapDist !== null && Math.abs(nearestBearGapDist) <= 0.35) ||
    (volZ !== null && volZ >= 1.8) ||
    (relVol !== null && relVol >= 1.8)
  ) {
    tags.push("breakout_risk");
  }
  if (volTrend !== null && Math.abs(volTrend) < 0.2 && stochRsiD !== null && stochRsiK !== null) {
    tags.push("range_bound");
  }
  if (trCloudPos !== null && (trCloudPos <= 0.1 || trCloudPos >= 0.9)) {
    tags.push("mean_reversion");
  }
  if (trPvsraTier === "extreme") {
    tags.push("breakout_risk");
  }
  if (smcSwingEvent === "bos" || smcSwingEvent === "choch") {
    tags.push("breakout_risk");
    if (smcSwingDirection === "bullish") tags.push("trend_up");
    if (smcSwingDirection === "bearish") tags.push("trend_down");
  }
  if (
    smcInternalBullBreaks !== null &&
    smcInternalBearBreaks !== null &&
    smcInternalBullBreaks > smcInternalBearBreaks
  ) {
    tags.push("trend_up");
  }
  if (
    smcInternalBearBreaks !== null &&
    smcInternalBullBreaks !== null &&
    smcInternalBearBreaks > smcInternalBullBreaks
  ) {
    tags.push("trend_down");
  }
  if (bbPos !== null && (bbPos >= 0.9 || bbPos <= 0.1)) tags.push("mean_reversion");
  if ((spreadBps !== null && spreadBps >= 25) || (liquidity !== null && liquidity <= 0.35)) {
    tags.push("low_liquidity");
  }
  if (funding !== null && Math.abs(funding) >= 0.0005) tags.push("funding_risk");
  if (newsRisk === true) tags.push("news_risk");

  const signalText = input.prediction.signal;
  const confidenceText = confidenceLabel(boundedConfidence(input.prediction.confidence));
  const expectedMovePct = Number.isFinite(input.prediction.expectedMovePct)
    ? input.prediction.expectedMovePct.toFixed(2)
    : "unknown";

  const trendText =
    trend === null
      ? "trend information is incomplete"
      : trend > 0
        ? "trend indicators are positive"
        : trend < 0
          ? "trend indicators are negative"
          : "trend is mixed";

  const volText =
    vol === null
      ? "volatility is unknown"
      : vol >= 0.03
        ? "volatility is elevated"
        : vol <= 0.008
          ? "volatility is muted"
          : "volatility is moderate";

  const explanation = clampText(
    `Signal ${signalText} with ${confidenceText} confidence and expected move ${expectedMovePct}% ` +
    `based on provided features; ${trendText} and ${volText}.`
  );

  const preferredDrivers = [
    "indicators.rsi_14",
    "indicators.macd.hist",
    "indicators.bb.width_pct",
    "indicators.bb.pos",
    "indicators.stochrsi.k",
    "indicators.stochrsi.d",
    "indicators.volume.rel_vol",
    "indicators.volume.vol_z",
    "indicators.volume.vol_trend",
    "indicators.fvg.open_bullish_count",
    "indicators.fvg.open_bearish_count",
    "indicators.fvg.nearest_bullish_gap.dist_pct",
    "indicators.fvg.nearest_bearish_gap.dist_pct",
    "indicators.vwap.dist_pct",
    "indicators.adx.adx_14",
    "advancedIndicators.emas.ema_50",
    "advancedIndicators.emas.ema_200",
    "advancedIndicators.emas.ema_800",
    "advancedIndicators.emas.emaDistancesPct.spread_13_50_pct",
    "advancedIndicators.cloud.price_pos",
    "advancedIndicators.ranges.distancesPct.dist_to_adrHigh_pct",
    "advancedIndicators.ranges.distancesPct.dist_to_adrLow_pct",
    "advancedIndicators.pvsra.vectorTier",
    "advancedIndicators.pvsra.vectorColor",
    "advancedIndicators.smartMoneyConcepts.internal.lastEvent.type",
    "advancedIndicators.smartMoneyConcepts.internal.lastEvent.direction",
    "advancedIndicators.smartMoneyConcepts.swing.lastEvent.type",
    "advancedIndicators.smartMoneyConcepts.swing.lastEvent.direction",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.internal.bullishCount",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.internal.bearishCount",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.swing.bullishCount",
    "advancedIndicators.smartMoneyConcepts.orderBlocks.swing.bearishCount",
    "advancedIndicators.smartMoneyConcepts.fairValueGaps.bullishCount",
    "advancedIndicators.smartMoneyConcepts.fairValueGaps.bearishCount",
    "emaSpread",
    "atrPct",
    "volatility",
    "fundingRate",
    "spreadBps",
    "liquidityScore"
  ];

  const keyDrivers: { name: string; value: unknown }[] = [];
  for (const path of preferredDrivers) {
    const value = getByPath(snapshot, path);
    if (value === undefined) continue;
    keyDrivers.push({ name: path, value });
    if (keyDrivers.length >= 3) break;
  }

  if (keyDrivers.length === 0) {
    const fallbackKeys = Object.keys(snapshot).sort().slice(0, 3);
    for (const key of fallbackKeys) {
      keyDrivers.push({ name: key, value: snapshot[key] });
    }
  }

  return {
    explanation,
    tags: normalizeTags(tags),
    keyDrivers,
    aiPrediction: deriveFallbackAiPrediction({
      featureSnapshot: snapshot,
      baselinePrediction: input.prediction
    }),
    disclaimer: "grounded_features_only"
  };
}

function normalizeConfidenceBucket(value: number): number {
  const normalized = boundedConfidence(value) * 100;
  return Math.max(0, Math.min(100, Math.floor(normalized / 10) * 10));
}

function resolveExplainerCacheTtlSec(timeframe: ExplainerInput["timeframe"]): number {
  if (timeframe === "5m") return EXPLAINER_CACHE_TTL_5M_SEC;
  if (timeframe === "15m") return EXPLAINER_CACHE_TTL_15M_SEC;
  if (timeframe === "1h") return EXPLAINER_CACHE_TTL_1H_SEC;
  if (timeframe === "4h") return EXPLAINER_CACHE_TTL_4H_SEC;
  if (timeframe === "1d") return EXPLAINER_CACHE_TTL_1D_SEC;
  return EXPLAINER_CACHE_TTL_DEFAULT_SEC;
}

function buildPromptVersion(
  settings: AiPromptRuntimeSettings,
  runtimeProfile: ExplainerRuntimeProfile
): string {
  const revision = hashStableObject({
    promptText: settings.promptText,
    indicatorKeys: settings.indicatorKeys,
    ohlcvBars: settings.ohlcvBars,
    timeframes: settings.timeframes,
    runTimeframe: settings.runTimeframe,
    timeframe: settings.timeframe,
    directionPreference: settings.directionPreference,
    confidenceTargetPct: settings.confidenceTargetPct,
    marketAnalysisUpdateEnabled: settings.marketAnalysisUpdateEnabled,
    activePromptId: settings.activePromptId,
    activePromptName: settings.activePromptName,
    selectedFrom: settings.selectedFrom,
    matchedScopeType: settings.matchedScopeType,
    matchedOverrideId: settings.matchedOverrideId,
    runtimeProfile: {
      provider: runtimeProfile.provider,
      timeframe: runtimeProfile.timeframe,
      analysisMode: runtimeProfile.analysisMode,
      enforceNeutralPrediction: runtimeProfile.enforceNeutralPrediction,
      explanationMinChars: runtimeProfile.explanationMinChars,
      explanationMinSentences: runtimeProfile.explanationMinSentences,
      runtimeHints: runtimeProfile.runtimeHints
    }
  }).slice(0, 16);
  const promptId = settings.activePromptId ?? "default";
  return `${promptId}:${revision}`;
}

function buildHistoryContextHash(snapshot: Record<string, unknown>): string {
  const historyRaw = asObject(snapshot.historyContext);
  if (!historyRaw) return "none";
  const copy = JSON.parse(JSON.stringify(historyRaw)) as Record<string, unknown>;
  const bud = asObject(copy.bud);
  if (bud) {
    bud.bytes = 0;
  }
  return hashStableObject(copy);
}

function buildFeatureSnapshotHash(snapshot: Record<string, unknown>): string {
  const copy = { ...snapshot };
  delete (copy as Record<string, unknown>).historyContext;
  return hashStableObject(copy);
}

export function buildPredictionExplainerCacheKey(params: {
  model: string;
  promptVersion: string;
  symbol: string;
  timeframe: string;
  analysisMode: ExplainerAnalysisMode;
  signal?: "up" | "down" | "neutral";
  confidence?: number;
  featureSnapshotHash: string;
  historyContextHash: string;
}): string {
  const signal = params.analysisMode === "trading_explainer"
    ? (params.signal ?? "neutral")
    : "analysis";
  const confidenceBucket = params.analysisMode === "trading_explainer"
    ? normalizeConfidenceBucket(params.confidence ?? 0)
    : 0;
  return [
    "explain",
    params.model,
    params.promptVersion,
    params.analysisMode,
    params.symbol,
    params.timeframe,
    signal,
    String(confidenceBucket),
    params.featureSnapshotHash,
    params.historyContextHash
  ].join(":");
}

function normalizeContextString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isGpt5Model(model: string): boolean {
  return model.startsWith("gpt-5");
}

function resolveExplainerTokenBudget(model: string): {
  maxTokens: number;
  retryMaxTokens: number;
} {
  if (isGpt5Model(model)) {
    return {
      maxTokens: GPT5_EXPLAINER_MAX_TOKENS,
      retryMaxTokens: GPT5_EXPLAINER_RETRY_MAX_TOKENS
    };
  }
  return {
    maxTokens: EXPLAINER_MAX_TOKENS,
    retryMaxTokens: EXPLAINER_RETRY_MAX_TOKENS
  };
}

function resolveExplainerMaxAttemptsPerModel(
  provider: "openai" | "ollama" | "disabled",
  model: string
): number {
  if (provider === "ollama") return OLLAMA_EXPLAINER_MAX_ATTEMPTS;
  if (isGpt5Model(model)) return GPT5_EXPLAINER_MAX_ATTEMPTS;
  return 2;
}

function resolveExplainerAttemptMaxTokens(model: string, attempt: number): number {
  const tokenBudget = resolveExplainerTokenBudget(model);
  if (!isGpt5Model(model)) {
    return attempt === 1 ? tokenBudget.maxTokens : tokenBudget.retryMaxTokens;
  }
  if (attempt <= 1) return tokenBudget.maxTokens;
  if (attempt === 2) return tokenBudget.retryMaxTokens;
  return GPT5_EXPLAINER_FINAL_MAX_TOKENS;
}

function resolveExplainerFallbackModel(primaryModel: string): string | null {
  if (!isGpt5Model(primaryModel)) return null;
  const fallback = (process.env.AI_FALLBACK_MODEL ?? "gpt-4o-mini").trim();
  if (!fallback || fallback === primaryModel) return null;
  return fallback;
}

function useAgentSignalEngine(aiProvider: "openai" | "ollama" | "disabled"): boolean {
  if (aiProvider === "ollama") {
    const ollamaMode = (process.env.AI_SIGNAL_ENGINE_OLLAMA ?? "").trim().toLowerCase();
    return ollamaMode !== "legacy";
  }
  const mode = (process.env.AI_SIGNAL_ENGINE ?? "").trim().toLowerCase();
  if (mode === "agent_v1") return true;
  if (mode === "legacy") return false;
  return false;
}

function normalizeAgentSignalToExplainerRaw(
  signal: AgentSignal,
  baselinePrediction: ExplainerInput["prediction"]
): Record<string, unknown> {
  const mappedSignal = mapDecisionToSignal(signal.decision);
  return {
    explanation: (signal.explanation ?? signal.reason ?? "").trim(),
    tags: Array.isArray(signal.tags) ? signal.tags : [],
    keyDrivers: Array.isArray(signal.keyDrivers) ? signal.keyDrivers : [],
    aiPrediction: {
      signal: mappedSignal,
      expectedMovePct: Number.isFinite(Number(baselinePrediction.expectedMovePct))
        ? Number(Math.max(0, Math.abs(Number(baselinePrediction.expectedMovePct))).toFixed(2))
        : 0,
      confidence: Number.isFinite(Number(signal.confidence))
        ? Number(Math.max(0, Math.min(1, Number(signal.confidence))).toFixed(4))
        : 0
    },
    levels: {
      entry: Number.isFinite(Number(signal.entry)) ? Number(signal.entry) : undefined,
      stop_loss: Number.isFinite(Number(signal.stop_loss)) ? Number(signal.stop_loss) : undefined,
      take_profit: Number.isFinite(Number(signal.take_profit)) ? Number(signal.take_profit) : undefined
    },
    disclaimer: "grounded_features_only"
  };
}

function deriveScopeContext(
  input: ExplainerInput,
  explicitContext: AiPromptScopeContext | undefined
): AiPromptScopeContext {
  const snapshot = input.featureSnapshot ?? {};
  const snapshotExchange = normalizeContextString(snapshot.prefillExchange);
  const snapshotAccount = normalizeContextString(snapshot.prefillExchangeAccountId);
  const explicitExchange = normalizeContextString(explicitContext?.exchange);
  const explicitAccount = normalizeContextString(explicitContext?.accountId);
  const explicitSymbol = normalizeContextString(explicitContext?.symbol);
  const explicitTimeframe = normalizeContextString(explicitContext?.timeframe);

  return {
    exchange: (explicitExchange ?? snapshotExchange ?? null)?.toLowerCase() ?? null,
    accountId: explicitAccount ?? snapshotAccount ?? null,
    symbol: (explicitSymbol ?? input.symbol ?? null)?.toUpperCase() ?? null,
    timeframe: (explicitTimeframe ?? input.timeframe ?? null)?.toLowerCase() ?? null
  };
}

export async function buildPredictionExplainerPromptPreview(
  input: ExplainerInput,
  deps: GenerateDeps = {}
): Promise<ExplainerPromptPreview> {
  const aiProvider = await getAiProviderAsync();
  const scopeContext = deriveScopeContext(input, deps.promptScopeContext);
  const runtimeSettings =
    deps.promptSettings ?? (await getAiPromptRuntimeSettings(scopeContext));
  const filteredFeatureSnapshot = filterFeatureSnapshotForAiPrompt(
    input.featureSnapshot ?? {},
    runtimeSettings.indicatorKeys
  );
  const runtimeFeatureSnapshot = applyOhlcvBarsLimit(
    filteredFeatureSnapshot,
    runtimeSettings.ohlcvBars
  );
  const runtimeFeatureSnapshotWithHistory = applyHistoryContextLimit(
    runtimeFeatureSnapshot
  );
  const promptInput: ExplainerInput = {
    ...input,
    featureSnapshot: runtimeFeatureSnapshotWithHistory
  };
  const runtimeProfile = buildExplainerRuntimeProfile({
    aiProvider,
    timeframe: input.timeframe,
    runtimeSettings
  });
  const payloadProfile = resolvePayloadProfile(runtimeProfile.analysisMode);
  const payloadBuild = buildPromptPayload(promptInput, runtimeSettings, payloadProfile);
  const payloadCompaction = applyPayloadCompactionForAi({
    payload: payloadBuild.payload,
    payloadProfile
  });
  const rawPayload = payloadCompaction.payload;
  const payloadBudget = applyAiPayloadBudget(
    rawPayload,
    aiProvider === "ollama"
      ? {
          maxPayloadBytes: OLLAMA_MAX_PAYLOAD_BYTES,
          maxHistoryBytes: OLLAMA_MAX_HISTORY_BYTES,
          attachMeta: payloadProfile.mode === "legacy"
        }
      : {
          attachMeta: payloadProfile.mode === "legacy"
        }
  );
  const userPayload = payloadBudget.payload;
  const payloadTraceMeta: PayloadTraceMeta = {
    payloadProfile: payloadProfile.profile,
    payloadCompactionProfile: payloadCompaction.compactionProfile,
    payloadTopLevelKeys: listObjectKeys(userPayload),
    payloadFeatureSnapshotKeys: listObjectKeys(asObject(userPayload.featureSnapshot)),
    payloadDroppedPaths: asUniqueSortedStrings([
      ...payloadBuild.droppedPaths,
      ...payloadCompaction.droppedPaths,
      ...payloadBudget.metrics.trimFlags.map((flag) => `budget:${flag}`)
    ]),
    payloadCompactionDroppedPaths: payloadCompaction.droppedPaths,
    payloadBytes: payloadBudget.metrics.bytes
  };
  const systemMessage = buildSystemMessage(
    runtimeSettings.promptText,
    runtimeProfile.runtimeHints,
    buildPayloadPromptHints(payloadProfile)
  );
  const featureSnapshot = asObject(userPayload.featureSnapshot) ?? {};
  const resolvedModel = await getAiModelAsync();
  const cacheKey = buildPredictionExplainerCacheKey({
    model: resolvedModel,
    promptVersion: buildPromptVersion(runtimeSettings, runtimeProfile),
    symbol: promptInput.symbol,
    timeframe: promptInput.timeframe,
    analysisMode: runtimeProfile.analysisMode,
    signal: runtimeProfile.analysisMode === "trading_explainer" ? promptInput.prediction.signal : undefined,
    confidence: runtimeProfile.analysisMode === "trading_explainer" ? promptInput.prediction.confidence : undefined,
    featureSnapshotHash: buildFeatureSnapshotHash(featureSnapshot),
    historyContextHash: buildHistoryContextHash(featureSnapshot)
  });

  return {
    aiProvider,
    scopeContext,
    runtimeSettings,
    runtimeProfile,
    payloadProfile: payloadProfile.profile,
    systemMessage,
    userPayload,
    payloadDroppedPaths: payloadTraceMeta.payloadDroppedPaths,
    payloadTraceMeta,
    payloadBudgetMetrics: payloadBudget.metrics,
    promptInput,
    cacheKey
  };
}

export async function generatePredictionExplanation(
  input: ExplainerInput,
  deps: GenerateDeps = {}
): Promise<ExplainerOutput> {
  const preview = await buildPredictionExplainerPromptPreview(input, deps);
  const {
    aiProvider,
    promptInput,
    runtimeSettings,
    runtimeProfile,
    systemMessage,
    userPayload,
    payloadTraceMeta,
    payloadBudgetMetrics,
    cacheKey
  } = preview;
  const fallback = () => applyAnalysisModePolicy(fallbackExplain(promptInput), runtimeProfile).output;
  const aiModel = await getAiModelAsync();
  const aiFallbackModel = resolveExplainerFallbackModel(aiModel);
  const callAiFn = deps.callAiFn ?? callAi;
  const agentEnabled = useAgentSignalEngine(aiProvider);
  const shouldRecordPayloadBudgetTelemetry = aiProvider !== "ollama";
  const effectiveExplainerTimeoutMs =
    aiProvider === "ollama"
      ? Math.max(EXPLAINER_TIMEOUT_MS, OLLAMA_EXPLAINER_TIMEOUT_MS)
      : EXPLAINER_TIMEOUT_MS;
  const traceBase = {
    userId: deps.traceUserId ?? null,
    scope: "prediction_explainer",
    provider: aiProvider,
    model: aiModel,
    symbol: promptInput.symbol,
    marketType: promptInput.marketType,
    timeframe: promptInput.timeframe,
    promptTemplateId: runtimeSettings.activePromptId,
    promptTemplateName: runtimeSettings.activePromptName,
    systemMessage,
    userPayload
  } as const;
  if (payloadBudgetMetrics.overBudget) {
    const metrics: AiPayloadBudgetMetrics = {
      ...payloadBudgetMetrics,
      toolCallsUsed: 0
    };
    if (shouldRecordPayloadBudgetTelemetry) {
      recordAiPayloadBudgetTelemetry(metrics);
    }
    const payloadBudgetMeta: ExplanationQualityMetrics = {
      explanationLength: 0,
      explanationSentenceCount: 0,
      explanationParagraphCount: 0,
      meetsLength: true,
      meetsSentenceCount: true,
      meetsParagraphs: true
    };
      await recordAiTraceLog({
        ...traceBase,
        userPayload: withTraceMetaPayload(userPayload, {
          retryUsed: false,
          retryCount: 0,
          totalTokens: null,
          analysisMode: runtimeProfile.analysisMode,
          neutralEnforced: false,
          explanationLength: payloadBudgetMeta.explanationLength,
          explanationSentenceCount: payloadBudgetMeta.explanationSentenceCount,
          explanationParagraphCount: payloadBudgetMeta.explanationParagraphCount,
          paragraphFormatRequired: runtimeProfile.paragraphFormatRequired,
          requestedModel: aiModel,
          resolvedModel: aiModel,
          attemptedModels: [aiModel],
          fallbackReason: "payload_budget_exceeded",
          payloadProfile: payloadTraceMeta.payloadProfile,
          payloadCompactionProfile: payloadTraceMeta.payloadCompactionProfile,
          payloadTopLevelKeys: payloadTraceMeta.payloadTopLevelKeys,
          payloadFeatureSnapshotKeys: payloadTraceMeta.payloadFeatureSnapshotKeys,
          payloadDroppedPaths: payloadTraceMeta.payloadDroppedPaths,
          payloadCompactionDroppedPaths: payloadTraceMeta.payloadCompactionDroppedPaths,
          payloadBytes: payloadTraceMeta.payloadBytes
        }),
      rawResponse: null,
      parsedResponse: null,
      success: false,
      error: "payload_budget_exceeded",
      fallbackUsed: true,
      cacheHit: false,
      rateLimited: false,
      latencyMs: 0
    });
    if (deps.requireSuccessfulAi) {
      throw new Error("ai_payload_budget_exceeded");
    }
    logger.warn("ai_payload_budget_exceeded_fallback", {
      ai_payload_budget_exceeded: true,
      ai_model: aiModel,
      ai_prompt_bytes: payloadBudgetMetrics.bytes,
      max_payload_bytes: payloadBudgetMetrics.maxPayloadBytes,
      trim_flags: payloadBudgetMetrics.trimFlags
    });
    return fallback();
  }

  let aiAttemptsUsed = 0;
  const result = await analyzeWithAiGuards({
    cacheKey,
    aiModel,
    ttlSec: resolveExplainerCacheTtlSec(promptInput.timeframe),
    compute: async () => {
      const startedAt = Date.now();
      let raw: string | null = null;
      let parsedJson: unknown = null;
      let lastUsageTotalTokens: number | null = null;
      let lastExplanationMetrics: ExplanationQualityMetrics | null = null;
      let lastNeutralEnforced = false;
      let totalCalls = 0;
      let resolvedModelForTrace: string | null = null;
      let fallbackReasonForTrace: string | null = null;
      let fallbackObservedForTrace = false;
      const attemptedModelsForTrace: string[] = [];

      const rememberAttemptedModel = (value: string | null | undefined) => {
        if (typeof value !== "string") return;
        const trimmed = value.trim();
        if (!trimmed) return;
        if (!attemptedModelsForTrace.includes(trimmed)) {
          attemptedModelsForTrace.push(trimmed);
        }
      };

      const rememberFallbackReason = (value: unknown) => {
        const raw = String(value ?? "").trim();
        if (!raw) return;
        if (!fallbackReasonForTrace) {
          fallbackReasonForTrace = raw.slice(0, 1000);
        }
      };

      const finalizeValidatedOutput = async (inputArgs: {
        parsedCandidate: unknown;
        rawCandidate: string | null;
        model: string;
        allowQualityRepair: boolean;
      }): Promise<{
        output: ExplainerOutput;
        parsedCandidate: unknown;
        rawCandidate: string | null;
        qualityRepairUsed: boolean;
        qualityMetrics: ExplanationQualityMetrics;
        neutralEnforced: boolean;
      }> => {
        let validated: ExplainerOutput;
        let qualityRepairUsed = false;
        let parsedCandidate = inputArgs.parsedCandidate;
        let rawCandidate = inputArgs.rawCandidate;

        try {
          validated = validateExplainerOutput(
            parsedCandidate,
            promptInput.featureSnapshot,
            promptInput.prediction,
            { runtimeProfile }
          );
        } catch (error) {
          const reason = String(error);
          const isQualityError = /\bexplanation_quality_failed\b/.test(reason);
          if (!isQualityError || !inputArgs.allowQualityRepair) {
            throw error;
          }
          qualityRepairUsed = true;
          const localRepairCandidate = tryLocalExplanationRepair(parsedCandidate, runtimeProfile);
          if (localRepairCandidate) {
            parsedCandidate = localRepairCandidate;
          } else {
            totalCalls += 1;
            aiAttemptsUsed = totalCalls;
            const repairPrompt = [
              "Your previous JSON object failed explanation quality requirements.",
              "Keep all values unchanged except the `explanation` field.",
              "Return only one valid JSON object (no markdown).",
              "Previous JSON:",
              JSON.stringify(parsedCandidate)
            ].join("\n");
            rawCandidate = await callAiFn(repairPrompt, {
              systemMessage: appendQualityRepairInstruction(systemMessage, runtimeProfile),
              model: inputArgs.model,
              temperature: 0,
              timeoutMs: effectiveExplainerTimeoutMs,
              maxTokens: resolveExplainerTokenBudget(inputArgs.model).retryMaxTokens,
              billingUserId: deps.traceUserId ?? null,
              billingScope: "prediction_explainer",
              onUsage: (usage) => {
                const derived =
                  usage.totalTokens
                  ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0));
                if (Number.isFinite(derived)) {
                  lastUsageTotalTokens = Math.max(0, Math.trunc(derived));
                }
              }
            });
            parsedCandidate = parseAiResponseJson(rawCandidate);
          }
          validated = validateExplainerOutput(
            parsedCandidate,
            promptInput.featureSnapshot,
            promptInput.prediction,
            { runtimeProfile }
          );
        }

        const policy = applyAnalysisModePolicy(validated, runtimeProfile);
        const qualityMetrics = evaluateExplanationQuality(policy.output.explanation, runtimeProfile);
        return {
          output: policy.output,
          parsedCandidate,
          rawCandidate,
          qualityRepairUsed,
          qualityMetrics,
          neutralEnforced: policy.neutralEnforced
        };
      };

      try {
        if (agentEnabled) {
          totalCalls += 1;
          aiAttemptsUsed = totalCalls;
          rememberAttemptedModel(aiModel);
          const agentResult = await runSignalAgent({
            systemMessage,
            userPayload,
            model: aiModel,
            timeoutMs: effectiveExplainerTimeoutMs,
            maxTokens: resolveExplainerTokenBudget(aiModel).retryMaxTokens,
            billingUserId: deps.traceUserId ?? null,
            billingScope: "prediction_explainer",
            profile: runtimeProfile.agentSignalProfile
          });
          raw = agentResult.content;
          lastUsageTotalTokens = agentResult.usageTotalTokens;
          resolvedModelForTrace = agentResult.model;
          rememberAttemptedModel(agentResult.model);
          if (agentResult.model !== aiModel) {
            fallbackObservedForTrace = true;
            rememberFallbackReason(`resolved_model_differs:${aiModel}->${agentResult.model}`);
          }
          parsedJson = normalizeAgentSignalToExplainerRaw(
            agentResult.signal,
            promptInput.prediction
          );
          const finalized = await finalizeValidatedOutput({
            parsedCandidate: parsedJson,
            rawCandidate: raw,
            model: agentResult.model,
            allowQualityRepair: aiProvider === "ollama" || runtimeProfile.paragraphFormatRequired
          });
          parsedJson = finalized.parsedCandidate;
          raw = finalized.rawCandidate;
          lastExplanationMetrics = finalized.qualityMetrics;
          lastNeutralEnforced = finalized.neutralEnforced;
          const retryCount = Math.max(0, totalCalls - 1);
          const retryUsed = retryCount > 0 || agentResult.toolIterations > 0 || finalized.qualityRepairUsed;
          await recordAiTraceLog({
            ...traceBase,
            model: agentResult.model,
            userPayload: withTraceMetaPayload(userPayload, {
              retryUsed,
              retryCount,
              totalTokens: lastUsageTotalTokens,
              analysisMode: runtimeProfile.analysisMode,
              neutralEnforced: lastNeutralEnforced,
              explanationLength: lastExplanationMetrics.explanationLength,
              explanationSentenceCount: lastExplanationMetrics.explanationSentenceCount,
              explanationParagraphCount: lastExplanationMetrics.explanationParagraphCount,
              paragraphFormatRequired: runtimeProfile.paragraphFormatRequired,
              requestedModel: aiModel,
              resolvedModel: resolvedModelForTrace ?? agentResult.model,
              attemptedModels: attemptedModelsForTrace,
              fallbackReason: fallbackReasonForTrace,
              payloadProfile: payloadTraceMeta.payloadProfile,
              payloadCompactionProfile: payloadTraceMeta.payloadCompactionProfile,
              payloadTopLevelKeys: payloadTraceMeta.payloadTopLevelKeys,
              payloadFeatureSnapshotKeys: payloadTraceMeta.payloadFeatureSnapshotKeys,
              payloadDroppedPaths: payloadTraceMeta.payloadDroppedPaths,
              payloadCompactionDroppedPaths: payloadTraceMeta.payloadCompactionDroppedPaths,
              payloadBytes: payloadTraceMeta.payloadBytes
            }),
            rawResponse: raw ?? null,
            parsedResponse: finalized.output,
            success: true,
            fallbackUsed: fallbackObservedForTrace,
            cacheHit: false,
            rateLimited: false,
            latencyMs: Date.now() - startedAt
          });
          return finalized.output;
        }

        const modelCandidates = aiFallbackModel ? [aiModel, aiFallbackModel] : [aiModel];
        for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
          const currentModel = modelCandidates[modelIndex];
          const maxAttemptsPerModel = resolveExplainerMaxAttemptsPerModel(aiProvider, currentModel);
          rememberAttemptedModel(currentModel);
          let validated: ExplainerOutput | null = null;
          let validatedQualityMetrics: ExplanationQualityMetrics | null = null;
          let validatedNeutralEnforced = false;
          let modelError: unknown = null;
          for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
            totalCalls += 1;
            aiAttemptsUsed = totalCalls;
            let callResolvedModel: string | null = null;
            let callFallbackUsed = false;
            let callFallbackReason: string | null = null;
            const callPayload =
              attempt === 1
                ? JSON.stringify(userPayload)
                : [
                    "Your previous response was not valid JSON.",
                    "Return only one valid JSON object.",
                    "Do not use markdown, code fences, or extra text.",
                    "Use this exact payload:",
                    JSON.stringify(userPayload)
                  ].join("\n");
            try {
              raw = await callAiFn(callPayload, {
                systemMessage,
                model: currentModel,
                temperature: 0,
                timeoutMs: effectiveExplainerTimeoutMs,
                maxTokens: resolveExplainerAttemptMaxTokens(currentModel, attempt),
                billingUserId: deps.traceUserId ?? null,
                billingScope: "prediction_explainer",
                onUsage: (usage) => {
                  const derived =
                    usage.totalTokens
                    ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0));
                  if (Number.isFinite(derived)) {
                    lastUsageTotalTokens = Math.max(0, Math.trunc(derived));
                  }
                },
                onResolved: (meta) => {
                  callResolvedModel = meta.modelUsed;
                  callFallbackUsed = meta.fallbackUsed;
                  callFallbackReason = meta.fallbackReason;
                }
              });
              if (callResolvedModel) {
                resolvedModelForTrace = callResolvedModel;
                rememberAttemptedModel(callResolvedModel);
              } else {
                resolvedModelForTrace = currentModel;
              }
              if (callFallbackUsed) {
                fallbackObservedForTrace = true;
                rememberFallbackReason(callFallbackReason ?? "provider_model_fallback");
              }
              if (callResolvedModel && callResolvedModel !== currentModel) {
                fallbackObservedForTrace = true;
                rememberFallbackReason(`resolved_model_differs:${currentModel}->${callResolvedModel}`);
              }
              parsedJson = parseAiResponseJson(raw);
              const finalized = await finalizeValidatedOutput({
                parsedCandidate: parsedJson,
                rawCandidate: raw,
                model: currentModel,
                allowQualityRepair: aiProvider === "ollama" || runtimeProfile.paragraphFormatRequired
              });
              validated = finalized.output;
              parsedJson = finalized.parsedCandidate;
              raw = finalized.rawCandidate;
              validatedQualityMetrics = finalized.qualityMetrics;
              validatedNeutralEnforced = finalized.neutralEnforced;
              break;
            } catch (error) {
              modelError = error;
              if (attempt < maxAttemptsPerModel) {
                continue;
              }
            }
          }

          if (validated) {
            const retryCount = Math.max(0, totalCalls - 1);
            const retryUsed = retryCount > 0;
            if (validatedQualityMetrics) {
              lastExplanationMetrics = validatedQualityMetrics;
            }
            lastNeutralEnforced = validatedNeutralEnforced;
            await recordAiTraceLog({
            ...traceBase,
            model: resolvedModelForTrace ?? currentModel,
            userPayload: withTraceMetaPayload(userPayload, {
              retryUsed,
              retryCount,
              totalTokens: lastUsageTotalTokens,
              analysisMode: runtimeProfile.analysisMode,
              neutralEnforced: lastNeutralEnforced,
              explanationLength: lastExplanationMetrics?.explanationLength ?? null,
              explanationSentenceCount: lastExplanationMetrics?.explanationSentenceCount ?? null,
              explanationParagraphCount: lastExplanationMetrics?.explanationParagraphCount ?? null,
              paragraphFormatRequired: runtimeProfile.paragraphFormatRequired,
              requestedModel: aiModel,
              resolvedModel: resolvedModelForTrace ?? currentModel,
              attemptedModels: attemptedModelsForTrace,
              fallbackReason: fallbackReasonForTrace,
              payloadProfile: payloadTraceMeta.payloadProfile,
              payloadCompactionProfile: payloadTraceMeta.payloadCompactionProfile,
              payloadTopLevelKeys: payloadTraceMeta.payloadTopLevelKeys,
              payloadFeatureSnapshotKeys: payloadTraceMeta.payloadFeatureSnapshotKeys,
              payloadDroppedPaths: payloadTraceMeta.payloadDroppedPaths,
              payloadCompactionDroppedPaths: payloadTraceMeta.payloadCompactionDroppedPaths,
              payloadBytes: payloadTraceMeta.payloadBytes
            }),
            rawResponse: raw ?? null,
            parsedResponse: validated,
            success: true,
            fallbackUsed: fallbackObservedForTrace || modelIndex > 0,
            cacheHit: false,
            rateLimited: false,
            latencyMs: Date.now() - startedAt
            });
            return validated;
          }

          if (modelIndex < modelCandidates.length - 1) {
            fallbackObservedForTrace = true;
            rememberFallbackReason(modelError ?? "unknown");
            logger.warn("ai_model_fallback_retry", {
              primary_model: currentModel,
              fallback_model: modelCandidates[modelIndex + 1],
              reason: String(modelError ?? "unknown")
            });
            continue;
          }

          throw modelError ?? new Error("invalid_json");
        }
        throw new Error("invalid_json");
      } catch (caughtError) {
        let error: unknown = caughtError;
        const initialReason = String(caughtError);
        const initialInvalidJson =
          caughtError instanceof SyntaxError
          || /\binvalid_json\b/i.test(initialReason)
          || /\bai_empty_response\b/i.test(initialReason)
          || /\bschema_validation_failed\b/i.test(initialReason);

        if (aiProvider === "ollama" && !agentEnabled && initialInvalidJson) {
          logger.warn("ai_ollama_legacy_rescue_attempt", {
            ai_model: aiModel,
            reason: initialReason
          });
          fallbackObservedForTrace = true;
          rememberFallbackReason(initialReason);
          totalCalls += 1;
          aiAttemptsUsed = totalCalls;
          rememberAttemptedModel(aiModel);
          try {
            const agentResult = await runSignalAgent({
              systemMessage,
              userPayload,
              model: aiModel,
              timeoutMs: effectiveExplainerTimeoutMs,
              maxTokens: resolveExplainerTokenBudget(aiModel).retryMaxTokens,
              billingUserId: deps.traceUserId ?? null,
              billingScope: "prediction_explainer",
              profile: runtimeProfile.agentSignalProfile
            });
            raw = agentResult.content;
            lastUsageTotalTokens = agentResult.usageTotalTokens;
            resolvedModelForTrace = agentResult.model;
            rememberAttemptedModel(agentResult.model);
            parsedJson = normalizeAgentSignalToExplainerRaw(
              agentResult.signal,
              promptInput.prediction
            );
            const finalized = await finalizeValidatedOutput({
              parsedCandidate: parsedJson,
              rawCandidate: raw,
              model: agentResult.model,
              allowQualityRepair: aiProvider === "ollama" || runtimeProfile.paragraphFormatRequired
            });
            parsedJson = finalized.parsedCandidate;
            raw = finalized.rawCandidate;
            lastExplanationMetrics = finalized.qualityMetrics;
            lastNeutralEnforced = finalized.neutralEnforced;
            const retryCount = Math.max(0, totalCalls - 1);
            const retryUsed = retryCount > 0 || agentResult.toolIterations > 0 || finalized.qualityRepairUsed;
            await recordAiTraceLog({
              ...traceBase,
              model: agentResult.model,
              userPayload: withTraceMetaPayload(userPayload, {
                retryUsed,
                retryCount,
                totalTokens: lastUsageTotalTokens,
                analysisMode: runtimeProfile.analysisMode,
                neutralEnforced: lastNeutralEnforced,
                explanationLength: lastExplanationMetrics.explanationLength,
                explanationSentenceCount: lastExplanationMetrics.explanationSentenceCount,
                explanationParagraphCount: lastExplanationMetrics.explanationParagraphCount,
                paragraphFormatRequired: runtimeProfile.paragraphFormatRequired,
                requestedModel: aiModel,
                resolvedModel: resolvedModelForTrace ?? agentResult.model,
                attemptedModels: attemptedModelsForTrace,
                fallbackReason: fallbackReasonForTrace,
                payloadProfile: payloadTraceMeta.payloadProfile,
                payloadCompactionProfile: payloadTraceMeta.payloadCompactionProfile,
                payloadTopLevelKeys: payloadTraceMeta.payloadTopLevelKeys,
                payloadFeatureSnapshotKeys: payloadTraceMeta.payloadFeatureSnapshotKeys,
                payloadDroppedPaths: payloadTraceMeta.payloadDroppedPaths,
                payloadCompactionDroppedPaths: payloadTraceMeta.payloadCompactionDroppedPaths,
                payloadBytes: payloadTraceMeta.payloadBytes
              }),
              rawResponse: raw ?? null,
              parsedResponse: finalized.output,
              success: true,
              fallbackUsed: true,
              cacheHit: false,
              rateLimited: false,
              latencyMs: Date.now() - startedAt
            });
            return finalized.output;
          } catch (rescueError) {
            error = rescueError;
            logger.warn("ai_ollama_legacy_rescue_failed", {
              ai_model: aiModel,
              reason: String(rescueError)
            });
          }
        }

        const reason = String(error);
        const isInvalidJson = error instanceof SyntaxError || /\binvalid_json\b/i.test(reason);
        const retryCount = Math.max(0, totalCalls - 1);
        const retryUsed = retryCount > 0;
        rememberFallbackReason(reason);
        logger.warn("ai_validation_failed", {
          ai_validation_failed: true,
          ai_model: aiModel,
          reason: isInvalidJson ? `invalid_json:${reason}` : reason
        });
        await recordAiTraceLog({
          ...traceBase,
          userPayload: withTraceMetaPayload(userPayload, {
            retryUsed,
            retryCount,
            totalTokens: lastUsageTotalTokens,
            analysisMode: runtimeProfile.analysisMode,
            neutralEnforced: lastNeutralEnforced,
            explanationLength: lastExplanationMetrics?.explanationLength ?? null,
            explanationSentenceCount: lastExplanationMetrics?.explanationSentenceCount ?? null,
            explanationParagraphCount: lastExplanationMetrics?.explanationParagraphCount ?? null,
            paragraphFormatRequired: runtimeProfile.paragraphFormatRequired,
            requestedModel: aiModel,
            resolvedModel: resolvedModelForTrace ?? aiModel,
            attemptedModels: attemptedModelsForTrace.length > 0 ? attemptedModelsForTrace : [aiModel],
            fallbackReason: fallbackReasonForTrace,
            payloadProfile: payloadTraceMeta.payloadProfile,
            payloadCompactionProfile: payloadTraceMeta.payloadCompactionProfile,
            payloadTopLevelKeys: payloadTraceMeta.payloadTopLevelKeys,
            payloadFeatureSnapshotKeys: payloadTraceMeta.payloadFeatureSnapshotKeys,
            payloadDroppedPaths: payloadTraceMeta.payloadDroppedPaths,
            payloadCompactionDroppedPaths: payloadTraceMeta.payloadCompactionDroppedPaths,
            payloadBytes: payloadTraceMeta.payloadBytes
          }),
          rawResponse: raw,
          parsedResponse: parsedJson,
          success: false,
          error: isInvalidJson ? "invalid_json" : reason,
          fallbackUsed: true,
          cacheHit: false,
          rateLimited: false,
          latencyMs: Date.now() - startedAt
        });
        if (isInvalidJson) {
          throw new Error("invalid_json");
        }
        throw error;
      }
    },
    fallback
  });
  const toolCallsUsed = result.cacheHit || aiAttemptsUsed === 0 ? 0 : aiAttemptsUsed;
  if (shouldRecordPayloadBudgetTelemetry) {
    recordAiPayloadBudgetTelemetry({
      ...payloadBudgetMetrics,
      toolCallsUsed
    });
  }
  recordAiExplainerCacheTelemetry(result.cacheHit);

  if (result.fallbackUsed) {
    if (deps.requireSuccessfulAi) {
      const fallbackReason =
        typeof result.fallbackReason === "string" && result.fallbackReason.trim()
          ? result.fallbackReason.trim().replace(/\s+/g, " ").slice(0, 220)
          : "";
      const reason = result.rateLimited
        ? "rate_limited"
        : fallbackReason
          ? `provider_unavailable_or_invalid_response:${fallbackReason}`
          : "provider_unavailable_or_invalid_response";
      throw new Error(`ai_required_but_unavailable:${reason}`);
    }
    logger.info("ai_fallback_used", {
      ai_fallback_used: true,
      ai_model: aiModel,
      ai_cache_hit: result.cacheHit
    });
  }

  return result.value;
}
