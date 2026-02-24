import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import { prisma } from "@mm/db";
import { BitgetFuturesAdapter } from "@mm/futures-exchange";
import {
  createSession,
  destroySession,
  getUserFromLocals,
  hashPassword,
  requireAuth,
  verifyPassword
} from "./auth.js";
import { ensureDefaultRoles, buildPermissions, PERMISSION_KEYS } from "./rbac.js";
import { sendReauthOtpEmail, sendSmtpTestEmail } from "./email.js";
import { decryptSecret, encryptSecret } from "./secret-crypto.js";
import {
  evaluateAiPromptAccess,
  evaluateStrategyAccess,
  enforceBotStartLicense,
  getAiPromptAllowedPublicIds,
  getAiPromptLicenseMode,
  isAiModelAllowed,
  isStrategyIdAllowed,
  isStrategyKindAllowed,
  resolveStrategyEntitlementsForWorkspace,
  getStubEntitlements,
  isLicenseEnforcementEnabled,
  isLicenseStubEnabled
} from "./license.js";
import {
  closeOrchestration,
  cancelBotRun,
  enqueueBotRun,
  getQueueMetrics,
  getRuntimeOrchestrationMode
} from "./orchestration.js";
import { ExchangeSyncError, syncExchangeAccount } from "./exchange-sync.js";
import { recoverRunningBotJobs } from "./bot-run-recovery.js";
import {
  OPENAI_ADMIN_MODEL_OPTIONS,
  getAiModel,
  getAiModelAsync,
  invalidateAiApiKeyCache,
  invalidateAiModelCache,
  resolveAiModelFromConfig,
  type OpenAiAdminModel
} from "./ai/provider.js";
import {
  buildPredictionExplainerPromptPreview,
  fallbackExplain,
  generatePredictionExplanation,
  type ExplainerOutput
} from "./ai/predictionExplainer.js";
import {
  createGeneratedPromptDraft,
  generateHybridPromptText
} from "./ai/promptGenerator.js";
import {
  createUserAiPromptTemplate,
  deleteUserAiPromptTemplateById,
  listUserAiPromptTemplates,
  resolveAiPromptRuntimeForUserSelection
} from "./ai/userPromptSettings.js";
import {
  buildAndAttachHistoryContext
} from "./ai/historyContext.js";
import {
  AI_PROMPT_SETTINGS_GLOBAL_SETTING_KEY,
  DEFAULT_AI_PROMPT_SETTINGS,
  getAiPromptRuntimeSettings,
  getAiPromptRuntimeSettingsByTemplateId,
  getAiPromptIndicatorOptionsPublic,
  getAiPromptTemplateById,
  getPublicAiPromptTemplates,
  invalidateAiPromptSettingsCache,
  isAiPromptIndicatorKey,
  parseStoredAiPromptSettings,
  resolveAiPromptRuntimeSettingsForContext,
  type AiPromptSettingsStored,
  type AiPromptTemplate,
  type AiPromptIndicatorKey
} from "./ai/promptSettings.js";
import {
  AI_TRACE_SETTINGS_GLOBAL_SETTING_KEY,
  DEFAULT_AI_TRACE_SETTINGS,
  getAiTraceSettingsCached,
  invalidateAiTraceSettingsCache,
  parseStoredAiTraceSettings
} from "./ai/traceLog.js";
import {
  getAiPayloadBudgetAlertSnapshot,
  getAiPayloadBudgetTelemetrySnapshot
} from "./ai/payloadBudget.js";
import {
  cancelAllPaperOrders,
  cancelPaperOrder,
  clearPaperMarketDataAccountId,
  clearPaperState,
  closePaperPosition,
  editOpenOrder,
  editPaperOrder,
  ManualTradingError,
  getPaperAccountState,
  isPaperTradingAccount,
  listPaperMarketDataAccountIds,
  listPaperOpenOrders,
  listPaperPositions,
  cancelAllOrders,
  closePositionsMarket,
  createBitgetAdapter,
  extractWsDataArray,
  getTradingSettings,
  listOpenOrders,
  listPositions,
  listSymbols,
  normalizeOrderBookPayload,
  normalizeSymbolInput,
  normalizeTickerPayload,
  normalizeTradesPayload,
  placePaperOrder,
  resolveMarketDataTradingAccount,
  resolveTradingAccount,
  saveTradingSettings,
  setPositionTpSl,
  setPaperPositionTpSl,
  setPaperMarketDataAccountId
} from "./trading.js";
import {
  computeOpenPnlUsd,
  computeRuntimeMarkPrice,
  deriveStoppedWhy,
  extractLastDecisionConfidence,
  readBotPrimaryTradeState,
  sumRealizedPnlUsdFromTradeEvents,
  type BotTradeStateOverviewRow
} from "./bots/overview.js";
import {
  classifyOutcomeFromClose,
  computeCoreMetricsFromClosedTrades,
  computeRealizedPnlPct,
  decodeTradeHistoryCursor,
  encodeTradeHistoryCursor,
  type BotTradeHistoryOutcome
} from "./bots/tradeHistory.js";
import {
  generateAndPersistPrediction,
  resolvePredictionTracking,
  type PredictionSignalMode,
  type PredictionSignalSource
} from "./ai/predictionPipeline.js";
import {
  FEATURE_THRESHOLD_VERSION,
  applyConfidencePenalty,
  buildFeatureThresholds,
  calibrationWindowMsForTimeframe,
  deriveRegimeTags,
  expectedBarsForWindow,
  fallbackFeatureThresholds,
  minimumBarsForTimeframe,
  percentileRankFromBands,
  readFeatureThresholds,
  type FeatureThresholdsJson,
  type ResolvedFeatureThresholds,
  type ThresholdMarketType,
  type ThresholdTimeframe
} from "./prediction-thresholds.js";
import {
  computeIndicators,
  minimumCandlesForIndicatorsWithSettings,
  type IndicatorsSnapshot
} from "./market/indicators.js";
import { computeAdvancedIndicators } from "./market/indicators/advancedIndicators.js";
import { bucketCandles, toBucketStart } from "./market/timeframe.js";
import {
  DEFAULT_INDICATOR_SETTINGS,
  indicatorSettingsUpsertSchema,
  mergeIndicatorSettings,
  normalizeIndicatorSettingsPatch,
  type IndicatorSettingsConfig
} from "./dto/indicatorSettings.dto.js";
import {
  clearIndicatorSettingsCache,
  resolveIndicatorSettings
} from "./config/indicatorSettingsResolver.js";
import {
  buildPredictionMetricsSummary,
  computeDirectionalRealizedReturnPct,
  computePredictionErrorMetrics,
  normalizeConfidencePct,
  readRealizedPayloadFromOutcomeMeta,
  type PredictionEvaluatorSample
} from "./jobs/predictionEvaluatorJob.js";
import { createEconomicCalendarRefreshJob } from "./jobs/economicCalendarRefreshJob.js";
import { registerPredictionDetailRoute } from "./routes/predictions.js";
import { registerEconomicCalendarRoutes } from "./routes/economic-calendar.js";
import { registerNewsRoutes } from "./routes/news.js";
import {
  buildEventDelta,
  buildPredictionChangeHash,
  evaluateSignificantChange,
  refreshIntervalMsForTimeframe,
  shouldMarkUnstableFlips,
  shouldThrottleRepeatedEvent,
  type PredictionStateLike
} from "./predictions/refreshService.js";
import {
  applyAiQualityGateCallToState,
  getAiQualityGateTelemetrySnapshot,
  shouldInvokeAiExplain,
  type AiQualityGateRollingState
} from "./ai/qualityGate.js";
import {
  getBuiltinLocalStrategyTemplates,
  getRegisteredLocalStrategy,
  listPythonStrategyRegistry,
  listRegisteredLocalStrategies,
  runLocalStrategy
} from "./local-strategies/registry.js";
import {
  normalizeCompositeGraph,
  validateCompositeGraph
} from "./composite-strategies/graph.js";
import { runCompositeStrategy } from "./composite-strategies/runner.js";
import { shouldRefreshTF, type TriggerDebounceState } from "./predictions/refreshTriggers.js";
import {
  applyNewsRiskToFeatureSnapshot,
  evaluateNewsRiskForSymbol,
  getEconomicCalendarConfig
} from "./services/economicCalendar/index.js";
import { fetchFmpEconomicEvents } from "./services/economicCalendar/providers/fmp.js";

const db = prisma as any;
const economicCalendarRefreshJob = createEconomicCalendarRefreshJob(db);

const app = express();
app.set("trust proxy", 1);

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (origins.includes("http://localhost:3000") && !origins.includes("http://127.0.0.1:3000")) {
  origins.push("http://127.0.0.1:3000");
}
if (origins.includes("http://127.0.0.1:3000") && !origins.includes("http://localhost:3000")) {
  origins.push("http://localhost:3000");
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origins.includes("*") || origins.includes(origin)) return callback(null, true);
      return callback(new Error("not_allowed_by_cors"));
    },
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json());

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const exchangeCreateSchema = z.object({
  exchange: z.string().trim().min(1),
  label: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  apiSecret: z.string().trim().optional(),
  passphrase: z.string().trim().optional(),
  marketDataExchangeAccountId: z.string().trim().optional()
}).superRefine((value, ctx) => {
  const exchange = value.exchange.toLowerCase();
  if (exchange === "bitget") {
    if (!value.apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: "apiKey is required for bitget"
      });
    }
    if (!value.apiSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiSecret"],
        message: "apiSecret is required for bitget"
      });
    }
  }
  if (exchange !== "paper" && !value.apiKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiKey"],
      message: "apiKey is required"
    });
  }
  if (exchange !== "paper" && !value.apiSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiSecret"],
      message: "apiSecret is required"
    });
  }
  if (exchange === "bitget" && !value.passphrase) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["passphrase"],
      message: "passphrase is required for bitget"
    });
  }
  if (exchange === "hyperliquid" && value.apiKey && !/^0x[a-fA-F0-9]{40}$/.test(value.apiKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiKey"],
      message: "apiKey must be a wallet address (0x + 40 hex) for hyperliquid"
    });
  }
  if (
    exchange === "hyperliquid" &&
    value.apiSecret &&
    !/^(0x)?[a-fA-F0-9]{64}$/.test(value.apiSecret)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiSecret"],
      message: "apiSecret must be a private key (64 hex, optional 0x) for hyperliquid"
    });
  }
  if (exchange === "paper" && !value.marketDataExchangeAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["marketDataExchangeAccountId"],
      message: "marketDataExchangeAccountId is required for paper"
    });
  }
});

const predictionCopierTimeframeSchema = z.enum(["5m", "15m", "1h", "4h"]);
const predictionSignalModeSchema = z.enum(["local_only", "ai_only", "both"]);
const predictionStrategyKindSchema = z.enum(["local", "ai", "composite"]);

const predictionCopierSettingsSchema = z.object({
  sourceStateId: z.string().trim().min(1).optional(),
  sourceSnapshot: z.object({
    stateId: z.string().trim().min(1).optional(),
    accountId: z.string().trim().min(1).optional(),
    symbol: z.string().trim().min(1).optional(),
    timeframe: predictionCopierTimeframeSchema.optional(),
    signalMode: predictionSignalModeSchema.optional(),
    strategyRef: z.string().trim().min(1).nullable().optional(),
    strategyKind: predictionStrategyKindSchema.nullable().optional(),
    strategyId: z.string().trim().min(1).nullable().optional(),
    strategyName: z.string().trim().min(1).nullable().optional()
  }).passthrough().optional(),
  timeframe: predictionCopierTimeframeSchema.optional(),
  minConfidence: z.number().min(0).max(100).optional(),
  maxPredictionAgeSec: z.number().int().min(30).max(86_400).optional(),
  symbols: z.array(z.string().trim().min(1)).max(100).optional(),
  positionSizing: z.object({
    type: z.enum(["fixed_usd", "equity_pct", "risk_pct"]).optional(),
    value: z.number().positive().optional()
  }).optional(),
  risk: z.object({
    maxOpenPositions: z.number().int().min(1).max(100).optional(),
    maxDailyTrades: z.number().int().min(1).max(10_000).optional(),
    cooldownSecAfterTrade: z.number().int().min(0).max(86_400).optional(),
    maxNotionalPerSymbolUsd: z.number().positive().optional(),
    maxTotalNotionalUsd: z.number().positive().optional(),
    maxLeverage: z.number().int().min(1).max(125).optional(),
    stopLossPct: z.number().positive().max(95).nullable().optional(),
    takeProfitPct: z.number().positive().max(500).nullable().optional(),
    timeStopMin: z.number().int().positive().max(10_080).nullable().optional()
  }).optional(),
  filters: z.object({
    blockTags: z.array(z.string().trim().min(1)).max(50).optional(),
    newsRiskBlockEnabled: z.boolean().optional(),
    requireTags: z.array(z.string().trim().min(1)).max(50).nullable().optional(),
    allowSignals: z.array(z.enum(["up", "down", "neutral"])).max(3).optional(),
    minExpectedMovePct: z.number().nonnegative().nullable().optional()
  }).optional(),
  execution: z.object({
    orderType: z.enum(["market", "limit"]).optional(),
    limitOffsetBps: z.number().nonnegative().max(500).optional(),
    reduceOnlyOnExit: z.boolean().optional()
  }).optional(),
  exit: z.object({
    onSignalFlip: z.boolean().optional(),
    onConfidenceDrop: z.boolean().optional()
  }).optional()
});

const botCreateSchema = z.object({
  name: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  exchangeAccountId: z.string().trim().min(1),
  strategyKey: z.string().trim().min(1).default("dummy"),
  marginMode: z.enum(["isolated", "cross"]).default("isolated"),
  leverage: z.number().int().min(1).max(125).default(1),
  tickMs: z.number().int().min(100).max(60_000).default(1000),
  paramsJson: z.record(z.any()).default({})
}).superRefine((value, ctx) => {
  if (value.strategyKey !== "prediction_copier") return;

  const root =
    value.paramsJson && typeof value.paramsJson.predictionCopier === "object" && value.paramsJson.predictionCopier
      ? value.paramsJson.predictionCopier
      : value.paramsJson;
  const parsed = predictionCopierSettingsSchema.safeParse(root);
  if (parsed.success) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["paramsJson"],
    message: "invalid prediction_copier configuration"
  });
});

const botUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1).optional(),
  strategyKey: z.string().trim().min(1).optional(),
  marginMode: z.enum(["isolated", "cross"]).optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  tickMs: z.number().int().min(100).max(60_000).optional(),
  paramsJson: z.record(z.any()).optional()
}).superRefine((value, ctx) => {
  if (Object.keys(value).length > 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "at least one field must be provided"
  });
});

const botStopSchema = z.object({
  closeOpenPosition: z.boolean().optional()
});

const botPredictionSourcesQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  strategyKind: predictionStrategyKindSchema.optional(),
  signalMode: predictionSignalModeSchema.optional(),
  symbol: z.string().trim().min(1).optional()
});

const botOverviewListQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  status: z.enum(["running", "stopped", "error"]).optional()
});

const botOverviewDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

const botRiskEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100)
});

const botTradeHistoryOutcomeSchema = z.enum([
  "tp_hit",
  "sl_hit",
  "signal_exit",
  "manual_exit",
  "time_stop",
  "unknown"
]);

const botTradeHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  outcome: botTradeHistoryOutcomeSchema.optional()
});

const tradingSettingsSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).nullable().optional(),
  symbol: z.string().trim().min(1).nullable().optional(),
  timeframe: z.string().trim().min(1).nullable().optional(),
  marginMode: z.enum(["isolated", "cross"]).nullable().optional(),
  chartPreferences: z.object({
    indicatorToggles: z.object({
      ema5: z.boolean().optional(),
      ema13: z.boolean().optional(),
      ema50: z.boolean().optional(),
      ema200: z.boolean().optional(),
      ema800: z.boolean().optional(),
      emaCloud50: z.boolean().optional(),
      vwapSession: z.boolean().optional(),
      dailyOpen: z.boolean().optional(),
      smcStructure: z.boolean().optional(),
      volumeOverlay: z.boolean().optional(),
      pvsraVector: z.boolean().optional(),
      breakerBlocks: z.boolean().optional(),
      superOrderBlockFvgBos: z.boolean().optional()
    }).optional(),
    showUpMarkers: z.boolean().optional(),
    showDownMarkers: z.boolean().optional()
  }).optional()
});

const alertsSettingsSchema = z.object({
  telegramBotToken: z.string().trim().nullable().optional(),
  telegramChatId: z.string().trim().nullable().optional()
});

const securitySettingsSchema = z.object({
  autoLogoutEnabled: z.boolean().optional(),
  autoLogoutMinutes: z.number().int().min(1).max(1440).optional(),
  reauthOtpEnabled: z.boolean().optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email()
});

const passwordResetConfirmSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().regex(/^\d{6}$/),
  newPassword: z.string().min(8)
});

const adminUserCreateSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().trim().min(8).optional()
});

const adminUserPasswordSchema = z.object({
  password: z.string().trim().min(8)
});

const adminUserAdminAccessSchema = z.object({
  enabled: z.boolean().default(false)
});

const adminTelegramSchema = z.object({
  telegramBotToken: z.string().trim().nullable().optional(),
  telegramChatId: z.string().trim().nullable().optional()
}).superRefine((value, ctx) => {
  const token = typeof value.telegramBotToken === "string" ? value.telegramBotToken.trim() : "";
  const chatId = typeof value.telegramChatId === "string" ? value.telegramChatId.trim() : "";
  if ((token && !chatId) || (!token && chatId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "telegramBotToken and telegramChatId must both be set or both be empty"
    });
  }
});

const adminExchangesSchema = z.object({
  allowed: z.array(z.string().trim().min(1)).min(1).max(20)
});

const adminSmtpSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().trim().min(1),
  from: z.string().trim().min(1),
  secure: z.boolean().default(true),
  password: z.string().trim().min(1).optional()
});

const adminSmtpTestSchema = z.object({
  to: z.string().trim().email()
});

const openAiModelSchema = z.enum(OPENAI_ADMIN_MODEL_OPTIONS);

const adminApiKeysSchema = z.object({
  openaiApiKey: z.string().trim().min(10).max(500).optional(),
  clearOpenaiApiKey: z.boolean().default(false),
  fmpApiKey: z.string().trim().min(10).max(500).optional(),
  clearFmpApiKey: z.boolean().default(false),
  openaiModel: openAiModelSchema.optional(),
  clearOpenaiModel: z.boolean().default(false)
}).refine(
  (value) =>
    value.clearOpenaiApiKey ||
    Boolean(value.openaiApiKey) ||
    value.clearFmpApiKey ||
    Boolean(value.fmpApiKey) ||
    value.clearOpenaiModel ||
    Boolean(value.openaiModel),
  {
    message: "Provide openaiApiKey/fmpApiKey/openaiModel or set a clear flag."
  }
);

const adminPredictionRefreshSchema = z.object({
  triggerDebounceSec: z.number().int().min(0).max(3600),
  aiCooldownSec: z.number().int().min(30).max(3600),
  eventThrottleSec: z.number().int().min(0).max(3600),
  hysteresisRatio: z.number().min(0.2).max(0.95),
  unstableFlipLimit: z.number().int().min(2).max(20),
  unstableFlipWindowSeconds: z.number().int().min(60).max(86400)
});

const adminPredictionDefaultsSchema = z.object({
  signalMode: z.enum(["local_only", "ai_only", "both"]).default("both")
});

const accessSectionVisibilitySchema = z.object({
  tradingDesk: z.boolean().default(true),
  bots: z.boolean().default(true),
  predictionsDashboard: z.boolean().default(true),
  economicCalendar: z.boolean().default(true),
  news: z.boolean().default(true),
  strategy: z.boolean().default(true)
});

const accessSectionLimitsSchema = z.object({
  bots: z.number().int().min(0).nullable().default(null),
  predictionsLocal: z.number().int().min(0).nullable().default(null),
  predictionsAi: z.number().int().min(0).nullable().default(null),
  predictionsComposite: z.number().int().min(0).nullable().default(null)
});

const adminAccessSectionSettingsSchema = z.object({
  visibility: accessSectionVisibilitySchema.default({}),
  limits: accessSectionLimitsSchema.default({})
});

const adminServerInfoSchema = z.object({
  serverIpAddress: z.string().trim().max(255).nullable().optional()
});

const adminAiTraceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  maxSystemMessageChars: z.number().int().min(500).max(50_000).default(12_000),
  maxUserPayloadChars: z.number().int().min(1_000).max(250_000).default(60_000),
  maxRawResponseChars: z.number().int().min(500).max(50_000).default(12_000)
});

const adminAiTraceLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const adminAiTraceCleanupSchema = z.object({
  deleteAll: z.boolean().default(false),
  olderThanDays: z.number().int().min(1).max(3650).default(30)
});

const aiPromptTemplateSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(64),
  promptText: z.string().max(8000).default(""),
  indicatorKeys: z.array(z.string().trim().min(1)).max(128).default([]),
  ohlcvBars: z.number().int().min(20).max(500).default(100),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().default(null),
  timeframes: z.array(z.enum(["5m", "15m", "1h", "4h", "1d"])).max(4).default([]),
  runTimeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().default(null),
  directionPreference: z.enum(["long", "short", "either"]).default("either"),
  confidenceTargetPct: z.number().min(0).max(100).default(60),
  slTpSource: z.enum(["local", "ai", "hybrid"]).default("local"),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  marketAnalysisUpdateEnabled: z.boolean().default(false),
  isPublic: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, timeframe] of value.timeframes.entries()) {
    if (seen.has(timeframe)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeframes must be unique",
        path: ["timeframes", index]
      });
      continue;
    }
    seen.add(timeframe);
  }
  if (value.timeframes.length > 0 && value.runTimeframe && !value.timeframes.includes(value.runTimeframe)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runTimeframe must be included in timeframes",
      path: ["runTimeframe"]
    });
  }
});

const adminAiPromptsSchema = z.object({
  activePromptId: z.string().trim().nullable().optional(),
  prompts: z.array(aiPromptTemplateSchema).max(500).default([])
});

const adminAiPromptsPreviewSchema = z.object({
  exchange: z.string().trim().optional(),
  accountId: z.string().trim().optional(),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]).default("perp"),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).default("15m"),
  tsCreated: z.string().datetime().optional(),
  prediction: z.object({
    signal: z.enum(["up", "down", "neutral"]),
    expectedMovePct: z.number(),
    confidence: z.number()
  }).optional(),
  featureSnapshot: z.record(z.any()).default({}),
  settingsDraft: z.unknown().optional()
});

function validateAdminAiPromptGeneratorInput(
  value: {
    timeframes: Array<"5m" | "15m" | "1h" | "4h" | "1d">;
    runTimeframe?: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  },
  ctx: z.RefinementCtx
) {
  const seen = new Set<string>();
  for (const [index, timeframe] of value.timeframes.entries()) {
    if (seen.has(timeframe)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeframes must be unique",
        path: ["timeframes", index]
      });
      continue;
    }
    seen.add(timeframe);
  }

  if (value.timeframes.length === 0 && value.runTimeframe) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runTimeframe requires at least one selected timeframe",
      path: ["runTimeframe"]
    });
  } else if (value.timeframes.length > 0 && value.runTimeframe && !value.timeframes.includes(value.runTimeframe)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runTimeframe must be included in timeframes",
      path: ["runTimeframe"]
    });
  }
}

const adminAiPromptsGenerateBaseSchema = z.object({
  name: z.string().trim().min(1).max(64),
  strategyDescription: z.string().trim().min(1).max(8000),
  indicatorKeys: z.array(z.string().trim().min(1)).max(128).default([]),
  ohlcvBars: z.number().int().min(20).max(500).default(100),
  timeframes: z.array(z.enum(["5m", "15m", "1h", "4h", "1d"])).max(4).default([]),
  runTimeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().optional(),
  directionPreference: z.enum(["long", "short", "either"]).default("either"),
  confidenceTargetPct: z.number().min(0).max(100).default(60),
  slTpSource: z.enum(["local", "ai", "hybrid"]).default("local"),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  setActive: z.boolean().default(false),
  isPublic: z.boolean().default(false)
});

const adminAiPromptsGeneratePreviewSchema = adminAiPromptsGenerateBaseSchema
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

const adminAiPromptsGenerateSaveSchema = adminAiPromptsGenerateBaseSchema
  .extend({
    generatedPromptText: z.string().optional(),
    generationMeta: z.object({
      mode: z.enum(["ai", "fallback"]),
      model: z.string().trim().min(1).max(120)
    }).optional()
  })
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

const userAiPromptTemplateIdParamSchema = z.object({
  id: z.string().trim().min(1).max(160)
});

const userAiPromptsGenerateBaseSchema = z.object({
  name: z.string().trim().min(1).max(64),
  strategyDescription: z.string().trim().min(1).max(8000),
  indicatorKeys: z.array(z.string().trim().min(1)).max(128).default([]),
  ohlcvBars: z.number().int().min(20).max(500).default(100),
  timeframes: z.array(z.enum(["5m", "15m", "1h", "4h", "1d"])).max(4).default([]),
  runTimeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().optional(),
  directionPreference: z.enum(["long", "short", "either"]).default("either"),
  confidenceTargetPct: z.number().min(0).max(100).default(60),
  slTpSource: z.enum(["local", "ai", "hybrid"]).default("local"),
  newsRiskMode: z.enum(["off", "block"]).default("off")
});

const userAiPromptsGeneratePreviewSchema = userAiPromptsGenerateBaseSchema
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

const userAiPromptsGenerateSaveSchema = userAiPromptsGenerateBaseSchema
  .extend({
    generatedPromptText: z.string().optional(),
    generationMeta: z.object({
      mode: z.enum(["ai", "fallback"]),
      model: z.string().trim().min(1).max(120)
    }).optional()
  })
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

type AdminAiPromptsPayload = z.infer<typeof adminAiPromptsSchema>;

const localStrategyDefinitionSchema = z.object({
  strategyType: z.string().trim().min(1).max(128),
  engine: z.enum(["ts", "python"]).default("ts"),
  shadowMode: z.boolean().default(false),
  remoteStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  fallbackStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  timeoutMs: z.number().int().min(200).max(10000).nullable().optional(),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).default("1.0.0"),
  inputSchema: z.record(z.any()).nullable().optional(),
  configJson: z.record(z.any()).default({}),
  isEnabled: z.boolean().default(true)
});

const localStrategyDefinitionUpdateSchema = z.object({
  strategyType: z.string().trim().min(1).max(128).optional(),
  engine: z.enum(["ts", "python"]).optional(),
  shadowMode: z.boolean().optional(),
  remoteStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  fallbackStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  timeoutMs: z.number().int().min(200).max(10000).nullable().optional(),
  newsRiskMode: z.enum(["off", "block"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).optional(),
  inputSchema: z.record(z.any()).nullable().optional(),
  configJson: z.record(z.any()).optional(),
  isEnabled: z.boolean().optional()
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "Provide at least one field to update." }
);

const localStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const localStrategyRunSchema = z.object({
  featureSnapshot: z.record(z.any()).default({}),
  ctx: z.object({
    signal: z.enum(["up", "down", "neutral"]).optional(),
    exchange: z.string().trim().optional(),
    accountId: z.string().trim().optional(),
    symbol: z.string().trim().optional(),
    marketType: z.string().trim().optional(),
    timeframe: z.string().trim().optional()
  }).catchall(z.any()).default({})
});

const compositeNodeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(["local", "ai"]),
  refId: z.string().trim().min(1).max(160),
  configOverrides: z.record(z.any()).optional(),
  position: z.object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional()
  }).optional()
});

const compositeEdgeSchema = z.object({
  from: z.string().trim().min(1).max(120),
  to: z.string().trim().min(1).max(120),
  rule: z.enum(["always", "if_signal_not_neutral", "if_confidence_gte"]).default("always"),
  confidenceGte: z.number().min(0).max(100).optional()
});

const compositeStrategyCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).default("1.0.0"),
  nodesJson: z.array(compositeNodeSchema).min(1).max(30),
  edgesJson: z.array(compositeEdgeSchema).max(120).default([]),
  combineMode: z.enum(["pipeline", "vote"]).default("pipeline"),
  outputPolicy: z.enum(["first_non_neutral", "override_by_confidence", "local_signal_ai_explain"]).default("local_signal_ai_explain"),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  isEnabled: z.boolean().default(true)
});

const compositeStrategyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).optional(),
  nodesJson: z.array(compositeNodeSchema).min(1).max(30).optional(),
  edgesJson: z.array(compositeEdgeSchema).max(120).optional(),
  combineMode: z.enum(["pipeline", "vote"]).optional(),
  outputPolicy: z.enum(["first_non_neutral", "override_by_confidence", "local_signal_ai_explain"]).optional(),
  newsRiskMode: z.enum(["off", "block"]).optional(),
  isEnabled: z.boolean().optional()
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "Provide at least one field to update." }
);

const compositeStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const compositeStrategyDryRunSchema = z.object({
  predictionId: z.string().trim().min(1)
});

const adminIndicatorSettingsResolvedQuerySchema = z.object({
  exchange: z.string().trim().optional(),
  accountId: z.string().trim().optional(),
  symbol: z.string().trim().optional(),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional()
});

const placeOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  type: z.enum(["market", "limit"]),
  side: z.enum(["long", "short"]),
  qty: z.number().positive(),
  price: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  stopLossPrice: z.number().positive().optional(),
  reduceOnly: z.boolean().optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  marginMode: z.enum(["isolated", "cross"]).optional()
}).superRefine((value, ctx) => {
  if (value.type === "limit" && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["price"],
      message: "price is required for limit orders"
    });
  }
});

const adjustLeverageSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  leverage: z.number().int().min(1).max(125),
  marginMode: z.enum(["isolated", "cross"]).default("cross")
});

const cancelOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1),
  symbol: z.string().trim().min(1).optional()
});

const closePositionSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  side: z.enum(["long", "short"]).optional()
});

const editOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  price: z.number().positive().optional(),
  qty: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().nullable().optional(),
  stopLossPrice: z.number().positive().nullable().optional()
}).superRefine((value, ctx) => {
  if (
    value.price === undefined &&
    value.qty === undefined &&
    value.takeProfitPrice === undefined &&
    value.stopLossPrice === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["orderId"],
      message: "at least one editable field is required"
    });
  }
});

const positionTpSlSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  side: z.enum(["long", "short"]).optional(),
  takeProfitPrice: z.number().positive().nullable().optional(),
  stopLossPrice: z.number().positive().nullable().optional()
}).superRefine((value, ctx) => {
  if (value.takeProfitPrice === undefined && value.stopLossPrice === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["symbol"],
      message: "takeProfitPrice or stopLossPrice is required"
    });
  }
});

const marketCandlesQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("15m"),
  limit: z.coerce.number().int().min(20).max(1000).default(400)
});

const dashboardAlertsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const dashboardPerformanceQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).default("24h")
});

const settingsRiskAccountParamSchema = z.object({
  exchangeAccountId: z.string().trim().min(1)
});

const settingsRiskUpdateSchema = z.object({
  dailyLossWarnPct: z.coerce.number().finite().min(0).optional(),
  dailyLossWarnUsd: z.coerce.number().finite().min(0).optional(),
  dailyLossCriticalPct: z.coerce.number().finite().min(0).optional(),
  dailyLossCriticalUsd: z.coerce.number().finite().min(0).optional(),
  marginWarnPct: z.coerce.number().finite().min(0).optional(),
  marginWarnUsd: z.coerce.number().finite().min(0).optional(),
  marginCriticalPct: z.coerce.number().finite().min(0).optional(),
  marginCriticalUsd: z.coerce.number().finite().min(0).optional()
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "Provide at least one field to update." }
);

const dashboardRiskAnalysisQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3)
});

const predictionGenerateSchema = z.object({
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  tsCreated: z.string().datetime().optional(),
  prediction: z.object({
    signal: z.enum(["up", "down", "neutral"]),
    expectedMovePct: z.number(),
    confidence: z.number()
  }),
  featureSnapshot: z.record(z.any()),
  botId: z.string().trim().min(1).optional(),
  modelVersionBase: z.string().trim().min(1).optional(),
  signalMode: z.enum(["local_only", "ai_only", "both"]).default("both"),
  aiPromptTemplateId: z.string().trim().min(1).max(128).nullish(),
  compositeStrategyId: z.string().trim().min(1).max(160).nullish(),
  strategyRef: z.object({
    kind: z.enum(["ai", "local", "composite"]),
    id: z.string().trim().min(1).max(160)
  }).nullish()
});

const predictionGenerateAutoSchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  leverage: z.number().int().min(1).max(125).optional(),
  modelVersionBase: z.string().trim().min(1).optional(),
  aiPromptTemplateId: z.string().trim().min(1).max(128).nullish(),
  compositeStrategyId: z.string().trim().min(1).max(160).nullish(),
  strategyRef: z.object({
    kind: z.enum(["ai", "local", "composite"]),
    id: z.string().trim().min(1).max(160)
  }).nullish()
});

const predictionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  mode: z.enum(["state", "history"]).default("state")
});

const predictionPauseSchema = z.object({
  paused: z.boolean().default(true)
});

const predictionIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const predictionStateQuerySchema = z.object({
  exchange: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  signalMode: z.enum(["local_only", "ai_only", "both"]).optional()
});

const predictionEventsQuerySchema = z.object({
  stateId: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const predictionMetricsQuerySchema = z.object({
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  tf: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  symbol: z.string().trim().min(1).optional(),
  signalSource: z.enum(["local", "ai"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  bins: z.coerce.number().int().min(2).max(20).default(10)
});

const predictionQualityQuerySchema = z.object({
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  tf: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  symbol: z.string().trim().min(1).optional(),
  signalSource: z.enum(["local", "ai"]).optional()
});

const thresholdsLatestQuerySchema = z.object({
  exchange: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]).default("perp"),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  tf: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional()
});

type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type PredictionSignal = "up" | "down" | "neutral";
type DirectionPreference = "long" | "short" | "either";
type AccessSectionPredictionLimitKey =
  | "predictionsLocal"
  | "predictionsAi"
  | "predictionsComposite";
type AccessSectionLimitKey = "bots" | AccessSectionPredictionLimitKey;
type AccessSectionVisibility = {
  tradingDesk: boolean;
  bots: boolean;
  predictionsDashboard: boolean;
  economicCalendar: boolean;
  news: boolean;
  strategy: boolean;
};
type AccessSectionLimits = {
  bots: number | null;
  predictionsLocal: number | null;
  predictionsAi: number | null;
  predictionsComposite: number | null;
};
type StoredAccessSectionSettings = {
  visibility: AccessSectionVisibility;
  limits: AccessSectionLimits;
};
type AccessSectionUsage = {
  bots: number;
  predictionsLocal: number;
  predictionsAi: number;
  predictionsComposite: number;
};
type StoredServerInfoSettings = {
  serverIpAddress: string | null;
};

const PREDICTION_TIMEFRAMES = new Set<PredictionTimeframe>(["5m", "15m", "1h", "4h", "1d"]);
const PREDICTION_MARKET_TYPES = new Set<PredictionMarketType>(["spot", "perp"]);
const PREDICTION_SIGNALS = new Set<PredictionSignal>(["up", "down", "neutral"]);
const PREDICTION_PRIMARY_SIGNAL_SOURCE: PredictionSignalSource =
  String(process.env.PREDICTION_PRIMARY_SIGNAL_SOURCE ?? "local").trim().toLowerCase() === "ai"
    ? "ai"
    : "local";

type DashboardConnectionStatus = "connected" | "degraded" | "disconnected";

type ExchangeAccountOverview = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  status: DashboardConnectionStatus;
  lastSyncAt: string | null;
  spotBudget: { total?: number | null; available?: number | null } | null;
  futuresBudget: { equity?: number | null; availableMargin?: number | null } | null;
  pnlTodayUsd: number | null;
  lastSyncError: { at: string | null; message: string | null } | null;
  bots: { running: number; stopped: number; error: number };
  runningPredictions: number;
  alerts: { hasErrors: boolean; message?: string | null };
};

type DashboardOverviewTotals = {
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  currency: "USDT";
  includedAccounts: number;
};

type DashboardOverviewResponse = {
  accounts: ExchangeAccountOverview[];
  totals: DashboardOverviewTotals;
};

type DashboardPerformanceRange = "24h" | "7d" | "30d";
type DashboardPerformancePoint = {
  ts: string;
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  includedAccounts: number;
};

type DashboardOpenPositionItem = {
  exchangeAccountId: string;
  exchange: string;
  exchangeLabel: string;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  unrealizedPnl: number | null;
};

type RiskSeverity = "critical" | "warning" | "ok";
type RiskTrigger = "dailyLoss" | "margin" | "insufficientData";

type RiskLimitValues = {
  dailyLossWarnPct: number;
  dailyLossWarnUsd: number;
  dailyLossCriticalPct: number;
  dailyLossCriticalUsd: number;
  marginWarnPct: number;
  marginWarnUsd: number;
  marginCriticalPct: number;
  marginCriticalUsd: number;
};

type AccountRiskAssessment = {
  severity: RiskSeverity;
  triggers: RiskTrigger[];
  riskScore: number;
  insufficientData: boolean;
  lossUsd: number;
  lossPct: number | null;
  marginPct: number | null;
  availableMarginUsd: number | null;
  pnlTodayUsd: number | null;
};

type DashboardAlertSeverity = "critical" | "warning" | "info";
type DashboardAlertType =
  | "API_DOWN"
  | "SYNC_FAIL"
  | "BOT_ERROR"
  | "MARGIN_WARN"
  | "CIRCUIT_BREAKER"
  | "AI_PAYLOAD_BUDGET";
type DashboardAlert = {
  id: string;
  severity: DashboardAlertSeverity;
  type: DashboardAlertType;
  title: string;
  message?: string;
  exchange?: string;
  exchangeAccountId?: string;
  botId?: string;
  ts: string;
  link?: string;
};

const DASHBOARD_CONNECTED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_CONNECTED_SECONDS ?? "120") * 1000;
const DASHBOARD_DEGRADED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_DEGRADED_SECONDS ?? "600") * 1000;
const DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS = Math.max(
  60,
  Number(process.env.DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS ?? "300")
);
const DASHBOARD_PERFORMANCE_RANGE_MS: Record<DashboardPerformanceRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};
const DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS: RiskLimitValues = {
  dailyLossWarnPct: 2.5,
  dailyLossWarnUsd: 250,
  dailyLossCriticalPct: 5,
  dailyLossCriticalUsd: 500,
  marginWarnPct: 20,
  marginWarnUsd: 200,
  marginCriticalPct: 10,
  marginCriticalUsd: 100
};
const EXCHANGE_AUTO_SYNC_INTERVAL_MS =
  Math.max(15, Number(process.env.EXCHANGE_AUTO_SYNC_INTERVAL_SECONDS ?? "60")) * 1000;
const EXCHANGE_AUTO_SYNC_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.EXCHANGE_AUTO_SYNC_ENABLED ?? "1").trim().toLowerCase()
);
const BOT_QUEUE_RECOVERY_INTERVAL_MS =
  Math.max(5_000, Number(process.env.BOT_QUEUE_RECOVERY_INTERVAL_MS ?? "30000"));
const PREDICTION_AUTO_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_AUTO_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_AUTO_POLL_MS =
  Math.max(30, Number(process.env.PREDICTION_AUTO_POLL_SECONDS ?? "60")) * 1000;
const PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT =
  Math.max(10, Number(process.env.PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT ?? "300"));
const PREDICTION_AUTO_MAX_RUNS_PER_CYCLE =
  Math.max(1, Number(process.env.PREDICTION_AUTO_MAX_RUNS_PER_CYCLE ?? "25"));
const PREDICTION_OUTCOME_HORIZON_BARS =
  Math.max(2, Number(process.env.PREDICTION_OUTCOME_HORIZON_BARS ?? "12"));
const PREDICTION_OUTCOME_EVAL_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_OUTCOME_EVAL_ENABLED ?? "1").trim().toLowerCase()
);
// Temporary kill switch for TP/SL outcome Telegram alerts.
const PREDICTION_OUTCOME_TELEGRAM_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_OUTCOME_TELEGRAM_ENABLED ?? "0").trim().toLowerCase()
);
const PREDICTION_OUTCOME_EVAL_POLL_MS =
  Math.max(30, Number(process.env.PREDICTION_OUTCOME_EVAL_POLL_SECONDS ?? "60")) * 1000;
const PREDICTION_OUTCOME_EVAL_BATCH_SIZE =
  Math.max(5, Number(process.env.PREDICTION_OUTCOME_EVAL_BATCH_SIZE ?? "50"));
const PREDICTION_EVALUATOR_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_EVALUATOR_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_EVALUATOR_POLL_MS =
  Math.max(60, Number(process.env.PREDICTION_EVALUATOR_POLL_SECONDS ?? "300")) * 1000;
const PREDICTION_EVALUATOR_BATCH_SIZE =
  Math.max(10, Number(process.env.PREDICTION_EVALUATOR_BATCH_SIZE ?? "100"));
const PREDICTION_EVALUATOR_SAFETY_LAG_MS =
  Math.max(0, Number(process.env.PREDICTION_EVALUATOR_SAFETY_LAG_SECONDS ?? "120")) * 1000;
const SETTINGS_SERVER_IP_ADDRESS =
  (typeof process.env.SERVER_PUBLIC_IP === "string" ? process.env.SERVER_PUBLIC_IP : null) ??
  (typeof process.env.PANEL_SERVER_IP === "string" ? process.env.PANEL_SERVER_IP : null) ??
  null;
const DASHBOARD_ALERT_STALE_SYNC_MS =
  Math.max(5 * 60, Number(process.env.DASHBOARD_ALERT_STALE_SYNC_SECONDS ?? "1800")) * 1000;
const DASHBOARD_MARGIN_WARN_RATIO =
  Math.min(1, Math.max(0.01, Number(process.env.DASHBOARD_MARGIN_WARN_RATIO ?? "0.1")));
const PREDICTION_REFRESH_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_REFRESH_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_REFRESH_SCAN_LIMIT =
  Math.max(10, Number(process.env.PREDICTION_REFRESH_SCAN_LIMIT ?? PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT));
const PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE =
  Math.max(1, Number(process.env.PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE ?? PREDICTION_AUTO_MAX_RUNS_PER_CYCLE));
const PREDICTION_REFRESH_TRIGGER_MIN_AGE_MS =
  Math.max(30, Number(process.env.PREDICTION_REFRESH_TRIGGER_MIN_AGE_SECONDS ?? "120")) * 1000;
const PREDICTION_REFRESH_TRIGGER_PROBE_LIMIT =
  Math.max(1, Number(process.env.PREDICTION_REFRESH_TRIGGER_PROBE_LIMIT ?? "25"));
const DEFAULT_PRED_TRIGGER_DEBOUNCE_SEC = Math.max(
  0,
  Number(process.env.PRED_TRIGGER_DEBOUNCE_SEC ?? "90")
);
const DEFAULT_PRED_AI_COOLDOWN_SEC = Math.max(
  30,
  Number(process.env.PRED_AI_COOLDOWN_SEC ?? process.env.PREDICTION_REFRESH_AI_COOLDOWN_SECONDS ?? "300")
);
const DEFAULT_PRED_EVENT_THROTTLE_SEC = Math.max(
  0,
  Number(process.env.PRED_EVENT_THROTTLE_SEC ?? "180")
);
const DEFAULT_PRED_HYSTERESIS_RATIO = clamp(
  Number(process.env.PRED_HYSTERESIS_RATIO ?? "0.6"),
  0.2,
  0.95
);
const DEFAULT_PRED_UNSTABLE_FLIP_LIMIT = Math.max(
  2,
  Number(process.env.PRED_UNSTABLE_FLIP_LIMIT ?? "4")
);
const DEFAULT_PRED_UNSTABLE_FLIP_WINDOW_SECONDS = Math.max(
  60,
  Number(process.env.PRED_UNSTABLE_FLIP_WINDOW_SECONDS ?? "1800")
);
const DEFAULT_PRED_UNSTABLE_FLIP_WINDOW_MS =
  Math.max(60, Number(process.env.PRED_UNSTABLE_FLIP_WINDOW_SECONDS ?? "1800")) * 1000;
const FEATURE_THRESHOLDS_CACHE_TTL_MS =
  Math.max(30, Number(process.env.FEATURE_THRESHOLDS_CACHE_TTL_SECONDS ?? "600")) * 1000;
const FEATURE_THRESHOLDS_WINSORIZE_PCT = clamp(
  Number(process.env.FEATURE_THRESHOLDS_WINSORIZE_PCT ?? "0.01"),
  0,
  0.25
);
const FEATURE_THRESHOLDS_MAX_GAP_RATIO = clamp(
  Number(process.env.FEATURE_THRESHOLDS_MAX_GAP_RATIO ?? "0.05"),
  0,
  1
);
const FEATURE_THRESHOLDS_CALIBRATION_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.FEATURE_THRESHOLDS_CALIBRATION_ENABLED ?? "1").trim().toLowerCase()
);
const FEATURE_THRESHOLDS_CALIBRATION_SCAN_MS =
  Math.max(5, Number(process.env.FEATURE_THRESHOLDS_CALIBRATION_SCAN_MINUTES ?? "10")) * 60 * 1000;
const FEATURE_THRESHOLDS_SYMBOLS = String(
  process.env.FEATURE_THRESHOLDS_SYMBOLS ?? "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT"
)
  .split(",")
  .map((item) => normalizeSymbolInput(item))
  .filter((item): item is string => Boolean(item));
const FEATURE_THRESHOLDS_TIMEFRAMES = String(
  process.env.FEATURE_THRESHOLDS_TIMEFRAMES ?? "5m,15m,1h,4h,1d"
)
  .split(",")
  .map((item) => item.trim())
  .filter((item): item is ThresholdTimeframe =>
    ["5m", "15m", "1h", "4h", "1d"].includes(item)
  );
const FEATURE_THRESHOLDS_MARKET_TYPES = String(
  process.env.FEATURE_THRESHOLDS_MARKET_TYPES ?? "perp"
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter((item): item is ThresholdMarketType => item === "spot" || item === "perp");

const GLOBAL_SETTING_EXCHANGES_KEY = "admin.exchanges";
const GLOBAL_SETTING_SMTP_KEY = "admin.smtp";
const GLOBAL_SETTING_SECURITY_KEY = "settings.security";
const GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY = "settings.securityUserOverrides.v1";
const GLOBAL_SETTING_API_KEYS_KEY = "admin.apiKeys";
const GLOBAL_SETTING_PREDICTION_REFRESH_KEY = "admin.predictionRefresh";
const GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY = "admin.predictionDefaults";
const GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY = "admin.backendAccess";
const GLOBAL_SETTING_ACCESS_SECTION_KEY = "admin.accessSection.v1";
const GLOBAL_SETTING_SERVER_INFO_KEY = "admin.serverInfo.v1";
const GLOBAL_SETTING_AI_PROMPTS_KEY = AI_PROMPT_SETTINGS_GLOBAL_SETTING_KEY;
const GLOBAL_SETTING_AI_TRACE_KEY = AI_TRACE_SETTINGS_GLOBAL_SETTING_KEY;
const GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY = "predictions.performanceResetByUser.v1";
const DEFAULT_PREDICTION_SIGNAL_MODE = normalizePredictionSignalMode(
  process.env.PREDICTION_DEFAULT_SIGNAL_MODE
);
const DEFAULT_ACCESS_SECTION_SETTINGS: StoredAccessSectionSettings = {
  visibility: {
    tradingDesk: true,
    bots: true,
    predictionsDashboard: true,
    economicCalendar: true,
    news: true,
    strategy: true
  },
  limits: {
    bots: null,
    predictionsLocal: null,
    predictionsAi: null,
    predictionsComposite: null
  }
};
const SUPERADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@utrade.vip").trim().toLowerCase();
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "TempAdmin1234!";
const PASSWORD_RESET_PURPOSE = "password_reset";
const PASSWORD_RESET_OTP_TTL_MIN = Math.max(
  5,
  Number(process.env.PASSWORD_RESET_OTP_TTL_MIN ?? "15")
);

const EXCHANGE_OPTION_CATALOG = [
  { value: "bitget", label: "Bitget (Futures)" },
  { value: "hyperliquid", label: "Hyperliquid (Perps)" },
  { value: "mexc", label: "MEXC (Legacy)" },
  { value: "paper", label: "Paper (Simulated Trading)" }
] as const;

type ExchangeOption = (typeof EXCHANGE_OPTION_CATALOG)[number];

const EXCHANGE_OPTION_VALUES = new Set(EXCHANGE_OPTION_CATALOG.map((row) => row.value));

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

type AiPredictionSnapshot = {
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
};

type PredictionStrategyKind = "ai" | "local" | "composite";

type PredictionStrategyRef = {
  kind: PredictionStrategyKind;
  id: string;
  name: string | null;
};

type PredictionStateStrategyScope = {
  strategyKind: string;
  strategyId: string;
};

function normalizeSnapshotPrediction(value: Record<string, unknown>): AiPredictionSnapshot | null {
  const signal =
    value.signal === "up" || value.signal === "down" || value.signal === "neutral"
      ? value.signal
      : null;
  const expectedMoveRaw = Number(value.expectedMovePct);
  const confidenceRaw = Number(value.confidence);
  if (!signal || !Number.isFinite(expectedMoveRaw) || !Number.isFinite(confidenceRaw)) return null;
  const confidenceNormalized = confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100;
  return {
    signal,
    expectedMovePct: Number(clamp(Math.abs(expectedMoveRaw), 0, 25).toFixed(2)),
    confidence: Number(clamp(confidenceNormalized, 0, 1).toFixed(4))
  };
}

function readAiPredictionSnapshot(snapshot: Record<string, unknown>): AiPredictionSnapshot | null {
  return normalizeSnapshotPrediction(asRecord(snapshot.aiPrediction));
}

function readLocalPredictionSnapshot(snapshot: Record<string, unknown>): AiPredictionSnapshot | null {
  return normalizeSnapshotPrediction(asRecord(snapshot.localPrediction));
}

function readSelectedSignalSource(snapshot: Record<string, unknown>): PredictionSignalSource {
  return snapshot.selectedSignalSource === "ai" ? "ai" : "local";
}

function normalizePredictionSignalMode(value: unknown): PredictionSignalMode {
  if (value === "local_only" || value === "ai_only" || value === "both") return value;
  if (value === "local") return "local_only";
  if (value === "ai") return "ai_only";
  return "both";
}

function readSignalMode(snapshot: Record<string, unknown>): PredictionSignalMode {
  return normalizePredictionSignalMode(snapshot.signalMode);
}

function readAiPromptTemplateId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.aiPromptTemplateId !== "string") return null;
  const trimmed = snapshot.aiPromptTemplateId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAiPromptTemplateName(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.aiPromptTemplateName !== "string") return null;
  const trimmed = snapshot.aiPromptTemplateName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAiPromptMarketAnalysisUpdateEnabled(snapshot: Record<string, unknown>): boolean {
  const raw = snapshot.aiPromptMarketAnalysisUpdateEnabled;
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "1" || raw === 1) return true;
  if (raw === "false" || raw === "0" || raw === 0) return false;
  return false;
}

function readLocalStrategyId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.localStrategyId !== "string") return null;
  const trimmed = snapshot.localStrategyId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLocalStrategyName(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.localStrategyName !== "string") return null;
  const trimmed = snapshot.localStrategyName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCompositeStrategyId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.compositeStrategyId !== "string") return null;
  const trimmed = snapshot.compositeStrategyId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCompositeStrategyName(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.compositeStrategyName !== "string") return null;
  const trimmed = snapshot.compositeStrategyName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePredictionStrategyKind(value: unknown): PredictionStrategyKind | null {
  if (value === "ai" || value === "local" || value === "composite") return value;
  return null;
}

function readPredictionStrategyRef(snapshot: Record<string, unknown>): PredictionStrategyRef | null {
  const direct = asRecord(snapshot.strategyRef);
  const directKind = normalizePredictionStrategyKind(direct.kind);
  const directId = typeof direct.id === "string" ? direct.id.trim() : "";
  if (directKind && directId) {
    return {
      kind: directKind,
      id: directId,
      name: typeof direct.name === "string" && direct.name.trim() ? direct.name.trim() : null
    };
  }

  const compositeId = readCompositeStrategyId(snapshot);
  if (compositeId) {
    return {
      kind: "composite",
      id: compositeId,
      name: readCompositeStrategyName(snapshot)
    };
  }

  const localId = readLocalStrategyId(snapshot);
  if (localId) {
    return {
      kind: "local",
      id: localId,
      name: readLocalStrategyName(snapshot)
    };
  }

  const aiId = readAiPromptTemplateId(snapshot);
  if (aiId) {
    return {
      kind: "ai",
      id: aiId,
      name: readAiPromptTemplateName(snapshot)
    };
  }
  return null;
}

function resolveNotificationStrategyName(params: {
  signalSource: PredictionSignalSource;
  snapshot?: Record<string, unknown> | null;
  strategyRef?: PredictionStrategyRef | null;
  aiPromptTemplateName?: string | null;
}): string | null {
  const snapshot = params.snapshot ?? null;
  const strategyRef = params.strategyRef ?? (snapshot ? readPredictionStrategyRef(snapshot) : null);
  const strategyName =
    typeof strategyRef?.name === "string" && strategyRef.name.trim()
      ? strategyRef.name.trim()
      : null;

  if (params.signalSource === "local") {
    if (strategyRef?.kind === "local" || strategyRef?.kind === "composite") {
      return strategyName;
    }
    if (snapshot) {
      return readLocalStrategyName(snapshot) ?? readCompositeStrategyName(snapshot);
    }
    return null;
  }

  if (strategyRef?.kind === "ai" && strategyName) {
    return strategyName;
  }
  if (typeof params.aiPromptTemplateName === "string" && params.aiPromptTemplateName.trim()) {
    return params.aiPromptTemplateName.trim();
  }
  if (snapshot) {
    return readAiPromptTemplateName(snapshot);
  }
  return null;
}

function toPredictionStateStrategyScope(
  strategyRef: PredictionStrategyRef | null | undefined
): PredictionStateStrategyScope {
  if (!strategyRef || !strategyRef.id?.trim()) {
    return {
      strategyKind: "legacy",
      strategyId: "legacy"
    };
  }
  return {
    strategyKind: strategyRef.kind,
    strategyId: strategyRef.id.trim()
  };
}

function readStateSignalMode(
  signalModeValue: unknown,
  snapshot: Record<string, unknown>
): PredictionSignalMode {
  if (
    signalModeValue === "local_only"
    || signalModeValue === "ai_only"
    || signalModeValue === "both"
  ) {
    return signalModeValue;
  }
  return readSignalMode(snapshot);
}

function resolvePreferredSignalSourceForMode(
  mode: PredictionSignalMode,
  fallback: PredictionSignalSource
): PredictionSignalSource {
  if (mode === "local_only") return "local";
  if (mode === "ai_only") return "ai";
  return fallback;
}

function resolveStrategyBoundSignalMode(
  baseMode: PredictionSignalMode,
  strategyKind: "ai" | "local" | "composite" | null
): PredictionSignalMode {
  if (strategyKind === "local") return "local_only";
  if (strategyKind === "ai") return "ai_only";
  return baseMode;
}

function withPredictionSnapshots(params: {
  snapshot: Record<string, unknown>;
  localPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  };
  aiPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  } | null;
  selectedSignalSource: PredictionSignalSource;
  signalMode: PredictionSignalMode;
}): Record<string, unknown> {
  return {
    ...params.snapshot,
    localPrediction: normalizeSnapshotPrediction(asRecord(params.localPrediction)) ?? params.localPrediction,
    aiPrediction: params.aiPrediction
      ? (normalizeSnapshotPrediction(asRecord(params.aiPrediction)) ?? params.aiPrediction)
      : null,
    selectedSignalSource: params.selectedSignalSource,
    signalMode: params.signalMode
  };
}

function selectPredictionBySource(params: {
  localPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  };
  aiPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  };
  source: PredictionSignalSource;
}): {
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
  source: PredictionSignalSource;
} {
  if (params.source === "ai") {
    return {
      signal: params.aiPrediction.signal,
      expectedMovePct: params.aiPrediction.expectedMovePct,
      confidence: params.aiPrediction.confidence,
      source: "ai"
    };
  }
  return {
    signal: params.localPrediction.signal,
    expectedMovePct: params.localPrediction.expectedMovePct,
    confidence: params.localPrediction.confidence,
    source: "local"
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeIndicatorSettingExchange(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIndicatorSettingAccountId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIndicatorSettingSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeSymbolInput(value);
  return normalized ?? null;
}

function normalizeIndicatorSettingTimeframe(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toIndicatorComputeSettings(config: IndicatorSettingsConfig) {
  return {
    enabledPacks: {
      indicatorsV1: config.enabledPacks.indicatorsV1,
      indicatorsV2: config.enabledPacks.indicatorsV2
    },
    stochrsi: {
      rsiLen: config.indicatorsV2.stochrsi.rsiLen,
      stochLen: config.indicatorsV2.stochrsi.stochLen,
      smoothK: config.indicatorsV2.stochrsi.smoothK,
      smoothD: config.indicatorsV2.stochrsi.smoothD
    },
    volume: {
      lookback: config.indicatorsV2.volume.lookback,
      emaFast: config.indicatorsV2.volume.emaFast,
      emaSlow: config.indicatorsV2.volume.emaSlow
    },
    fvg: {
      lookback: config.indicatorsV2.fvg.lookback,
      fillRule: config.indicatorsV2.fvg.fillRule
    },
    vumanchu: {
      wtChannelLen: config.indicatorsV2.vumanchu.wtChannelLen,
      wtAverageLen: config.indicatorsV2.vumanchu.wtAverageLen,
      wtMaLen: config.indicatorsV2.vumanchu.wtMaLen,
      obLevel: config.indicatorsV2.vumanchu.obLevel,
      osLevel: config.indicatorsV2.vumanchu.osLevel,
      osLevel3: config.indicatorsV2.vumanchu.osLevel3,
      wtDivObLevel: config.indicatorsV2.vumanchu.wtDivObLevel,
      wtDivOsLevel: config.indicatorsV2.vumanchu.wtDivOsLevel,
      wtDivObLevelAdd: config.indicatorsV2.vumanchu.wtDivObLevelAdd,
      wtDivOsLevelAdd: config.indicatorsV2.vumanchu.wtDivOsLevelAdd,
      rsiLen: config.indicatorsV2.vumanchu.rsiLen,
      rsiMfiPeriod: config.indicatorsV2.vumanchu.rsiMfiPeriod,
      rsiMfiMultiplier: config.indicatorsV2.vumanchu.rsiMfiMultiplier,
      rsiMfiPosY: config.indicatorsV2.vumanchu.rsiMfiPosY,
      stochLen: config.indicatorsV2.vumanchu.stochLen,
      stochRsiLen: config.indicatorsV2.vumanchu.stochRsiLen,
      stochKSmooth: config.indicatorsV2.vumanchu.stochKSmooth,
      stochDSmooth: config.indicatorsV2.vumanchu.stochDSmooth,
      useHiddenDiv: config.indicatorsV2.vumanchu.useHiddenDiv,
      useHiddenDivNoLimits: config.indicatorsV2.vumanchu.useHiddenDivNoLimits,
      goldRsiThreshold: config.indicatorsV2.vumanchu.goldRsiThreshold,
      goldWtDiffMin: config.indicatorsV2.vumanchu.goldWtDiffMin
    },
    breakerBlocks: {
      len: config.indicatorsV2.breakerBlocks.len,
      breakerCandleOnlyBody: config.indicatorsV2.breakerBlocks.breakerCandleOnlyBody,
      breakerCandle2Last: config.indicatorsV2.breakerBlocks.breakerCandle2Last,
      tillFirstBreak: config.indicatorsV2.breakerBlocks.tillFirstBreak,
      onlyWhenInPDarray: config.indicatorsV2.breakerBlocks.onlyWhenInPDarray,
      showPDarray: config.indicatorsV2.breakerBlocks.showPDarray,
      showBreaks: config.indicatorsV2.breakerBlocks.showBreaks,
      showSPD: config.indicatorsV2.breakerBlocks.showSPD,
      pdTextColor: config.indicatorsV2.breakerBlocks.pdTextColor,
      pdSwingLineColor: config.indicatorsV2.breakerBlocks.pdSwingLineColor,
      enableTp: config.indicatorsV2.breakerBlocks.enableTp,
      tpColor: config.indicatorsV2.breakerBlocks.tpColor,
      rrTp1: config.indicatorsV2.breakerBlocks.rrTp1,
      rrTp2: config.indicatorsV2.breakerBlocks.rrTp2,
      rrTp3: config.indicatorsV2.breakerBlocks.rrTp3,
      bbPlusColorA: config.indicatorsV2.breakerBlocks.bbPlusColorA,
      bbPlusColorB: config.indicatorsV2.breakerBlocks.bbPlusColorB,
      swingBullColor: config.indicatorsV2.breakerBlocks.swingBullColor,
      bbMinusColorA: config.indicatorsV2.breakerBlocks.bbMinusColorA,
      bbMinusColorB: config.indicatorsV2.breakerBlocks.bbMinusColorB,
      swingBearColor: config.indicatorsV2.breakerBlocks.swingBearColor
    },
    superOrderBlockFvgBos: {
      plotOB: config.indicatorsV2.superOrderBlockFvgBos.plotOB,
      obBullColor: config.indicatorsV2.superOrderBlockFvgBos.obBullColor,
      obBearColor: config.indicatorsV2.superOrderBlockFvgBos.obBearColor,
      obBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.obBoxBorderStyle,
      obBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.obBorderTransparency,
      obMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.obMaxBoxSet,
      filterMitOB: config.indicatorsV2.superOrderBlockFvgBos.filterMitOB,
      mitOBColor: config.indicatorsV2.superOrderBlockFvgBos.mitOBColor,
      plotFVG: config.indicatorsV2.superOrderBlockFvgBos.plotFVG,
      plotStructureBreakingFVG: config.indicatorsV2.superOrderBlockFvgBos.plotStructureBreakingFVG,
      fvgBullColor: config.indicatorsV2.superOrderBlockFvgBos.fvgBullColor,
      fvgBearColor: config.indicatorsV2.superOrderBlockFvgBos.fvgBearColor,
      fvgStructBreakingColor: config.indicatorsV2.superOrderBlockFvgBos.fvgStructBreakingColor,
      fvgBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.fvgBoxBorderStyle,
      fvgBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.fvgBorderTransparency,
      fvgMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.fvgMaxBoxSet,
      filterMitFVG: config.indicatorsV2.superOrderBlockFvgBos.filterMitFVG,
      mitFVGColor: config.indicatorsV2.superOrderBlockFvgBos.mitFVGColor,
      plotRJB: config.indicatorsV2.superOrderBlockFvgBos.plotRJB,
      rjbBullColor: config.indicatorsV2.superOrderBlockFvgBos.rjbBullColor,
      rjbBearColor: config.indicatorsV2.superOrderBlockFvgBos.rjbBearColor,
      rjbBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.rjbBoxBorderStyle,
      rjbBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.rjbBorderTransparency,
      rjbMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.rjbMaxBoxSet,
      filterMitRJB: config.indicatorsV2.superOrderBlockFvgBos.filterMitRJB,
      mitRJBColor: config.indicatorsV2.superOrderBlockFvgBos.mitRJBColor,
      plotPVT: config.indicatorsV2.superOrderBlockFvgBos.plotPVT,
      pivotLookup: config.indicatorsV2.superOrderBlockFvgBos.pivotLookup,
      pvtTopColor: config.indicatorsV2.superOrderBlockFvgBos.pvtTopColor,
      pvtBottomColor: config.indicatorsV2.superOrderBlockFvgBos.pvtBottomColor,
      plotBOS: config.indicatorsV2.superOrderBlockFvgBos.plotBOS,
      useHighLowForBullishBoS: config.indicatorsV2.superOrderBlockFvgBos.useHighLowForBullishBoS,
      useHighLowForBearishBoS: config.indicatorsV2.superOrderBlockFvgBos.useHighLowForBearishBoS,
      bosBoxFlag: config.indicatorsV2.superOrderBlockFvgBos.bosBoxFlag,
      bosBoxLength: config.indicatorsV2.superOrderBlockFvgBos.bosBoxLength,
      bosBullColor: config.indicatorsV2.superOrderBlockFvgBos.bosBullColor,
      bosBearColor: config.indicatorsV2.superOrderBlockFvgBos.bosBearColor,
      bosBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.bosBoxBorderStyle,
      bosBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.bosBorderTransparency,
      bosMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.bosMaxBoxSet,
      plotHVB: config.indicatorsV2.superOrderBlockFvgBos.plotHVB,
      hvbBullColor: config.indicatorsV2.superOrderBlockFvgBos.hvbBullColor,
      hvbBearColor: config.indicatorsV2.superOrderBlockFvgBos.hvbBearColor,
      hvbEMAPeriod: config.indicatorsV2.superOrderBlockFvgBos.hvbEMAPeriod,
      hvbMultiplier: config.indicatorsV2.superOrderBlockFvgBos.hvbMultiplier,
      plotPPDD: config.indicatorsV2.superOrderBlockFvgBos.plotPPDD,
      ppddBullColor: config.indicatorsV2.superOrderBlockFvgBos.ppddBullColor,
      ppddBearColor: config.indicatorsV2.superOrderBlockFvgBos.ppddBearColor,
      plotOBFVG: config.indicatorsV2.superOrderBlockFvgBos.plotOBFVG,
      obfvgBullColor: config.indicatorsV2.superOrderBlockFvgBos.obfvgBullColor,
      obfvgBearColor: config.indicatorsV2.superOrderBlockFvgBos.obfvgBearColor,
      plotLabelOB: config.indicatorsV2.superOrderBlockFvgBos.plotLabelOB,
      obLabelColor: config.indicatorsV2.superOrderBlockFvgBos.obLabelColor,
      obLabelSize: config.indicatorsV2.superOrderBlockFvgBos.obLabelSize,
      plotLabelFVG: config.indicatorsV2.superOrderBlockFvgBos.plotLabelFVG,
      fvgLabelColor: config.indicatorsV2.superOrderBlockFvgBos.fvgLabelColor,
      fvgLabelSize: config.indicatorsV2.superOrderBlockFvgBos.fvgLabelSize,
      plotLabelRJB: config.indicatorsV2.superOrderBlockFvgBos.plotLabelRJB,
      rjbLabelColor: config.indicatorsV2.superOrderBlockFvgBos.rjbLabelColor,
      rjbLabelSize: config.indicatorsV2.superOrderBlockFvgBos.rjbLabelSize,
      plotLabelBOS: config.indicatorsV2.superOrderBlockFvgBos.plotLabelBOS,
      bosLabelColor: config.indicatorsV2.superOrderBlockFvgBos.bosLabelColor,
      bosLabelSize: config.indicatorsV2.superOrderBlockFvgBos.bosLabelSize
    }
  };
}

function toAdvancedIndicatorComputeSettings(config: IndicatorSettingsConfig) {
  return {
    enabled: config.enabledPacks.advancedIndicators,
    adrLen: config.advancedIndicators.adrLen,
    awrLen: config.advancedIndicators.awrLen,
    amrLen: config.advancedIndicators.amrLen,
    rdLen: config.advancedIndicators.rdLen,
    rwLen: config.advancedIndicators.rwLen,
    openingRangeMinutes: config.advancedIndicators.openingRangeMin,
    sessionsUseDST: config.advancedIndicators.sessionsUseDST,
    smcInternalLength: config.advancedIndicators.smcInternalLength,
    smcSwingLength: config.advancedIndicators.smcSwingLength,
    smcEqualLength: config.advancedIndicators.smcEqualLength,
    smcEqualThreshold: config.advancedIndicators.smcEqualThreshold,
    smcMaxOrderBlocks: config.advancedIndicators.smcMaxOrderBlocks,
    smcFvgAutoThreshold: config.advancedIndicators.smcFvgAutoThreshold,
    liquiditySweepsEnabled: config.enabledPacks.liquiditySweeps,
    liquiditySweepLen: config.liquiditySweeps.len,
    liquiditySweepMode: config.liquiditySweeps.mode,
    liquiditySweepExtend: config.liquiditySweeps.extend,
    liquiditySweepMaxBars: config.liquiditySweeps.maxBars,
    liquiditySweepMaxRecentEvents: config.liquiditySweeps.maxRecentEvents,
    liquiditySweepMaxActiveZones: config.liquiditySweeps.maxActiveZones
  };
}

function normalizeExchangeValue(value: string): string {
  return value.trim().toLowerCase();
}

function isSuperadminEmail(email: string): boolean {
  return email.trim().toLowerCase() === SUPERADMIN_EMAIL;
}

function generateTempPassword() {
  const raw = crypto.randomBytes(9).toString("base64url");
  return `Tmp-${raw.slice(0, 10)}!`;
}

function generateNumericCode(length = 6): string {
  const max = 10 ** length;
  const random = crypto.randomInt(0, max);
  return String(random).padStart(length, "0");
}

function hashOneTimeCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function getGlobalSettingValue(key: string): Promise<unknown> {
  const row = await db.globalSetting.findUnique({
    where: { key },
    select: { value: true }
  });
  return row?.value;
}

function parseStoredAdminBackendAccess(value: unknown): { userIds: string[] } {
  const record = parseJsonObject(value);
  const raw = Array.isArray(record.userIds) ? record.userIds : [];
  const userIds = Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
  return { userIds };
}

function parsePredictionPerformanceResetMap(value: unknown): { byUserId: Record<string, string> } {
  const record = parseJsonObject(value);
  const rawByUserId = parseJsonObject(record.byUserId);
  const byUserId: Record<string, string> = {};
  for (const [userId, rawIso] of Object.entries(rawByUserId)) {
    if (typeof rawIso !== "string") continue;
    const parsed = new Date(rawIso);
    if (Number.isNaN(parsed.getTime())) continue;
    byUserId[userId] = parsed.toISOString();
  }
  return { byUserId };
}

function normalizeServerIpAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 255);
}

function parseStoredServerInfoSettings(value: unknown): StoredServerInfoSettings {
  const record = parseJsonObject(value);
  return {
    serverIpAddress: normalizeServerIpAddress(record.serverIpAddress)
  };
}

function normalizeAccessSectionLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized < 0) return null;
  return normalized;
}

function parseStoredAccessSectionSettings(value: unknown): StoredAccessSectionSettings {
  const record = parseJsonObject(value);
  const visibilityRaw = parseJsonObject(record.visibility);
  const limitsRaw = parseJsonObject(record.limits);

  return {
    visibility: {
      tradingDesk: asBoolean(
        visibilityRaw.tradingDesk,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.tradingDesk
      ),
      bots: asBoolean(visibilityRaw.bots, DEFAULT_ACCESS_SECTION_SETTINGS.visibility.bots),
      predictionsDashboard: asBoolean(
        visibilityRaw.predictionsDashboard,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.predictionsDashboard
      ),
      economicCalendar: asBoolean(
        visibilityRaw.economicCalendar,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.economicCalendar
      ),
      news: asBoolean(
        visibilityRaw.news,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.news
      ),
      strategy: asBoolean(
        visibilityRaw.strategy,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.strategy
      )
    },
    limits: {
      bots: normalizeAccessSectionLimit(limitsRaw.bots),
      predictionsLocal: normalizeAccessSectionLimit(limitsRaw.predictionsLocal),
      predictionsAi: normalizeAccessSectionLimit(limitsRaw.predictionsAi),
      predictionsComposite: normalizeAccessSectionLimit(limitsRaw.predictionsComposite)
    }
  };
}

function toEffectiveAccessSectionSettings(
  stored: StoredAccessSectionSettings | null | undefined
): StoredAccessSectionSettings {
  if (!stored) return DEFAULT_ACCESS_SECTION_SETTINGS;
  return {
    visibility: {
      tradingDesk: Boolean(stored.visibility?.tradingDesk),
      bots: Boolean(stored.visibility?.bots),
      predictionsDashboard: Boolean(stored.visibility?.predictionsDashboard),
      economicCalendar: Boolean(stored.visibility?.economicCalendar),
      news: Boolean(stored.visibility?.news),
      strategy: Boolean(stored.visibility?.strategy)
    },
    limits: {
      bots: normalizeAccessSectionLimit(stored.limits?.bots),
      predictionsLocal: normalizeAccessSectionLimit(stored.limits?.predictionsLocal),
      predictionsAi: normalizeAccessSectionLimit(stored.limits?.predictionsAi),
      predictionsComposite: normalizeAccessSectionLimit(stored.limits?.predictionsComposite)
    }
  };
}

function createEmptyAccessSectionUsage(): AccessSectionUsage {
  return {
    bots: 0,
    predictionsLocal: 0,
    predictionsAi: 0,
    predictionsComposite: 0
  };
}

function computeRemaining(limit: number | null, usage: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - Math.max(0, Math.trunc(usage)));
}

function resolvePredictionLimitBucketFromStrategy(params: {
  strategyRef?: PredictionStrategyRef | null;
  signalMode?: PredictionSignalMode;
}): AccessSectionPredictionLimitKey {
  const kind = params.strategyRef?.kind ?? null;
  if (kind === "local") return "predictionsLocal";
  if (kind === "composite") return "predictionsComposite";
  if (kind === "ai") return "predictionsAi";
  const mode = normalizePredictionSignalMode(params.signalMode);
  if (mode === "local_only") return "predictionsLocal";
  return "predictionsAi";
}

function resolvePredictionLimitBucketFromStateRow(row: {
  featuresSnapshot: unknown;
  signalMode: unknown;
}): AccessSectionPredictionLimitKey {
  const snapshot = asRecord(row.featuresSnapshot);
  const strategyRef = readPredictionStrategyRef(snapshot);
  const signalMode =
    row.signalMode === "local_only" || row.signalMode === "ai_only" || row.signalMode === "both"
      ? row.signalMode
      : readSignalMode(snapshot);
  return resolvePredictionLimitBucketFromStrategy({
    strategyRef,
    signalMode
  });
}

function predictionLimitExceededCode(bucket: AccessSectionPredictionLimitKey): string {
  if (bucket === "predictionsLocal") return "prediction_create_limit_exceeded_local";
  if (bucket === "predictionsComposite") return "prediction_create_limit_exceeded_composite";
  return "prediction_create_limit_exceeded_ai";
}

async function getAccessSectionSettings(): Promise<StoredAccessSectionSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_ACCESS_SECTION_KEY },
    select: { value: true }
  });
  return toEffectiveAccessSectionSettings(parseStoredAccessSectionSettings(row?.value));
}

async function getAccessSectionUsageForUser(userId: string): Promise<AccessSectionUsage> {
  const [botsCount, predictionStates] = await Promise.all([
    db.bot.count({ where: { userId } }),
    db.predictionState.findMany({
      where: {
        userId,
        autoScheduleEnabled: true
      },
      select: {
        featuresSnapshot: true,
        signalMode: true
      }
    })
  ]);

  const usage = createEmptyAccessSectionUsage();
  usage.bots = botsCount;
  for (const row of predictionStates) {
    const bucket = resolvePredictionLimitBucketFromStateRow(row);
    usage[bucket] += 1;
  }
  return usage;
}

async function evaluateAccessSectionBypassForUser(
  user: { id: string; email: string }
): Promise<boolean> {
  const ctx = await resolveUserContext(user);
  return Boolean(ctx.hasAdminBackendAccess);
}

async function isStrategyFeatureEnabledForUser(
  user: { id: string; email: string }
): Promise<boolean> {
  const bypass = await evaluateAccessSectionBypassForUser(user);
  if (bypass) return true;
  const settings = await getAccessSectionSettings();
  return Boolean(settings.visibility.strategy);
}

async function canCreateBotForUser(params: {
  userId: string;
  bypass: boolean;
}): Promise<{ allowed: boolean; limit: number | null; usage: number; remaining: number | null }> {
  if (params.bypass) {
    return { allowed: true, limit: null, usage: 0, remaining: null };
  }
  const settings = await getAccessSectionSettings();
  const limit = settings.limits.bots;
  if (limit === null) {
    return { allowed: true, limit: null, usage: 0, remaining: null };
  }
  const usage = await db.bot.count({ where: { userId: params.userId } });
  return {
    allowed: usage < limit,
    limit,
    usage,
    remaining: computeRemaining(limit, usage)
  };
}

async function canCreatePredictionForUser(params: {
  userId: string;
  bypass: boolean;
  bucket: AccessSectionPredictionLimitKey;
  existingStateId: string | null;
  consumesSlot: boolean;
}): Promise<{ allowed: boolean; limit: number | null; usage: number; remaining: number | null }> {
  if (params.bypass || !params.consumesSlot || params.existingStateId) {
    return { allowed: true, limit: null, usage: 0, remaining: null };
  }
  const settings = await getAccessSectionSettings();
  const limit = settings.limits[params.bucket];
  if (limit === null) {
    return { allowed: true, limit: null, usage: 0, remaining: null };
  }
  const usage = (await getAccessSectionUsageForUser(params.userId))[params.bucket];
  return {
    allowed: usage < limit,
    limit,
    usage,
    remaining: computeRemaining(limit, usage)
  };
}

async function getPredictionPerformanceResetAt(userId: string): Promise<Date | null> {
  const stored = parsePredictionPerformanceResetMap(
    await getGlobalSettingValue(GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY)
  );
  const raw = stored.byUserId[userId];
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function setPredictionPerformanceResetAt(userId: string, nowIso: string): Promise<string> {
  const stored = parsePredictionPerformanceResetMap(
    await getGlobalSettingValue(GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY)
  );
  const parsedNow = new Date(nowIso);
  const normalizedNow = Number.isNaN(parsedNow.getTime())
    ? new Date().toISOString()
    : parsedNow.toISOString();
  stored.byUserId[userId] = normalizedNow;
  await setGlobalSettingValue(GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY, stored);
  return normalizedNow;
}

async function getAdminBackendAccessUserIdSet(): Promise<Set<string>> {
  const stored = parseStoredAdminBackendAccess(
    await getGlobalSettingValue(GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY)
  );
  return new Set(stored.userIds);
}

async function hasAdminBackendAccess(user: { id: string; email: string }): Promise<boolean> {
  if (isSuperadminEmail(user.email)) return true;
  const ids = await getAdminBackendAccessUserIdSet();
  return ids.has(user.id);
}

async function setGlobalSettingValue(key: string, value: unknown) {
  return db.globalSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
    select: { key: true, value: true, updatedAt: true }
  });
}

async function getServerInfoSettings(): Promise<{
  serverIpAddress: string | null;
  updatedAt: string | null;
  source: "db" | "env" | "none";
  defaults: { serverIpAddress: string | null };
}> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_SERVER_INFO_KEY },
    select: { value: true, updatedAt: true }
  });
  const stored = parseStoredServerInfoSettings(row?.value);
  const envDefault = normalizeServerIpAddress(SETTINGS_SERVER_IP_ADDRESS);
  const effective = stored.serverIpAddress ?? envDefault;
  const source: "db" | "env" | "none" = stored.serverIpAddress
    ? "db"
    : envDefault
      ? "env"
      : "none";
  return {
    serverIpAddress: effective,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    source,
    defaults: { serverIpAddress: envDefault }
  };
}

async function getAllowedExchangeValues(): Promise<string[]> {
  const configured = asStringArray(await getGlobalSettingValue(GLOBAL_SETTING_EXCHANGES_KEY))
    .map(normalizeExchangeValue)
    .filter((value) => EXCHANGE_OPTION_VALUES.has(value as ExchangeOption["value"]));
  if (configured.length > 0) return Array.from(new Set(configured));
  return EXCHANGE_OPTION_CATALOG.map((row) => row.value);
}

function getExchangeOptionsResponse(allowedValues: string[]) {
  const allowed = new Set(allowedValues.map(normalizeExchangeValue));
  return EXCHANGE_OPTION_CATALOG.map((row) => ({
    value: row.value,
    label: row.label,
    enabled: allowed.has(row.value)
  }));
}

async function getSecurityGlobalSettings() {
  const raw = parseJsonObject(await getGlobalSettingValue(GLOBAL_SETTING_SECURITY_KEY));
  return {
    reauthOtpEnabled: asBoolean(raw.reauthOtpEnabled, true)
  };
}

async function setSecurityGlobalSettings(next: { reauthOtpEnabled: boolean }) {
  return setGlobalSettingValue(GLOBAL_SETTING_SECURITY_KEY, {
    reauthOtpEnabled: next.reauthOtpEnabled
  });
}

function parseStoredSecurityUserOverrides(value: unknown): StoredSecurityUserOverrides {
  const record = parseJsonObject(value);
  const rawByUserId = parseJsonObject(record.reauthOtpEnabledByUserId);
  const reauthOtpEnabledByUserId: Record<string, boolean> = {};
  for (const [userId, rawValue] of Object.entries(rawByUserId)) {
    if (typeof userId !== "string" || !userId.trim()) continue;
    if (typeof rawValue !== "boolean") continue;
    reauthOtpEnabledByUserId[userId] = rawValue;
  }
  return { reauthOtpEnabledByUserId };
}

async function getSecurityUserReauthOverride(userId: string): Promise<boolean | null> {
  const stored = parseStoredSecurityUserOverrides(
    await getGlobalSettingValue(GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY)
  );
  if (Object.prototype.hasOwnProperty.call(stored.reauthOtpEnabledByUserId, userId)) {
    return stored.reauthOtpEnabledByUserId[userId];
  }
  return null;
}

async function setSecurityUserReauthOverride(userId: string, enabled: boolean): Promise<void> {
  const stored = parseStoredSecurityUserOverrides(
    await getGlobalSettingValue(GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY)
  );
  stored.reauthOtpEnabledByUserId[userId] = Boolean(enabled);
  await setGlobalSettingValue(GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY, stored);
}

type StoredSmtpSettings = {
  host: string | null;
  port: number | null;
  user: string | null;
  from: string | null;
  secure: boolean | null;
  passEnc: string | null;
};

type StoredSecurityUserOverrides = {
  reauthOtpEnabledByUserId: Record<string, boolean>;
};

type StoredApiKeysSettings = {
  openaiApiKeyEnc: string | null;
  fmpApiKeyEnc: string | null;
  openaiModel: OpenAiAdminModel | null;
};

type StoredPredictionRefreshSettings = {
  triggerDebounceSec: number | null;
  aiCooldownSec: number | null;
  eventThrottleSec: number | null;
  hysteresisRatio: number | null;
  unstableFlipLimit: number | null;
  unstableFlipWindowSeconds: number | null;
};

type StoredPredictionDefaultsSettings = {
  signalMode: PredictionSignalMode | null;
};

type PredictionRefreshSettingsPublic = {
  triggerDebounceSec: number;
  aiCooldownSec: number;
  eventThrottleSec: number;
  hysteresisRatio: number;
  unstableFlipLimit: number;
  unstableFlipWindowSeconds: number;
};

type PredictionDefaultsSettingsPublic = {
  signalMode: PredictionSignalMode;
};

type ApiKeySource = "env" | "db" | "none";
type EffectiveOpenAiModelSource = "db" | "env" | "default";
const OPENAI_ADMIN_MODEL_OPTION_SET = new Set<string>(OPENAI_ADMIN_MODEL_OPTIONS);

function normalizeOpenAiAdminModel(value: unknown): OpenAiAdminModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!OPENAI_ADMIN_MODEL_OPTION_SET.has(trimmed)) return null;
  return trimmed as OpenAiAdminModel;
}

function parseStoredSmtpSettings(value: unknown): StoredSmtpSettings {
  const record = parseJsonObject(value);
  const host = typeof record.host === "string" && record.host.trim() ? record.host.trim() : null;
  const user = typeof record.user === "string" && record.user.trim() ? record.user.trim() : null;
  const from = typeof record.from === "string" && record.from.trim() ? record.from.trim() : null;
  const passEnc =
    typeof record.passEnc === "string" && record.passEnc.trim() ? record.passEnc.trim() : null;
  const portNum = Number(record.port);
  const port = Number.isFinite(portNum) && portNum > 0 && portNum <= 65535 ? Math.floor(portNum) : null;
  const secure =
    typeof record.secure === "boolean"
      ? record.secure
      : typeof record.secure === "string"
        ? asBoolean(record.secure, false)
        : null;
  return {
    host,
    port,
    user,
    from,
    secure,
    passEnc
  };
}

function toPublicSmtpSettings(value: StoredSmtpSettings) {
  return {
    host: value.host,
    port: value.port,
    user: value.user,
    from: value.from,
    secure: value.secure ?? (value.port === 465),
    hasPassword: Boolean(value.passEnc)
  };
}

function parseStoredApiKeysSettings(value: unknown): StoredApiKeysSettings {
  const record = parseJsonObject(value);
  const openaiApiKeyEnc =
    typeof record.openaiApiKeyEnc === "string" && record.openaiApiKeyEnc.trim()
      ? record.openaiApiKeyEnc.trim()
      : null;
  const fmpApiKeyEnc =
    typeof record.fmpApiKeyEnc === "string" && record.fmpApiKeyEnc.trim()
      ? record.fmpApiKeyEnc.trim()
      : null;
  const openaiModel = normalizeOpenAiAdminModel(record.openaiModel);
  return {
    openaiApiKeyEnc,
    fmpApiKeyEnc,
    openaiModel
  };
}

function parseStoredPredictionRefreshSettings(value: unknown): StoredPredictionRefreshSettings {
  const record = parseJsonObject(value);
  const readInt = (field: string, min: number, max: number): number | null => {
    const parsed = Number(record[field]);
    if (!Number.isFinite(parsed)) return null;
    const valueInt = Math.trunc(parsed);
    if (valueInt < min || valueInt > max) return null;
    return valueInt;
  };
  const readFloat = (field: string, min: number, max: number): number | null => {
    const parsed = Number(record[field]);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < min || parsed > max) return null;
    return parsed;
  };
  return {
    triggerDebounceSec: readInt("triggerDebounceSec", 0, 3600),
    aiCooldownSec: readInt("aiCooldownSec", 30, 3600),
    eventThrottleSec: readInt("eventThrottleSec", 0, 3600),
    hysteresisRatio: readFloat("hysteresisRatio", 0.2, 0.95),
    unstableFlipLimit: readInt("unstableFlipLimit", 2, 20),
    unstableFlipWindowSeconds: readInt("unstableFlipWindowSeconds", 60, 86400)
  };
}

function parseStoredPredictionDefaultsSettings(value: unknown): StoredPredictionDefaultsSettings {
  const record = parseJsonObject(value);
  const raw = record.signalMode;
  if (raw === undefined || raw === null) {
    return { signalMode: null };
  }
  const signalMode = normalizePredictionSignalMode(raw);
  return {
    signalMode
  };
}

function toEffectivePredictionRefreshSettings(
  stored: StoredPredictionRefreshSettings | null
): PredictionRefreshSettingsPublic {
  return {
    triggerDebounceSec: stored?.triggerDebounceSec ?? DEFAULT_PRED_TRIGGER_DEBOUNCE_SEC,
    aiCooldownSec: stored?.aiCooldownSec ?? DEFAULT_PRED_AI_COOLDOWN_SEC,
    eventThrottleSec: stored?.eventThrottleSec ?? DEFAULT_PRED_EVENT_THROTTLE_SEC,
    hysteresisRatio: stored?.hysteresisRatio ?? DEFAULT_PRED_HYSTERESIS_RATIO,
    unstableFlipLimit: stored?.unstableFlipLimit ?? DEFAULT_PRED_UNSTABLE_FLIP_LIMIT,
    unstableFlipWindowSeconds:
      stored?.unstableFlipWindowSeconds ?? DEFAULT_PRED_UNSTABLE_FLIP_WINDOW_SECONDS
  };
}

function toEffectivePredictionDefaultsSettings(
  stored: StoredPredictionDefaultsSettings | null
): PredictionDefaultsSettingsPublic {
  return {
    signalMode: stored?.signalMode ?? DEFAULT_PREDICTION_SIGNAL_MODE
  };
}

async function getPredictionDefaultsSettings(): Promise<PredictionDefaultsSettingsPublic> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY },
    select: { value: true }
  });
  const stored = parseStoredPredictionDefaultsSettings(row?.value);
  return toEffectivePredictionDefaultsSettings(stored);
}

function toPublicApiKeysSettings(value: StoredApiKeysSettings) {
  let openaiApiKeyMasked: string | null = null;
  let fmpApiKeyMasked: string | null = null;
  if (value.openaiApiKeyEnc) {
    try {
      const decrypted = decryptSecret(value.openaiApiKeyEnc);
      openaiApiKeyMasked = maskSecret(decrypted);
    } catch {
      openaiApiKeyMasked = "****";
    }
  }
  if (value.fmpApiKeyEnc) {
    try {
      const decrypted = decryptSecret(value.fmpApiKeyEnc);
      fmpApiKeyMasked = maskSecret(decrypted);
    } catch {
      fmpApiKeyMasked = "****";
    }
  }
  return {
    openaiApiKeyMasked,
    hasOpenAiApiKey: Boolean(value.openaiApiKeyEnc),
    fmpApiKeyMasked,
    hasFmpApiKey: Boolean(value.fmpApiKeyEnc),
    openaiModel: value.openaiModel
  };
}

function resolveEffectiveOpenAiModel(settings: StoredApiKeysSettings): {
  model: string;
  source: EffectiveOpenAiModelSource;
} {
  const resolved = resolveAiModelFromConfig({
    dbModel: settings.openaiModel,
    envModel: process.env.AI_MODEL
  });
  return {
    model: resolved.model,
    source: resolved.source
  };
}

function resolveEffectiveOpenAiApiKey(
  settings: StoredApiKeysSettings
): { apiKey: string | null; source: ApiKeySource; decryptError: boolean } {
  const envApiKey = process.env.AI_API_KEY?.trim() ?? "";
  if (envApiKey) {
    return { apiKey: envApiKey, source: "env", decryptError: false };
  }

  if (!settings.openaiApiKeyEnc) {
    return { apiKey: null, source: "none", decryptError: false };
  }

  try {
    const decrypted = decryptSecret(settings.openaiApiKeyEnc).trim();
    if (!decrypted) {
      return { apiKey: null, source: "none", decryptError: false };
    }
    return { apiKey: decrypted, source: "db", decryptError: false };
  } catch {
    return { apiKey: null, source: "db", decryptError: true };
  }
}

function resolveEffectiveFmpApiKey(
  settings: StoredApiKeysSettings
): { apiKey: string | null; source: ApiKeySource; decryptError: boolean } {
  const envApiKey = process.env.FMP_API_KEY?.trim() ?? "";
  if (envApiKey) {
    return { apiKey: envApiKey, source: "env", decryptError: false };
  }

  if (!settings.fmpApiKeyEnc) {
    return { apiKey: null, source: "none", decryptError: false };
  }

  try {
    const decrypted = decryptSecret(settings.fmpApiKeyEnc).trim();
    if (!decrypted) {
      return { apiKey: null, source: "none", decryptError: false };
    }
    return { apiKey: decrypted, source: "db", decryptError: false };
  } catch {
    return { apiKey: null, source: "db", decryptError: true };
  }
}

async function ensureWorkspaceMembership(userId: string, userEmail: string) {
  const existing = await db.workspaceMember.findFirst({
    where: { userId },
    include: {
      role: true
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) {
    return {
      workspaceId: existing.workspaceId as string,
      roleId: existing.roleId as string,
      permissions: parseJsonObject(existing.role?.permissions)
    };
  }

  const workspaceName = `${userEmail.split("@")[0] || "Workspace"} Workspace`;
  const workspace = await db.workspace.create({
    data: {
      name: workspaceName
    }
  });
  const { adminRoleId } = await ensureDefaultRoles(workspace.id);
  const member = await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId,
      roleId: adminRoleId
    },
    include: {
      role: true
    }
  });

  return {
    workspaceId: member.workspaceId as string,
    roleId: member.roleId as string,
    permissions: parseJsonObject(member.role?.permissions)
  };
}

async function resolveUserContext(user: { id: string; email: string }) {
  const member = await ensureWorkspaceMembership(user.id, user.email);
  const isSuperadmin = isSuperadminEmail(user.email);
  const hasAdminAccess = isSuperadmin || (await hasAdminBackendAccess(user));
  const permissions = hasAdminAccess
    ? buildPermissions(PERMISSION_KEYS)
    : member.permissions;
  return {
    workspaceId: member.workspaceId,
    permissions,
    isSuperadmin,
    hasAdminBackendAccess: hasAdminAccess
  };
}

async function resolveWorkspaceIdForUserId(userId: string): Promise<string | null> {
  const member = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true }
  });
  if (!member?.workspaceId || typeof member.workspaceId !== "string") return null;
  const trimmed = member.workspaceId.trim();
  return trimmed || null;
}

function readUserFromLocals(res: express.Response): { id: string; email: string } {
  return getUserFromLocals(res);
}

async function requireSuperadmin(res: express.Response): Promise<boolean> {
  const user = readUserFromLocals(res);
  if (!(await hasAdminBackendAccess(user))) {
    res.status(403).json({ error: "forbidden", message: "admin_backend_access_required" });
    return false;
  }
  return true;
}

async function ensureAdminUserSeed() {
  const email = SUPERADMIN_EMAIL;
  const existing = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });

  let user = existing;
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD)
      },
      select: {
        id: true,
        email: true,
        passwordHash: true
      }
    });
    // eslint-disable-next-line no-console
    console.log(`[admin] created default admin user ${email}`);
  } else if (!user.passwordHash) {
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD)
      }
    });
  }

  const membership = await ensureWorkspaceMembership(user.id, user.email);
  const { adminRoleId } = await ensureDefaultRoles(membership.workspaceId);
  if (membership.roleId !== adminRoleId) {
    await db.workspaceMember.updateMany({
      where: {
        userId: user.id,
        workspaceId: membership.workspaceId
      },
      data: {
        roleId: adminRoleId
      }
    });
  }
}

function pickNumber(snapshot: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = Number(snapshot[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizePredictionTimeframe(value: unknown): PredictionTimeframe {
  if (typeof value === "string" && PREDICTION_TIMEFRAMES.has(value as PredictionTimeframe)) {
    return value as PredictionTimeframe;
  }
  return "15m";
}

function normalizePredictionMarketType(value: unknown): PredictionMarketType {
  if (typeof value === "string" && PREDICTION_MARKET_TYPES.has(value as PredictionMarketType)) {
    return value as PredictionMarketType;
  }
  return "perp";
}

function normalizePredictionSignal(value: unknown): PredictionSignal {
  if (typeof value === "string" && PREDICTION_SIGNALS.has(value as PredictionSignal)) {
    return value as PredictionSignal;
  }
  return "neutral";
}

function derivePredictionKeyDrivers(snapshot: Record<string, unknown>) {
  const preferred = [
    "atr_pct_rank_0_100",
    "ema_spread_abs_rank_0_100",
    "rsi",
    "emaSpread",
    "emaFast",
    "emaSlow",
    "macd",
    "atrPct",
    "volatility",
    "spreadBps",
    "liquidityScore",
    "fundingRate",
    "newsRisk"
  ];

  const out: Array<{ name: string; value: unknown }> = [];
  for (const key of preferred) {
    if (!(key in snapshot)) continue;
    out.push({ name: key, value: snapshot[key] });
    if (out.length >= 5) return out;
  }

  const fallbackKeys = Object.keys(snapshot).sort().slice(0, 5);
  for (const key of fallbackKeys) {
    out.push({ name: key, value: snapshot[key] });
  }
  return out.slice(0, 5);
}

function deriveSuggestedEntry(snapshot: Record<string, unknown>) {
  const rawType = String(
    snapshot.suggestedEntryType ??
      snapshot.entryType ??
      snapshot.orderType ??
      ""
  )
    .trim()
    .toLowerCase();

  const entryPrice = pickNumber(snapshot, [
    "suggestedEntryPrice",
    "entryPrice",
    "limitPrice",
    "entry"
  ]);

  if (rawType === "market") {
    return { type: "market" as const };
  }

  const inferredType = rawType === "limit" || entryPrice !== null ? "limit" : "market";
  if (inferredType === "limit") {
    return {
      type: "limit" as const,
      price: entryPrice ?? undefined
    };
  }
  return { type: "market" as const };
}

function derivePositionSizeHint(snapshot: Record<string, unknown>) {
  const raw = snapshot.positionSizeHint;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const modeValue = String((raw as any).mode ?? "").trim().toLowerCase();
    const value = Number((raw as any).value);
    if ((modeValue === "percent_balance" || modeValue === "fixed_quote") && Number.isFinite(value) && value > 0) {
      return {
        mode: modeValue as "percent_balance" | "fixed_quote",
        value
      };
    }
  }

  const percentValue = pickNumber(snapshot, ["positionSizePercent", "sizePercent", "balancePercent"]);
  if (percentValue !== null && percentValue > 0) {
    return {
      mode: "percent_balance" as const,
      value: percentValue
    };
  }

  const quoteValue = pickNumber(snapshot, ["positionSizeQuote", "sizeQuote", "sizeUsdt"]);
  if (quoteValue !== null && quoteValue > 0) {
    return {
      mode: "fixed_quote" as const,
      value: quoteValue
    };
  }

  return null;
}

function derivePredictionTrackingFromSnapshot(
  snapshot: Record<string, unknown>,
  timeframe: PredictionTimeframe
): {
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  horizonMs: number | null;
} {
  const entryPrice = pickNumber(snapshot, ["suggestedEntryPrice", "entryPrice", "entry"]);
  const stopLossPrice = pickNumber(snapshot, ["suggestedStopLoss", "stopLoss", "slPrice", "sl"]);
  const takeProfitPrice = pickNumber(snapshot, ["suggestedTakeProfit", "takeProfit", "tpPrice", "tp"]);
  const customHorizonMs = pickNumber(snapshot, ["horizonMs", "predictionHorizonMs"]);
  const horizonMs = customHorizonMs !== null
    ? Math.max(60_000, Math.trunc(customHorizonMs))
    : timeframeToIntervalMs(timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;

  return {
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    horizonMs
  };
}

type CandleBar = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type OhlcvSeriesRow = [number | null, number, number, number, number, number | null];

const AI_PROMPT_OHLCV_FORMAT = ["ts", "open", "high", "low", "close", "volume"] as const;

function readAiPromptOhlcvMaxBars(): number {
  const parsed = Number(process.env.AI_PROMPT_OHLCV_MAX_BARS ?? "500");
  if (!Number.isFinite(parsed)) return 500;
  return Math.max(20, Math.min(500, Math.trunc(parsed)));
}

const AI_PROMPT_OHLCV_MAX_BARS = readAiPromptOhlcvMaxBars();

function readAiHistoryContextMaxEvents(): number {
  const parsed = Number(process.env.AI_HISTORY_CONTEXT_MAX_EVENTS ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(5, Math.min(30, Math.trunc(parsed)));
}

function readAiHistoryContextLastBars(): number {
  const parsed = Number(process.env.AI_HISTORY_CONTEXT_LAST_BARS ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(10, Math.min(30, Math.trunc(parsed)));
}

function readAiHistoryContextMaxBytes(): number {
  const parsed = Number(process.env.AI_HISTORY_CONTEXT_MAX_BYTES ?? "16384");
  if (!Number.isFinite(parsed)) return 16384;
  return Math.max(4096, Math.min(16384, Math.trunc(parsed)));
}

function readAiHistoryContextEnabled(): boolean {
  const raw = String(process.env.AI_HISTORY_CONTEXT_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

const AI_HISTORY_CONTEXT_OPTIONS = {
  enabled: readAiHistoryContextEnabled(),
  maxEvents: readAiHistoryContextMaxEvents(),
  lastBars: readAiHistoryContextLastBars(),
  maxBytes: readAiHistoryContextMaxBytes()
} as const;

function toRecordSafe(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBitgetCandles(value: unknown): CandleBar[] {
  if (!Array.isArray(value)) return [];
  const out: CandleBar[] = [];

  for (const row of value) {
    if (Array.isArray(row)) {
      const ts = asNumber(row[0]);
      const open = asNumber(row[1]);
      const high = asNumber(row[2]);
      const low = asNumber(row[3]);
      const close = asNumber(row[4]);
      const volume = asNumber(row[5]);
      if (open === null || high === null || low === null || close === null) continue;
      out.push({ ts, open, high, low, close, volume });
      continue;
    }

    const rec = toRecordSafe(row);
    if (!rec) continue;
    const open = asNumber(rec.open ?? rec.o);
    const high = asNumber(rec.high ?? rec.h);
    const low = asNumber(rec.low ?? rec.l);
    const close = asNumber(rec.close ?? rec.c);
    if (open === null || high === null || low === null || close === null) continue;
    out.push({
      ts: asNumber(rec.ts ?? rec.t ?? rec.time ?? rec.timestamp ?? rec.T),
      open,
      high,
      low,
      close,
      volume: asNumber(rec.volume ?? rec.v ?? rec.baseVolume)
    });
  }

  out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return out;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildOhlcvSeriesFeature(
  candles: CandleBar[],
  timeframe: PredictionTimeframe
): {
  timeframe: PredictionTimeframe;
  format: readonly ["ts", "open", "high", "low", "close", "volume"];
  bars: OhlcvSeriesRow[];
  count: number;
} {
  const source = candles.slice(-AI_PROMPT_OHLCV_MAX_BARS);
  const bars: OhlcvSeriesRow[] = [];
  for (const row of source) {
    if (!Number.isFinite(row.open) || !Number.isFinite(row.high) || !Number.isFinite(row.low) || !Number.isFinite(row.close)) {
      continue;
    }
    const ts = Number.isFinite(row.ts) ? Math.trunc(Number(row.ts)) : null;
    const volume = Number.isFinite(row.volume) ? Number(Number(row.volume).toFixed(8)) : null;
    bars.push([
      ts,
      Number(row.open.toFixed(8)),
      Number(row.high.toFixed(8)),
      Number(row.low.toFixed(8)),
      Number(row.close.toFixed(8)),
      volume
    ]);
  }

  return {
    timeframe,
    format: AI_PROMPT_OHLCV_FORMAT,
    bars,
    count: bars.length
  };
}

function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    const delta = next - prev;
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function timeframeToBitgetGranularity(timeframe: PredictionTimeframe): string {
  if (timeframe === "1h") return "1H";
  if (timeframe === "4h") return "4H";
  if (timeframe === "1d") return "1D";
  return timeframe;
}

function marketTimeframeToBitgetGranularity(timeframe: "1m" | PredictionTimeframe): string {
  if (timeframe === "1h") return "1H";
  if (timeframe === "4h") return "4H";
  if (timeframe === "1d") return "1D";
  return timeframe;
}

function timeframeToIntervalMs(timeframe: PredictionTimeframe): number {
  if (timeframe === "5m") return 5 * 60 * 1000;
  if (timeframe === "15m") return 15 * 60 * 1000;
  if (timeframe === "1h") return 60 * 60 * 1000;
  if (timeframe === "4h") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

const SESSION_LOOKBACK_BUFFER_BARS = Math.max(
  1,
  Number(process.env.PRED_SESSION_LOOKBACK_BUFFER_BARS ?? 6)
);

function resolvePredictionCandleLookback(params: {
  timeframe: PredictionTimeframe;
  indicatorSettings: Parameters<typeof minimumCandlesForIndicatorsWithSettings>[1];
  baseMinBars: number;
  nowMs?: number;
}): number {
  const indicatorMinBars = minimumCandlesForIndicatorsWithSettings(
    params.timeframe,
    params.indicatorSettings
  );
  if (params.timeframe === "1d") {
    return Math.max(params.baseMinBars, indicatorMinBars);
  }
  const nowMs = params.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const sessionStartUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const intervalMs = timeframeToIntervalMs(params.timeframe);
  const elapsedMs = Math.max(0, nowMs - sessionStartUtcMs);
  const barsSinceSessionStart = Math.floor(elapsedMs / intervalMs) + 1;
  const sessionCoverageBars = barsSinceSessionStart + SESSION_LOOKBACK_BUFFER_BARS;

  return Math.max(params.baseMinBars, indicatorMinBars, sessionCoverageBars);
}

function normalizePredictionTimeframeCandidate(value: unknown): PredictionTimeframe | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as PredictionTimeframe;
  return PREDICTION_TIMEFRAMES.has(trimmed) ? trimmed : null;
}

function normalizePromptTimeframeSetForRuntime(
  settings: {
    timeframe?: unknown;
    timeframes?: unknown;
    runTimeframe?: unknown;
  } | null | undefined,
  fallbackTimeframe: PredictionTimeframe
): { timeframes: PredictionTimeframe[]; runTimeframe: PredictionTimeframe } {
  const out: PredictionTimeframe[] = [];
  const seen = new Set<PredictionTimeframe>();
  const pushTf = (value: unknown) => {
    const normalized = normalizePredictionTimeframeCandidate(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  if (settings && Array.isArray(settings.timeframes)) {
    for (const value of settings.timeframes) {
      pushTf(value);
      if (out.length >= 4) break;
    }
  }

  const legacyTimeframe = normalizePredictionTimeframeCandidate(settings?.timeframe);
  if (out.length === 0 && legacyTimeframe) {
    pushTf(legacyTimeframe);
  }

  let runTimeframe =
    normalizePredictionTimeframeCandidate(settings?.runTimeframe)
    ?? legacyTimeframe
    ?? fallbackTimeframe;
  if (!seen.has(runTimeframe)) {
    if (out.length >= 4) {
      runTimeframe = out[0];
    } else {
      out.push(runTimeframe);
      seen.add(runTimeframe);
    }
  }
  if (out.length === 0) {
    out.push(runTimeframe);
  }
  return { timeframes: out, runTimeframe };
}

async function buildMtfFramesForPrediction(params: {
  adapter: BitgetFuturesAdapter;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframes: PredictionTimeframe[];
  runTimeframe: PredictionTimeframe;
  runFrame: {
    candles: CandleBar[];
    indicators: ReturnType<typeof computeIndicators>;
    advancedIndicators: ReturnType<typeof computeAdvancedIndicators>;
  };
}): Promise<{
  runTimeframe: PredictionTimeframe;
  timeframes: PredictionTimeframe[];
  frames: Record<string, Record<string, unknown>>;
}> {
  const dedupedTimeframes = normalizePromptTimeframeSetForRuntime(
    {
      timeframes: params.timeframes,
      runTimeframe: params.runTimeframe
    },
    params.runTimeframe
  ).timeframes;
  const frames: Record<string, Record<string, unknown>> = {};
  const exchangeSymbol = await params.adapter.toExchangeSymbol(params.symbol);

  for (const timeframe of dedupedTimeframes) {
    let candles: CandleBar[];
    let indicators: ReturnType<typeof computeIndicators>;
    let advancedIndicators: ReturnType<typeof computeAdvancedIndicators>;

    if (timeframe === params.runTimeframe) {
      candles = params.runFrame.candles;
      indicators = params.runFrame.indicators;
      advancedIndicators = params.runFrame.advancedIndicators;
    } else {
      const indicatorSettingsResolution = await resolveIndicatorSettings({
        db,
        exchange: params.exchange,
        accountId: params.accountId,
        symbol: params.symbol,
        timeframe
      });
      const indicatorComputeSettings = toIndicatorComputeSettings(
        indicatorSettingsResolution.config
      );
      const advancedIndicatorSettings = toAdvancedIndicatorComputeSettings(
        indicatorSettingsResolution.config
      );
      const candleLookback = resolvePredictionCandleLookback({
        timeframe,
        indicatorSettings: indicatorComputeSettings,
        baseMinBars: 120
      });
      const candlesRaw = await params.adapter.marketApi.getCandles({
        symbol: exchangeSymbol,
        productType: params.adapter.productType,
        granularity: timeframeToBitgetGranularity(timeframe),
        limit: candleLookback
      });
      candles = bucketCandles(parseBitgetCandles(candlesRaw), timeframe);
      if (candles.length < 20) continue;
      indicators = computeIndicators(candles, timeframe, {
        exchange: params.exchange,
        symbol: params.symbol,
        marketType: params.marketType,
        logVwapMetrics: false,
        settings: indicatorComputeSettings
      });
      advancedIndicators = computeAdvancedIndicators(
        candles,
        timeframe,
        advancedIndicatorSettings
      );
    }

    const frameSnapshot: Record<string, unknown> = {
      timeframe,
      indicators,
      advancedIndicators,
      rsi: asNumber(indicators.rsi_14),
      atrPct: asNumber(indicators.atr_pct),
      ohlcvSeries: buildOhlcvSeriesFeature(candles, timeframe)
    };

    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: frameSnapshot,
      candles,
      timeframe,
      indicators,
      advancedIndicators,
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    if (advancedIndicators.dataGap) {
      const riskFlags = asRecord(frameSnapshot.riskFlags) ?? {};
      frameSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    frames[timeframe] = frameSnapshot;
  }

  const effectiveTimeframes = dedupedTimeframes.filter((timeframe) => Boolean(frames[timeframe]));
  if (!effectiveTimeframes.includes(params.runTimeframe)) {
    const runFrameSnapshot: Record<string, unknown> = {
      timeframe: params.runTimeframe,
      indicators: params.runFrame.indicators,
      advancedIndicators: params.runFrame.advancedIndicators,
      rsi: asNumber(params.runFrame.indicators.rsi_14),
      atrPct: asNumber(params.runFrame.indicators.atr_pct),
      ohlcvSeries: buildOhlcvSeriesFeature(params.runFrame.candles, params.runTimeframe)
    };
    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: runFrameSnapshot,
      candles: params.runFrame.candles,
      timeframe: params.runTimeframe,
      indicators: params.runFrame.indicators,
      advancedIndicators: params.runFrame.advancedIndicators,
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    if (params.runFrame.advancedIndicators.dataGap) {
      const riskFlags = asRecord(runFrameSnapshot.riskFlags) ?? {};
      runFrameSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    frames[params.runTimeframe] = runFrameSnapshot;
    effectiveTimeframes.unshift(params.runTimeframe);
  }

  return {
    runTimeframe: params.runTimeframe,
    timeframes: effectiveTimeframes,
    frames
  };
}

type FeatureThresholdRecord = {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  windowFrom: Date;
  windowTo: Date;
  nBars: number;
  computedAt: Date;
  version: string;
  thresholdsJson: FeatureThresholdsJson;
};

type FeatureThresholdResolution = {
  thresholds: ResolvedFeatureThresholds;
  source: "db" | "fallback";
  computedAt: string | null;
  version: string;
  windowFrom: string | null;
  windowTo: string | null;
  nBars: number | null;
};

const featureThresholdCache = new Map<string, {
  expiresAt: number;
  row: FeatureThresholdRecord | null;
}>();

function featureThresholdKey(params: {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}) {
  return [
    params.exchange.trim().toLowerCase(),
    normalizeSymbolInput(params.symbol) ?? params.symbol.trim().toUpperCase(),
    params.marketType,
    params.timeframe
  ].join(":");
}

async function readLatestFeatureThresholdRow(params: {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}): Promise<FeatureThresholdRecord | null> {
  const key = featureThresholdKey(params);
  const now = Date.now();
  const cached = featureThresholdCache.get(key);
  if (cached && cached.expiresAt > now) return cached.row;

  const row = await db.featureThreshold.findFirst({
    where: {
      exchange: params.exchange.trim().toLowerCase(),
      accountScope: "global",
      symbol: (normalizeSymbolInput(params.symbol) ?? params.symbol.trim().toUpperCase()),
      marketType: params.marketType,
      timeframe: params.timeframe
    },
    orderBy: { computedAt: "desc" },
    select: {
      exchange: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      windowFrom: true,
      windowTo: true,
      nBars: true,
      computedAt: true,
      version: true,
      thresholdsJson: true
    }
  });

  const normalized = row
    ? {
        exchange: row.exchange,
        symbol: row.symbol,
        marketType: normalizePredictionMarketType(row.marketType),
        timeframe: normalizePredictionTimeframe(row.timeframe),
        windowFrom: row.windowFrom,
        windowTo: row.windowTo,
        nBars: Number(row.nBars),
        computedAt: row.computedAt,
        version: String(row.version ?? FEATURE_THRESHOLD_VERSION),
        thresholdsJson: asRecord(row.thresholdsJson) as FeatureThresholdsJson
      }
    : null;

  featureThresholdCache.set(key, {
    expiresAt: now + FEATURE_THRESHOLDS_CACHE_TTL_MS,
    row: normalized
  });
  return normalized;
}

function setFeatureThresholdCacheRow(row: FeatureThresholdRecord) {
  featureThresholdCache.set(featureThresholdKey({
    exchange: row.exchange,
    symbol: row.symbol,
    marketType: row.marketType,
    timeframe: row.timeframe
  }), {
    expiresAt: Date.now() + FEATURE_THRESHOLDS_CACHE_TTL_MS,
    row
  });
}

async function resolveFeatureThresholds(params: {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}): Promise<FeatureThresholdResolution> {
  const row = await readLatestFeatureThresholdRow(params);
  if (!row) {
    return {
      thresholds: fallbackFeatureThresholds(),
      source: "fallback",
      computedAt: null,
      version: FEATURE_THRESHOLD_VERSION,
      windowFrom: null,
      windowTo: null,
      nBars: null
    };
  }

  const parsed = readFeatureThresholds(row.thresholdsJson);
  if (!parsed) {
    return {
      thresholds: fallbackFeatureThresholds(),
      source: "fallback",
      computedAt: toIso(row.computedAt),
      version: row.version,
      windowFrom: toIso(row.windowFrom),
      windowTo: toIso(row.windowTo),
      nBars: row.nBars
    };
  }

  return {
    thresholds: parsed,
    source: "db",
    computedAt: toIso(row.computedAt),
    version: row.version,
    windowFrom: toIso(row.windowFrom),
    windowTo: toIso(row.windowTo),
    nBars: row.nBars
  };
}

function computeAtrPctSeries(candles: CandleBar[], period = 14): number[] {
  const trValues: number[] = [];
  const out: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1]?.close;
    const bar = candles[i];
    if (!bar || !Number.isFinite(prevClose) || !Number.isFinite(bar.close) || bar.close <= 0) continue;
    const tr = Math.max(
      Math.abs(bar.high - bar.low),
      Math.abs(bar.high - (prevClose as number)),
      Math.abs(bar.low - (prevClose as number))
    );
    trValues.push(tr);
    if (trValues.length > period) trValues.shift();
    if (trValues.length === period) {
      out.push(average(trValues) / bar.close);
    }
  }
  return out;
}

function computeAbsEmaSpreadSeries(candles: CandleBar[], fast = 12, slow = 26): number[] {
  const out: number[] = [];
  const fastK = 2 / (fast + 1);
  const slowK = 2 / (slow + 1);
  let emaFast: number | null = null;
  let emaSlow: number | null = null;

  for (const bar of candles) {
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
    emaFast = emaFast === null ? bar.close : bar.close * fastK + emaFast * (1 - fastK);
    emaSlow = emaSlow === null ? bar.close : bar.close * slowK + emaSlow * (1 - slowK);
    if (emaSlow !== null && emaSlow !== 0 && emaFast !== null) {
      out.push(Math.abs((emaFast - emaSlow) / emaSlow));
    }
  }

  return out;
}

function computeGapRatio(timeframe: PredictionTimeframe, windowMs: number, nBars: number): number {
  const expectedBars = expectedBarsForWindow(timeframe as ThresholdTimeframe, windowMs);
  if (expectedBars <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - nBars / Math.max(1, expectedBars)));
}

function isDailyCalibrationTime(now: Date): boolean {
  return now.getUTCHours() === 2 && now.getUTCMinutes() >= 15 && now.getUTCMinutes() < 25;
}

function isoWeekBucket(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function isWeeklyCalibrationTime(now: Date): boolean {
  return now.getUTCDay() === 0 && now.getUTCHours() === 3 && now.getUTCMinutes() < 15;
}

type PredictionQualityContext = {
  sampleSize: number;
  winRatePct: number | null;
  avgOutcomePnlPct: number | null;
  tpCount: number;
  slCount: number;
  expiredCount: number;
};

async function getPredictionQualityContext(
  userId: string,
  symbol: string,
  timeframe: PredictionTimeframe,
  marketType: PredictionMarketType
): Promise<PredictionQualityContext> {
  const rows = await db.prediction.findMany({
    where: {
      userId,
      symbol,
      timeframe,
      marketType,
      outcomeStatus: "closed"
    },
    orderBy: { tsCreated: "desc" },
    take: 100,
    select: {
      outcomeResult: true,
      outcomePnlPct: true
    }
  });

  let tpCount = 0;
  let slCount = 0;
  let expiredCount = 0;
  let pnlSum = 0;
  let pnlCount = 0;

  for (const row of rows) {
    const result = typeof row.outcomeResult === "string" ? row.outcomeResult : "";
    if (result === "tp_hit") tpCount += 1;
    else if (result === "sl_hit") slCount += 1;
    else if (result === "expired") expiredCount += 1;

    const pnl = Number(row.outcomePnlPct);
    if (Number.isFinite(pnl)) {
      pnlSum += pnl;
      pnlCount += 1;
    }
  }

  const sampleSize = rows.length;
  const winRatePct = sampleSize > 0 ? Number(((tpCount / sampleSize) * 100).toFixed(2)) : null;
  const avgOutcomePnlPct = pnlCount > 0 ? Number((pnlSum / pnlCount).toFixed(4)) : null;

  return {
    sampleSize,
    winRatePct,
    avgOutcomePnlPct,
    tpCount,
    slCount,
    expiredCount
  };
}

function deriveSignalFromScore(
  score: number,
  threshold: number,
  directionPreference: DirectionPreference
): PredictionSignal {
  let adjustedScore = score;
  if (directionPreference === "long") adjustedScore = Math.max(0, adjustedScore);
  if (directionPreference === "short") adjustedScore = Math.min(0, adjustedScore);

  if (adjustedScore > threshold) return "up";
  if (adjustedScore < -threshold) return "down";
  return "neutral";
}

function inferPredictionFromMarket(params: {
  closes: number[];
  highs: number[];
  lows: number[];
  indicators: IndicatorsSnapshot;
  referencePrice: number;
  timeframe: PredictionTimeframe;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  leverage?: number;
  marketType: PredictionMarketType;
  exchangeAccountId: string;
  exchange: string;
  thresholdResolution: FeatureThresholdResolution;
}): {
  prediction: { signal: PredictionSignal; expectedMovePct: number; confidence: number };
  featureSnapshot: Record<string, unknown>;
  tracking: {
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    horizonMs: number;
  };
} {
  const closes = params.closes;
  const highs = params.highs;
  const lows = params.lows;
  const last = closes[closes.length - 1] ?? params.referencePrice;
  const prev5 = closes[Math.max(0, closes.length - 6)] ?? last;
  const momentum = prev5 > 0 ? (last - prev5) / prev5 : 0;

  const sma20 = average(closes.slice(-20));
  const emaSpread = sma20 > 0 ? (last - sma20) / sma20 : 0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (prev > 0 && next > 0) returns.push((next - prev) / prev);
  }
  const volatility = stddev(returns.slice(-30));
  const atrProxyFallback = average(
    highs.slice(-20).map((high, idx) => {
      const low = lows.slice(-20)[idx] ?? high;
      if (last <= 0) return 0;
      return Math.abs(high - low) / last;
    })
  );
  const atrProxy = typeof params.indicators.atr_pct === "number"
    ? params.indicators.atr_pct
    : atrProxyFallback;
  const absEmaSpread = Math.abs(emaSpread);

  const rawScore = emaSpread * 0.65 + momentum * 0.35;
  const threshold = 0.0008 + volatility * 0.25;
  let signal = deriveSignalFromScore(rawScore, threshold, params.directionPreference);

  const confidencePrePenalty = clamp(
    0.3 + (Math.abs(rawScore) / Math.max(0.0004, threshold + volatility)) * 0.5,
    0.05,
    0.95
  );
  const confidenceRaw = applyConfidencePenalty({
    baseConfidence: confidencePrePenalty,
    atrPct: atrProxy,
    emaSpreadPct: emaSpread,
    thresholds: params.thresholdResolution.thresholds
  });
  const targetConfidence = clamp(params.confidenceTargetPct / 100, 0, 1);
  const confidence = confidenceRaw >= targetConfidence ? confidenceRaw : Math.max(0.2, confidenceRaw * 0.85);

  if (confidenceRaw < targetConfidence) {
    signal = "neutral";
  }

  const expectedMovePct = clamp((Math.abs(momentum) + Math.max(volatility, atrProxy) * 1.2) * 100, 0.1, 6);
  const referencePrice = params.referencePrice > 0 ? params.referencePrice : last;
  const entryPrice = signal === "down"
    ? referencePrice * (1 + 0.0005)
    : referencePrice * (1 - 0.0005);
  const slMultiplier = Math.max(0.004, volatility * 1.7 + 0.0025);
  const tpMultiplier = Math.max(expectedMovePct / 100, volatility * 2.2 + 0.003);
  const suggestedStopLoss = signal === "down"
    ? referencePrice * (1 + slMultiplier)
    : referencePrice * (1 - slMultiplier);
  const suggestedTakeProfit = signal === "down"
    ? referencePrice * (1 - tpMultiplier)
    : referencePrice * (1 + tpMultiplier);

  const rsi = typeof params.indicators.rsi_14 === "number"
    ? params.indicators.rsi_14
    : computeRsi(closes);
  const sizePercent = clamp(Math.round((confidence * 100) * 0.35), 10, 35);
  const horizonMs = timeframeToIntervalMs(params.timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;
  const tags = deriveRegimeTags({
    signal,
    atrPct: atrProxy,
    emaSpreadPct: emaSpread,
    rsi,
    thresholds: params.thresholdResolution.thresholds
  });
  const atrPctRank = percentileRankFromBands(atrProxy, params.thresholdResolution.thresholds.atrPct);
  const emaSpreadAbsRank = percentileRankFromBands(
    absEmaSpread,
    params.thresholdResolution.thresholds.absEmaSpreadPct
  );

  return {
    prediction: {
      signal,
      expectedMovePct: Number(expectedMovePct.toFixed(2)),
      confidence: Number(confidence.toFixed(4))
    },
    featureSnapshot: {
      rsi: rsi !== null ? Number(rsi.toFixed(2)) : null,
      emaSpread: Number(emaSpread.toFixed(6)),
      momentum: Number(momentum.toFixed(6)),
      volatility: Number(volatility.toFixed(6)),
      atrPct: Number(atrProxy.toFixed(6)),
      atr_pct_rank_0_100: atrPctRank !== null ? Number(atrPctRank.toFixed(2)) : null,
      ema_spread_abs_rank_0_100:
        emaSpreadAbsRank !== null ? Number(emaSpreadAbsRank.toFixed(2)) : null,
      indicators: params.indicators,
      thresholdSource: params.thresholdResolution.source,
      thresholdVersion: params.thresholdResolution.version,
      thresholdComputedAt: params.thresholdResolution.computedAt,
      thresholdWindowFrom: params.thresholdResolution.windowFrom,
      thresholdWindowTo: params.thresholdResolution.windowTo,
      thresholdBars: params.thresholdResolution.nBars,
      suggestedEntryType: "market",
      suggestedEntryPrice: Number(entryPrice.toFixed(2)),
      suggestedStopLoss: Number(suggestedStopLoss.toFixed(2)),
      suggestedTakeProfit: Number(suggestedTakeProfit.toFixed(2)),
      positionSizeHint: {
        mode: "percent_balance",
        value: sizePercent
      },
      requestedLeverage: params.marketType === "perp" ? params.leverage ?? 1 : null,
      directionPreference: params.directionPreference,
      confidenceTargetPct: params.confidenceTargetPct,
      prefillExchangeAccountId: params.exchangeAccountId,
      prefillExchange: params.exchange,
      tags,
      ...(params.indicators.dataGap ? { riskFlags: { dataGap: true } } : {})
    },
    tracking: {
      entryPrice: Number(entryPrice.toFixed(2)),
      stopLossPrice: Number(suggestedStopLoss.toFixed(2)),
      takeProfitPrice: Number(suggestedTakeProfit.toFixed(2)),
      horizonMs
    }
  };
}

type PredictionGenerateAutoInput = z.infer<typeof predictionGenerateAutoSchema>;

function parseDirectionPreference(value: unknown): DirectionPreference {
  if (value === "long" || value === "short" || value === "either") return value;
  return "either";
}

async function generateAutoPredictionForUser(
  userId: string,
  payload: PredictionGenerateAutoInput,
  options?: {
    isSuperadmin?: boolean;
    hasAdminBackendAccess?: boolean;
    userEmail?: string;
  }
): Promise<{
  persisted: boolean;
  prediction: { signal: PredictionSignal; expectedMovePct: number; confidence: number };
  timeframe: PredictionTimeframe;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  signalSource: PredictionSignalSource;
  signalMode: PredictionSignalMode;
  explanation: Awaited<ReturnType<typeof generateAndPersistPrediction>>["explanation"];
  modelVersion: string;
  predictionId: string | null;
  tsCreated: string;
  aiPromptTemplateId: string | null;
  aiPromptTemplateName: string | null;
  localStrategyId: string | null;
  localStrategyName: string | null;
  compositeStrategyId: string | null;
  compositeStrategyName: string | null;
  strategyRef: PredictionStrategyRef | null;
  existing?: boolean;
  existingStateId?: string | null;
}> {
  const resolvedAccount = await resolveMarketDataTradingAccount(userId, payload.exchangeAccountId);
  const account = resolvedAccount.selectedAccount;
  const adapter = createBitgetAdapter(resolvedAccount.marketDataAccount);

  try {
    const requestIsSuperadmin = Boolean(options?.isSuperadmin);
    await adapter.contractCache.warmup();
    const canonicalSymbol = normalizeSymbolInput(payload.symbol);
    if (!canonicalSymbol) {
      throw new ManualTradingError("symbol_required", 400, "symbol_required");
    }
    const predictionDefaults = await getPredictionDefaultsSettings();
    const defaultSignalMode = predictionDefaults.signalMode;
    const requestedTimeframe = payload.timeframe;
    const promptScopeContextDraft = {
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      symbol: canonicalSymbol,
      timeframe: requestedTimeframe
    };
    const payloadStrategyKind = normalizePredictionStrategyKind(payload.strategyRef?.kind);
    const payloadStrategyId =
      typeof payload.strategyRef?.id === "string" && payload.strategyRef.id.trim()
        ? payload.strategyRef.id.trim()
        : null;
    const requestedPromptTemplateId =
      payloadStrategyKind === "ai"
        ? payloadStrategyId
        : (typeof payload.aiPromptTemplateId === "string" && payload.aiPromptTemplateId.trim()
            ? payload.aiPromptTemplateId.trim()
            : null);
    const requestedLocalStrategyId =
      payloadStrategyKind === "local"
        ? payloadStrategyId
        : null;
    const requestedCompositeStrategyId =
      payloadStrategyKind === "composite"
        ? payloadStrategyId
        : (typeof payload.compositeStrategyId === "string" && payload.compositeStrategyId.trim()
            ? payload.compositeStrategyId.trim()
            : null);
    const selectedLocalStrategy = requestedLocalStrategyId
      ? await getEnabledLocalStrategyById(requestedLocalStrategyId)
      : null;
    const selectedCompositeStrategy = requestedCompositeStrategyId
      ? await getEnabledCompositeStrategyById(requestedCompositeStrategyId)
      : null;
    let selectedStrategyRef: PredictionStrategyRef | null =
      selectedCompositeStrategy
        ? { kind: "composite", id: selectedCompositeStrategy.id, name: selectedCompositeStrategy.name }
        : selectedLocalStrategy
          ? { kind: "local", id: selectedLocalStrategy.id, name: selectedLocalStrategy.name }
          : requestedPromptTemplateId
            ? { kind: "ai", id: requestedPromptTemplateId, name: null }
            : null;
    const signalMode = resolveStrategyBoundSignalMode(
      defaultSignalMode,
      selectedStrategyRef?.kind ?? "ai"
    );
    if (requestedLocalStrategyId && !selectedLocalStrategy) {
      throw new ManualTradingError(
        "Selected local strategy is not available.",
        400,
        "invalid_local_strategy"
      );
    }
    if (requestedCompositeStrategyId && !selectedCompositeStrategy) {
      throw new ManualTradingError(
        "Selected composite strategy is not available.",
        400,
        "invalid_composite_strategy"
      );
    }
    const workspaceId = await resolveWorkspaceIdForUserId(userId);
    const strategyEntitlements = await resolveStrategyEntitlementsForWorkspace({
      workspaceId: workspaceId ?? "unknown"
    });
    const requestedPromptSelection = requestedPromptTemplateId
      ? await resolveAiPromptRuntimeForUserSelection({
          userId,
          templateId: requestedPromptTemplateId,
          context: promptScopeContextDraft,
          requirePublicGlobalPrompt: !requestIsSuperadmin
        })
      : null;
    if (requestedPromptTemplateId && !requestedPromptSelection) {
      throw new ManualTradingError(
        "Selected AI prompt is not available.",
        400,
        "invalid_ai_prompt_template"
      );
    }
    const selectedPromptIsOwn = Boolean(requestedPromptSelection?.isOwnTemplate);
    if (selectedPromptIsOwn) {
      const strategyFeatureEnabled = options?.userEmail
        ? await isStrategyFeatureEnabledForUser({
            id: userId,
            email: options.userEmail
          })
        : (
            Boolean(options?.hasAdminBackendAccess || options?.isSuperadmin)
            || Boolean((await getAccessSectionSettings()).visibility.strategy)
          );
      if (!strategyFeatureEnabled) {
        throw new ManualTradingError(
          "Own strategies are currently disabled by access settings.",
          403,
          "forbidden"
        );
      }
    }
    if (selectedStrategyRef?.kind === "ai" && requestedPromptSelection?.templateName) {
      selectedStrategyRef = {
        ...selectedStrategyRef,
        name: requestedPromptSelection.templateName
      };
    }
    const selectedKind: "ai" | "local" | "composite" =
      selectedStrategyRef?.kind ?? "ai";
    const predictionLimitBucket = resolvePredictionLimitBucketFromStrategy({
      strategyRef: selectedStrategyRef,
      signalMode
    });
    const selectedId =
      selectedStrategyRef?.id
      ?? (
        selectedKind === "ai"
          ? (selectedPromptIsOwn ? null : (requestedPromptTemplateId ?? "default"))
          : null
      );
    const strategyAccess = evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: selectedKind,
      strategyId: selectedId,
      aiModel: selectedKind === "ai" ? await getAiModelAsync() : null,
      compositeNodes:
        selectedKind === "composite"
          ? countCompositeStrategyNodes(selectedCompositeStrategy)
          : null
    });
    if (!strategyAccess.allowed) {
      throw new ManualTradingError(
        "Selected strategy is blocked by license entitlements.",
        403,
        `strategy_license_blocked:${strategyAccess.reason}`
      );
    }
    const promptLicenseDecision = selectedPromptIsOwn
      ? {
          allowed: true,
          reason: "ok" as const,
          mode: "off" as const,
          wouldBlock: false
        }
      : evaluateAiPromptAccess({
          userId,
          selectedPromptId: requestedPromptTemplateId
        });
    if (!promptLicenseDecision.allowed) {
      throw new ManualTradingError(
        "Selected AI prompt is blocked by license policy.",
        403,
        "ai_prompt_license_blocked"
      );
    }
    if (promptLicenseDecision.wouldBlock) {
      // eslint-disable-next-line no-console
      console.warn("[license] ai prompt selection would be blocked in enforce mode", {
        userId,
        selectedPromptId: requestedPromptTemplateId,
        mode: promptLicenseDecision.mode
      });
    }
    const selectedPromptSettings = requestedPromptTemplateId
      ? requestedPromptSelection?.runtimeSettings ?? null
      : await getAiPromptRuntimeSettings(promptScopeContextDraft);
    if (requestedPromptTemplateId && !selectedPromptSettings) {
      throw new ManualTradingError(
        "Selected AI prompt is not available.",
        400,
        "invalid_ai_prompt_template"
      );
    }
    const promptTimeframeConfig = normalizePromptTimeframeSetForRuntime(
      selectedPromptSettings,
      requestedTimeframe
    );
    const allowPromptTimeframeOverride =
      !selectedStrategyRef || selectedStrategyRef.kind === "ai";
    const effectiveTimeframe = (
      allowPromptTimeframeOverride
        ? promptTimeframeConfig.runTimeframe
        : requestedTimeframe
    ) as PredictionTimeframe;
    const effectivePromptTimeframes = allowPromptTimeframeOverride
      ? promptTimeframeConfig.timeframes
      : [requestedTimeframe];
    const effectiveDirectionPreference = parseDirectionPreference(
      selectedPromptSettings?.directionPreference
    );
    const effectiveConfidenceTargetPct = clamp(
      Number(selectedPromptSettings?.confidenceTargetPct ?? 60),
      0,
      100
    );
    const promptScopeContext = {
      ...promptScopeContextDraft,
      timeframe: effectiveTimeframe
    };
    const requestedStrategyRefForScope: PredictionStrategyRef | null =
      selectedStrategyRef?.kind === "ai"
        ? {
            kind: "ai",
            id: selectedPromptSettings?.activePromptId ?? selectedStrategyRef.id,
            name: selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name
          }
        : selectedStrategyRef;
    const existingStateId = await findPredictionStateIdByScope({
      userId,
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signalMode,
      strategyRef: requestedStrategyRefForScope
    });
    if (existingStateId) {
      const existingState = await db.predictionState.findUnique({
        where: { id: existingStateId },
        select: {
          id: true,
          timeframe: true,
          signalMode: true,
          signal: true,
          expectedMovePct: true,
          confidence: true,
          explanation: true,
          tags: true,
          keyDrivers: true,
          featuresSnapshot: true,
          modelVersion: true,
          tsUpdated: true,
          directionPreference: true,
          confidenceTargetPct: true
        }
      });
      if (existingState) {
        const existingSnapshot = asRecord(existingState.featuresSnapshot);
        const existingStrategyRef = readPredictionStrategyRef(existingSnapshot);
        const existingSignal: PredictionSignal =
          existingState.signal === "up" || existingState.signal === "down" || existingState.signal === "neutral"
            ? existingState.signal
            : "neutral";
        const existingExpectedMovePct = Number.isFinite(Number(existingState.expectedMovePct))
          ? Number(clamp(Math.abs(Number(existingState.expectedMovePct)), 0, 25).toFixed(2))
          : 0;
        const existingConfidence = Number.isFinite(Number(existingState.confidence))
          ? Number(clamp(Number(existingState.confidence), 0, 1).toFixed(4))
          : 0;
        const existingTimeframe = normalizePredictionTimeframeCandidate(existingState.timeframe)
          ?? effectiveTimeframe;
        const existingSignalMode = normalizePredictionSignalMode(existingState.signalMode);
        const existingSignalSource = readSelectedSignalSource(existingSnapshot);
        const existingAiPrediction =
          readAiPredictionSnapshot(existingSnapshot)
          ?? {
            signal: existingSignal,
            expectedMovePct: existingExpectedMovePct,
            confidence: existingConfidence
          };
        const existingTags = normalizeTagList(existingState.tags);
        const existingKeyDrivers = normalizeKeyDriverList(existingState.keyDrivers);
        return {
          persisted: false,
          existing: true,
          existingStateId: existingState.id,
          prediction: {
            signal: existingSignal,
            expectedMovePct: existingExpectedMovePct,
            confidence: existingConfidence
          },
          timeframe: existingTimeframe,
          directionPreference: parseDirectionPreference(existingState.directionPreference),
          confidenceTargetPct: Number.isFinite(Number(existingState.confidenceTargetPct))
            ? clamp(Number(existingState.confidenceTargetPct), 0, 100)
            : effectiveConfidenceTargetPct,
          signalSource: existingSignalSource,
          signalMode: existingSignalMode,
          explanation: {
            explanation:
              typeof existingState.explanation === "string" && existingState.explanation.trim()
                ? existingState.explanation
                : "Existing prediction schedule reused for this scope.",
            tags: existingTags,
            keyDrivers: existingKeyDrivers,
            aiPrediction: existingAiPrediction,
            disclaimer: "grounded_features_only"
          },
          modelVersion: existingState.modelVersion,
          predictionId: null,
          tsCreated: existingState.tsUpdated.toISOString(),
          aiPromptTemplateId: readAiPromptTemplateId(existingSnapshot),
          aiPromptTemplateName: readAiPromptTemplateName(existingSnapshot),
          localStrategyId: readLocalStrategyId(existingSnapshot),
          localStrategyName: readLocalStrategyName(existingSnapshot),
          compositeStrategyId: readCompositeStrategyId(existingSnapshot),
          compositeStrategyName: readCompositeStrategyName(existingSnapshot),
          strategyRef: existingStrategyRef
        };
      }
    }
    const predictionCreateAccess = await canCreatePredictionForUser({
      userId,
      bypass: Boolean(options?.hasAdminBackendAccess || options?.isSuperadmin),
      bucket: predictionLimitBucket,
      existingStateId,
      consumesSlot: true
    });
    if (!predictionCreateAccess.allowed) {
      const code = predictionLimitExceededCode(predictionLimitBucket);
      throw new ManualTradingError(
        code,
        403,
        code
      );
    }
    const indicatorSettingsResolution = await resolveIndicatorSettings({
      db,
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      symbol: canonicalSymbol,
      timeframe: effectiveTimeframe
    });
    const indicatorComputeSettings = toIndicatorComputeSettings(indicatorSettingsResolution.config);
    const advancedIndicatorSettings = toAdvancedIndicatorComputeSettings(indicatorSettingsResolution.config);

    const exchangeSymbol = await adapter.toExchangeSymbol(canonicalSymbol);
    const candleLookback = resolvePredictionCandleLookback({
      timeframe: effectiveTimeframe,
      indicatorSettings: indicatorComputeSettings,
      baseMinBars: 120
    });
    const [tickerRaw, candlesRaw] = await Promise.all([
      adapter.marketApi.getTicker(exchangeSymbol, adapter.productType),
      adapter.marketApi.getCandles({
        symbol: exchangeSymbol,
        productType: adapter.productType,
        granularity: timeframeToBitgetGranularity(effectiveTimeframe),
        limit: candleLookback
      })
    ]);

    const candles = parseBitgetCandles(candlesRaw);
    const alignedCandles = bucketCandles(candles, effectiveTimeframe);
    if (alignedCandles.length < 20) {
      throw new ManualTradingError(
        "Not enough candle data to generate prediction.",
        422,
        "insufficient_market_data"
      );
    }

    const closes = alignedCandles.map((row) => row.close);
    const highs = alignedCandles.map((row) => row.high);
    const lows = alignedCandles.map((row) => row.low);
    const indicators = computeIndicators(alignedCandles, effectiveTimeframe, {
      exchange: account.exchange,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      logVwapMetrics: true,
      settings: indicatorComputeSettings
    });
    const advancedIndicators = computeAdvancedIndicators(
      alignedCandles,
      effectiveTimeframe,
      advancedIndicatorSettings
    );
    const ticker = normalizeTickerPayload(coerceFirstItem(tickerRaw));
    const referencePrice = ticker.mark ?? ticker.last ?? closes[closes.length - 1];
    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      throw new ManualTradingError(
        "Cannot determine reference price from market data.",
        422,
        "invalid_reference_price"
      );
    }

    const thresholdResolution = await resolveFeatureThresholds({
      exchange: account.exchange,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe
    });

    const inferred = inferPredictionFromMarket({
      closes,
      highs,
      lows,
      indicators,
      referencePrice,
      timeframe: effectiveTimeframe,
      directionPreference: effectiveDirectionPreference,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      leverage: payload.leverage,
      marketType: payload.marketType,
      exchangeAccountId: payload.exchangeAccountId,
      exchange: account.exchange,
      thresholdResolution
    });

    const quality = await getPredictionQualityContext(
      userId,
      canonicalSymbol,
      effectiveTimeframe,
      payload.marketType
    );
    const newsBlackout = await evaluateNewsRiskForSymbol({
      db,
      symbol: canonicalSymbol,
      now: new Date()
    });

    inferred.featureSnapshot.autoScheduleEnabled = true;
    inferred.featureSnapshot.autoSchedulePaused = false;
    inferred.featureSnapshot.directionPreference = effectiveDirectionPreference;
    inferred.featureSnapshot.confidenceTargetPct = effectiveConfidenceTargetPct;
    inferred.featureSnapshot.promptTimeframe =
      selectedPromptSettings?.runTimeframe
      ?? selectedPromptSettings?.timeframe
      ?? null;
    inferred.featureSnapshot.promptTimeframes = effectivePromptTimeframes;
    inferred.featureSnapshot.promptSlTpSource = selectedPromptSettings?.slTpSource ?? "local";
    inferred.featureSnapshot.promptRunTimeframe = allowPromptTimeframeOverride
      ? effectiveTimeframe
      : null;
    inferred.featureSnapshot.requestedTimeframe = requestedTimeframe;
    inferred.featureSnapshot.requestedLeverage = payload.leverage ?? null;
    inferred.featureSnapshot.prefillExchangeAccountId = payload.exchangeAccountId;
    inferred.featureSnapshot.prefillExchange = account.exchange;
    inferred.featureSnapshot.qualityWinRatePct = quality.winRatePct;
    inferred.featureSnapshot.qualitySampleSize = quality.sampleSize;
    inferred.featureSnapshot.qualityAvgOutcomePnlPct = quality.avgOutcomePnlPct;
    inferred.featureSnapshot.qualityTpCount = quality.tpCount;
    inferred.featureSnapshot.qualitySlCount = quality.slCount;
    inferred.featureSnapshot.qualityExpiredCount = quality.expiredCount;
    inferred.featureSnapshot.advancedIndicators = advancedIndicators;
    inferred.featureSnapshot.ohlcvSeries = buildOhlcvSeriesFeature(
      alignedCandles,
      effectiveTimeframe
    );
    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: inferred.featureSnapshot,
      candles: alignedCandles,
      timeframe: effectiveTimeframe,
      indicators,
      advancedIndicators,
      exchange: account.exchange,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    if (allowPromptTimeframeOverride && effectivePromptTimeframes.length > 0) {
      inferred.featureSnapshot.mtf = await buildMtfFramesForPrediction({
        adapter,
        exchange: account.exchange,
        accountId: payload.exchangeAccountId,
        symbol: canonicalSymbol,
        marketType: payload.marketType,
        timeframes: effectivePromptTimeframes,
        runTimeframe: effectiveTimeframe,
        runFrame: {
          candles: alignedCandles,
          indicators,
          advancedIndicators
        }
      });
    } else {
      delete inferred.featureSnapshot.mtf;
    }
    inferred.featureSnapshot.aiPromptTemplateRequestedId = requestedPromptTemplateId;
    inferred.featureSnapshot.aiPromptTemplateId =
      selectedPromptSettings?.activePromptId ?? requestedPromptTemplateId;
    inferred.featureSnapshot.aiPromptTemplateName =
      selectedPromptSettings?.activePromptName ?? null;
    inferred.featureSnapshot.aiPromptMarketAnalysisUpdateEnabled =
      selectedStrategyRef?.kind === "ai"
        ? Boolean(selectedPromptSettings?.marketAnalysisUpdateEnabled)
        : false;
    inferred.featureSnapshot.localStrategyId = selectedLocalStrategy?.id ?? null;
    inferred.featureSnapshot.localStrategyName = selectedLocalStrategy?.name ?? null;
    inferred.featureSnapshot.aiPromptLicenseMode = promptLicenseDecision.mode;
    inferred.featureSnapshot.aiPromptLicenseWouldBlock = promptLicenseDecision.wouldBlock;
    inferred.featureSnapshot.compositeStrategyId = requestedCompositeStrategyId ?? null;
    inferred.featureSnapshot.compositeStrategyName = selectedCompositeStrategy?.name ?? null;
    inferred.featureSnapshot.strategyRef = selectedStrategyRef
      ? { kind: selectedStrategyRef.kind, id: selectedStrategyRef.id, name: selectedStrategyRef.name }
      : null;
    const strategyRefForInitialSnapshot: PredictionStrategyRef | null =
      selectedStrategyRef?.kind === "ai"
        ? {
            kind: "ai",
            id: selectedPromptSettings?.activePromptId ?? selectedStrategyRef.id,
            name: selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name
          }
        : selectedStrategyRef;
    inferred.featureSnapshot = withStrategyRunSnapshot(
      inferred.featureSnapshot,
      {
        strategyRef: strategyRefForInitialSnapshot,
        status: "skipped",
        signal: inferred.prediction.signal,
        expectedMovePct: inferred.prediction.expectedMovePct,
        confidence: inferred.prediction.confidence,
        source: resolvePreferredSignalSourceForMode(
          signalMode,
          PREDICTION_PRIMARY_SIGNAL_SOURCE
        ),
        aiCalled: false,
        explanation: "Initial prediction created; strategy runner will apply on refresh cycle.",
        tags: normalizeTagList(inferred.featureSnapshot.tags),
        keyDrivers: [],
        ts: new Date().toISOString()
      },
      {
        phase: "initial_generate",
        strategyRef: strategyRefForInitialSnapshot
      }
    );
    inferred.featureSnapshot.meta = {
      ...(asRecord(inferred.featureSnapshot.meta) ?? {}),
      indicatorSettingsHash: indicatorSettingsResolution.hash
    };
    if (advancedIndicators.dataGap) {
      const riskFlags = asRecord(inferred.featureSnapshot.riskFlags) ?? {};
      inferred.featureSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    inferred.featureSnapshot = applyNewsRiskToFeatureSnapshot(
      inferred.featureSnapshot,
      newsBlackout
    );
    const globalNewsRiskBlockEnabled = await readGlobalNewsRiskEnforcement();
    const strategyNewsRiskMode = resolveStrategyNewsRiskMode({
      strategyRef: strategyRefForInitialSnapshot,
      promptSettings: selectedPromptSettings,
      localStrategy: selectedLocalStrategy,
      compositeStrategy: selectedCompositeStrategy
    });
    const newsRiskBlocked = shouldBlockByNewsRisk({
      featureSnapshot: inferred.featureSnapshot,
      globalEnabled: globalNewsRiskBlockEnabled,
      strategyMode: strategyNewsRiskMode
    });
    if (newsRiskBlocked) {
      inferred.featureSnapshot = withStrategyRunSnapshot(
        inferred.featureSnapshot,
        {
          strategyRef: strategyRefForInitialSnapshot,
          status: "fallback",
          signal: "neutral",
          expectedMovePct: 0,
          confidence: 0,
          source: resolvePreferredSignalSourceForMode(
            signalMode,
            PREDICTION_PRIMARY_SIGNAL_SOURCE
          ),
          aiCalled: false,
          explanation: "News blackout active; setup suspended.",
          tags: ["news_risk"],
          keyDrivers: [
            { name: "featureSnapshot.newsRisk", value: true },
            { name: "policy.reasonCode", value: "news_risk_blocked" }
          ],
          ts: new Date().toISOString()
        },
        {
          phase: "initial_generate",
          strategyRef: strategyRefForInitialSnapshot,
          reasonCode: "news_risk_blocked",
          strategyNewsRiskMode
        }
      );
    }

    const tsCreated = new Date().toISOString();
    const selectedSignalSource = resolvePreferredSignalSourceForMode(
      signalMode,
      PREDICTION_PRIMARY_SIGNAL_SOURCE
    );
    const created = await generateAndPersistPrediction({
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      tsCreated,
      prediction: inferred.prediction,
      featureSnapshot: inferred.featureSnapshot,
      signalMode,
      preferredSignalSource: selectedSignalSource,
      tracking: inferred.tracking,
      userId,
      botId: null,
      modelVersionBase: payload.modelVersionBase ?? "baseline-v1:auto-market-v1",
      promptSettings: selectedPromptSettings ?? undefined,
      promptScopeContext,
      newsRiskBlocked: newsRiskBlocked
        ? {
            reasonCode: "news_risk_blocked",
            strategyMode: strategyNewsRiskMode
          }
        : null
    });
    const featureSnapshotForState = created.featureSnapshot;

    const stateTags = enforceNewsRiskTag(
      created.explanation.tags.length > 0
        ? created.explanation.tags
        : featureSnapshotForState.tags,
      featureSnapshotForState
    );
    const stateKeyDrivers = normalizeKeyDriverList(created.explanation.keyDrivers);
    const stateTs = new Date(tsCreated);
    const stateHash = buildPredictionChangeHash({
      signal: created.prediction.signal,
      confidence: created.prediction.confidence,
      tags: stateTags,
      keyDrivers: stateKeyDrivers,
      featureSnapshot: featureSnapshotForState
    });

    const stateData = {
      ...toPredictionStateStrategyScope(strategyRefForInitialSnapshot),
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      userId,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signalMode,
      tsUpdated: stateTs,
      tsPredictedFor: new Date(stateTs.getTime() + timeframeToIntervalMs(effectiveTimeframe)),
      signal: created.prediction.signal,
      expectedMovePct: Number.isFinite(Number(created.prediction.expectedMovePct))
        ? Number(created.prediction.expectedMovePct)
        : null,
      confidence: Number.isFinite(Number(created.prediction.confidence))
        ? Number(created.prediction.confidence)
        : 0,
      tags: stateTags,
      explanation: created.explanation.explanation,
      keyDrivers: stateKeyDrivers,
      featuresSnapshot: featureSnapshotForState,
      modelVersion: created.modelVersion,
      lastAiExplainedAt: signalMode === "local_only" ? null : stateTs,
      lastChangeHash: stateHash,
      lastChangeReason: "manual",
      autoScheduleEnabled: true,
      autoSchedulePaused: false,
      directionPreference: effectiveDirectionPreference,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      leverage: payload.leverage ?? null
    };

    const stateRow = await persistPredictionState({
      existingStateId,
      stateData,
      scope: {
        userId,
        exchange: account.exchange,
        accountId: payload.exchangeAccountId,
        symbol: canonicalSymbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signalMode
      }
    });

    await db.predictionEvent.create({
      data: {
        stateId: stateRow.id,
        changeType: "manual",
        prevSnapshot: null,
        newSnapshot: {
          signal: created.prediction.signal,
          confidence: created.prediction.confidence,
          expectedMovePct: created.prediction.expectedMovePct,
          tags: stateTags
        },
        delta: {
          reason: "manual_create"
        },
        horizonEvalRef: created.rowId,
        modelVersion: created.modelVersion,
        reason: "manual_create"
      }
    });

    await notifyTradablePrediction({
      userId,
      exchange: account.exchange,
      exchangeAccountLabel: account.label,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signal: created.prediction.signal,
      confidence: created.prediction.confidence,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      expectedMovePct: created.prediction.expectedMovePct,
      predictionId: created.rowId,
      explanation: created.explanation.explanation,
      source: "auto",
      signalSource: created.signalSource,
      aiPromptTemplateName: resolveNotificationStrategyName({
        signalSource: created.signalSource,
        snapshot: featureSnapshotForState,
        strategyRef: strategyRefForInitialSnapshot,
        aiPromptTemplateName: selectedPromptSettings?.activePromptName ?? null
      })
    });
    if (readAiPromptMarketAnalysisUpdateEnabled(featureSnapshotForState)) {
      await notifyMarketAnalysisUpdate({
        userId,
        exchange: account.exchange,
        exchangeAccountLabel: account.label,
        symbol: canonicalSymbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signal: created.prediction.signal,
        confidence: created.prediction.confidence,
        expectedMovePct: created.prediction.expectedMovePct,
        predictionId: created.rowId,
        explanation: created.explanation.explanation,
        source: "auto",
        signalSource: created.signalSource,
        aiPromptTemplateName: resolveNotificationStrategyName({
          signalSource: created.signalSource,
          snapshot: featureSnapshotForState,
          strategyRef: strategyRefForInitialSnapshot,
          aiPromptTemplateName: selectedPromptSettings?.activePromptName ?? null
        })
      });
    }

    return {
      persisted: created.persisted,
      prediction: created.prediction,
      timeframe: effectiveTimeframe,
      directionPreference: effectiveDirectionPreference,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      explanation: created.explanation,
      modelVersion: created.modelVersion,
      predictionId: created.rowId,
      tsCreated,
      signalSource: created.signalSource,
      signalMode,
      aiPromptTemplateId:
        selectedPromptSettings?.activePromptId ?? requestedPromptTemplateId,
      aiPromptTemplateName:
        selectedPromptSettings?.activePromptName ?? null,
      localStrategyId: selectedLocalStrategy?.id ?? null,
      localStrategyName: selectedLocalStrategy?.name ?? null,
      compositeStrategyId: selectedCompositeStrategy?.id ?? null,
      compositeStrategyName: selectedCompositeStrategy?.name ?? null,
      strategyRef: selectedStrategyRef
        ? {
            kind: selectedStrategyRef.kind,
            id: selectedStrategyRef.id,
            name:
              selectedStrategyRef.kind === "ai"
                ? (selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name)
                : selectedStrategyRef.name
          }
        : null
    };
  } finally {
    await adapter.close();
  }
}

function resolveLastSyncAt(runtime: {
  lastHeartbeatAt?: Date | null;
  lastTickAt?: Date | null;
  updatedAt?: Date | null;
} | null | undefined): Date | null {
  if (!runtime) return null;
  const values = [runtime.lastHeartbeatAt, runtime.lastTickAt, runtime.updatedAt]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime());
  return values[0] ?? null;
}

function computeConnectionStatus(
  lastSyncAt: Date | null,
  hasBotActivity: boolean
): DashboardConnectionStatus {
  if (!lastSyncAt) return hasBotActivity ? "disconnected" : "degraded";
  const ageMs = Date.now() - lastSyncAt.getTime();
  if (ageMs <= DASHBOARD_CONNECTED_WINDOW_MS) return "connected";
  // Passive accounts (no running/error bot activity) should not be shown as disconnected
  // only because the last sync is old.
  if (!hasBotActivity) return "degraded";
  if (ageMs <= DASHBOARD_DEGRADED_WINDOW_MS) return "degraded";
  return "disconnected";
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeRiskProfileWithDefaults(profile: any): RiskLimitValues {
  const asValue = (value: unknown, fallback: number): number => {
    const parsed = toFiniteNumber(value);
    if (parsed === null) return fallback;
    return parsed >= 0 ? parsed : fallback;
  };

  return {
    dailyLossWarnPct: asValue(profile?.dailyLossWarnPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossWarnPct),
    dailyLossWarnUsd: asValue(profile?.dailyLossWarnUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossWarnUsd),
    dailyLossCriticalPct: asValue(profile?.dailyLossCriticalPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossCriticalPct),
    dailyLossCriticalUsd: asValue(profile?.dailyLossCriticalUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossCriticalUsd),
    marginWarnPct: asValue(profile?.marginWarnPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginWarnPct),
    marginWarnUsd: asValue(profile?.marginWarnUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginWarnUsd),
    marginCriticalPct: asValue(profile?.marginCriticalPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginCriticalPct),
    marginCriticalUsd: asValue(profile?.marginCriticalUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginCriticalUsd)
  };
}

function validateRiskLimitValues(limits: RiskLimitValues): string[] {
  const issues: string[] = [];
  if (limits.dailyLossCriticalPct < limits.dailyLossWarnPct) {
    issues.push("dailyLossCriticalPct must be greater than or equal to dailyLossWarnPct");
  }
  if (limits.dailyLossCriticalUsd < limits.dailyLossWarnUsd) {
    issues.push("dailyLossCriticalUsd must be greater than or equal to dailyLossWarnUsd");
  }
  if (limits.marginCriticalPct > limits.marginWarnPct) {
    issues.push("marginCriticalPct must be less than or equal to marginWarnPct");
  }
  if (limits.marginCriticalUsd > limits.marginWarnUsd) {
    issues.push("marginCriticalUsd must be less than or equal to marginWarnUsd");
  }
  return issues;
}

function riskSeverityRank(value: RiskSeverity): number {
  if (value === "critical") return 3;
  if (value === "warning") return 2;
  return 1;
}

function computeAccountRiskAssessment(
  account: {
    pnlTodayUsd?: unknown;
    futuresBudgetEquity?: unknown;
    futuresBudgetAvailableMargin?: unknown;
  },
  limits: RiskLimitValues
): AccountRiskAssessment {
  const equity = toFiniteNumber(account.futuresBudgetEquity);
  const availableMargin = toFiniteNumber(account.futuresBudgetAvailableMargin);
  const pnlToday = toFiniteNumber(account.pnlTodayUsd);
  const safePnlToday = pnlToday ?? 0;
  const lossUsd = safePnlToday < 0 ? Number(Math.abs(safePnlToday).toFixed(6)) : 0;
  const lossPct = equity !== null && equity > 0
    ? Number(((lossUsd / equity) * 100).toFixed(4))
    : null;
  const marginPct = equity !== null && equity > 0 && availableMargin !== null
    ? Number(((availableMargin / equity) * 100).toFixed(4))
    : null;

  const dailyWarn =
    (lossPct !== null && lossPct >= limits.dailyLossWarnPct) ||
    lossUsd >= limits.dailyLossWarnUsd;
  const dailyCritical =
    (lossPct !== null && lossPct >= limits.dailyLossCriticalPct) ||
    lossUsd >= limits.dailyLossCriticalUsd;
  const marginWarn =
    (marginPct !== null && marginPct <= limits.marginWarnPct) ||
    (availableMargin !== null && availableMargin <= limits.marginWarnUsd);
  const marginCritical =
    (marginPct !== null && marginPct <= limits.marginCriticalPct) ||
    (availableMargin !== null && availableMargin <= limits.marginCriticalUsd);

  const insufficientData =
    equity === null || equity <= 0 || availableMargin === null;
  const severity: RiskSeverity =
    dailyCritical || marginCritical
      ? "critical"
      : dailyWarn || marginWarn || insufficientData
        ? "warning"
        : "ok";

  const triggers: RiskTrigger[] = [];
  if (dailyWarn || dailyCritical) triggers.push("dailyLoss");
  if (marginWarn || marginCritical) triggers.push("margin");
  if (insufficientData) triggers.push("insufficientData");

  let riskScore = 0;
  if (dailyWarn) riskScore += 28;
  if (dailyCritical) riskScore += 72;
  if (marginWarn) riskScore += 28;
  if (marginCritical) riskScore += 72;
  if (insufficientData) riskScore += 25;
  if (lossPct !== null) {
    riskScore += Math.max(0, lossPct - limits.dailyLossWarnPct) * 2;
  }
  if (lossUsd > 0) {
    riskScore += (Math.max(0, lossUsd - limits.dailyLossWarnUsd) / Math.max(1, limits.dailyLossWarnUsd)) * 24;
  }
  if (marginPct !== null) {
    riskScore += Math.max(0, limits.marginWarnPct - marginPct) * 2;
  }
  if (availableMargin !== null) {
    riskScore += (Math.max(0, limits.marginWarnUsd - availableMargin) / Math.max(1, limits.marginWarnUsd)) * 20;
  }

  return {
    severity,
    triggers,
    riskScore: Number(riskScore.toFixed(4)),
    insufficientData,
    lossUsd,
    lossPct,
    marginPct,
    availableMarginUsd: availableMargin,
    pnlTodayUsd: pnlToday
  };
}

function toSettingsRiskItem(account: any, limits: RiskLimitValues) {
  const assessment = computeAccountRiskAssessment(account, limits);
  return {
    exchangeAccountId: String(account.id),
    exchange: String(account.exchange ?? ""),
    label: String(account.label ?? ""),
    lastSyncAt: toIso(account.lastUsedAt),
    limits: {
      ...limits
    },
    preview: {
      lossUsd: assessment.lossUsd,
      lossPct: assessment.lossPct,
      marginPct: assessment.marginPct,
      availableMarginUsd: assessment.availableMarginUsd,
      pnlTodayUsd: assessment.pnlTodayUsd,
      severity: assessment.severity,
      triggers: assessment.triggers
    }
  };
}

function createDashboardAlertId(parts: Array<string | null | undefined>): string {
  const seed = parts.filter(Boolean).join("|");
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function alertSeverityRank(value: DashboardAlertSeverity): number {
  if (value === "critical") return 3;
  if (value === "warning") return 2;
  return 1;
}

function toSafeUser(user: { id: string; email: string }) {
  return { id: user.id, email: user.email };
}

function toAuthMePayload(
  user: { id: string; email: string },
  ctx: {
    workspaceId: string;
    permissions: Record<string, unknown>;
    isSuperadmin: boolean;
    hasAdminBackendAccess: boolean;
  }
) {
  const safeUser = toSafeUser(user);
  return {
    user: safeUser,
    id: safeUser.id,
    email: safeUser.email,
    workspaceId: ctx.workspaceId,
    permissions: ctx.permissions,
    isSuperadmin: ctx.isSuperadmin,
    hasAdminBackendAccess: ctx.hasAdminBackendAccess
  };
}

function normalizeCopierTimeframe(value: unknown): "5m" | "15m" | "1h" | "4h" | null {
  const raw = String(value ?? "").trim();
  if (raw === "5m" || raw === "15m" || raw === "1h" || raw === "4h") return raw;
  return null;
}

function readPredictionCopierRootConfig(paramsJson: unknown): { root: Record<string, unknown>; nested: boolean } {
  const params = asRecord(paramsJson);
  const nested = asRecord(params.predictionCopier);
  if (Object.keys(nested).length > 0) {
    return { root: nested, nested: true };
  }
  return { root: params, nested: false };
}

function writePredictionCopierRootConfig(paramsJson: unknown, root: Record<string, unknown>, forceNested = true): Record<string, unknown> {
  const params = asRecord(paramsJson);
  if (forceNested || Object.prototype.hasOwnProperty.call(params, "predictionCopier")) {
    return {
      ...params,
      predictionCopier: root
    };
  }
  return {
    ...params,
    ...root
  };
}

function readPredictionCopierSettingsFromParams(paramsJson: unknown): z.infer<typeof predictionCopierSettingsSchema> | null {
  const { root } = readPredictionCopierRootConfig(paramsJson);
  const parsed = predictionCopierSettingsSchema.safeParse(root);
  return parsed.success ? parsed.data : null;
}

function readPredictionSourceSnapshotFromState(state: any): Record<string, unknown> {
  const snapshot = asRecord(state?.featuresSnapshot);
  const signalMode = readStateSignalMode(state?.signalMode, snapshot);
  const timeframe = normalizeCopierTimeframe(state?.timeframe);
  const snapshotStrategyRef = readPredictionStrategyRef(snapshot);
  const rowKind = normalizePredictionStrategyKind(state?.strategyKind);
  const rowStrategyId = typeof state?.strategyId === "string" && state.strategyId.trim()
    ? state.strategyId.trim()
    : null;
  const strategyRef = snapshotStrategyRef ?? (rowKind && rowStrategyId
    ? { kind: rowKind, id: rowStrategyId, name: null }
    : null);

  return {
    stateId: String(state?.id ?? ""),
    accountId: String(state?.accountId ?? ""),
    symbol: normalizeSymbolInput(String(state?.symbol ?? "")),
    ...(timeframe ? { timeframe } : {}),
    signalMode,
    strategyRef: strategyRef ? `${strategyRef.kind}:${strategyRef.id}` : null,
    strategyKind: strategyRef?.kind ?? null,
    strategyId: strategyRef?.id ?? null,
    strategyName: strategyRef?.name ?? null
  };
}

async function findPredictionSourceStateForCopier(params: {
  userId: string;
  exchangeAccountId: string;
  sourceStateId: string;
  requireActive?: boolean;
}) {
  return db.predictionState.findFirst({
    where: {
      id: params.sourceStateId,
      userId: params.userId,
      accountId: params.exchangeAccountId,
      ...(params.requireActive
        ? {
            autoScheduleEnabled: true,
            autoSchedulePaused: false
          }
        : {})
    },
    select: {
      id: true,
      accountId: true,
      symbol: true,
      timeframe: true,
      signalMode: true,
      strategyKind: true,
      strategyId: true,
      featuresSnapshot: true,
      autoScheduleEnabled: true,
      autoSchedulePaused: true,
      signal: true,
      confidence: true,
      tsUpdated: true,
      lastChangeReason: true
    }
  });
}

async function findLegacyPredictionSourceForCopier(params: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "4h";
}) {
  return db.predictionState.findFirst({
    where: {
      userId: params.userId,
      accountId: params.exchangeAccountId,
      marketType: "perp",
      symbol: normalizeSymbolInput(params.symbol),
      timeframe: params.timeframe,
      autoScheduleEnabled: true,
      autoSchedulePaused: false
    },
    orderBy: [{ tsUpdated: "desc" }],
    select: {
      id: true,
      accountId: true,
      symbol: true,
      timeframe: true,
      signalMode: true,
      strategyKind: true,
      strategyId: true,
      featuresSnapshot: true,
      autoScheduleEnabled: true,
      autoSchedulePaused: true,
      signal: true,
      confidence: true,
      tsUpdated: true,
      lastChangeReason: true
    }
  });
}

function toSafeBot(bot: any) {
  const predictionCopier = bot?.futuresConfig?.strategyKey === "prediction_copier"
    ? readPredictionCopierSettingsFromParams(bot?.futuresConfig?.paramsJson)
    : null;
  return {
    id: bot.id,
    userId: bot.userId,
    exchangeAccountId: bot.exchangeAccountId ?? null,
    name: bot.name,
    exchange: bot.exchange,
    symbol: bot.symbol,
    status: bot.status,
    lastError: bot.lastError ?? null,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    exchangeAccount: bot.exchangeAccount
      ? {
          id: bot.exchangeAccount.id,
          exchange: bot.exchangeAccount.exchange,
          label: bot.exchangeAccount.label
        }
      : null,
    futuresConfig: bot.futuresConfig
      ? {
          strategyKey: bot.futuresConfig.strategyKey,
          marginMode: bot.futuresConfig.marginMode,
          leverage: bot.futuresConfig.leverage,
          tickMs: bot.futuresConfig.tickMs,
          paramsJson: bot.futuresConfig.paramsJson,
          predictionCopier
        }
      : null,
    runtime: bot.runtime
      ? {
          status: bot.runtime.status,
          reason: bot.runtime.reason,
          updatedAt: bot.runtime.updatedAt,
          workerId: bot.runtime.workerId ?? null,
          lastHeartbeatAt: bot.runtime.lastHeartbeatAt ?? null,
          lastTickAt: bot.runtime.lastTickAt ?? null,
          lastError: bot.runtime.lastError ?? null,
          consecutiveErrors: bot.runtime.consecutiveErrors ?? 0,
          errorWindowStartAt: bot.runtime.errorWindowStartAt ?? null,
          lastErrorAt: bot.runtime.lastErrorAt ?? null,
          lastErrorMessage: bot.runtime.lastErrorMessage ?? null
        }
      : null
  };
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

type ExchangeAccountSecrets = {
  id: string;
  userId: string;
  exchange: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
};

function normalizeSyncErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.slice(0, 500);
}

function bucketTimestampBySeconds(at: Date, bucketSeconds: number): Date {
  const bucketMs = Math.max(1, bucketSeconds) * 1000;
  return new Date(Math.floor(at.getTime() / bucketMs) * bucketMs);
}

type DashboardPerformanceTotals = Omit<DashboardOverviewTotals, "currency">;
type BotRealizedAccountSummary = {
  pnl: number;
  count: number;
};

async function aggregateDashboardPerformanceTotalsForUser(userId: string): Promise<DashboardPerformanceTotals> {
  const accounts = await db.exchangeAccount.findMany({
    where: { userId },
    select: {
      spotBudgetTotal: true,
      futuresBudgetEquity: true,
      futuresBudgetAvailableMargin: true,
      pnlTodayUsd: true
    }
  });

  const reduced = (Array.isArray(accounts) ? accounts : []).reduce(
    (acc: DashboardPerformanceTotals, row: any) => {
      const spotTotal = toFiniteNumber(row.spotBudgetTotal);
      const futuresEquity = toFiniteNumber(row.futuresBudgetEquity);
      const availableMargin = toFiniteNumber(row.futuresBudgetAvailableMargin);
      const pnlToday = toFiniteNumber(row.pnlTodayUsd);

      let contributes = false;

      if (spotTotal !== null) {
        acc.totalEquity += spotTotal;
        contributes = true;
      }
      if (futuresEquity !== null) {
        acc.totalEquity += futuresEquity;
        contributes = true;
      }
      if (availableMargin !== null) {
        acc.totalAvailableMargin += availableMargin;
        contributes = true;
      }
      if (pnlToday !== null) {
        acc.totalTodayPnl += pnlToday;
        contributes = true;
      }
      if (contributes) acc.includedAccounts += 1;
      return acc;
    },
    {
      totalEquity: 0,
      totalAvailableMargin: 0,
      totalTodayPnl: 0,
      includedAccounts: 0
    } satisfies DashboardPerformanceTotals
  );

  return {
    totalEquity: Number(reduced.totalEquity.toFixed(6)),
    totalAvailableMargin: Number(reduced.totalAvailableMargin.toFixed(6)),
    totalTodayPnl: Number(reduced.totalTodayPnl.toFixed(6)),
    includedAccounts: reduced.includedAccounts
  };
}

async function readBotRealizedPnlTodayByAccount(
  userId: string,
  accountIds: string[]
): Promise<Map<string, BotRealizedAccountSummary>> {
  if (!Array.isArray(accountIds) || accountIds.length === 0) return new Map();
  const dayStartUtc = new Date();
  dayStartUtc.setUTCHours(0, 0, 0, 0);
  const rows = await ignoreMissingTable(() => db.botTradeHistory.findMany({
    where: {
      userId,
      exchangeAccountId: { in: accountIds },
      status: "closed",
      exitTs: { gte: dayStartUtc }
    },
    select: {
      exchangeAccountId: true,
      realizedPnlUsd: true
    }
  }));

  const byAccount = new Map<string, BotRealizedAccountSummary>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const exchangeAccountId =
      typeof (row as any)?.exchangeAccountId === "string" ? String((row as any).exchangeAccountId) : "";
    if (!exchangeAccountId) continue;
    const pnl = toFiniteNumber((row as any)?.realizedPnlUsd);
    if (pnl === null) continue;
    const current = byAccount.get(exchangeAccountId) ?? { pnl: 0, count: 0 };
    current.pnl += pnl;
    current.count += 1;
    byAccount.set(exchangeAccountId, current);
  }
  return byAccount;
}

function resolveEffectivePnlTodayUsd(rawPnlTodayUsd: unknown, botRealizedToday: BotRealizedAccountSummary | null): number {
  const exchangePnlToday = toFiniteNumber(rawPnlTodayUsd);
  if (exchangePnlToday !== null) return exchangePnlToday;
  if (botRealizedToday && botRealizedToday.count > 0) {
    return Number(botRealizedToday.pnl.toFixed(6));
  }
  return 0;
}

async function captureDashboardPerformanceSnapshot(userId: string, at: Date): Promise<void> {
  const bucketTs = bucketTimestampBySeconds(at, DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS);
  const totals = await aggregateDashboardPerformanceTotalsForUser(userId);

  await db.dashboardPerformanceSnapshot.upsert({
    where: {
      userId_bucketTs: {
        userId,
        bucketTs
      }
    },
    create: {
      userId,
      bucketTs,
      totalEquity: totals.totalEquity,
      totalAvailableMargin: totals.totalAvailableMargin,
      totalTodayPnl: totals.totalTodayPnl,
      includedAccounts: totals.includedAccounts
    },
    update: {
      totalEquity: totals.totalEquity,
      totalAvailableMargin: totals.totalAvailableMargin,
      totalTodayPnl: totals.totalTodayPnl,
      includedAccounts: totals.includedAccounts
    }
  });
}

async function persistExchangeSyncSuccess(
  userId: string,
  accountId: string,
  synced: Awaited<ReturnType<typeof syncExchangeAccount>>
) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastUsedAt: synced.syncedAt,
      spotBudgetTotal: synced.spotBudget?.total ?? null,
      spotBudgetAvailable: synced.spotBudget?.available ?? null,
      futuresBudgetEquity: synced.futuresBudget.equity,
      futuresBudgetAvailableMargin: synced.futuresBudget.availableMargin,
      pnlTodayUsd: synced.pnlTodayUsd,
      lastSyncErrorAt: null,
      lastSyncErrorMessage: null
    }
  });

  try {
    await captureDashboardPerformanceSnapshot(userId, synced.syncedAt);
  } catch (error) {
    console.warn(
      `[dashboard-performance] snapshot capture failed for account ${accountId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function persistExchangeSyncFailure(accountId: string, errorMessage: string) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastSyncErrorAt: new Date(),
      lastSyncErrorMessage: normalizeSyncErrorMessage(errorMessage)
    }
  });
}

function decodeExchangeSecrets(account: ExchangeAccountSecrets): {
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
} {
  try {
    const apiKey = decryptSecret(account.apiKeyEnc);
    const apiSecret = decryptSecret(account.apiSecretEnc);
    const passphrase = account.passphraseEnc ? decryptSecret(account.passphraseEnc) : null;
    return { apiKey, apiSecret, passphrase };
  } catch {
    throw new ExchangeSyncError(
      "Failed to decrypt exchange credentials.",
      500,
      "exchange_secret_decrypt_failed"
    );
  }
}

async function executeExchangeSync(account: ExchangeAccountSecrets) {
  const secrets = decodeExchangeSecrets(account);
  return syncExchangeAccount({
    exchange: account.exchange,
    apiKey: secrets.apiKey,
    apiSecret: secrets.apiSecret,
    passphrase: secrets.passphrase
  });
}

let exchangeAutoSyncTimer: NodeJS.Timeout | null = null;
let exchangeAutoSyncRunning = false;

async function runExchangeAutoSyncCycle() {
  if (exchangeAutoSyncRunning) return;
  exchangeAutoSyncRunning = true;
  try {
    const accounts: ExchangeAccountSecrets[] = await db.exchangeAccount.findMany({
      where: {
        exchange: {
          in: ["bitget", "hyperliquid"]
        }
      },
      select: {
        id: true,
        userId: true,
        exchange: true,
        apiKeyEnc: true,
        apiSecretEnc: true,
        passphraseEnc: true
      }
    });

    for (const account of accounts) {
      try {
        const synced = await executeExchangeSync(account);
        await persistExchangeSyncSuccess(account.userId, account.id, synced);
      } catch (error) {
        const message =
          error instanceof ExchangeSyncError
            ? error.message
            : "Auto sync failed due to unexpected error.";
        await persistExchangeSyncFailure(account.id, message);
      }
    }
  } finally {
    exchangeAutoSyncRunning = false;
  }
}

function startExchangeAutoSyncScheduler() {
  if (!EXCHANGE_AUTO_SYNC_ENABLED) return;
  exchangeAutoSyncTimer = setInterval(() => {
    void runExchangeAutoSyncCycle();
  }, EXCHANGE_AUTO_SYNC_INTERVAL_MS);
  void runExchangeAutoSyncCycle();
}

function stopExchangeAutoSyncScheduler() {
  if (!exchangeAutoSyncTimer) return;
  clearInterval(exchangeAutoSyncTimer);
  exchangeAutoSyncTimer = null;
}

let botQueueRecoveryTimer: NodeJS.Timeout | null = null;
let botQueueRecoveryRunning = false;

async function runBotQueueRecoveryCycle(reason: "startup" | "scheduled") {
  if (botQueueRecoveryRunning) return;
  botQueueRecoveryRunning = true;
  const startedAtMs = Date.now();
  try {
    const result = await recoverRunningBotJobs({ db });
    // eslint-disable-next-line no-console
    console.log("[bot-queue-recovery] bot_queue_recovery_cycle", {
      reason,
      scanned: result.scanned,
      enqueued: result.enqueued,
      alreadyQueued: result.alreadyQueued,
      failed: result.failed,
      durationMs: Date.now() - startedAtMs
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[bot-queue-recovery] bot_queue_recovery_failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAtMs
    });
  } finally {
    botQueueRecoveryRunning = false;
  }
}

function startBotQueueRecoveryScheduler() {
  if (getRuntimeOrchestrationMode() !== "queue") return;
  if (botQueueRecoveryTimer) return;
  botQueueRecoveryTimer = setInterval(() => {
    void runBotQueueRecoveryCycle("scheduled");
  }, BOT_QUEUE_RECOVERY_INTERVAL_MS);
  void runBotQueueRecoveryCycle("startup");
}

function stopBotQueueRecoveryScheduler() {
  if (!botQueueRecoveryTimer) return;
  clearInterval(botQueueRecoveryTimer);
  botQueueRecoveryTimer = null;
}

let featureThresholdCalibrationTimer: NodeJS.Timeout | null = null;
let featureThresholdCalibrationRunning = false;
const featureThresholdCalibrationBuckets = new Map<PredictionTimeframe, string>();

async function fetchHistoricalCandles(
  adapter: BitgetFuturesAdapter,
  symbol: string,
  timeframe: PredictionTimeframe,
  windowFromMs: number,
  windowToMs: number,
  minBars: number
): Promise<CandleBar[]> {
  const targetBars = Math.max(minBars, 1200);
  const maxBars = Math.max(targetBars + 200, 5000);
  const byTs = new Map<number, CandleBar>();
  let cursorEnd = windowToMs;
  let rounds = 0;

  while (cursorEnd > windowFromMs && byTs.size < maxBars && rounds < 80) {
    const raw = await adapter.marketApi.getCandles({
      symbol,
      productType: adapter.productType,
      granularity: timeframeToBitgetGranularity(timeframe),
      startTime: windowFromMs,
      endTime: cursorEnd,
      limit: 200
    });
    const batch = parseBitgetCandles(raw);
    if (batch.length === 0) break;

    for (const row of batch) {
      if (!Number.isFinite(row.ts) || row.ts === null) continue;
      const ts = Number(row.ts);
      if (ts < windowFromMs || ts > windowToMs) continue;
      byTs.set(ts, row);
    }

    const firstTs = batch[0]?.ts;
    if (!Number.isFinite(firstTs) || firstTs === null) break;
    if ((firstTs as number) <= windowFromMs) break;
    cursorEnd = (firstTs as number) - 1;
    rounds += 1;
  }

  return Array.from(byTs.values()).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

function extractMicrostructureSeries(
  rows: Array<{ featuresSnapshot: unknown }>,
  exchange: string
) {
  const spreadBpsSeries: number[] = [];
  const depth1pctUsdSeries: number[] = [];
  const normalizedExchange = normalizeExchangeValue(exchange);

  for (const row of rows) {
    const snapshot = asRecord(row.featuresSnapshot);
    const snapshotExchange = typeof snapshot.prefillExchange === "string"
      ? normalizeExchangeValue(snapshot.prefillExchange)
      : null;
    if (snapshotExchange && snapshotExchange !== normalizedExchange) continue;
    const spread = pickNumber(snapshot, ["spreadBps", "spread_bps"]);
    const depth = pickNumber(snapshot, ["depth1pctUsd", "depth_1pct_usd", "orderBookDepth1pctUsd"]);
    if (spread !== null) spreadBpsSeries.push(spread);
    if (depth !== null) depth1pctUsdSeries.push(depth);
  }

  return {
    spreadBpsSeries,
    depth1pctUsdSeries
  };
}

async function calibrateFeatureThresholdForSymbol(params: {
  adapter: BitgetFuturesAdapter;
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  now: Date;
}) {
  const windowMs = calibrationWindowMsForTimeframe(params.timeframe as ThresholdTimeframe);
  const minBars = minimumBarsForTimeframe(params.timeframe as ThresholdTimeframe);
  const windowToMs = params.now.getTime();
  const windowFromMs = windowToMs - windowMs;

  const exchangeSymbol = await params.adapter.toExchangeSymbol(params.symbol);
  const candles = await fetchHistoricalCandles(
    params.adapter,
    exchangeSymbol,
    params.timeframe,
    windowFromMs,
    windowToMs,
    minBars
  );
  const nBars = candles.length;
  const gapRatio = computeGapRatio(params.timeframe, windowMs, nBars);

  const atrPctSeries = computeAtrPctSeries(candles);
  const absEmaSpreadPctSeries = computeAbsEmaSpreadSeries(candles);

  const predictionRows = await db.prediction.findMany({
    where: {
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      tsCreated: {
        gte: new Date(windowFromMs)
      }
    },
    orderBy: { tsCreated: "desc" },
    take: 1500,
    select: {
      featuresSnapshot: true
    }
  });
  const microstructure = extractMicrostructureSeries(predictionRows, params.exchange);
  const expectedBars = expectedBarsForWindow(params.timeframe as ThresholdTimeframe, windowMs);
  const dataGapDetected = gapRatio > FEATURE_THRESHOLDS_MAX_GAP_RATIO;
  const insufficientBars = nBars < minBars;
  if (dataGapDetected) {
    // eslint-disable-next-line no-console
    console.warn("[thresholds] data gap detected, storing fallback thresholds", {
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      nBars,
      gapRatio
    });
  }
  if (insufficientBars) {
    // eslint-disable-next-line no-console
    console.warn("[thresholds] insufficient bars, storing fallback thresholds", {
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      nBars,
      minBars
    });
  }
  const built = buildFeatureThresholds({
    atrPctSeries: dataGapDetected || insufficientBars ? [] : atrPctSeries,
    absEmaSpreadPctSeries: dataGapDetected || insufficientBars ? [] : absEmaSpreadPctSeries,
    spreadBpsSeries: dataGapDetected || insufficientBars ? [] : microstructure.spreadBpsSeries,
    depth1pctUsdSeries: dataGapDetected || insufficientBars ? [] : microstructure.depth1pctUsdSeries,
    winsorizePct: FEATURE_THRESHOLDS_WINSORIZE_PCT,
    expectedBars,
    nBars,
    dataGap: dataGapDetected
  });

  const row = await db.featureThreshold.create({
    data: {
      exchange: params.exchange.trim().toLowerCase(),
      accountScope: "global",
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      windowFrom: new Date(windowFromMs),
      windowTo: new Date(windowToMs),
      nBars,
      thresholdsJson: built.thresholdsJson,
      computedAt: params.now,
      version: FEATURE_THRESHOLD_VERSION
    },
    select: {
      exchange: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      windowFrom: true,
      windowTo: true,
      nBars: true,
      computedAt: true,
      version: true,
      thresholdsJson: true
    }
  });

  setFeatureThresholdCacheRow({
    exchange: row.exchange,
    symbol: row.symbol,
    marketType: normalizePredictionMarketType(row.marketType),
    timeframe: normalizePredictionTimeframe(row.timeframe),
    windowFrom: row.windowFrom,
    windowTo: row.windowTo,
    nBars: Number(row.nBars),
    computedAt: row.computedAt,
    version: String(row.version ?? FEATURE_THRESHOLD_VERSION),
    thresholdsJson: asRecord(row.thresholdsJson) as FeatureThresholdsJson
  });
}

function thresholdBucketForTimeframe(timeframe: PredictionTimeframe, now: Date): string | null {
  if (timeframe === "5m" || timeframe === "15m") {
    if (!isDailyCalibrationTime(now)) return null;
    return now.toISOString().slice(0, 10);
  }
  if (!isWeeklyCalibrationTime(now)) return null;
  return isoWeekBucket(now);
}

async function runFeatureThresholdCalibrationCycle(mode: "startup" | "scheduled") {
  if (!FEATURE_THRESHOLDS_CALIBRATION_ENABLED) return;
  if (featureThresholdCalibrationRunning) return;
  featureThresholdCalibrationRunning = true;

  try {
    const timeframes =
      FEATURE_THRESHOLDS_TIMEFRAMES.length > 0
        ? FEATURE_THRESHOLDS_TIMEFRAMES
        : (["5m", "15m", "1h", "4h", "1d"] as ThresholdTimeframe[]);
    const now = new Date();
    const dueTimeframes: PredictionTimeframe[] = [];

    for (const timeframe of timeframes) {
      const tf = normalizePredictionTimeframe(timeframe);
      if (mode === "startup") {
        dueTimeframes.push(tf);
        continue;
      }
      const bucket = thresholdBucketForTimeframe(tf, now);
      if (!bucket) continue;
      if (featureThresholdCalibrationBuckets.get(tf) === bucket) continue;
      dueTimeframes.push(tf);
      featureThresholdCalibrationBuckets.set(tf, bucket);
    }

    if (dueTimeframes.length === 0) return;

    const accounts = await db.exchangeAccount.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        userId: true,
        exchange: true
      }
    });

    const byExchange = new Map<string, { id: string; userId: string; exchange: string }>();
    for (const account of accounts) {
      const exchange = normalizeExchangeValue(account.exchange);
      if (!byExchange.has(exchange)) {
        byExchange.set(exchange, {
          id: account.id,
          userId: account.userId,
          exchange
        });
      }
    }

    const symbols =
      FEATURE_THRESHOLDS_SYMBOLS.length > 0
        ? FEATURE_THRESHOLDS_SYMBOLS
        : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"];
    const marketTypes =
      FEATURE_THRESHOLDS_MARKET_TYPES.length > 0
        ? FEATURE_THRESHOLDS_MARKET_TYPES
        : (["perp"] as ThresholdMarketType[]);

    for (const [exchange, accountRef] of byExchange.entries()) {
      if (exchange !== "bitget" && exchange !== "hyperliquid") continue;
      let adapter: BitgetFuturesAdapter | null = null;
      try {
        const account = await resolveTradingAccount(accountRef.userId, accountRef.id);
        adapter = createBitgetAdapter(account);
        await adapter.contractCache.warmup();

        for (const symbol of symbols) {
          for (const marketType of marketTypes) {
            const normalizedMarketType = normalizePredictionMarketType(marketType);
            for (const timeframe of dueTimeframes) {
              try {
                await calibrateFeatureThresholdForSymbol({
                  adapter,
                  exchange,
                  symbol,
                  marketType: normalizedMarketType,
                  timeframe,
                  now
                });
              } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("[thresholds] calibration failed", {
                  exchange,
                  symbol,
                  marketType: normalizedMarketType,
                  timeframe,
                  reason: String(error)
                });
              }
            }
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[thresholds] exchange calibration skipped", {
          exchange,
          reason: String(error)
        });
      } finally {
        if (adapter) {
          await adapter.close();
        }
      }
    }
  } finally {
    featureThresholdCalibrationRunning = false;
  }
}

function startFeatureThresholdCalibrationScheduler() {
  if (!FEATURE_THRESHOLDS_CALIBRATION_ENABLED) return;
  featureThresholdCalibrationTimer = setInterval(() => {
    void runFeatureThresholdCalibrationCycle("scheduled");
  }, FEATURE_THRESHOLDS_CALIBRATION_SCAN_MS);
  void runFeatureThresholdCalibrationCycle("startup");
}

function stopFeatureThresholdCalibrationScheduler() {
  if (!featureThresholdCalibrationTimer) return;
  clearInterval(featureThresholdCalibrationTimer);
  featureThresholdCalibrationTimer = null;
}

function isAutoScheduleEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(normalized);
  }
  return false;
}

function readConfidenceTarget(snapshot: Record<string, unknown>): number {
  const parsed = pickNumber(snapshot, ["confidenceTargetPct", "targetConfidencePct", "confidenceTarget"]);
  if (parsed === null) return 55;
  return clamp(parsed, 0, 100);
}

function readConfiguredConfidenceTarget(snapshot: Record<string, unknown>): number | null {
  const parsed = pickNumber(snapshot, ["confidenceTargetPct", "targetConfidencePct", "confidenceTarget"]);
  if (parsed === null) return null;
  return clamp(parsed, 0, 100);
}

function confidenceToPct(value: number): number {
  const normalized = value <= 1 ? value * 100 : value;
  return clamp(normalized, 0, 100);
}

function isTradableSignal(params: {
  signal: PredictionSignal;
  confidence: number;
  confidenceTargetPct: number;
}): boolean {
  if (params.signal !== "up" && params.signal !== "down") return false;
  if (!Number.isFinite(params.confidence)) return false;
  const confidencePct = confidenceToPct(params.confidence);
  return confidencePct >= clamp(params.confidenceTargetPct, 0, 100);
}

type TelegramConfig = {
  botToken: string;
  chatId: string;
};

function resolvePanelBaseUrl(): string {
  const configured =
    (typeof process.env.PANEL_BASE_URL === "string" ? process.env.PANEL_BASE_URL : null) ??
    (typeof process.env.INVITE_BASE_URL === "string" ? process.env.INVITE_BASE_URL : null) ??
    "http://localhost:3000";
  return configured.trim().replace(/\/+$/, "") || "http://localhost:3000";
}

function buildManualDeskPredictionLink(predictionId: string | null): string | null {
  if (!predictionId) return null;
  try {
    const url = new URL("/trading-desk", `${resolvePanelBaseUrl()}/`);
    url.searchParams.set("predictionId", predictionId);
    return url.toString();
  } catch {
    return null;
  }
}

function parseTelegramConfigValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveTelegramConfig(userId?: string | null): Promise<TelegramConfig | null> {
  const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
  const envChatId = parseTelegramConfigValue(process.env.TELEGRAM_CHAT_ID);
  const envOverrideEnabled = Boolean(envToken && envChatId);
  const config = await db.alertConfig.findUnique({
    where: { key: "default" },
    select: {
      telegramBotToken: true,
      telegramChatId: true
    }
  });

  const botToken = envOverrideEnabled
    ? envToken
    : parseTelegramConfigValue(config?.telegramBotToken);
  let chatId: string | null = null;
  if (userId) {
    const userSettings = await db.user.findUnique({
      where: { id: userId },
      select: {
        telegramChatId: true
      }
    });
    chatId = parseTelegramConfigValue(userSettings?.telegramChatId);
  }
  if (!chatId) {
    chatId = envOverrideEnabled
      ? envChatId
      : parseTelegramConfigValue(config?.telegramChatId);
  }

  if (!botToken || !chatId) return null;

  return { botToken, chatId };
}

async function sendTelegramMessage(params: TelegramConfig & {
  text: string;
  linkButton?: { text: string; url: string } | null;
}): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const sendPayload = async (withLinkButton: boolean): Promise<Response> => fetch(
      `https://api.telegram.org/bot${params.botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          disable_web_page_preview: true,
          ...(withLinkButton && params.linkButton
            ? {
                reply_markup: {
                  inline_keyboard: [[{
                    text: params.linkButton.text,
                    url: params.linkButton.url
                  }]]
                }
              }
            : {})
        }),
        signal: controller.signal
      }
    );

    let response = await sendPayload(Boolean(params.linkButton));
    let responseBody = await response.text();
    if (!response.ok && params.linkButton && response.status === 400) {
      const lower = responseBody.toLowerCase();
      const mayBeInvalidButtonUrl = lower.includes("button") && lower.includes("url");
      if (mayBeInvalidButtonUrl) {
        response = await sendPayload(false);
        responseBody = await response.text();
      }
    }

    let payload: { ok?: boolean; description?: string } = {};
    try {
      payload = JSON.parse(responseBody) as { ok?: boolean; description?: string };
    } catch {
      payload = {};
    }
    if (!response.ok || payload.ok === false) {
      const details = typeof payload.description === "string" ? payload.description : responseBody;
      throw new Error(`telegram_api_failed:${response.status}:${details}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

const TELEGRAM_TEXT_MAX_CHARS = 3900;

function buildTelegramText(lines: Array<string | null | undefined>): string {
  const text = lines.filter((line): line is string => Boolean(line)).join("\n");
  if (text.length <= TELEGRAM_TEXT_MAX_CHARS) return text;
  const truncated = text.slice(0, TELEGRAM_TEXT_MAX_CHARS - 14).trimEnd();
  return `${truncated}\n…[truncated]`;
}

async function notifyTradablePrediction(params: {
  userId: string;
  exchange: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  confidence: number;
  confidenceTargetPct: number;
  expectedMovePct: number;
  predictionId: string | null;
  explanation?: string | null;
  source: "manual" | "auto";
  signalSource: PredictionSignalSource;
  aiPromptTemplateName?: string | null;
}): Promise<void> {
  if (!isTradableSignal({
    signal: params.signal,
    confidence: params.confidence,
    confidenceTargetPct: params.confidenceTargetPct
  })) {
    return;
  }

  const config = await resolveTelegramConfig(params.userId);
  if (!config) {
    return;
  }

  const confidencePct = confidenceToPct(params.confidence);
  const signalLabel = params.signal === "up" ? "LONG" : "SHORT";
  const explanation = typeof params.explanation === "string" ? params.explanation.trim() : "";
  const promptName =
    typeof params.aiPromptTemplateName === "string" && params.aiPromptTemplateName.trim()
      ? params.aiPromptTemplateName.trim()
      : null;
  const deskLink = buildManualDeskPredictionLink(params.predictionId);

  const text = buildTelegramText([
    "🆕 SIGNAL ALERT",
    `${params.symbol} (${params.marketType}, ${params.timeframe})`,
    `Signal: ${signalLabel}`,
    `Source: ${params.signalSource}${promptName ? ` (Strategy: ${promptName})` : ""}`,
    `Confidence: ${confidencePct.toFixed(1)}% (target ${params.confidenceTargetPct.toFixed(0)}%)`,
    `Expected move: ${params.expectedMovePct.toFixed(2)}%`,
    `Exchange: ${params.exchangeAccountLabel}`,
    explanation ? `Reason: ${explanation}` : null
  ]);

  try {
    await sendTelegramMessage({
      ...config,
      text,
      linkButton: deskLink ? { text: "Open Trading Desk", url: deskLink } : null
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[telegram] prediction notification failed", {
      userId: params.userId,
      predictionId: params.predictionId ?? null,
      reason: String(error)
    });
  }
}

async function notifyMarketAnalysisUpdate(params: {
  userId: string;
  exchange: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  confidence: number;
  expectedMovePct: number;
  predictionId: string | null;
  explanation?: string | null;
  source: "manual" | "auto";
  signalSource: PredictionSignalSource;
  aiPromptTemplateName?: string | null;
}): Promise<void> {
  const config = await resolveTelegramConfig(params.userId);
  if (!config) return;

  const promptName =
    typeof params.aiPromptTemplateName === "string" && params.aiPromptTemplateName.trim()
      ? params.aiPromptTemplateName.trim()
      : null;
  const explanation = typeof params.explanation === "string" ? params.explanation.trim() : "";
  const deskLink = buildManualDeskPredictionLink(params.predictionId);
  const confidencePct = confidenceToPct(params.confidence);
  const text = buildTelegramText([
    "📊 MARKET ANALYSIS UPDATE",
    `${params.symbol} (${params.marketType}, ${params.timeframe})`,
    `Source: ${params.signalSource}`,
    `Strategy: ${promptName ?? "n/a"}`,
    explanation ? `Analysis: ${explanation}` : null
  ]);

  try {
    await sendTelegramMessage({
      ...config,
      text,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[telegram] market analysis notification failed", {
      userId: params.userId,
      predictionId: params.predictionId ?? null,
      reason: String(error)
    });
  }
}

async function notifyPredictionOutcome(params: {
  userId: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  predictionId: string;
  outcomeResult: "tp_hit" | "sl_hit";
  outcomePnlPct: number | null;
}): Promise<boolean> {
  const config = await resolveTelegramConfig(params.userId);
  if (!config) {
    return false;
  }

  const sideLabel = params.signal === "down" ? "SHORT" : "LONG";
  const outcomeLabel = params.outcomeResult === "tp_hit" ? "TP HIT" : "SL HIT";
  const pnlText = Number.isFinite(params.outcomePnlPct)
    ? `${Number(params.outcomePnlPct).toFixed(2)}%`
    : "n/a";
  const emoji = params.outcomeResult === "tp_hit" ? "✅" : "🛑";

  const lines = [
    `${emoji} SIGNAL OUTCOME`,
    `${params.symbol} (${params.marketType}, ${params.timeframe})`,
    `Side: ${sideLabel}`,
    `Result: ${outcomeLabel}`,
    `PnL: ${pnlText}`,
    `Exchange: ${params.exchangeAccountLabel}`,
    `Signal ID: ${params.predictionId}`
  ];

  try {
    await sendTelegramMessage({
      ...config,
      text: lines.join("\n")
    });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[telegram] prediction outcome notification failed", {
      userId: params.userId,
      predictionId: params.predictionId,
      outcomeResult: params.outcomeResult,
      reason: String(error)
    });
    return false;
  }
}

function readRequestedLeverage(snapshot: Record<string, unknown>): number | undefined {
  const parsed = pickNumber(snapshot, ["requestedLeverage", "leverage"]);
  if (parsed === null) return undefined;
  if (!Number.isFinite(parsed)) return undefined;
  const bounded = Math.max(1, Math.min(125, Math.trunc(parsed)));
  return bounded;
}

function computeSignalPnlPct(
  signal: PredictionSignal,
  entryPrice: number,
  price: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(price) || price <= 0) {
    return 0;
  }
  if (signal === "down") {
    return ((entryPrice - price) / entryPrice) * 100;
  }
  return ((price - entryPrice) / entryPrice) * 100;
}

type PredictionOutcomeEvaluation = {
  data: Record<string, unknown>;
  terminal: boolean;
};

function preserveRealizedMeta(outcomeMeta: unknown): Record<string, unknown> {
  const meta = asRecord(outcomeMeta);
  const preserved: Record<string, unknown> = {};
  const keys = [
    "realizedReturnPct",
    "realizedEvaluatedAt",
    "realizedStartClose",
    "realizedEndClose",
    "realizedStartBucketMs",
    "realizedEndBucketMs",
    "predictedMovePct",
    "evaluatorVersion",
    "errorMetrics",
    "outcomeAlertSentAt",
    "outcomeAlertResult",
    "outcomeAlertSignalId"
  ];
  for (const key of keys) {
    if (key in meta) preserved[key] = meta[key];
  }
  return preserved;
}

function evaluatePredictionOutcomeFromCandles(params: {
  row: {
    signal: PredictionSignal;
    timeframe: PredictionTimeframe;
    tsCreated: Date;
    entryPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    horizonMs: number | null;
    featuresSnapshot: unknown;
    outcomeMeta: unknown;
  };
  candles: CandleBar[];
  nowMs: number;
}): PredictionOutcomeEvaluation | null {
  const row = params.row;
  const signal = row.signal;
  const snapshot = asRecord(row.featuresSnapshot);
  const realizedMeta = preserveRealizedMeta(row.outcomeMeta);

  if (signal === "neutral") {
    return {
      terminal: true,
      data: {
        outcomeStatus: "closed",
        outcomeResult: "skipped",
        outcomeReason: "neutral_signal",
        outcomePnlPct: 0,
        maxFavorablePct: 0,
        maxAdversePct: 0,
        outcomeEvaluatedAt: new Date(),
        outcomeMeta: {
          ...realizedMeta,
          evaluatedFrom: row.tsCreated.toISOString(),
          evaluatedTo: new Date(params.nowMs).toISOString(),
          barsScanned: 0
        }
      }
    };
  }

  const derived = derivePredictionTrackingFromSnapshot(snapshot, row.timeframe);
  const entryPrice = row.entryPrice ?? derived.entryPrice;
  const stopLossPrice = row.stopLossPrice ?? derived.stopLossPrice;
  const takeProfitPrice = row.takeProfitPrice ?? derived.takeProfitPrice;
  const horizonMs = row.horizonMs ?? derived.horizonMs ?? timeframeToIntervalMs(row.timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;

  if (!entryPrice || !stopLossPrice || !takeProfitPrice || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      terminal: true,
      data: {
        outcomeStatus: "closed",
        outcomeResult: "invalid",
        outcomeReason: "missing_tracking_prices",
        outcomeEvaluatedAt: new Date(),
        outcomeMeta: {
          ...realizedMeta,
          hasEntryPrice: Boolean(entryPrice),
          hasStopLossPrice: Boolean(stopLossPrice),
          hasTakeProfitPrice: Boolean(takeProfitPrice)
        }
      }
    };
  }

  const expireAtMs = row.tsCreated.getTime() + Math.max(60_000, horizonMs);
  const evaluationEndMs = Math.min(params.nowMs, expireAtMs);

  const bars = params.candles
    .filter((bar) => bar.ts !== null)
    .filter((bar) => (bar.ts as number) >= row.tsCreated.getTime() && (bar.ts as number) <= evaluationEndMs);

  if (bars.length === 0) {
    if (params.nowMs >= expireAtMs) {
      return {
        terminal: true,
        data: {
          outcomeStatus: "closed",
          outcomeResult: "expired",
          outcomeReason: "horizon_elapsed_no_data",
          outcomeEvaluatedAt: new Date(),
          outcomeMeta: {
            ...realizedMeta,
            evaluatedFrom: row.tsCreated.toISOString(),
            evaluatedTo: new Date(evaluationEndMs).toISOString(),
            barsScanned: 0
          }
        }
      };
    }
    return null;
  }

  let maxFavorablePct = Number.NEGATIVE_INFINITY;
  let maxAdversePct = Number.POSITIVE_INFINITY;

  for (const bar of bars) {
    const favorable =
      signal === "down"
        ? ((entryPrice - bar.low) / entryPrice) * 100
        : ((bar.high - entryPrice) / entryPrice) * 100;
    const adverse =
      signal === "down"
        ? ((entryPrice - bar.high) / entryPrice) * 100
        : ((bar.low - entryPrice) / entryPrice) * 100;

    maxFavorablePct = Math.max(maxFavorablePct, favorable);
    maxAdversePct = Math.min(maxAdversePct, adverse);

    const tpHit = signal === "down" ? bar.low <= takeProfitPrice : bar.high >= takeProfitPrice;
    const slHit = signal === "down" ? bar.high >= stopLossPrice : bar.low <= stopLossPrice;

    if (tpHit || slHit) {
      const conservativeSlFirst = tpHit && slHit;
      const result = conservativeSlFirst ? "sl_hit" : tpHit ? "tp_hit" : "sl_hit";
      const settledPrice = result === "tp_hit" ? takeProfitPrice : stopLossPrice;
      const pnl = computeSignalPnlPct(signal, entryPrice, settledPrice);
      return {
        terminal: true,
        data: {
          outcomeStatus: "closed",
          outcomeResult: result,
          outcomeReason: conservativeSlFirst ? "both_hit_same_bar_conservative_sl" : "price_touched_level",
          outcomePnlPct: Number(pnl.toFixed(4)),
          maxFavorablePct: Number(maxFavorablePct.toFixed(4)),
          maxAdversePct: Number(maxAdversePct.toFixed(4)),
          outcomeEvaluatedAt: new Date(),
          outcomeMeta: {
            ...realizedMeta,
            entryPrice,
            takeProfitPrice,
            stopLossPrice,
            evaluatedFrom: row.tsCreated.toISOString(),
            evaluatedTo: new Date(evaluationEndMs).toISOString(),
            barsScanned: bars.length
          }
        }
      };
    }
  }

  const pending = params.nowMs < expireAtMs;
  const lastClose = bars[bars.length - 1]?.close;
  const expiredPnl =
    Number.isFinite(lastClose) && lastClose > 0
      ? Number(computeSignalPnlPct(signal, entryPrice, lastClose).toFixed(4))
      : null;

  return {
    terminal: !pending,
    data: {
      outcomeStatus: pending ? "pending" : "closed",
      outcomeResult: pending ? null : "expired",
      outcomeReason: pending ? "awaiting_levels" : "horizon_elapsed",
      outcomePnlPct: pending ? null : expiredPnl,
      maxFavorablePct: Number(maxFavorablePct.toFixed(4)),
      maxAdversePct: Number(maxAdversePct.toFixed(4)),
      outcomeEvaluatedAt: new Date(),
      outcomeMeta: {
        ...realizedMeta,
        entryPrice,
        takeProfitPrice,
        stopLossPrice,
        evaluatedFrom: row.tsCreated.toISOString(),
        evaluatedTo: new Date(evaluationEndMs).toISOString(),
        barsScanned: bars.length,
        pending
      }
    }
  };
}

function readPrefillExchangeAccountId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.prefillExchangeAccountId !== "string") return null;
  const value = snapshot.prefillExchangeAccountId.trim();
  return value ? value : null;
}

function isAutoSchedulePaused(snapshot: Record<string, unknown>): boolean {
  const value = snapshot.autoSchedulePaused;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes", "paused"].includes(normalized);
  }
  return false;
}

function predictionTemplateKey(parts: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode?: PredictionSignalMode;
}): string {
  return `${parts.userId}:${parts.exchangeAccountId}:${parts.symbol}:${parts.marketType}:${parts.timeframe}:${parts.signalMode ?? "both"}`;
}

function withAutoScheduleFlag(
  featuresSnapshot: unknown,
  enabled: boolean
): Record<string, unknown> {
  const snapshot = asRecord(featuresSnapshot);
  return {
    ...snapshot,
    autoScheduleEnabled: enabled
  };
}

function normalizeTagList(value: unknown): string[] {
  return asStringArray(value)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function enforceNewsRiskTag(tags: unknown, featureSnapshot: unknown): string[] {
  const snapshot = asRecord(featureSnapshot);
  const hasNewsRisk = asBoolean(snapshot.newsRisk, false) || asBoolean(snapshot.news_risk, false);
  const normalized = normalizeTagList(tags).filter((tag) => tag !== "news_risk");
  if (hasNewsRisk) {
    normalized.unshift("news_risk");
  }
  return normalized.slice(0, 5);
}

type NewsRiskMode = "off" | "block";

function normalizeNewsRiskMode(value: unknown): NewsRiskMode {
  return value === "block" ? "block" : "off";
}

function readSnapshotNewsRiskFlag(featureSnapshot: unknown): boolean {
  const snapshot = asRecord(featureSnapshot);
  return asBoolean(snapshot.newsRisk, false) || asBoolean(snapshot.news_risk, false);
}

let cachedNewsRiskBlockGlobal: { value: boolean; expiresAt: number } | null = null;

async function readGlobalNewsRiskEnforcement(): Promise<boolean> {
  const now = Date.now();
  if (cachedNewsRiskBlockGlobal && now < cachedNewsRiskBlockGlobal.expiresAt) {
    return cachedNewsRiskBlockGlobal.value;
  }
  try {
    const config = await getEconomicCalendarConfig(db);
    const value = config.enforceNewsRiskBlock === true;
    cachedNewsRiskBlockGlobal = { value, expiresAt: now + 15_000 };
    return value;
  } catch {
    cachedNewsRiskBlockGlobal = { value: false, expiresAt: now + 5_000 };
    return false;
  }
}

function shouldBlockByNewsRisk(params: {
  featureSnapshot: unknown;
  globalEnabled: boolean;
  strategyMode: NewsRiskMode;
}): boolean {
  return Boolean(
    params.globalEnabled
    && params.strategyMode === "block"
    && readSnapshotNewsRiskFlag(params.featureSnapshot)
  );
}

function resolveStrategyNewsRiskMode(params: {
  strategyRef: PredictionStrategyRef | null;
  promptSettings?: { newsRiskMode?: unknown } | null;
  localStrategy?: { newsRiskMode?: unknown } | null;
  compositeStrategy?: { newsRiskMode?: unknown } | null;
}): NewsRiskMode {
  if (!params.strategyRef) return "off";
  if (params.strategyRef.kind === "ai") {
    return normalizeNewsRiskMode(params.promptSettings?.newsRiskMode);
  }
  if (params.strategyRef.kind === "local") {
    return normalizeNewsRiskMode(params.localStrategy?.newsRiskMode);
  }
  if (params.strategyRef.kind === "composite") {
    return normalizeNewsRiskMode(params.compositeStrategy?.newsRiskMode);
  }
  return "off";
}

function createNewsRiskBlockedExplanation(
  strategyMode: NewsRiskMode
): ExplainerOutput {
  return {
    explanation: "News blackout active; setup suspended.",
    tags: ["news_risk"],
    keyDrivers: [
      { name: "featureSnapshot.newsRisk", value: true },
      { name: "policy.newsRiskMode", value: strategyMode },
      { name: "policy.reasonCode", value: "news_risk_blocked" }
    ],
    aiPrediction: {
      signal: "neutral",
      expectedMovePct: 0,
      confidence: 0
    },
    disclaimer: "grounded_features_only"
  };
}

function normalizeKeyDriverList(
  value: unknown
): Array<{ name: string; value: unknown }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name: string; value: unknown }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const name = String((item as Record<string, unknown>).name ?? "").trim();
    if (!name) continue;
    out.push({
      name,
      value: (item as Record<string, unknown>).value
    });
    if (out.length >= 5) break;
  }
  return out;
}

function readPredictionStateLike(row: any): PredictionStateLike {
  return {
    id: String(row.id),
    signal: normalizePredictionSignal(row.signal),
    confidence: Number.isFinite(Number(row.confidence))
      ? Number(row.confidence)
      : 0,
    tags: normalizeTagList(row.tags),
    explanation: typeof row.explanation === "string" ? row.explanation : null,
    keyDrivers: normalizeKeyDriverList(row.keyDrivers),
    featureSnapshot: asRecord(row.featuresSnapshot),
    modelVersion:
      typeof row.modelVersion === "string" && row.modelVersion.trim()
        ? row.modelVersion
        : "baseline-v1",
    tsUpdated: row.tsUpdated instanceof Date ? row.tsUpdated : new Date(),
    lastAiExplainedAt:
      row.lastAiExplainedAt instanceof Date ? row.lastAiExplainedAt : null
  };
}

function readAiQualityGateState(row: any): AiQualityGateRollingState {
  const aiCallsLastHourRaw = Number(row?.aiGateCallsLastHour);
  const highPriorityCallsRaw = Number(row?.aiGateHighPriorityCallsLastHour);
  return {
    lastAiCallTs:
      row?.lastAiExplainedAt instanceof Date ? row.lastAiExplainedAt : null,
    lastExplainedPredictionHash:
      typeof row?.aiGateLastExplainedPredictionHash === "string"
      && row.aiGateLastExplainedPredictionHash.trim()
        ? row.aiGateLastExplainedPredictionHash
        : null,
    lastExplainedHistoryHash:
      typeof row?.aiGateLastExplainedHistoryHash === "string"
      && row.aiGateLastExplainedHistoryHash.trim()
        ? row.aiGateLastExplainedHistoryHash
        : null,
    lastAiDecisionHash:
      typeof row?.aiGateLastDecisionHash === "string"
      && row.aiGateLastDecisionHash.trim()
        ? row.aiGateLastDecisionHash
        : null,
    windowStartedAt:
      row?.aiGateWindowStartedAt instanceof Date ? row.aiGateWindowStartedAt : null,
    aiCallsLastHour: Number.isFinite(aiCallsLastHourRaw) ? Math.max(0, Math.trunc(aiCallsLastHourRaw)) : 0,
    highPriorityCallsLastHour:
      Number.isFinite(highPriorityCallsRaw) ? Math.max(0, Math.trunc(highPriorityCallsRaw)) : 0
  };
}

function readAiQualityGateConfig(config: IndicatorSettingsConfig): {
  enabled: boolean;
  minConfidenceForExplain: number;
  minConfidenceForNeutralExplain: number;
  confidenceJumpThreshold: number;
  keyLevelNearPct: number;
  recentEventBars: Record<PredictionTimeframe, number>;
  highImportanceMin: number;
  aiCooldownSec: Record<PredictionTimeframe, number>;
  maxHighPriorityPerHour: number;
} {
  const gate = config.aiGating;
  return {
    enabled: Boolean(gate.enabled),
    minConfidenceForExplain: Number(gate.minConfidenceForExplain),
    minConfidenceForNeutralExplain: Number(gate.minConfidenceForNeutralExplain),
    confidenceJumpThreshold: Number(gate.confidenceJumpThreshold),
    keyLevelNearPct: Number(gate.keyLevelNearPct),
    recentEventBars: {
      "5m": Number(gate.recentEventBars["5m"]),
      "15m": Number(gate.recentEventBars["15m"]),
      "1h": Number(gate.recentEventBars["1h"]),
      "4h": Number(gate.recentEventBars["4h"]),
      "1d": Number(gate.recentEventBars["1d"])
    },
    highImportanceMin: Number(gate.highImportanceMin),
    aiCooldownSec: {
      "5m": Number(gate.aiCooldownSec["5m"]),
      "15m": Number(gate.aiCooldownSec["15m"]),
      "1h": Number(gate.aiCooldownSec["1h"]),
      "4h": Number(gate.aiCooldownSec["4h"]),
      "1d": Number(gate.aiCooldownSec["1d"])
    },
    maxHighPriorityPerHour: Number(gate.maxHighPriorityPerHour)
  };
}

function predictionStateTemplateKey(parts: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}): string {
  return `${parts.userId}:${parts.exchangeAccountId}:${parts.symbol}:${parts.marketType}:${parts.timeframe}`;
}

async function resolvePredictionTemplateScope(userId: string, predictionId: string): Promise<{
  rowId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string | null;
  signalMode: PredictionSignalMode;
  strategyRef: PredictionStrategyRef | null;
} | null> {
  const row = await db.prediction.findFirst({
    where: {
      id: predictionId,
      userId
    },
    select: {
      id: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      featuresSnapshot: true
    }
  });
  if (!row) return null;

  const snapshot = asRecord(row.featuresSnapshot);
  const symbol = normalizeSymbolInput(row.symbol);
  if (!symbol) return null;
  return {
    rowId: row.id,
    symbol,
    marketType: normalizePredictionMarketType(row.marketType),
    timeframe: normalizePredictionTimeframe(row.timeframe),
    exchangeAccountId: readPrefillExchangeAccountId(snapshot),
    signalMode: readSignalMode(snapshot),
    strategyRef: readPredictionStrategyRef(snapshot)
  };
}

async function findPredictionTemplateRowIds(userId: string, scope: {
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string | null;
  signalMode?: PredictionSignalMode | null;
  strategyRef?: PredictionStrategyRef | null;
}): Promise<string[]> {
  const rows = await db.prediction.findMany({
    where: {
      userId,
      symbol: scope.symbol,
      marketType: scope.marketType,
      timeframe: scope.timeframe
    },
    select: {
      id: true,
      featuresSnapshot: true
    }
  });

  return rows
    .filter((row: any) => {
      const snapshot = asRecord(row.featuresSnapshot);
      if (readPrefillExchangeAccountId(snapshot) !== scope.exchangeAccountId) return false;
      if (scope.signalMode && readSignalMode(snapshot) !== scope.signalMode) return false;
      if (scope.strategyRef !== undefined) {
        const rowStrategyRef = readPredictionStrategyRef(snapshot);
        const expected = scope.strategyRef;
        const mismatch = !expected
          ? Boolean(rowStrategyRef)
          : !rowStrategyRef
            || rowStrategyRef.kind !== expected.kind
            || rowStrategyRef.id !== expected.id;
        if (mismatch) return false;
      }
      return true;
    })
    .map((row: any) => row.id);
}

function setFeatureSnapshotStrategyRef(
  snapshot: Record<string, unknown>,
  strategyRef: PredictionStrategyRef | null
): Record<string, unknown> {
  if (!strategyRef) {
    return {
      ...snapshot,
      strategyRef: null,
      localStrategyId: null,
      localStrategyName: null,
      compositeStrategyId: null,
      compositeStrategyName: null
    };
  }
  return {
    ...snapshot,
    strategyRef: {
      kind: strategyRef.kind,
      id: strategyRef.id,
      name: strategyRef.name
    },
    localStrategyId: strategyRef.kind === "local" ? strategyRef.id : null,
    localStrategyName: strategyRef.kind === "local" ? strategyRef.name : null,
    compositeStrategyId: strategyRef.kind === "composite" ? strategyRef.id : null,
    compositeStrategyName: strategyRef.kind === "composite" ? strategyRef.name : null,
    aiPromptTemplateId: strategyRef.kind === "ai" ? strategyRef.id : readAiPromptTemplateId(snapshot),
    aiPromptTemplateName: strategyRef.kind === "ai" ? strategyRef.name : readAiPromptTemplateName(snapshot)
  };
}

async function findPredictionStateIdByScope(params: {
  userId: string;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode: PredictionSignalMode;
  strategyRef?: PredictionStrategyRef | null;
}): Promise<string | null> {
  const strategyScope = toPredictionStateStrategyScope(params.strategyRef ?? null);
  const row = await db.predictionState.findFirst({
    where: {
      userId: params.userId,
      exchange: params.exchange,
      accountId: params.accountId,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      signalMode: params.signalMode,
      strategyKind: strategyScope.strategyKind,
      strategyId: strategyScope.strategyId
    },
    select: {
      id: true
    }
  });
  return row ? String(row.id) : null;
}

async function findPredictionStateIdByLegacyScope(params: {
  userId: string;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode: PredictionSignalMode;
}): Promise<string | null> {
  const row = await db.predictionState.findFirst({
    where: {
      userId: params.userId,
      exchange: params.exchange,
      accountId: params.accountId,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      signalMode: params.signalMode
    },
    select: { id: true }
  });
  return row ? String(row.id) : null;
}

async function persistPredictionState(params: {
  existingStateId: string | null;
  stateData: Record<string, unknown>;
  scope: {
    userId: string;
    exchange: string;
    accountId: string;
    symbol: string;
    marketType: PredictionMarketType;
    timeframe: PredictionTimeframe;
    signalMode: PredictionSignalMode;
  };
}): Promise<{ id: string }> {
  if (params.existingStateId) {
    try {
      return await db.predictionState.update({
        where: { id: params.existingStateId },
        data: params.stateData,
        select: { id: true }
      });
    } catch (error) {
      if ((error as any)?.code !== "P2025") {
        throw error;
      }
    }
  }

  try {
    return await db.predictionState.create({
      data: params.stateData,
      select: { id: true }
    });
  } catch (error) {
    if ((error as any)?.code !== "P2002") {
      throw error;
    }

    const legacyStateId = await findPredictionStateIdByLegacyScope(params.scope);
    if (!legacyStateId) {
      throw error;
    }
    return await db.predictionState.update({
      where: { id: legacyStateId },
      data: params.stateData,
      select: { id: true }
    });
  }
}

let predictionAutoTimer: NodeJS.Timeout | null = null;
let predictionAutoRunning = false;
const predictionTriggerDebounceState = new Map<string, TriggerDebounceState>();
let predictionRefreshRuntimeSettings: PredictionRefreshSettingsPublic =
  toEffectivePredictionRefreshSettings(null);
let predictionOutcomeEvalTimer: NodeJS.Timeout | null = null;
let predictionOutcomeEvalRunning = false;
let predictionPerformanceEvalTimer: NodeJS.Timeout | null = null;
let predictionPerformanceEvalRunning = false;

async function runPredictionOutcomeEvalCycle() {
  if (!PREDICTION_OUTCOME_EVAL_ENABLED) return;
  if (predictionOutcomeEvalRunning) return;
  predictionOutcomeEvalRunning = true;

  try {
    const rows = await db.prediction.findMany({
      where: {
        userId: { not: null },
        outcomeStatus: "pending"
      },
      orderBy: [{ tsCreated: "asc" }],
      take: PREDICTION_OUTCOME_EVAL_BATCH_SIZE,
      select: {
        id: true,
        userId: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        signal: true,
        tsCreated: true,
        entryPrice: true,
        stopLossPrice: true,
        takeProfitPrice: true,
        horizonMs: true,
        featuresSnapshot: true,
        outcomeMeta: true,
        outcomeResult: true
      }
    });

    if (rows.length === 0) return;

    const defaultAccountByUser = new Map<string, string | null>();
    const grouped = new Map<string, Array<any>>();

    for (const row of rows) {
      const userId = typeof row.userId === "string" ? row.userId : null;
      if (!userId) continue;

      const snapshot = asRecord(row.featuresSnapshot);
      let exchangeAccountId = readPrefillExchangeAccountId(snapshot);

      if (!exchangeAccountId) {
        if (!defaultAccountByUser.has(userId)) {
          const defaultAccount = await db.exchangeAccount.findFirst({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
          });
          defaultAccountByUser.set(userId, defaultAccount?.id ?? null);
        }
        exchangeAccountId = defaultAccountByUser.get(userId) ?? null;
      }

      if (!exchangeAccountId) {
        await db.prediction.update({
          where: { id: row.id },
          data: {
            outcomeStatus: "closed",
            outcomeResult: "invalid",
            outcomeReason: "missing_exchange_account",
            outcomeEvaluatedAt: new Date()
          }
        });
        continue;
      }

      const key = `${userId}:${exchangeAccountId}`;
      const list = grouped.get(key) ?? [];
      list.push({
        ...row,
        userId,
        exchangeAccountId
      });
      grouped.set(key, list);
    }

    const nowMs = Date.now();
    for (const [key, groupRows] of grouped.entries()) {
      const [userId, exchangeAccountId] = key.split(":");
      let adapter: BitgetFuturesAdapter | null = null;
      try {
        const resolvedAccount = await resolveMarketDataTradingAccount(userId, exchangeAccountId);
        const accountLabel = resolvedAccount.selectedAccount.label;
        adapter = createBitgetAdapter(resolvedAccount.marketDataAccount);
        await adapter.contractCache.warmup();

        for (const row of groupRows) {
          const timeframe = normalizePredictionTimeframe(row.timeframe);
          const signal = normalizePredictionSignal(row.signal);
          const symbol = normalizeSymbolInput(row.symbol);
          if (!symbol) continue;

          const exchangeSymbol = await adapter.toExchangeSymbol(symbol);
          const horizonMs = row.horizonMs ?? timeframeToIntervalMs(timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;
          const endTime = Math.min(nowMs, row.tsCreated.getTime() + Math.max(60_000, horizonMs));
          const candlesRaw = await adapter.marketApi.getCandles({
            symbol: exchangeSymbol,
            productType: adapter.productType,
            granularity: timeframeToBitgetGranularity(timeframe),
            startTime: row.tsCreated.getTime(),
            endTime,
            limit: 500
          });
          const candles = parseBitgetCandles(candlesRaw);

          const evaluation = evaluatePredictionOutcomeFromCandles({
            row: {
              signal,
              timeframe,
              tsCreated: row.tsCreated,
              entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
              stopLossPrice: Number.isFinite(Number(row.stopLossPrice)) ? Number(row.stopLossPrice) : null,
              takeProfitPrice: Number.isFinite(Number(row.takeProfitPrice)) ? Number(row.takeProfitPrice) : null,
              horizonMs: Number.isFinite(Number(row.horizonMs)) ? Number(row.horizonMs) : null,
              featuresSnapshot: row.featuresSnapshot,
              outcomeMeta: row.outcomeMeta
            },
            candles,
            nowMs
          });

          if (!evaluation) continue;
          const nextOutcomeResultRaw = evaluation.data.outcomeResult;
          const nextOutcomeResult =
            nextOutcomeResultRaw === "tp_hit" || nextOutcomeResultRaw === "sl_hit"
              ? nextOutcomeResultRaw
              : null;
          const previousOutcomeMeta = asRecord(row.outcomeMeta);
          const alreadySentResult = typeof previousOutcomeMeta.outcomeAlertResult === "string"
            ? previousOutcomeMeta.outcomeAlertResult
            : null;
          const alreadySentAt = typeof previousOutcomeMeta.outcomeAlertSentAt === "string"
            ? previousOutcomeMeta.outcomeAlertSentAt
            : null;
          const shouldNotifyOutcome =
            nextOutcomeResult !== null &&
            !(alreadySentAt && alreadySentResult === nextOutcomeResult) &&
            row.outcomeResult !== nextOutcomeResult;
          await db.prediction.update({
            where: { id: row.id },
            data: evaluation.data
          });

          if (shouldNotifyOutcome && PREDICTION_OUTCOME_TELEGRAM_ENABLED) {
            const outcomePnlRaw = evaluation.data.outcomePnlPct;
            const outcomePnlPct = Number.isFinite(Number(outcomePnlRaw))
              ? Number(outcomePnlRaw)
              : null;
            const sent = await notifyPredictionOutcome({
              userId,
              exchangeAccountLabel: accountLabel,
              symbol,
              marketType: row.marketType === "spot" ? "spot" : "perp",
              timeframe,
              signal,
              predictionId: row.id,
              outcomeResult: nextOutcomeResult,
              outcomePnlPct
            });
            if (sent) {
              const nextMeta = asRecord(evaluation.data.outcomeMeta);
              await db.prediction.update({
                where: { id: row.id },
                data: {
                  outcomeMeta: {
                    ...nextMeta,
                    outcomeAlertSentAt: new Date().toISOString(),
                    outcomeAlertResult: nextOutcomeResult,
                    outcomeAlertSignalId: row.id
                  }
                }
              });
            }
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:outcome] cycle group failed", { key, reason: String(error) });
      } finally {
        if (adapter) {
          await adapter.close();
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:outcome] scheduler cycle failed", String(error));
  } finally {
    predictionOutcomeEvalRunning = false;
  }
}

async function runPredictionPerformanceEvalCycle() {
  if (!PREDICTION_EVALUATOR_ENABLED) return;
  if (predictionPerformanceEvalRunning) return;
  predictionPerformanceEvalRunning = true;

  try {
    const nowMs = Date.now();
    const cutoffMs = nowMs - PREDICTION_EVALUATOR_SAFETY_LAG_MS;
    const rawRows = await db.prediction.findMany({
      where: {
        userId: { not: null },
        tsCreated: { lte: new Date(cutoffMs) }
      },
      orderBy: [{ tsCreated: "asc" }],
      take: Math.max(PREDICTION_EVALUATOR_BATCH_SIZE * 4, PREDICTION_EVALUATOR_BATCH_SIZE),
      select: {
        id: true,
        userId: true,
        symbol: true,
        timeframe: true,
        signal: true,
        expectedMovePct: true,
        confidence: true,
        tsCreated: true,
        featuresSnapshot: true,
        outcomeMeta: true,
        outcomeEvaluatedAt: true
      }
    });
    if (rawRows.length === 0) return;

    const candidates = rawRows
      .filter((row: any) => typeof row.userId === "string" && row.userId.trim())
      .filter((row: any) => {
        const realized = readRealizedPayloadFromOutcomeMeta(row.outcomeMeta);
        if (realized.evaluatedAt) return false;
        const timeframe = normalizePredictionTimeframe(row.timeframe);
        const horizonEndMs = row.tsCreated.getTime() + timeframeToIntervalMs(timeframe);
        return horizonEndMs <= cutoffMs;
      })
      .slice(0, PREDICTION_EVALUATOR_BATCH_SIZE);
    if (candidates.length === 0) return;

    const defaultAccountByUser = new Map<string, string | null>();
    const grouped = new Map<string, Array<any>>();
    for (const row of candidates) {
      const userId = row.userId as string;
      const snapshot = asRecord(row.featuresSnapshot);
      let exchangeAccountId = readPrefillExchangeAccountId(snapshot);

      if (!exchangeAccountId) {
        if (!defaultAccountByUser.has(userId)) {
          const defaultAccount = await db.exchangeAccount.findFirst({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
          });
          defaultAccountByUser.set(userId, defaultAccount?.id ?? null);
        }
        exchangeAccountId = defaultAccountByUser.get(userId) ?? null;
      }

      if (!exchangeAccountId) {
        const existingMeta = asRecord(row.outcomeMeta);
        await db.prediction.update({
          where: { id: row.id },
          data: {
            outcomeMeta: {
              ...existingMeta,
              realizedEvaluatedAt: new Date(nowMs).toISOString(),
              evaluatorVersion: "close_to_close_v1",
              errorMetrics: {
                ...asRecord(existingMeta.errorMetrics),
                hit: null,
                absError: null,
                sqError: null,
                reason: "missing_exchange_account"
              }
            }
          }
        });
        continue;
      }

      const key = `${userId}:${exchangeAccountId}`;
      const list = grouped.get(key) ?? [];
      list.push({
        ...row,
        userId,
        exchangeAccountId
      });
      grouped.set(key, list);
    }

    let evaluatedCount = 0;
    for (const [key, groupRows] of grouped.entries()) {
      const [userId, exchangeAccountId] = key.split(":");
      let adapter: BitgetFuturesAdapter | null = null;

      try {
        const resolvedAccount = await resolveMarketDataTradingAccount(userId, exchangeAccountId);
        adapter = createBitgetAdapter(resolvedAccount.marketDataAccount);
        await adapter.contractCache.warmup();

        for (const row of groupRows) {
          const timeframe = normalizePredictionTimeframe(row.timeframe);
          const signal = normalizePredictionSignal(row.signal);
          const symbol = normalizeSymbolInput(row.symbol);
          if (!symbol) continue;

          const tfMs = timeframeToIntervalMs(timeframe);
          const startTsMs = row.tsCreated.getTime();
          const horizonEndMs = startTsMs + tfMs;
          const startBucketMs = toBucketStart(startTsMs, timeframe);
          const endBucketMs = toBucketStart(horizonEndMs, timeframe);
          const exchangeSymbol = await adapter.toExchangeSymbol(symbol);

          const candlesRaw = await adapter.marketApi.getCandles({
            symbol: exchangeSymbol,
            productType: adapter.productType,
            granularity: timeframeToBitgetGranularity(timeframe),
            startTime: Math.max(0, startBucketMs - tfMs),
            endTime: endBucketMs + tfMs * 2,
            limit: 500
          });
          const candles = bucketCandles(parseBitgetCandles(candlesRaw), timeframe) as CandleBar[];
          if (candles.length === 0) continue;

          const startCandle =
            candles.find((bar) => (bar.ts ?? 0) >= startBucketMs) ?? candles[candles.length - 1];
          const endCandleFromPast = [...candles]
            .reverse()
            .find((bar) => (bar.ts ?? 0) <= endBucketMs);
          const endCandle =
            endCandleFromPast ??
            candles.find((bar) => (bar.ts ?? 0) >= endBucketMs) ??
            candles[candles.length - 1];

          const startClose = Number(startCandle?.close);
          const endClose = Number(endCandle?.close);
          if (!Number.isFinite(startClose) || startClose <= 0) continue;
          if (!Number.isFinite(endClose) || endClose <= 0) continue;

          const realizedReturnPct = computeDirectionalRealizedReturnPct(signal, startClose, endClose);
          const err = computePredictionErrorMetrics({
            signal,
            expectedMovePct: Number.isFinite(Number(row.expectedMovePct))
              ? Number(row.expectedMovePct)
              : null,
            realizedReturnPct
          });

          const existingMeta = asRecord(row.outcomeMeta);
          const evaluatedAt = new Date();
          await db.prediction.update({
            where: { id: row.id },
            data: {
              outcomeEvaluatedAt: row.outcomeEvaluatedAt ?? evaluatedAt,
              outcomeMeta: {
                ...existingMeta,
                realizedReturnPct: Number(realizedReturnPct.toFixed(4)),
                realizedEvaluatedAt: evaluatedAt.toISOString(),
                realizedStartClose: Number(startClose.toFixed(6)),
                realizedEndClose: Number(endClose.toFixed(6)),
                realizedStartBucketMs: startBucketMs,
                realizedEndBucketMs: endBucketMs,
                predictedMovePct:
                  typeof err.predictedMovePct === "number"
                    ? Number(err.predictedMovePct.toFixed(4))
                    : null,
                evaluatorVersion: "close_to_close_v1",
                errorMetrics: {
                  ...asRecord(existingMeta.errorMetrics),
                  hit: err.hit,
                  absError:
                    typeof err.absError === "number" ? Number(err.absError.toFixed(4)) : null,
                  sqError: typeof err.sqError === "number" ? Number(err.sqError.toFixed(4)) : null
                }
              }
            }
          });
          evaluatedCount += 1;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:evaluator] cycle group failed", { key, reason: String(error) });
      } finally {
        if (adapter) await adapter.close();
      }
    }

    if (evaluatedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`[predictions:evaluator] evaluated ${evaluatedCount} prediction(s)`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:evaluator] scheduler cycle failed", String(error));
  } finally {
    predictionPerformanceEvalRunning = false;
  }
}

type PredictionRefreshTemplate = {
  stateId: string;
  userId: string;
  exchangeAccountId: string;
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode: PredictionSignalMode;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  leverage: number | null;
  autoScheduleEnabled: boolean;
  autoSchedulePaused: boolean;
  tsUpdated: Date;
  featureSnapshot: Record<string, unknown>;
  aiPromptTemplateId: string | null;
  aiPromptTemplateName: string | null;
  localStrategyId: string | null;
  localStrategyName: string | null;
  compositeStrategyId: string | null;
  compositeStrategyName: string | null;
  strategyRef: PredictionStrategyRef | null;
  modelVersionBase: string;
};

type StrategyRunSummary = {
  strategyRef: PredictionStrategyRef | null;
  status: "ok" | "fallback" | "error" | "skipped";
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
  source: PredictionSignalSource;
  aiCalled: boolean;
  explanation: string;
  tags: string[];
  keyDrivers: Array<{ name: string; value: unknown }>;
  ts: string;
};

let predictionStateBootstrapped = false;

function resolveRequestedStrategyRefForTemplate(
  template: PredictionRefreshTemplate
): PredictionStrategyRef | null {
  if (template.strategyRef) {
    return {
      kind: template.strategyRef.kind,
      id: template.strategyRef.id,
      name: template.strategyRef.name ?? null
    };
  }
  if (template.compositeStrategyId) {
    return {
      kind: "composite",
      id: template.compositeStrategyId,
      name: template.compositeStrategyName ?? null
    };
  }
  if (template.localStrategyId) {
    return {
      kind: "local",
      id: template.localStrategyId,
      name: template.localStrategyName ?? null
    };
  }
  if (template.aiPromptTemplateId) {
    return {
      kind: "ai",
      id: template.aiPromptTemplateId,
      name: template.aiPromptTemplateName ?? null
    };
  }
  return null;
}

function withStrategyRunSnapshot(
  snapshot: Record<string, unknown>,
  summary: StrategyRunSummary,
  debug: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...setFeatureSnapshotStrategyRef(snapshot, summary.strategyRef),
    strategyRunOutput: {
      strategyRef: summary.strategyRef,
      status: summary.status,
      signal: summary.signal,
      expectedMovePct: Number(clamp(summary.expectedMovePct, 0, 25).toFixed(2)),
      confidence: Number(clamp(summary.confidence, 0, 1).toFixed(4)),
      source: summary.source,
      aiCalled: summary.aiCalled,
      explanation: typeof summary.explanation === "string" ? summary.explanation : "",
      tags: normalizeTagList(summary.tags),
      keyDrivers: normalizeKeyDriverList(summary.keyDrivers),
      ts: summary.ts
    },
    strategyRunDebug: debug ?? null
  };
}

async function bootstrapPredictionStateFromHistory() {
  if (predictionStateBootstrapped) return;

  const rows = await db.prediction.findMany({
    where: {
      userId: { not: null }
    },
    orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
    take: Math.max(200, PREDICTION_REFRESH_SCAN_LIMIT * 2),
    select: {
      id: true,
      userId: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      tsCreated: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      explanation: true,
      tags: true,
      featuresSnapshot: true,
      modelVersion: true
    }
  });

  const nowMs = Date.now();
  let staleTemplatesDisabled = 0;

  for (const row of rows) {
    const userId = typeof row.userId === "string" ? row.userId : null;
    if (!userId) continue;

    const featureSnapshot = asRecord(row.featuresSnapshot);
    const autoEnabled = isAutoScheduleEnabled(featureSnapshot.autoScheduleEnabled);
    if (!autoEnabled) continue;
    const autoPaused = isAutoSchedulePaused(featureSnapshot);
    const exchangeAccountId = readPrefillExchangeAccountId(featureSnapshot);
    if (!exchangeAccountId) continue;

    const symbol = normalizeSymbolInput(row.symbol);
    if (!symbol) continue;

    const marketType = normalizePredictionMarketType(row.marketType);
    const timeframe = normalizePredictionTimeframe(row.timeframe);
    const staleBootstrapThresholdMs = Math.max(
      refreshIntervalMsForTimeframe(timeframe) * 2,
      15 * 60 * 1000
    );
    const ageMs = nowMs - row.tsCreated.getTime();
    if (Number.isFinite(ageMs) && ageMs > staleBootstrapThresholdMs) {
      await db.prediction.update({
        where: { id: row.id },
        data: {
          featuresSnapshot: {
            ...featureSnapshot,
            autoScheduleEnabled: false,
            autoSchedulePaused: false,
            autoScheduleDeleted: true,
            autoScheduleDeletedReason: "stale_bootstrap_orphan",
            autoScheduleDeletedAt: new Date().toISOString()
          }
        }
      });
      staleTemplatesDisabled += 1;
      continue;
    }
    const exchange =
      typeof featureSnapshot.prefillExchange === "string"
        ? normalizeExchangeValue(featureSnapshot.prefillExchange)
        : "bitget";
    const signalMode = readSignalMode(featureSnapshot);
    const strategyRef = readPredictionStrategyRef(featureSnapshot);
    const existingId = await findPredictionStateIdByScope({
      userId,
      exchange,
      accountId: exchangeAccountId,
      symbol,
      marketType,
      timeframe,
      signalMode,
      strategyRef
    });
    const existing = existingId ? { id: existingId } : null;
    if (existing) continue;

    const tags = normalizeTagList(row.tags);
    const keyDrivers = normalizeKeyDriverList(featureSnapshot.keyDrivers);
    const changeHash = buildPredictionChangeHash({
      signal: normalizePredictionSignal(row.signal),
      confidence: Number(row.confidence),
      tags,
      keyDrivers,
      featureSnapshot
    });

    await persistPredictionState({
      existingStateId: existingId,
      stateData: {
        ...toPredictionStateStrategyScope(strategyRef),
        exchange,
        accountId: exchangeAccountId,
        userId,
        symbol,
        marketType,
        timeframe,
        signalMode,
        tsUpdated: row.tsCreated,
        tsPredictedFor: new Date(row.tsCreated.getTime() + timeframeToIntervalMs(timeframe)),
        signal: normalizePredictionSignal(row.signal),
        expectedMovePct: Number.isFinite(Number(row.expectedMovePct))
          ? Number(row.expectedMovePct)
          : null,
        confidence: Number.isFinite(Number(row.confidence))
          ? Number(row.confidence)
          : 0,
        tags,
        explanation: typeof row.explanation === "string" ? row.explanation : null,
        keyDrivers,
        featuresSnapshot: featureSnapshot,
        modelVersion:
          typeof row.modelVersion === "string" && row.modelVersion.trim()
            ? row.modelVersion
            : "baseline-v1",
        lastAiExplainedAt: row.tsCreated,
        lastChangeHash: changeHash,
        lastChangeReason: "bootstrap",
        autoScheduleEnabled: autoEnabled,
        autoSchedulePaused: autoPaused,
        directionPreference: parseDirectionPreference(featureSnapshot.directionPreference),
        confidenceTargetPct: readConfidenceTarget(featureSnapshot),
        leverage: readRequestedLeverage(featureSnapshot)
      },
      scope: {
        userId,
        exchange,
        accountId: exchangeAccountId,
        symbol,
        marketType,
        timeframe,
        signalMode
      }
    });
  }

  if (staleTemplatesDisabled > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[predictions:bootstrap] disabled ${staleTemplatesDisabled} stale orphan auto-template row(s)`
    );
  }

  predictionStateBootstrapped = true;
}

async function listPredictionRefreshTemplates(): Promise<PredictionRefreshTemplate[]> {
  const rows = await db.predictionState.findMany({
    orderBy: [{ tsUpdated: "asc" }, { updatedAt: "asc" }],
    take: PREDICTION_REFRESH_SCAN_LIMIT,
    select: {
      id: true,
      userId: true,
      accountId: true,
      exchange: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      signalMode: true,
      directionPreference: true,
      confidenceTargetPct: true,
      leverage: true,
      autoScheduleEnabled: true,
      autoSchedulePaused: true,
      tsUpdated: true,
      featuresSnapshot: true,
      modelVersion: true
    }
  });

  return rows
    .map((row: any): PredictionRefreshTemplate | null => {
      const userId = typeof row.userId === "string" ? row.userId : null;
      const exchangeAccountId =
        typeof row.accountId === "string" && row.accountId.trim()
          ? row.accountId.trim()
          : null;
      const symbol = normalizeSymbolInput(row.symbol);
      if (!userId || !exchangeAccountId || !symbol) return null;
      const marketType = normalizePredictionMarketType(row.marketType);
      const timeframe = normalizePredictionTimeframe(row.timeframe);
      const snapshot = asRecord(row.featuresSnapshot);
      const signalMode = readStateSignalMode(row.signalMode, snapshot);

      return {
        stateId: String(row.id),
        userId,
        exchangeAccountId,
        exchange:
          typeof row.exchange === "string" && row.exchange.trim()
            ? normalizeExchangeValue(row.exchange)
            : "bitget",
        symbol,
        marketType,
        timeframe,
        signalMode,
        directionPreference: parseDirectionPreference(
          row.directionPreference ?? snapshot.directionPreference
        ),
        confidenceTargetPct: Number.isFinite(Number(row.confidenceTargetPct))
          && row.confidenceTargetPct !== null
          && row.confidenceTargetPct !== undefined
          ? Number(row.confidenceTargetPct)
          : readConfidenceTarget(snapshot),
        leverage:
          Number.isFinite(Number(row.leverage))
          && row.leverage !== null
          && row.leverage !== undefined
            ? Math.max(1, Math.trunc(Number(row.leverage)))
            : (readRequestedLeverage(snapshot) ?? null),
        autoScheduleEnabled: Boolean(row.autoScheduleEnabled),
        autoSchedulePaused: Boolean(row.autoSchedulePaused),
        tsUpdated: row.tsUpdated instanceof Date ? row.tsUpdated : new Date(),
        featureSnapshot: {
          ...snapshot,
          signalMode
        },
        aiPromptTemplateId: readAiPromptTemplateId(snapshot),
        aiPromptTemplateName: readAiPromptTemplateName(snapshot),
        localStrategyId: readLocalStrategyId(snapshot),
        localStrategyName: readLocalStrategyName(snapshot),
        compositeStrategyId: readCompositeStrategyId(snapshot),
        compositeStrategyName: readCompositeStrategyName(snapshot),
        strategyRef: readPredictionStrategyRef(snapshot),
        modelVersionBase:
          typeof row.modelVersion === "string" && row.modelVersion.trim()
            ? row.modelVersion
            : "baseline-v1:auto-market-v1"
      };
    })
    .filter((item: PredictionRefreshTemplate | null): item is PredictionRefreshTemplate => Boolean(item));
}

async function refreshPredictionRefreshRuntimeSettingsFromDb() {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_PREDICTION_REFRESH_KEY },
    select: { value: true }
  });
  const stored = parseStoredPredictionRefreshSettings(row?.value);
  predictionRefreshRuntimeSettings = toEffectivePredictionRefreshSettings(stored);
}

async function probePredictionRefreshTrigger(
  template: PredictionRefreshTemplate
): Promise<{ refresh: boolean; reasons: string[] }> {
  let adapter: BitgetFuturesAdapter | null = null;
  try {
    const resolvedAccount = await resolveMarketDataTradingAccount(template.userId, template.exchangeAccountId);
    adapter = createBitgetAdapter(resolvedAccount.marketDataAccount);
    await adapter.contractCache.warmup();
    const indicatorSettingsResolution = await resolveIndicatorSettings({
      db,
      exchange: template.exchange,
      accountId: template.exchangeAccountId,
      symbol: template.symbol,
      timeframe: template.timeframe
    });
    const indicatorComputeSettings = toIndicatorComputeSettings(indicatorSettingsResolution.config);

    const exchangeSymbol = await adapter.toExchangeSymbol(template.symbol);
    const lookback = resolvePredictionCandleLookback({
      timeframe: template.timeframe,
      indicatorSettings: indicatorComputeSettings,
      baseMinBars: 80
    });
    const candlesRaw = await adapter.marketApi.getCandles({
      symbol: exchangeSymbol,
      productType: adapter.productType,
      granularity: timeframeToBitgetGranularity(template.timeframe),
      limit: lookback
    });
    const candles = bucketCandles(parseBitgetCandles(candlesRaw), template.timeframe);
    if (candles.length < 40) {
      return { refresh: false, reasons: [] };
    }

    const closes = candles.map((row) => row.close);
    const highs = candles.map((row) => row.high);
    const lows = candles.map((row) => row.low);
    const indicators = computeIndicators(candles, template.timeframe, {
      exchange: template.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      logVwapMetrics: false,
      settings: indicatorComputeSettings
    });
    const tickerRaw = await adapter.marketApi.getTicker(exchangeSymbol, adapter.productType);
    const ticker = normalizeTickerPayload(coerceFirstItem(tickerRaw));
    const referencePrice = ticker.mark ?? ticker.last ?? closes[closes.length - 1];
    if (!referencePrice || !Number.isFinite(referencePrice)) {
      return { refresh: false, reasons: [] };
    }

    const thresholdResolution = await resolveFeatureThresholds({
      exchange: template.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      timeframe: template.timeframe
    });

    const inferred = inferPredictionFromMarket({
      closes,
      highs,
      lows,
      indicators,
      referencePrice,
      timeframe: template.timeframe,
      directionPreference: template.directionPreference,
      confidenceTargetPct: template.confidenceTargetPct,
      leverage: template.leverage ?? undefined,
      marketType: template.marketType,
      exchangeAccountId: template.exchangeAccountId,
      exchange: template.exchange,
      thresholdResolution
    });

    const trigger = shouldRefreshTF({
      timeframe: template.timeframe,
      nowMs: Date.now(),
      lastUpdatedMs: template.tsUpdated.getTime(),
      refreshIntervalMs: refreshIntervalMsForTimeframe(template.timeframe),
      previousFeatureSnapshot: template.featureSnapshot,
      currentFeatureSnapshot: inferred.featureSnapshot,
      previousTriggerState: predictionTriggerDebounceState.get(template.stateId) ?? null,
      triggerDebounceSec: predictionRefreshRuntimeSettings.triggerDebounceSec,
      hysteresisRatio: predictionRefreshRuntimeSettings.hysteresisRatio
    });
    predictionTriggerDebounceState.set(template.stateId, trigger.triggerState);
    return {
      refresh: trigger.refresh,
      reasons: trigger.reasons
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[predictions:refresh] trigger probe failed", {
      stateId: template.stateId,
      reason: String(error)
    });
    predictionTriggerDebounceState.delete(template.stateId);
    return { refresh: false, reasons: [] };
  } finally {
    if (adapter) await adapter.close();
  }
}

async function refreshPredictionStateForTemplate(params: {
  template: PredictionRefreshTemplate;
  reason: string;
}): Promise<{ refreshed: boolean; significant: boolean; aiCalled: boolean }> {
  const { template } = params;
  let adapter: BitgetFuturesAdapter | null = null;
  try {
    // Guard against pause/resume races while a scheduler cycle is already in progress.
    const liveState = await db.predictionState.findUnique({
      where: { id: template.stateId },
      select: {
        autoScheduleEnabled: true,
        autoSchedulePaused: true
      }
    });
    if (!liveState || !Boolean(liveState.autoScheduleEnabled) || Boolean(liveState.autoSchedulePaused)) {
      return { refreshed: false, significant: false, aiCalled: false };
    }

    const resolvedAccount = await resolveMarketDataTradingAccount(template.userId, template.exchangeAccountId);
    const account = resolvedAccount.selectedAccount;
    adapter = createBitgetAdapter(resolvedAccount.marketDataAccount);
    await adapter.contractCache.warmup();
    const indicatorSettingsResolution = await resolveIndicatorSettings({
      db,
      exchange: account.exchange,
      accountId: template.exchangeAccountId,
      symbol: template.symbol,
      timeframe: template.timeframe
    });
    const indicatorComputeSettings = toIndicatorComputeSettings(indicatorSettingsResolution.config);
    const advancedIndicatorSettings = toAdvancedIndicatorComputeSettings(indicatorSettingsResolution.config);

    const exchangeSymbol = await adapter.toExchangeSymbol(template.symbol);
    const candleLookback = resolvePredictionCandleLookback({
      timeframe: template.timeframe,
      indicatorSettings: indicatorComputeSettings,
      baseMinBars: 160
    });
    const [tickerRaw, candlesRaw] = await Promise.all([
      adapter.marketApi.getTicker(exchangeSymbol, adapter.productType),
      adapter.marketApi.getCandles({
        symbol: exchangeSymbol,
        productType: adapter.productType,
        granularity: timeframeToBitgetGranularity(template.timeframe),
        limit: candleLookback
      })
    ]);

    const candles = bucketCandles(parseBitgetCandles(candlesRaw), template.timeframe);
    if (candles.length < 20) {
      return { refreshed: false, significant: false, aiCalled: false };
    }

    const closes = candles.map((row) => row.close);
    const highs = candles.map((row) => row.high);
    const lows = candles.map((row) => row.low);
    const indicators = computeIndicators(candles, template.timeframe, {
      exchange: account.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      logVwapMetrics: true,
      settings: indicatorComputeSettings
    });
    const advancedIndicators = computeAdvancedIndicators(
      candles,
      template.timeframe,
      advancedIndicatorSettings
    );
    const ticker = normalizeTickerPayload(coerceFirstItem(tickerRaw));
    const referencePrice = ticker.mark ?? ticker.last ?? closes[closes.length - 1];
    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      return { refreshed: false, significant: false, aiCalled: false };
    }

    const thresholdResolution = await resolveFeatureThresholds({
      exchange: account.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      timeframe: template.timeframe
    });

    const inferred = inferPredictionFromMarket({
      closes,
      highs,
      lows,
      indicators,
      referencePrice,
      timeframe: template.timeframe,
      directionPreference: template.directionPreference,
      confidenceTargetPct: template.confidenceTargetPct,
      leverage: template.leverage ?? undefined,
      marketType: template.marketType,
      exchangeAccountId: template.exchangeAccountId,
      exchange: account.exchange,
      thresholdResolution
    });

    const quality = await getPredictionQualityContext(
      template.userId,
      template.symbol,
      template.timeframe,
      template.marketType
    );
    const newsBlackout = await evaluateNewsRiskForSymbol({
      db,
      symbol: template.symbol,
      now: new Date()
    });

    inferred.featureSnapshot.autoScheduleEnabled = template.autoScheduleEnabled;
    inferred.featureSnapshot.autoSchedulePaused = template.autoSchedulePaused;
    inferred.featureSnapshot.directionPreference = template.directionPreference;
    inferred.featureSnapshot.confidenceTargetPct = template.confidenceTargetPct;
    inferred.featureSnapshot.requestedLeverage = template.leverage ?? null;
    inferred.featureSnapshot.prefillExchangeAccountId = template.exchangeAccountId;
    inferred.featureSnapshot.prefillExchange = account.exchange;
    inferred.featureSnapshot.qualityWinRatePct = quality.winRatePct;
    inferred.featureSnapshot.qualitySampleSize = quality.sampleSize;
    inferred.featureSnapshot.qualityAvgOutcomePnlPct = quality.avgOutcomePnlPct;
    inferred.featureSnapshot.qualityTpCount = quality.tpCount;
    inferred.featureSnapshot.qualitySlCount = quality.slCount;
    inferred.featureSnapshot.qualityExpiredCount = quality.expiredCount;
    inferred.featureSnapshot.advancedIndicators = advancedIndicators;
    inferred.featureSnapshot.ohlcvSeries = buildOhlcvSeriesFeature(
      candles,
      template.timeframe
    );
    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: inferred.featureSnapshot,
      candles,
      timeframe: template.timeframe,
      indicators,
      advancedIndicators,
      exchange: account.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    inferred.featureSnapshot.meta = {
      ...(asRecord(inferred.featureSnapshot.meta) ?? {}),
      indicatorSettingsHash: indicatorSettingsResolution.hash
    };
    if (advancedIndicators.dataGap) {
      const riskFlags = asRecord(inferred.featureSnapshot.riskFlags) ?? {};
      inferred.featureSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    inferred.featureSnapshot = applyNewsRiskToFeatureSnapshot(
      inferred.featureSnapshot,
      newsBlackout
    );

    const prevStateRow = await db.predictionState.findUnique({
      where: { id: template.stateId }
    });
    const prevState = prevStateRow ? readPredictionStateLike(prevStateRow) : null;
    const signalMode = template.signalMode;
    const requestedStrategyRef = resolveRequestedStrategyRefForTemplate(template);
    const requestedLocalStrategyId = requestedStrategyRef?.kind === "local"
      ? requestedStrategyRef.id
      : (template.localStrategyId ?? readLocalStrategyId(template.featureSnapshot));
    const requestedCompositeStrategyId = requestedStrategyRef?.kind === "composite"
      ? requestedStrategyRef.id
      : (template.compositeStrategyId ?? readCompositeStrategyId(template.featureSnapshot));
    const selectedLocalStrategy = requestedLocalStrategyId
      ? await getEnabledLocalStrategyById(requestedLocalStrategyId)
      : null;
    const selectedCompositeStrategy = requestedCompositeStrategyId
      ? await getEnabledCompositeStrategyById(requestedCompositeStrategyId)
      : null;
    const requestedStrategyRefEffective: PredictionStrategyRef | null =
      requestedStrategyRef
      ?? (requestedCompositeStrategyId
        ? {
            kind: "composite",
            id: requestedCompositeStrategyId,
            name: template.compositeStrategyName ?? null
          }
        : requestedLocalStrategyId
          ? {
              kind: "local",
              id: requestedLocalStrategyId,
            name: template.localStrategyName ?? null
          }
          : null);
    const workspaceId = await resolveWorkspaceIdForUserId(template.userId);
    const strategyEntitlements = await resolveStrategyEntitlementsForWorkspace({
      workspaceId: workspaceId ?? "unknown"
    });
    const promptScopeContext = {
      exchange: template.exchange,
      accountId: template.exchangeAccountId,
      symbol: template.symbol,
      timeframe: template.timeframe
    };
    const requestedPromptTemplateId =
      requestedStrategyRefEffective?.kind === "ai"
        ? requestedStrategyRefEffective.id
        : (readAiPromptTemplateId(template.featureSnapshot) ?? template.aiPromptTemplateId);
    const requestedPromptSelection = requestedPromptTemplateId
      ? await resolveAiPromptRuntimeForUserSelection({
          userId: template.userId,
          templateId: requestedPromptTemplateId,
          context: promptScopeContext
        })
      : null;
    const selectedPromptIsOwn = Boolean(requestedPromptSelection?.isOwnTemplate);
    if (selectedPromptIsOwn) {
      const owner = await db.user.findUnique({
        where: { id: template.userId },
        select: { id: true, email: true }
      });
      const strategyFeatureEnabled = owner
        ? await isStrategyFeatureEnabledForUser(owner)
        : false;
      if (!strategyFeatureEnabled) {
        // eslint-disable-next-line no-console
        console.info("[predictions:refresh] own strategy blocked by access settings", {
          stateId: template.stateId,
          userId: template.userId,
          requestedPromptTemplateId
        });
        return {
          refreshed: false,
          significant: false,
          aiCalled: false
        };
      }
    }
    const requestedStrategyKindForAccess: "ai" | "local" | "composite" =
      requestedStrategyRefEffective?.kind ?? "ai";
    const requestedStrategyIdForAccess =
      requestedStrategyRefEffective?.id
      ?? (
        requestedStrategyKindForAccess === "ai"
          ? (selectedPromptIsOwn
            ? null
            : (
              requestedPromptTemplateId
              ?? template.aiPromptTemplateId
              ?? readAiPromptTemplateId(template.featureSnapshot)
              ?? "default"
            ))
          : null
      );
    const strategyAccess = evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: requestedStrategyKindForAccess,
      strategyId: requestedStrategyIdForAccess,
      aiModel: requestedStrategyKindForAccess === "ai" ? await getAiModelAsync() : null,
      compositeNodes:
        requestedStrategyKindForAccess === "composite"
          ? countCompositeStrategyNodes(selectedCompositeStrategy)
          : null
    });
    const strategyNewsRiskMode = resolveStrategyNewsRiskMode({
      strategyRef: requestedStrategyRefEffective,
      promptSettings: requestedPromptSelection?.runtimeSettings ?? null,
      localStrategy: selectedLocalStrategy,
      compositeStrategy: selectedCompositeStrategy
    });
    const globalNewsRiskBlockEnabled = await readGlobalNewsRiskEnforcement();
    const newsRiskBlocked = shouldBlockByNewsRisk({
      featureSnapshot: inferred.featureSnapshot,
      globalEnabled: globalNewsRiskBlockEnabled,
      strategyMode: strategyNewsRiskMode
    });

    const baselineTags = enforceNewsRiskTag(
      inferred.featureSnapshot.tags,
      inferred.featureSnapshot
    );
    const nowMs = Date.now();
    const gateState = prevStateRow
      ? readAiQualityGateState(prevStateRow)
      : {
        lastAiCallTs: null,
        lastExplainedPredictionHash: null,
        lastExplainedHistoryHash: null,
        lastAiDecisionHash: null,
        windowStartedAt: null,
        aiCallsLastHour: 0,
        highPriorityCallsLastHour: 0
      };
    const budgetSnapshot = getAiPayloadBudgetAlertSnapshot();
    const aiGateDecision = shouldInvokeAiExplain({
      timeframe: template.timeframe,
      nowMs,
      prediction: {
        signal: inferred.prediction.signal,
        confidence: inferred.prediction.confidence,
        expectedMovePct: inferred.prediction.expectedMovePct,
        tsUpdated: new Date(nowMs)
      },
      featureSnapshot: inferred.featureSnapshot,
      prevState: prevState
        ? {
          signal: prevState.signal,
          confidence: prevState.confidence,
          featureSnapshot: prevState.featureSnapshot
        }
        : null,
      gateState,
      config: readAiQualityGateConfig(indicatorSettingsResolution.config),
      budgetPressureConsecutive: budgetSnapshot.highWaterConsecutive
    });
    const aiDecision = {
      shouldCallAi: aiGateDecision.allow,
      reason: aiGateDecision.reasonCodes.join(","),
      cooldownActive: aiGateDecision.reasonCodes.includes("cooldown_active")
    };
    let useLegacySignalFlow =
      requestedStrategyRefEffective?.kind !== "local"
      && requestedStrategyRefEffective?.kind !== "composite";
    if (!strategyAccess.allowed) {
      useLegacySignalFlow = true;
    }
    let aiGateStateForPersist = aiGateDecision.state;
    if (useLegacySignalFlow && !aiDecision.shouldCallAi && !newsRiskBlocked) {
      console.info("[ai_quality_gate_blocked_refresh]", {
        gate_allow: false,
        gate_reasons: aiGateDecision.reasonCodes,
        gate_priority: aiGateDecision.priority,
        stateId: template.stateId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        ai_calls_saved: 1
      });
    }

    if (
      useLegacySignalFlow
      && signalMode === "ai_only"
      && requestedStrategyRefEffective?.kind !== "local"
      && requestedStrategyRefEffective?.kind !== "composite"
      && !aiDecision.shouldCallAi
      && !newsRiskBlocked
    ) {
      return {
        refreshed: false,
        significant: false,
        aiCalled: false
      };
    }
    if (
      signalMode === "ai_only"
      && requestedStrategyKindForAccess === "ai"
      && !strategyAccess.allowed
      && !newsRiskBlocked
    ) {
      return {
        refreshed: false,
        significant: false,
        aiCalled: false
      };
    }

    const tsCreated = new Date().toISOString();
    let aiCalled = false;
    let strategyRunStatus: StrategyRunSummary["status"] = "ok";
    let strategyRunDebug: Record<string, unknown> | null = null;
    if (!strategyAccess.allowed) {
      strategyRunStatus = "fallback";
      strategyRunDebug = {
        strategyAccess,
        requestedStrategyRef: requestedStrategyRefEffective
      };
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] strategy blocked by license entitlements", {
        stateId: template.stateId,
        userId: template.userId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        requestedStrategyKind: requestedStrategyKindForAccess,
        requestedStrategyId: requestedStrategyIdForAccess,
        reason: strategyAccess.reason
      });
    }
    const requestedPromptTemplateName =
      requestedStrategyRefEffective?.kind === "ai"
        ? (requestedPromptSelection?.templateName ?? requestedStrategyRefEffective.name ?? null)
        : (readAiPromptTemplateName(template.featureSnapshot) ?? template.aiPromptTemplateName);
    const promptLicenseDecision = selectedPromptIsOwn
      ? {
          allowed: true,
          reason: "ok" as const,
          mode: "off" as const,
          wouldBlock: false
        }
      : evaluateAiPromptAccess({
          userId: template.userId,
          selectedPromptId: requestedPromptTemplateId
        });
    const runtimePromptTemplateId =
      promptLicenseDecision.allowed
        ? (requestedPromptSelection?.templateId ?? requestedPromptTemplateId)
        : null;
    if (promptLicenseDecision.wouldBlock) {
      // eslint-disable-next-line no-console
      console.warn("[license] ai prompt selection would be blocked in enforce mode", {
        userId: template.userId,
        selectedPromptId: requestedPromptTemplateId,
        mode: promptLicenseDecision.mode,
        stateId: template.stateId
      });
    }
    let runtimePromptSettings: Awaited<
      ReturnType<typeof getAiPromptRuntimeSettingsByTemplateId>
    > | null = requestedPromptSelection?.runtimeSettings ?? null;
    let localPrediction =
      normalizeSnapshotPrediction(asRecord(inferred.prediction)) ??
      {
        signal: inferred.prediction.signal,
        expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
        confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
      };
    let aiPrediction: AiPredictionSnapshot | null =
      signalMode === "local_only" ? null : localPrediction;
    let selectedPrediction: {
      signal: PredictionSignal;
      expectedMovePct: number;
      confidence: number;
      source: PredictionSignalSource;
    } = {
      signal: localPrediction.signal,
      expectedMovePct: localPrediction.expectedMovePct,
      confidence: localPrediction.confidence,
      source: "local"
    };
    let explainer: ExplainerOutput = {
      explanation: "No major state change; awaiting clearer signal.",
      tags: [],
      keyDrivers: [],
      aiPrediction: localPrediction,
      disclaimer: "grounded_features_only"
    };
    if (newsRiskBlocked) {
      useLegacySignalFlow = false;
      strategyRunStatus = "fallback";
      strategyRunDebug = {
        requestedStrategyRef: requestedStrategyRefEffective,
        reasonCode: "news_risk_blocked",
        strategyNewsRiskMode
      };
      const blockedSource = resolvePreferredSignalSourceForMode(
        signalMode,
        PREDICTION_PRIMARY_SIGNAL_SOURCE
      );
      selectedPrediction = {
        signal: "neutral",
        expectedMovePct: 0,
        confidence: 0,
        source: blockedSource
      };
      aiPrediction =
        signalMode === "local_only"
          ? null
          : {
              signal: "neutral",
              expectedMovePct: 0,
              confidence: 0
            };
      explainer = createNewsRiskBlockedExplanation(strategyNewsRiskMode);
    }

    if (requestedCompositeStrategyId && !selectedCompositeStrategy) {
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] composite strategy unavailable, fallback to legacy flow", {
        stateId: template.stateId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        compositeStrategyId: requestedCompositeStrategyId
      });
      strategyRunStatus = "fallback";
      useLegacySignalFlow = true;
    }

    if (!newsRiskBlocked && requestedLocalStrategyId && !selectedLocalStrategy) {
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] local strategy unavailable, fallback to legacy flow", {
        stateId: template.stateId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        localStrategyId: requestedLocalStrategyId
      });
      strategyRunStatus = "fallback";
      useLegacySignalFlow = true;
    }

    if (
      !newsRiskBlocked
      && strategyAccess.allowed
      && requestedStrategyRefEffective?.kind === "local"
      && selectedLocalStrategy
    ) {
      try {
        const localRun = await runLocalStrategy(
          selectedLocalStrategy.id,
          inferred.featureSnapshot,
          {
            signal: localPrediction.signal,
            exchange: template.exchange,
            accountId: template.exchangeAccountId,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe
          }
        );
        useLegacySignalFlow = false;
        const localScoreConfidence = Number(clamp(localRun.score / 100, 0, 1).toFixed(4));
        const blockedSignal: PredictionSignal = "neutral";
        const blockedMove = Number((localPrediction.expectedMovePct * 0.35).toFixed(2));
        selectedPrediction = {
          signal: localRun.allow ? localPrediction.signal : blockedSignal,
          expectedMovePct: localRun.allow
            ? localPrediction.expectedMovePct
            : Number(clamp(blockedMove, 0, localPrediction.expectedMovePct).toFixed(2)),
          confidence: localRun.allow
            ? Number(clamp(Math.max(localPrediction.confidence, localScoreConfidence), 0, 1).toFixed(4))
            : Number(clamp(Math.min(localPrediction.confidence, localScoreConfidence), 0, 1).toFixed(4)),
          source: "local"
        };
        aiPrediction = null;
        explainer = {
          explanation: localRun.explanation,
          tags: normalizeTagList(localRun.tags),
          keyDrivers: [
            { name: "localStrategy.id", value: localRun.strategyId },
            { name: "localStrategy.type", value: localRun.strategyType },
            { name: "localStrategy.allow", value: localRun.allow },
            { name: "localStrategy.score", value: localRun.score },
            { name: "localStrategy.reasonCodes", value: localRun.reasonCodes }
          ],
          aiPrediction: localPrediction,
          disclaimer: "grounded_features_only"
        };
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          localStrategy: localRun
        };
      } catch (error) {
        strategyRunStatus = "error";
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          error: String(error)
        };
        // eslint-disable-next-line no-console
        console.warn("[predictions:refresh] local strategy execution failed, fallback to legacy flow", {
          stateId: template.stateId,
          symbol: template.symbol,
          timeframe: template.timeframe,
          localStrategyId: selectedLocalStrategy.id,
          reason: String(error)
        });
        useLegacySignalFlow = true;
      }
    }

    if (
      !newsRiskBlocked
      && strategyAccess.allowed
      && requestedStrategyRefEffective?.kind === "composite"
      && selectedCompositeStrategy
    ) {
      try {
        const compositeRun = await runCompositeStrategy({
          compositeId: selectedCompositeStrategy.id,
          nodesJson: selectedCompositeStrategy.nodesJson,
          edgesJson: selectedCompositeStrategy.edgesJson,
          combineMode: selectedCompositeStrategy.combineMode,
          outputPolicy: selectedCompositeStrategy.outputPolicy,
          featureSnapshot: inferred.featureSnapshot,
          basePrediction: {
            signal: localPrediction.signal,
            confidence: localPrediction.confidence * 100,
            expectedMovePct: localPrediction.expectedMovePct,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated
          },
          context: {
            exchange: template.exchange,
            accountId: template.exchangeAccountId,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            aiQualityGateConfig: readAiQualityGateConfig(indicatorSettingsResolution.config),
            gateState
          }
        }, {
          resolveLocalStrategyRef: async (id) => {
            if (!db.localStrategyDefinition || typeof db.localStrategyDefinition.findUnique !== "function") {
              return false;
            }
            const found = await db.localStrategyDefinition.findUnique({
              where: { id },
              select: { id: true }
            });
            return Boolean(found);
          },
          resolveAiPromptRef: async (id) => {
            const found = await getAiPromptTemplateById(id);
            return Boolean(found);
          }
        });
        useLegacySignalFlow = false;
        aiCalled = compositeRun.aiCallsUsed > 0;
        if (aiCalled) {
          aiGateStateForPersist = applyAiQualityGateCallToState(
            aiGateStateForPersist,
            aiGateDecision.priority
          );
        }

        const lastExecutedAiNode = [...compositeRun.nodes]
          .reverse()
          .find((node) => node.kind === "ai" && node.executed);
        const aiPredictionFromComposite = normalizeSnapshotPrediction(
          asRecord(asRecord(lastExecutedAiNode?.meta).aiPrediction)
        );
        const selectedSignalSource: PredictionSignalSource =
          compositeRun.outputPolicy === "local_signal_ai_explain"
            ? "local"
            : aiPredictionFromComposite
              ? "ai"
              : "local";
        const compositeConfidenceRaw = Number(compositeRun.confidence);
        const compositeConfidence = Number(
          clamp(
            compositeConfidenceRaw > 1
              ? compositeConfidenceRaw / 100
              : compositeConfidenceRaw,
            0,
            1
          ).toFixed(4)
        );

        aiPrediction = aiPredictionFromComposite ?? aiPrediction;
        selectedPrediction = {
          signal: compositeRun.signal,
          expectedMovePct:
            selectedSignalSource === "ai" && aiPredictionFromComposite
              ? aiPredictionFromComposite.expectedMovePct
              : localPrediction.expectedMovePct,
          confidence: compositeConfidence,
          source: selectedSignalSource
        };

        explainer = {
          explanation:
            typeof compositeRun.explanation === "string" && compositeRun.explanation.trim()
              ? compositeRun.explanation.trim()
              : "Composite strategy evaluated.",
          tags: Array.isArray(compositeRun.tags) ? compositeRun.tags.slice(0, 10) : [],
          keyDrivers: Array.isArray(compositeRun.keyDrivers)
            ? compositeRun.keyDrivers.slice(0, 10)
            : [],
          aiPrediction: aiPrediction ?? localPrediction,
          disclaimer: "grounded_features_only"
        };
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          compositeRun
        };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:refresh] composite execution failed, fallback to legacy flow", {
          stateId: template.stateId,
          symbol: template.symbol,
          timeframe: template.timeframe,
          compositeStrategyId: selectedCompositeStrategy.id,
          reason: String(error)
        });
        strategyRunStatus = "error";
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          error: String(error)
        };
        useLegacySignalFlow = true;
      }
    }

    if (!newsRiskBlocked && useLegacySignalFlow) {
      const aiAllowedByStrategyEntitlements =
        strategyAccess.allowed || requestedStrategyKindForAccess !== "ai";
      if (signalMode !== "local_only" && aiDecision.shouldCallAi && aiAllowedByStrategyEntitlements) {
        try {
          const resolvedRuntime = await resolveAiPromptRuntimeForUserSelection({
            userId: template.userId,
            templateId: runtimePromptTemplateId,
            context: promptScopeContext
          });
          runtimePromptSettings =
            resolvedRuntime?.runtimeSettings
            ?? await getAiPromptRuntimeSettings(promptScopeContext);
          explainer = await generatePredictionExplanation({
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated,
            prediction: inferred.prediction,
            featureSnapshot: inferred.featureSnapshot
          }, {
            promptScopeContext,
            promptSettings: runtimePromptSettings,
            requireSuccessfulAi: signalMode === "ai_only"
          });
          aiCalled = true;
          aiGateStateForPersist = applyAiQualityGateCallToState(
            aiGateStateForPersist,
            aiGateDecision.priority
          );
        } catch (error) {
          if (signalMode === "ai_only") {
            // eslint-disable-next-line no-console
            console.warn("[predictions:refresh] ai_only skip due to missing AI response", {
              stateId: template.stateId,
              symbol: template.symbol,
              timeframe: template.timeframe,
              reason: String(error)
            });
            return {
              refreshed: false,
              significant: false,
              aiCalled: false
            };
          }
          explainer = fallbackExplain({
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated,
            prediction: inferred.prediction,
            featureSnapshot: inferred.featureSnapshot
          });
        }
      } else if (signalMode === "local_only") {
        explainer = fallbackExplain({
          symbol: template.symbol,
          marketType: template.marketType,
          timeframe: template.timeframe,
          tsCreated,
          prediction: inferred.prediction,
          featureSnapshot: inferred.featureSnapshot
        });
      } else if (signalMode === "ai_only") {
        return {
          refreshed: false,
          significant: false,
          aiCalled: false
        };
      } else if (
        prevState &&
        typeof prevState.explanation === "string" &&
        prevState.explanation.trim()
      ) {
        explainer = {
          explanation: prevState.explanation,
          tags: prevState.tags,
          keyDrivers: prevState.keyDrivers,
          aiPrediction:
            readAiPredictionSnapshot(prevState.featureSnapshot) ?? {
              signal: inferred.prediction.signal,
              expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
              confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
            },
          disclaimer: "grounded_features_only"
        };
      } else {
        explainer = {
          explanation: "No major state change; awaiting clearer signal.",
          tags: [],
          keyDrivers: [],
          aiPrediction: {
            signal: inferred.prediction.signal,
            expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
            confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
          },
          disclaimer: "grounded_features_only"
        };
      }

      localPrediction =
        normalizeSnapshotPrediction(asRecord(inferred.prediction)) ??
        {
          signal: inferred.prediction.signal,
          expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
          confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
        };
      aiPrediction =
        signalMode === "local_only"
          ? null
          : (normalizeSnapshotPrediction(asRecord(explainer.aiPrediction)) ?? localPrediction);
      selectedPrediction =
        signalMode === "local_only"
          ? {
              signal: localPrediction.signal,
              expectedMovePct: localPrediction.expectedMovePct,
              confidence: localPrediction.confidence,
              source: "local"
            }
          : signalMode === "ai_only"
            ? {
                signal: (aiPrediction ?? localPrediction).signal,
                expectedMovePct: (aiPrediction ?? localPrediction).expectedMovePct,
                confidence: (aiPrediction ?? localPrediction).confidence,
                source: "ai"
              }
            : selectPredictionBySource({
                localPrediction,
                aiPrediction: aiPrediction ?? localPrediction,
                source: PREDICTION_PRIMARY_SIGNAL_SOURCE
              });
      strategyRunDebug = {
        requestedStrategyRef: requestedStrategyRefEffective,
        signalMode,
        aiGateDecision: {
          allow: aiGateDecision.allow,
          priority: aiGateDecision.priority,
          reasonCodes: aiGateDecision.reasonCodes
        },
        aiDecision,
        runtimePromptTemplateId,
        runtimePromptSettings: runtimePromptSettings
          ? {
              source: runtimePromptSettings.source,
              activePromptId: runtimePromptSettings.activePromptId,
              activePromptName: runtimePromptSettings.activePromptName,
              marketAnalysisUpdateEnabled:
                runtimePromptSettings.marketAnalysisUpdateEnabled,
              selectedFrom: runtimePromptSettings.selectedFrom,
              matchedScopeType: runtimePromptSettings.matchedScopeType,
              matchedOverrideId: runtimePromptSettings.matchedOverrideId
            }
          : null
      };
      if (
        requestedStrategyRefEffective?.kind === "ai"
        && requestedPromptTemplateId
        && !runtimePromptSettings
      ) {
        strategyRunStatus = "fallback";
      }
    }
    const shouldAttachPromptMtf =
      !requestedStrategyRefEffective || requestedStrategyRefEffective.kind === "ai";
    if (shouldAttachPromptMtf && runtimePromptTemplateId && !runtimePromptSettings) {
      try {
        const resolvedRuntime = await resolveAiPromptRuntimeForUserSelection({
          userId: template.userId,
          templateId: runtimePromptTemplateId,
          context: promptScopeContext
        });
        runtimePromptSettings =
          resolvedRuntime?.runtimeSettings
          ?? await getAiPromptRuntimeSettings(promptScopeContext);
      } catch {
        runtimePromptSettings = null;
      }
    }
    const promptMtfConfig = normalizePromptTimeframeSetForRuntime(
      runtimePromptSettings ?? {
        timeframes: template.featureSnapshot.promptTimeframes,
        runTimeframe: template.featureSnapshot.promptRunTimeframe,
        timeframe: template.featureSnapshot.promptTimeframe ?? template.timeframe
      },
      template.timeframe
    );
    if (shouldAttachPromptMtf && promptMtfConfig.timeframes.length > 0) {
      inferred.featureSnapshot.mtf = await buildMtfFramesForPrediction({
        adapter,
        exchange: account.exchange,
        accountId: template.exchangeAccountId,
        symbol: template.symbol,
        marketType: template.marketType,
        timeframes: promptMtfConfig.timeframes,
        runTimeframe: template.timeframe,
        runFrame: {
          candles,
          indicators,
          advancedIndicators
        }
      });
    } else {
      delete inferred.featureSnapshot.mtf;
    }
    inferred.featureSnapshot.promptTimeframe = template.timeframe;
    inferred.featureSnapshot.promptTimeframes = promptMtfConfig.timeframes;
    inferred.featureSnapshot.promptSlTpSource = runtimePromptSettings?.slTpSource ?? "local";
    inferred.featureSnapshot.promptRunTimeframe = promptMtfConfig.runTimeframe;
    inferred.featureSnapshot.aiPromptTemplateRequestedId = requestedPromptTemplateId;
    if (runtimePromptSettings) {
      inferred.featureSnapshot.aiPromptTemplateId = runtimePromptSettings.activePromptId;
      inferred.featureSnapshot.aiPromptTemplateName = runtimePromptSettings.activePromptName;
      inferred.featureSnapshot.aiPromptMarketAnalysisUpdateEnabled = Boolean(
        runtimePromptSettings.marketAnalysisUpdateEnabled
      );
    } else {
      inferred.featureSnapshot.aiPromptTemplateId = runtimePromptTemplateId;
      inferred.featureSnapshot.aiPromptTemplateName =
        runtimePromptTemplateId ? requestedPromptTemplateName : null;
      inferred.featureSnapshot.aiPromptMarketAnalysisUpdateEnabled =
        requestedStrategyRefEffective?.kind === "ai"
          ? readAiPromptMarketAnalysisUpdateEnabled(template.featureSnapshot)
          : false;
    }
    inferred.featureSnapshot.aiPromptLicenseMode = promptLicenseDecision.mode;
    inferred.featureSnapshot.aiPromptLicenseWouldBlock = promptLicenseDecision.wouldBlock;
    inferred.featureSnapshot.signalMode = signalMode;
    inferred.featureSnapshot = withPredictionSnapshots({
      snapshot: inferred.featureSnapshot,
      localPrediction,
      aiPrediction,
      selectedSignalSource: selectedPrediction.source,
      signalMode
    });
    const effectiveStrategyRef: PredictionStrategyRef | null =
      requestedStrategyRefEffective?.kind === "composite" && selectedCompositeStrategy
        ? {
            kind: "composite",
            id: selectedCompositeStrategy.id,
            name: selectedCompositeStrategy.name
          }
        : requestedStrategyRefEffective?.kind === "local" && selectedLocalStrategy
          ? {
              kind: "local",
              id: selectedLocalStrategy.id,
              name: selectedLocalStrategy.name
            }
          : requestedPromptTemplateId
            ? {
                kind: "ai",
                id: runtimePromptTemplateId ?? requestedPromptTemplateId,
                name:
                  runtimePromptSettings?.activePromptName
                  ?? requestedPromptTemplateName
                  ?? requestedStrategyRefEffective?.name
                  ?? null
              }
            : null;
    inferred.featureSnapshot = withStrategyRunSnapshot(
      inferred.featureSnapshot,
      {
        strategyRef: effectiveStrategyRef,
        status: strategyRunStatus,
        signal: selectedPrediction.signal,
        expectedMovePct: selectedPrediction.expectedMovePct,
        confidence: selectedPrediction.confidence,
        source: selectedPrediction.source,
        aiCalled,
        explanation: explainer.explanation,
        tags: explainer.tags,
        keyDrivers: explainer.keyDrivers,
        ts: tsCreated
      },
      strategyRunDebug
    );

    const tags = enforceNewsRiskTag(
      explainer.tags.length > 0 ? explainer.tags : baselineTags,
      inferred.featureSnapshot
    );
    const keyDrivers = normalizeKeyDriverList(explainer.keyDrivers);
    const significant = evaluateSignificantChange({
      prev: prevState,
      next: {
        signal: selectedPrediction.signal,
        confidence: selectedPrediction.confidence,
        tags,
        featureSnapshot: inferred.featureSnapshot
      }
    });
    const changeReasons = significant.reasons.length > 0 ? [...significant.reasons] : [params.reason];
    if (significant.significant && significant.changeType === "signal_flip") {
      const recentFlips = await db.predictionEvent.findMany({
        where: {
          stateId: template.stateId,
          changeType: "signal_flip",
          tsCreated: {
            gte: new Date(
              Date.now() - predictionRefreshRuntimeSettings.unstableFlipWindowSeconds * 1000
            )
          }
        },
        orderBy: [{ tsCreated: "desc" }],
        take: predictionRefreshRuntimeSettings.unstableFlipLimit + 1,
        select: { tsCreated: true }
      });
      const markUnstable = shouldMarkUnstableFlips({
        recentFlipCount: recentFlips.length,
        unstableFlipLimit: predictionRefreshRuntimeSettings.unstableFlipLimit,
        unstableWindowMs: predictionRefreshRuntimeSettings.unstableFlipWindowSeconds * 1000,
        lastFlipAtMs: recentFlips[0]?.tsCreated?.getTime() ?? null,
        nowMs: Date.now()
      });
      if (markUnstable) {
        if (!tags.includes("range_bound")) {
          tags.push("range_bound");
          while (tags.length > 5) tags.pop();
        }
        if (!changeReasons.includes("unstable_flip_window")) {
          changeReasons.push("unstable_flip_window");
        }
      }
    }
    const explainVersion =
      selectedCompositeStrategy
        ? "composite-strategy-v1"
        : selectedLocalStrategy
          ? "local-strategy-v1"
        : signalMode === "local_only"
          ? "local-explain-v1"
          : aiCalled
            ? "openai-explain-v1"
            : "openai-explain-skip-v1";
    const resolvedTracking = resolvePredictionTracking({
      signal: selectedPrediction.signal,
      slTpSource: runtimePromptSettings?.slTpSource ?? "local",
      localTracking: {
        entryPrice: inferred.tracking.entryPrice,
        stopLossPrice: inferred.tracking.stopLossPrice,
        takeProfitPrice: inferred.tracking.takeProfitPrice,
        horizonMs: inferred.tracking.horizonMs
      },
      aiLevels: explainer.levels
    });
    inferred.featureSnapshot = {
      ...inferred.featureSnapshot,
      ...(resolvedTracking.entryPrice !== null
        ? { suggestedEntryPrice: resolvedTracking.entryPrice }
        : {}),
      ...(resolvedTracking.stopLossPrice !== null
        ? { suggestedStopLoss: resolvedTracking.stopLossPrice }
        : {}),
      ...(resolvedTracking.takeProfitPrice !== null
        ? { suggestedTakeProfit: resolvedTracking.takeProfitPrice }
        : {}),
      trackingConfig: {
        slTpSourceRequested: resolvedTracking.requestedSource,
        slTpSourceResolved: resolvedTracking.resolvedSource,
        aiLevelsUsed: resolvedTracking.aiLevelsUsed
      }
    };
    const modelVersion = `${template.modelVersionBase || "baseline-v1:auto-market-v1"} + ${explainVersion}`;
    const tsUpdated = new Date(tsCreated);
    const tsPredictedFor = new Date(tsUpdated.getTime() + timeframeToIntervalMs(template.timeframe));
    const changeHash = buildPredictionChangeHash({
      signal: selectedPrediction.signal,
      confidence: selectedPrediction.confidence,
      tags,
      keyDrivers,
      featureSnapshot: inferred.featureSnapshot
    });

    const stateData = {
      ...toPredictionStateStrategyScope(effectiveStrategyRef),
      exchange: account.exchange,
      accountId: template.exchangeAccountId,
      userId: template.userId,
      symbol: template.symbol,
      marketType: template.marketType,
      timeframe: template.timeframe,
      signalMode,
      tsUpdated,
      tsPredictedFor,
      signal: selectedPrediction.signal,
      expectedMovePct: Number.isFinite(Number(selectedPrediction.expectedMovePct))
        ? Number(selectedPrediction.expectedMovePct)
        : null,
      confidence: Number.isFinite(Number(selectedPrediction.confidence))
        ? Number(selectedPrediction.confidence)
        : 0,
      tags,
      explanation: explainer.explanation,
      keyDrivers,
      featuresSnapshot: inferred.featureSnapshot,
      modelVersion,
      lastAiExplainedAt: aiCalled ? tsUpdated : prevState?.lastAiExplainedAt ?? null,
      aiGateLastDecisionHash: aiGateDecision.decisionHash,
      aiGateLastReasonCodes: aiGateDecision.reasonCodes,
      aiGateLastPriority: aiGateDecision.priority,
      aiGateWindowStartedAt: aiGateStateForPersist.windowStartedAt,
      aiGateCallsLastHour: aiGateStateForPersist.aiCallsLastHour,
      aiGateHighPriorityCallsLastHour: aiGateStateForPersist.highPriorityCallsLastHour,
      aiGateLastExplainedPredictionHash: aiCalled
        ? aiGateDecision.predictionHash
        : gateState.lastExplainedPredictionHash,
      aiGateLastExplainedHistoryHash: aiCalled
        ? aiGateDecision.historyHash
        : gateState.lastExplainedHistoryHash,
      lastChangeHash: changeHash,
      lastChangeReason:
        significant.significant && changeReasons.length > 0
          ? changeReasons.join(",")
          : params.reason,
      autoScheduleEnabled: template.autoScheduleEnabled,
      autoSchedulePaused: template.autoSchedulePaused,
      directionPreference: template.directionPreference,
      confidenceTargetPct: template.confidenceTargetPct,
      leverage: template.leverage ?? null
    };

    const stateRow = await persistPredictionState({
      existingStateId: prevStateRow ? template.stateId : null,
      stateData,
      scope: {
        userId: template.userId,
        exchange: account.exchange,
        accountId: template.exchangeAccountId,
        symbol: template.symbol,
        marketType: template.marketType,
        timeframe: template.timeframe,
        signalMode
      }
    });
    const stateId = stateRow.id;

    if (significant.significant) {
      const prevMinimal = prevState
        ? {
            signal: prevState.signal,
            confidence: prevState.confidence,
            tags: prevState.tags,
            tsUpdated: prevState.tsUpdated.toISOString()
          }
        : null;
      const nextMinimal = {
        signal: selectedPrediction.signal,
        confidence: selectedPrediction.confidence,
        expectedMovePct: selectedPrediction.expectedMovePct,
        tags
      };
      const delta = buildEventDelta({
        prev: prevState,
        next: {
          signal: selectedPrediction.signal,
          confidence: selectedPrediction.confidence,
          tags,
          expectedMovePct: selectedPrediction.expectedMovePct
        },
        reasons: changeReasons
      });
      const recentSameEvent = await db.predictionEvent.findFirst({
        where: {
          stateId,
          changeType: significant.changeType,
          tsCreated: {
            gte: new Date(Date.now() - predictionRefreshRuntimeSettings.eventThrottleSec * 1000)
          }
        },
        orderBy: [{ tsCreated: "desc" }],
        select: { tsCreated: true }
      });
      const throttled = shouldThrottleRepeatedEvent({
        nowMs: Date.now(),
        recentSameEventAtMs: recentSameEvent?.tsCreated?.getTime() ?? null,
        eventThrottleMs: predictionRefreshRuntimeSettings.eventThrottleSec * 1000
      });
      if (!throttled) {
        const historyTs = new Date(tsCreated);
        const historyRow = await db.prediction.create({
          data: {
            userId: template.userId,
            botId: null,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated: historyTs,
            signal: selectedPrediction.signal,
            expectedMovePct: selectedPrediction.expectedMovePct,
            confidence: selectedPrediction.confidence,
            explanation: explainer.explanation,
            tags,
            featuresSnapshot: inferred.featureSnapshot,
            entryPrice: resolvedTracking.entryPrice,
            stopLossPrice: resolvedTracking.stopLossPrice,
            takeProfitPrice: resolvedTracking.takeProfitPrice,
            horizonMs: resolvedTracking.horizonMs,
            modelVersion
          },
          select: { id: true }
        });

        await db.predictionEvent.create({
          data: {
            stateId,
            changeType: significant.changeType,
            prevSnapshot: prevMinimal,
            newSnapshot: nextMinimal,
            delta,
            horizonEvalRef: historyRow.id,
            modelVersion,
            reason: params.reason
          }
        });

        await notifyTradablePrediction({
          userId: template.userId,
          exchange: account.exchange,
          exchangeAccountLabel: account.label,
          symbol: template.symbol,
          marketType: template.marketType,
          timeframe: template.timeframe,
          signal: selectedPrediction.signal,
          confidence: selectedPrediction.confidence,
          confidenceTargetPct: template.confidenceTargetPct,
          expectedMovePct: selectedPrediction.expectedMovePct,
          predictionId: historyRow.id,
          explanation: explainer.explanation,
          source: "auto",
          signalSource: selectedPrediction.source,
          aiPromptTemplateName: resolveNotificationStrategyName({
            signalSource: selectedPrediction.source,
            snapshot: inferred.featureSnapshot,
            strategyRef: effectiveStrategyRef
          })
        });
        if (readAiPromptMarketAnalysisUpdateEnabled(inferred.featureSnapshot)) {
          await notifyMarketAnalysisUpdate({
            userId: template.userId,
            exchange: account.exchange,
            exchangeAccountLabel: account.label,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            signal: selectedPrediction.signal,
            confidence: selectedPrediction.confidence,
            expectedMovePct: selectedPrediction.expectedMovePct,
            predictionId: historyRow.id,
            explanation: explainer.explanation,
            source: "auto",
            signalSource: selectedPrediction.source,
            aiPromptTemplateName: resolveNotificationStrategyName({
              signalSource: selectedPrediction.source,
              snapshot: inferred.featureSnapshot,
              strategyRef: effectiveStrategyRef
            })
          });
        }
      }
    }

    return {
      refreshed: true,
      significant: significant.significant,
      aiCalled
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[predictions:refresh] state refresh failed", {
      stateId: template.stateId,
      symbol: template.symbol,
      timeframe: template.timeframe,
      reason: String(error)
    });
    return {
      refreshed: false,
      significant: false,
      aiCalled: false
    };
  } finally {
    if (adapter) {
      await adapter.close();
    }
  }
}

async function runPredictionAutoCycle() {
  if (!PREDICTION_AUTO_ENABLED || !PREDICTION_REFRESH_ENABLED) return;
  if (predictionAutoRunning) return;

  let refreshed = 0;
  let significantCount = 0;
  let aiCallCount = 0;

  predictionAutoRunning = true;
  try {
    try {
      await refreshPredictionRefreshRuntimeSettingsFromDb();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] failed to load runtime settings, using last known defaults", {
        reason: String(error)
      });
    }
    await bootstrapPredictionStateFromHistory();
    const templates = await listPredictionRefreshTemplates();
    const active = templates.filter(
      (row) => row.autoScheduleEnabled && !row.autoSchedulePaused
    );

    const now = Date.now();

    const dueTemplates = active.filter((template) => {
      const intervalMs = refreshIntervalMsForTimeframe(template.timeframe);
      return now - template.tsUpdated.getTime() >= intervalMs;
    });

    for (const template of dueTemplates) {
      if (refreshed >= PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE) break;
      const result = await refreshPredictionStateForTemplate({
        template,
        reason: "scheduled_due"
      });
      if (!result.refreshed) continue;
      predictionTriggerDebounceState.delete(template.stateId);
      refreshed += 1;
      if (result.significant) significantCount += 1;
      if (result.aiCalled) aiCallCount += 1;
    }

    if (refreshed < PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE) {
      const remaining = active
        .filter((template) => !dueTemplates.some((item) => item.stateId === template.stateId))
        .filter((template) => now - template.tsUpdated.getTime() >= PREDICTION_REFRESH_TRIGGER_MIN_AGE_MS)
        .slice(0, PREDICTION_REFRESH_TRIGGER_PROBE_LIMIT);

      for (const template of remaining) {
        if (refreshed >= PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE) break;
        const triggerProbe = await probePredictionRefreshTrigger(template);
        if (!triggerProbe.refresh) continue;
        const result = await refreshPredictionStateForTemplate({
          template,
          reason: triggerProbe.reasons.join(",") || "triggered"
        });
        if (!result.refreshed) continue;
        predictionTriggerDebounceState.delete(template.stateId);
        refreshed += 1;
        if (result.significant) significantCount += 1;
        if (result.aiCalled) aiCallCount += 1;
      }
    }

    if (refreshed > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[predictions:refresh] updated ${refreshed} state row(s), ` +
          `significant=${significantCount}, ai_called=${aiCallCount}`
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:refresh] scheduler cycle failed", String(error));
  } finally {
    predictionAutoRunning = false;
  }
}

function startPredictionAutoScheduler() {
  if (!PREDICTION_AUTO_ENABLED) return;
  predictionAutoTimer = setInterval(() => {
    void runPredictionAutoCycle();
  }, PREDICTION_AUTO_POLL_MS);
  void runPredictionAutoCycle();
}

function stopPredictionAutoScheduler() {
  if (!predictionAutoTimer) return;
  clearInterval(predictionAutoTimer);
  predictionAutoTimer = null;
}

function startPredictionOutcomeEvalScheduler() {
  if (!PREDICTION_OUTCOME_EVAL_ENABLED) return;
  predictionOutcomeEvalTimer = setInterval(() => {
    void runPredictionOutcomeEvalCycle();
  }, PREDICTION_OUTCOME_EVAL_POLL_MS);
  void runPredictionOutcomeEvalCycle();
}

function stopPredictionOutcomeEvalScheduler() {
  if (!predictionOutcomeEvalTimer) return;
  clearInterval(predictionOutcomeEvalTimer);
  predictionOutcomeEvalTimer = null;
}

function startPredictionPerformanceEvalScheduler() {
  if (!PREDICTION_EVALUATOR_ENABLED) return;
  predictionPerformanceEvalTimer = setInterval(() => {
    void runPredictionPerformanceEvalCycle();
  }, PREDICTION_EVALUATOR_POLL_MS);
  void runPredictionPerformanceEvalCycle();
}

function stopPredictionPerformanceEvalScheduler() {
  if (!predictionPerformanceEvalTimer) return;
  clearInterval(predictionPerformanceEvalTimer);
  predictionPerformanceEvalTimer = null;
}

type WsAuthUser = {
  id: string;
  email: string;
};

type MarketWsContext = {
  adapter: BitgetFuturesAdapter;
  selectedAccount: Awaited<ReturnType<typeof resolveTradingAccount>>;
  marketDataAccount: Awaited<ReturnType<typeof resolveTradingAccount>>;
  stop: () => Promise<void>;
};

function readCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const entries = header.split(";");
  for (const entry of entries) {
    const [rawName, ...rest] = entry.trim().split("=");
    if (rawName !== name) continue;
    const value = rest.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function authenticateWsUser(req: http.IncomingMessage): Promise<WsAuthUser | null> {
  const token = readCookieValue(req.headers.cookie, "mm_session");
  if (!token) return null;

  const session = await db.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  await db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() }
  });

  return {
    id: session.user.id,
    email: session.user.email
  };
}

function wsReject(socket: any, statusCode: number, reason: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function createMarketWsContext(
  userId: string,
  exchangeAccountId?: string | null
): Promise<{ accountId: string; ctx: MarketWsContext }> {
  const resolved = await resolveMarketDataTradingAccount(userId, exchangeAccountId);
  const adapter = createBitgetAdapter(resolved.marketDataAccount);
  await adapter.contractCache.warmup();

  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await adapter.close();
  };

  return {
    accountId: resolved.selectedAccount.id,
    ctx: {
      adapter,
      selectedAccount: resolved.selectedAccount,
      marketDataAccount: resolved.marketDataAccount,
      stop
    }
  };
}

function pickWsSymbol(
  preferred: string | null | undefined,
  contracts: Array<{ canonicalSymbol: string; apiAllowed: boolean }>
): string | null {
  const normalizedPreferred = normalizeSymbolInput(preferred);
  if (normalizedPreferred && contracts.some((row) => row.canonicalSymbol === normalizedPreferred)) {
    return normalizedPreferred;
  }
  return contracts.find((row) => row.apiAllowed)?.canonicalSymbol ?? contracts[0]?.canonicalSymbol ?? null;
}

function sendManualTradingError(res: express.Response, error: unknown) {
  if (error instanceof ManualTradingError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      message: error.message
    });
  }

  const unknown = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    options?: {
      status?: unknown;
      code?: unknown;
      message?: unknown;
    };
  };

  const rawStatus = Number(unknown?.status ?? unknown?.options?.status);
  const status = Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus < 600
    ? rawStatus
    : 500;

  const code =
    typeof unknown?.code === "string" && unknown.code.trim()
      ? unknown.code
      : typeof unknown?.options?.code === "string" && unknown.options.code.trim()
        ? unknown.options.code
        : "manual_trading_unexpected_error";

  const message =
    error instanceof Error
      ? error.message
      : typeof unknown?.options?.message === "string" && unknown.options.message.trim()
        ? unknown.options.message
        : "Unexpected manual trading failure.";

  // eslint-disable-next-line no-console
  console.error("[manual-trading]", message, { status, code });

  return res.status(status).json({
    error: code,
    message
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api" });
});

app.get("/system/settings", (_req, res) => {
  res.json({
    tradingEnabled: true,
    readOnlyMode: false,
    orchestrationMode: getRuntimeOrchestrationMode()
  });
});

app.get("/license/state", (_req, res) => {
  res.json({
    enforcement: isLicenseEnforcementEnabled() ? "on" : "off",
    stubEnabled: isLicenseStubEnabled() ? "on" : "off"
  });
});

app.get("/license-server-stub/entitlements", (req, res) => {
  if (!isLicenseStubEnabled()) {
    return res.status(404).json({ error: "stub_disabled" });
  }

  const userId = typeof req.query.userId === "string" ? req.query.userId : "";
  return res.json({
    userId,
    ...getStubEntitlements()
  });
});

app.get("/admin/queue/metrics", requireAuth, async (_req, res) => {
  try {
    const metrics = await getQueueMetrics();
    return res.json(metrics);
  } catch (error) {
    return res.status(503).json({
      error: "queue_unavailable",
      reason: String(error)
    });
  }
});

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email_already_exists" });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.user.create({
    data: {
      email,
      passwordHash
    },
    select: {
      id: true,
      email: true
    }
  });

  await ensureWorkspaceMembership(user.id, user.email);
  await createSession(res, user.id);
  return res.status(201).json({ user: toSafeUser(user) });
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });
  if (!user?.passwordHash) return res.status(401).json({ error: "invalid_credentials" });

  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordOk) return res.status(401).json({ error: "invalid_credentials" });

  await ensureWorkspaceMembership(user.id, user.email);
  await createSession(res, user.id);
  return res.json({ user: toSafeUser(user) });
});

app.post("/auth/logout", async (req, res) => {
  const token = req.cookies?.mm_session ?? null;
  await destroySession(res, token);
  return res.json({ ok: true });
});

app.get("/auth/me", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const ctx = await resolveUserContext(user);
  return res.json(toAuthMePayload(user, ctx));
});

app.post("/auth/change-password", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = changePasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true }
  });
  if (!row?.passwordHash) {
    return res.status(400).json({ error: "password_not_set" });
  }

  const ok = await verifyPassword(parsed.data.currentPassword, row.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const nextHash = await hashPassword(parsed.data.newPassword);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: nextHash }
  });

  return res.json({ ok: true });
});

app.post("/auth/password-reset/request", async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true }
  });

  let devCode: string | null = null;
  if (user) {
    const code = generateNumericCode(6);
    const codeHash = hashOneTimeCode(code);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MIN * 60_000);

    await db.reauthOtp.deleteMany({
      where: {
        userId: user.id,
        purpose: PASSWORD_RESET_PURPOSE
      }
    });

    await db.reauthOtp.create({
      data: {
        userId: user.id,
        purpose: PASSWORD_RESET_PURPOSE,
        codeHash,
        expiresAt
      }
    });

    const sent = await sendReauthOtpEmail({
      to: user.email,
      code,
      expiresAt
    });

    if (!sent.ok) {
      // eslint-disable-next-line no-console
      console.warn("[password-reset] email send failed", {
        email: user.email,
        reason: sent.error
      });
    }

    if (process.env.NODE_ENV !== "production") {
      devCode = code;
    }
  }

  return res.json({
    ok: true,
    expiresInMinutes: PASSWORD_RESET_OTP_TTL_MIN,
    ...(devCode ? { devCode } : {})
  });
});

app.post("/auth/password-reset/confirm", async (req, res) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true
    }
  });
  if (!user) {
    return res.status(400).json({ error: "invalid_or_expired_code" });
  }

  const otp = await db.reauthOtp.findFirst({
    where: {
      userId: user.id,
      purpose: PASSWORD_RESET_PURPOSE,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      codeHash: true
    }
  });
  if (!otp) {
    return res.status(400).json({ error: "invalid_or_expired_code" });
  }

  if (hashOneTimeCode(parsed.data.code) !== otp.codeHash) {
    return res.status(400).json({ error: "invalid_or_expired_code" });
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword)
    }
  });

  await Promise.all([
    db.reauthOtp.deleteMany({
      where: {
        userId: user.id,
        purpose: PASSWORD_RESET_PURPOSE
      }
    }),
    db.session.deleteMany({
      where: {
        userId: user.id
      }
    })
  ]);

  return res.json({ ok: true });
});

app.get("/settings/security", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const [row, global, ctx, userOverride] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: {
        autoLogoutEnabled: true,
        autoLogoutMinutes: true
      }
    }),
    getSecurityGlobalSettings(),
    resolveUserContext(user),
    getSecurityUserReauthOverride(user.id)
  ]);

  const effectiveReauthOtpEnabled =
    userOverride === null ? global.reauthOtpEnabled : userOverride;

  return res.json({
    autoLogoutEnabled: row?.autoLogoutEnabled ?? true,
    autoLogoutMinutes: row?.autoLogoutMinutes ?? 60,
    reauthOtpEnabled: effectiveReauthOtpEnabled,
    isSuperadmin: ctx.isSuperadmin
  });
});

app.put("/settings/security", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = securitySettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const ctx = await resolveUserContext(user);
  const nextUserFields: Record<string, unknown> = {};
  if (typeof parsed.data.autoLogoutEnabled === "boolean") {
    nextUserFields.autoLogoutEnabled = parsed.data.autoLogoutEnabled;
  }
  if (typeof parsed.data.autoLogoutMinutes === "number") {
    nextUserFields.autoLogoutMinutes = parsed.data.autoLogoutMinutes;
  }
  if (Object.keys(nextUserFields).length > 0) {
    await db.user.update({
      where: { id: user.id },
      data: nextUserFields
    });
  }

  const global = await getSecurityGlobalSettings();
  let nextReauthEnabled = global.reauthOtpEnabled;
  if (typeof parsed.data.reauthOtpEnabled === "boolean") {
    nextReauthEnabled = parsed.data.reauthOtpEnabled;
    if (ctx.isSuperadmin) {
      await setSecurityGlobalSettings({ reauthOtpEnabled: parsed.data.reauthOtpEnabled });
    } else {
      await setSecurityUserReauthOverride(user.id, parsed.data.reauthOtpEnabled);
    }
  } else {
    const userOverride = await getSecurityUserReauthOverride(user.id);
    nextReauthEnabled = userOverride === null ? global.reauthOtpEnabled : userOverride;
  }

  const updated = await db.user.findUnique({
    where: { id: user.id },
    select: {
      autoLogoutEnabled: true,
      autoLogoutMinutes: true
    }
  });

  return res.json({
    autoLogoutEnabled: updated?.autoLogoutEnabled ?? true,
    autoLogoutMinutes: updated?.autoLogoutMinutes ?? 60,
    reauthOtpEnabled: nextReauthEnabled,
    isSuperadmin: ctx.isSuperadmin
  });
});

app.get("/settings/exchange-options", requireAuth, async (_req, res) => {
  const allowed = await getAllowedExchangeValues();
  return res.json({
    allowed,
    options: getExchangeOptionsResponse(allowed)
  });
});

app.get("/settings/server-info", requireAuth, async (_req, res) => {
  const settings = await getServerInfoSettings();
  return res.json({
    serverIpAddress: settings.serverIpAddress
  });
});

app.get("/settings/alerts", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const isSuperadmin = isSuperadminEmail(user.email);
  const [config, userSettings] = await Promise.all([
    db.alertConfig.findUnique({
      where: { key: "default" },
      select: {
        telegramBotToken: true
      }
    }),
    db.user.findUnique({
      where: { id: user.id },
      select: {
        telegramChatId: true
      }
    })
  ]);
  const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
  const dbToken = parseTelegramConfigValue(config?.telegramBotToken);

  return res.json({
    telegramBotToken: isSuperadmin ? dbToken : null,
    telegramBotConfigured: Boolean(envToken ?? dbToken),
    telegramChatId: userSettings?.telegramChatId ?? null
  });
});

app.put("/settings/alerts", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const isSuperadmin = isSuperadminEmail(user.email);
  const parsed = alertsSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const requestedToken = parseTelegramConfigValue(parsed.data.telegramBotToken);
  const requestedChatId = parseTelegramConfigValue(parsed.data.telegramChatId);
  const hasTokenUpdate = Object.prototype.hasOwnProperty.call(parsed.data, "telegramBotToken");
  const [existingConfig, updatedUser] = await Promise.all([
    db.alertConfig.findUnique({
      where: { key: "default" },
      select: {
        telegramBotToken: true,
        telegramChatId: true
      }
    }),
    db.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: requestedChatId
      },
      select: {
        telegramChatId: true
      }
    })
  ]);

  let token = parseTelegramConfigValue(existingConfig?.telegramBotToken);
  if (isSuperadmin && hasTokenUpdate) {
    const updatedConfig = await db.alertConfig.upsert({
      where: { key: "default" },
      create: {
        key: "default",
        telegramBotToken: requestedToken,
        telegramChatId: parseTelegramConfigValue(existingConfig?.telegramChatId)
      },
      update: {
        telegramBotToken: requestedToken
      },
      select: {
        telegramBotToken: true
      }
    });
    token = parseTelegramConfigValue(updatedConfig.telegramBotToken);
  }

  const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);

  return res.json({
    telegramBotToken: isSuperadmin ? token : null,
    telegramBotConfigured: Boolean(envToken ?? token),
    telegramChatId: updatedUser.telegramChatId ?? null
  });
});

app.post("/alerts/test", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const config = await resolveTelegramConfig(user.id);
  if (!config) {
    return res.status(400).json({
      error: "telegram_not_configured",
      details: "Set telegramBotToken + telegramChatId in /settings/notifications"
    });
  }

  try {
    await sendTelegramMessage({
      ...config,
      text: [
        "uTrade Telegram test",
        `User: ${user.email}`,
        `Time: ${new Date().toISOString()}`
      ].join("\n")
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(502).json({
      error: "telegram_send_failed",
      details: String(error)
    });
  }
});

app.get("/admin/users", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const adminAccessIds = await getAdminBackendAccessUserIdSet();

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          sessions: true,
          exchangeAccounts: true,
          bots: true,
          workspaces: true
        }
      }
    }
  });

  const rows = users.map((row: any) => ({
    id: row.id,
    email: row.email,
    isSuperadmin: isSuperadminEmail(row.email),
    hasAdminBackendAccess: isSuperadminEmail(row.email) || adminAccessIds.has(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sessions: row._count?.sessions ?? 0,
    exchangeAccounts: row._count?.exchangeAccounts ?? 0,
    bots: row._count?.bots ?? 0,
    workspaceMemberships: row._count?.workspaces ?? 0
  }));

  return res.json({ items: rows });
});

app.post("/admin/users", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminUserCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "email_already_exists" });
  }

  const generated = !parsed.data.password;
  const password = parsed.data.password ?? generateTempPassword();
  const passwordHash = await hashPassword(password);

  const created = await db.user.create({
    data: {
      email,
      passwordHash
    },
    select: {
      id: true,
      email: true,
      createdAt: true
    }
  });
  const membership = await ensureWorkspaceMembership(created.id, created.email);

  return res.status(201).json({
    user: {
      id: created.id,
      email: created.email,
      createdAt: created.createdAt,
      workspaceId: membership.workspaceId
    },
    temporaryPassword: generated ? password : null
  });
});

app.put("/admin/users/:id/password", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const id = req.params.id;
  const parsed = adminUserPasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!user) return res.status(404).json({ error: "user_not_found" });

  await db.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(parsed.data.password)
    }
  });

  await db.session.deleteMany({
    where: { userId: id }
  });

  return res.json({ ok: true, sessionsRevoked: true });
});

app.put("/admin/users/:id/admin-access", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const actor = getUserFromLocals(res);
  const id = req.params.id;
  const parsed = adminUserAdminAccessSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true }
  });
  if (!user) return res.status(404).json({ error: "user_not_found" });
  if (isSuperadminEmail(user.email)) {
    return res.status(400).json({ error: "cannot_change_superadmin_admin_access" });
  }

  const settings = parseStoredAdminBackendAccess(
    await getGlobalSettingValue(GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY)
  );
  const ids = new Set(settings.userIds);
  if (parsed.data.enabled) {
    ids.add(user.id);
  } else {
    ids.delete(user.id);
    if (actor.id === user.id) {
      await db.session.deleteMany({ where: { userId: user.id } });
    }
  }
  const next = { userIds: Array.from(ids) };
  await setGlobalSettingValue(GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY, next);

  return res.json({
    ok: true,
    userId: user.id,
    hasAdminBackendAccess: parsed.data.enabled
  });
});

app.delete("/admin/users/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const actor = getUserFromLocals(res);
  const id = req.params.id;

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true }
  });
  if (!user) return res.status(404).json({ error: "user_not_found" });
  if (isSuperadminEmail(user.email)) {
    return res.status(400).json({ error: "cannot_delete_superadmin" });
  }
  if (user.id === actor.id) {
    return res.status(400).json({ error: "cannot_delete_self" });
  }

  const bots = await db.bot.findMany({
    where: { userId: user.id },
    select: { id: true }
  });
  const botIds = bots.map((row: any) => row.id);

  await db.$transaction(async (tx: any) => {
    if (botIds.length > 0) {
      await ignoreMissingTable(() => tx.botMetric.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botAlert.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.riskEvent.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botRuntime.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botTradeHistory.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.futuresBotConfig.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.marketMakingConfig.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.volumeConfig.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.riskConfig.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botNotificationConfig.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botPriceSupportConfig.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botFillCursor.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botFillSeen.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.botOrderMap.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.manualTradeLog.deleteMany({ where: { botId: { in: botIds } } }));
      await ignoreMissingTable(() => tx.bot.deleteMany({ where: { id: { in: botIds } } }));
    }

    await ignoreMissingTable(() => tx.prediction.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.predictionState.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.manualTradeLog.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.exchangeAccount.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.botConfigPreset.deleteMany({ where: { createdByUserId: user.id } }));
    await ignoreMissingTable(() => tx.auditEvent.deleteMany({ where: { actorUserId: user.id } }));
    await ignoreMissingTable(() => tx.workspaceMember.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.reauthOtp.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.reauthSession.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.session.deleteMany({ where: { userId: user.id } }));
    await ignoreMissingTable(() => tx.user.delete({ where: { id: user.id } }));
  });

  const backendAccessSettings = parseStoredAdminBackendAccess(
    await getGlobalSettingValue(GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY)
  );
  if (backendAccessSettings.userIds.includes(user.id)) {
    await setGlobalSettingValue(GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY, {
      userIds: backendAccessSettings.userIds.filter((entry) => entry !== user.id)
    });
  }

  return res.json({ ok: true, deletedUserId: user.id });
});

app.get("/admin/settings/telegram", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const config = await db.alertConfig.findUnique({
    where: { key: "default" },
    select: {
      telegramBotToken: true,
      telegramChatId: true
    }
  });
  const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
  const envChatId = parseTelegramConfigValue(process.env.TELEGRAM_CHAT_ID);

  return res.json({
    telegramBotTokenMasked: config?.telegramBotToken ? maskSecret(config.telegramBotToken) : null,
    telegramChatId: config?.telegramChatId ?? null,
    configured: Boolean(config?.telegramBotToken && config?.telegramChatId),
    envOverride: Boolean(envToken && envChatId)
  });
});

app.put("/admin/settings/telegram", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminTelegramSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const token = parseTelegramConfigValue(parsed.data.telegramBotToken);
  const chatId = parseTelegramConfigValue(parsed.data.telegramChatId);

  const updated = await db.alertConfig.upsert({
    where: { key: "default" },
    create: {
      key: "default",
      telegramBotToken: token,
      telegramChatId: chatId
    },
    update: {
      telegramBotToken: token,
      telegramChatId: chatId
    },
    select: {
      telegramBotToken: true,
      telegramChatId: true
    }
  });

  return res.json({
    telegramBotTokenMasked: updated.telegramBotToken ? maskSecret(updated.telegramBotToken) : null,
    telegramChatId: updated.telegramChatId ?? null,
    configured: Boolean(updated.telegramBotToken && updated.telegramChatId)
  });
});

app.post("/admin/settings/telegram/test", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const user = getUserFromLocals(res);
  const config = await resolveTelegramConfig();
  if (!config) {
    return res.status(400).json({
      error: "telegram_not_configured",
      details: "No Telegram config found in ENV or DB."
    });
  }
  try {
    await sendTelegramMessage({
      ...config,
      text: [
        "uTrade admin telegram test",
        `Triggered by: ${user.email}`,
        `Time: ${new Date().toISOString()}`
      ].join("\n")
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(502).json({
      error: "telegram_send_failed",
      details: String(error)
    });
  }
});

app.get("/admin/settings/exchanges", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const allowed = await getAllowedExchangeValues();
  return res.json({
    allowed,
    options: getExchangeOptionsResponse(allowed)
  });
});

app.put("/admin/settings/exchanges", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminExchangesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const normalized = Array.from(
    new Set(
      parsed.data.allowed
        .map(normalizeExchangeValue)
        .filter((value) => EXCHANGE_OPTION_VALUES.has(value as ExchangeOption["value"]))
    )
  );

  if (normalized.length === 0) {
    return res.status(400).json({ error: "allowed_exchanges_empty" });
  }

  await setGlobalSettingValue(GLOBAL_SETTING_EXCHANGES_KEY, normalized);
  return res.json({
    allowed: normalized,
    options: getExchangeOptionsResponse(normalized)
  });
});

app.get("/admin/settings/smtp", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_SMTP_KEY },
    select: {
      value: true,
      updatedAt: true
    }
  });
  const settings = parseStoredSmtpSettings(row?.value);
  const envConfigured = Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  );

  return res.json({
    ...toPublicSmtpSettings(settings),
    updatedAt: row?.updatedAt ?? null,
    envOverride: envConfigured
  });
});

app.put("/admin/settings/smtp", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminSmtpSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const existing = parseStoredSmtpSettings(await getGlobalSettingValue(GLOBAL_SETTING_SMTP_KEY));
  const nextValue = {
    host: parsed.data.host.trim(),
    port: parsed.data.port,
    user: parsed.data.user.trim(),
    from: parsed.data.from.trim(),
    secure: parsed.data.secure,
    passEnc: parsed.data.password
      ? encryptSecret(parsed.data.password)
      : existing.passEnc
  };

  if (!nextValue.passEnc) {
    return res.status(400).json({ error: "smtp_password_required" });
  }

  const updated = await setGlobalSettingValue(GLOBAL_SETTING_SMTP_KEY, nextValue);
  const settings = parseStoredSmtpSettings(updated.value);

  return res.json({
    ...toPublicSmtpSettings(settings),
    updatedAt: updated.updatedAt
  });
});

app.post("/admin/settings/smtp/test", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminSmtpTestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const sent = await sendSmtpTestEmail({
    to: parsed.data.to,
    subject: "uTrade SMTP Test",
    text: [
      "uTrade SMTP test successful.",
      `Time: ${new Date().toISOString()}`
    ].join("\n")
  });
  if (!sent.ok) {
    return res.status(502).json({
      error: sent.error ?? "smtp_test_failed"
    });
  }

  return res.json({ ok: true });
});

app.get("/admin/settings/api-keys", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_API_KEYS_KEY },
    select: {
      value: true,
      updatedAt: true
    }
  });
  const settings = parseStoredApiKeysSettings(row?.value);
  const envConfigured = Boolean(process.env.AI_API_KEY?.trim());
  const fmpEnvConfigured = Boolean(process.env.FMP_API_KEY?.trim());
  const effectiveModel = resolveEffectiveOpenAiModel(settings);

  return res.json({
    ...toPublicApiKeysSettings(settings),
    updatedAt: row?.updatedAt ?? null,
    envOverride: envConfigured,
    envOverrideFmp: fmpEnvConfigured,
    effectiveOpenaiModel: effectiveModel.model,
    effectiveOpenaiModelSource: effectiveModel.source,
    modelOptions: [...OPENAI_ADMIN_MODEL_OPTIONS]
  });
});

app.get("/admin/settings/api-keys/status", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;

  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_API_KEYS_KEY },
    select: { value: true }
  });
  const settings = parseStoredApiKeysSettings(row?.value);
  const resolved = resolveEffectiveOpenAiApiKey(settings);
  const effectiveModel = resolveEffectiveOpenAiModel(settings);
  const checkedAt = new Date().toISOString();

  if (resolved.decryptError) {
    return res.json({
      ok: false,
      status: "error",
      source: resolved.source,
      checkedAt,
      message: "Stored OpenAI key could not be decrypted.",
      model: effectiveModel.model
    });
  }

  if (!resolved.apiKey) {
    return res.json({
      ok: false,
      status: "missing_key",
      source: resolved.source,
      checkedAt,
      message: "No OpenAI API key configured.",
      model: effectiveModel.model
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const startedAt = Date.now();

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`
      },
      signal: controller.signal
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok) {
      return res.json({
        ok: true,
        status: "ok",
        source: resolved.source,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: "OpenAI connection is healthy.",
        model: effectiveModel.model
      });
    }

    const providerMessage =
      typeof payload?.error?.message === "string" && payload.error.message.trim()
        ? payload.error.message.trim()
        : `openai_http_${response.status}`;

    return res.json({
      ok: false,
      status: "error",
      source: resolved.source,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      message: providerMessage,
      model: effectiveModel.model
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return res.json({
      ok: false,
      status: "error",
      source: resolved.source,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      message: isAbort ? "Connection timed out." : String(error),
      model: effectiveModel.model
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/admin/settings/api-keys/fmp-status", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;

  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_API_KEYS_KEY },
    select: { value: true }
  });
  const settings = parseStoredApiKeysSettings(row?.value);
  const resolved = resolveEffectiveFmpApiKey(settings);
  const checkedAt = new Date().toISOString();

  if (resolved.decryptError) {
    return res.json({
      ok: false,
      status: "error",
      source: resolved.source,
      checkedAt,
      message: "Stored FMP key could not be decrypted."
    });
  }

  if (!resolved.apiKey) {
    return res.json({
      ok: false,
      status: "missing_key",
      source: resolved.source,
      checkedAt,
      message: "No FMP API key configured."
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const startedAt = Date.now();

  try {
    await fetchFmpEconomicEvents({
      apiKey: resolved.apiKey,
      baseUrl: process.env.FMP_BASE_URL,
      from: "2026-01-01",
      to: "2026-01-02",
      signal: controller.signal
    });

    return res.json({
      ok: true,
      status: "ok",
      source: resolved.source,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      message: "FMP connection is healthy."
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    const raw = String(error ?? "").trim();
    const normalizedReason = raw.startsWith("Error: ") ? raw.slice(7) : raw;
    let message = isAbort ? "Connection timed out." : normalizedReason;
    let httpStatus: number | undefined;

    const httpMatch = normalizedReason.match(/^http_(\d{3})$/i);
    if (httpMatch) {
      httpStatus = Number(httpMatch[1]);
      if (httpStatus === 401) {
        message = "FMP authentication failed (401). Verify API key.";
      } else if (httpStatus === 402) {
        message =
          "FMP returned 402 (payment/plan required). Check your FMP subscription tier for Economic Calendar endpoints.";
      } else if (httpStatus === 403) {
        message = "FMP request forbidden (403). Check key permissions/IP restrictions.";
      } else {
        message = `fmp_http_${httpStatus}`;
      }
    }

    return res.json({
      ok: false,
      status: "error",
      source: resolved.source,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      ...(httpStatus ? { httpStatus } : {}),
      message
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.put("/admin/settings/api-keys", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminApiKeysSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const existing = parseStoredApiKeysSettings(await getGlobalSettingValue(GLOBAL_SETTING_API_KEYS_KEY));
  const nextValue = {
    openaiApiKeyEnc: parsed.data.clearOpenaiApiKey
      ? null
      : parsed.data.openaiApiKey
        ? encryptSecret(parsed.data.openaiApiKey)
        : existing.openaiApiKeyEnc,
    fmpApiKeyEnc: parsed.data.clearFmpApiKey
      ? null
      : parsed.data.fmpApiKey
        ? encryptSecret(parsed.data.fmpApiKey)
        : existing.fmpApiKeyEnc,
    openaiModel: parsed.data.clearOpenaiModel
      ? null
      : parsed.data.openaiModel ?? existing.openaiModel
  };

  const updated = await setGlobalSettingValue(GLOBAL_SETTING_API_KEYS_KEY, nextValue);
  const settings = parseStoredApiKeysSettings(updated.value);
  const effectiveModel = resolveEffectiveOpenAiModel(settings);
  invalidateAiApiKeyCache();
  invalidateAiModelCache();

  return res.json({
    ...toPublicApiKeysSettings(settings),
    updatedAt: updated.updatedAt,
    envOverride: Boolean(process.env.AI_API_KEY?.trim()),
    envOverrideFmp: Boolean(process.env.FMP_API_KEY?.trim()),
    effectiveOpenaiModel: effectiveModel.model,
    effectiveOpenaiModelSource: effectiveModel.source,
    modelOptions: [...OPENAI_ADMIN_MODEL_OPTIONS]
  });
});

app.get("/admin/settings/prediction-refresh", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_PREDICTION_REFRESH_KEY },
    select: { value: true, updatedAt: true }
  });
  const stored = parseStoredPredictionRefreshSettings(row?.value);
  const effective = toEffectivePredictionRefreshSettings(stored);
  return res.json({
    ...effective,
    updatedAt: row?.updatedAt ?? null,
    source: row ? "db" : "env",
    defaults: toEffectivePredictionRefreshSettings(null)
  });
});

app.put("/admin/settings/prediction-refresh", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminPredictionRefreshSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const value = {
    triggerDebounceSec: parsed.data.triggerDebounceSec,
    aiCooldownSec: parsed.data.aiCooldownSec,
    eventThrottleSec: parsed.data.eventThrottleSec,
    hysteresisRatio: parsed.data.hysteresisRatio,
    unstableFlipLimit: parsed.data.unstableFlipLimit,
    unstableFlipWindowSeconds: parsed.data.unstableFlipWindowSeconds
  };
  const updated = await setGlobalSettingValue(GLOBAL_SETTING_PREDICTION_REFRESH_KEY, value);
  predictionRefreshRuntimeSettings = toEffectivePredictionRefreshSettings(
    parseStoredPredictionRefreshSettings(updated.value)
  );
  predictionTriggerDebounceState.clear();

  return res.json({
    ...predictionRefreshRuntimeSettings,
    updatedAt: updated.updatedAt,
    source: "db",
    defaults: toEffectivePredictionRefreshSettings(null)
  });
});

app.get("/admin/settings/prediction-defaults", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY },
    select: { value: true, updatedAt: true }
  });
  const effective = toEffectivePredictionDefaultsSettings(
    parseStoredPredictionDefaultsSettings(row?.value)
  );
  return res.json({
    ...effective,
    updatedAt: row?.updatedAt ?? null,
    source: row ? "db" : "env",
    defaults: toEffectivePredictionDefaultsSettings(null)
  });
});

app.put("/admin/settings/prediction-defaults", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminPredictionDefaultsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }
  const value = {
    signalMode: normalizePredictionSignalMode(parsed.data.signalMode)
  };
  const updated = await setGlobalSettingValue(GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY, value);
  const effective = toEffectivePredictionDefaultsSettings(
    parseStoredPredictionDefaultsSettings(updated.value)
  );
  return res.json({
    ...effective,
    updatedAt: updated.updatedAt,
    source: "db",
    defaults: toEffectivePredictionDefaultsSettings(null)
  });
});

app.get("/settings/prediction-defaults", requireAuth, async (_req, res) => {
  const effective = await getPredictionDefaultsSettings();
  return res.json(effective);
});

app.get("/admin/settings/access-section", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_ACCESS_SECTION_KEY },
    select: { value: true, updatedAt: true }
  });
  const settings = toEffectiveAccessSectionSettings(
    parseStoredAccessSectionSettings(row?.value)
  );
  return res.json({
    ...settings,
    updatedAt: row?.updatedAt ?? null,
    source: row ? "db" : "default",
    defaults: DEFAULT_ACCESS_SECTION_SETTINGS
  });
});

app.put("/admin/settings/access-section", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAccessSectionSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }
  const value = toEffectiveAccessSectionSettings(parseStoredAccessSectionSettings(parsed.data));
  const updated = await setGlobalSettingValue(GLOBAL_SETTING_ACCESS_SECTION_KEY, value);
  const settings = toEffectiveAccessSectionSettings(
    parseStoredAccessSectionSettings(updated.value)
  );
  return res.json({
    ...settings,
    updatedAt: updated.updatedAt,
    source: "db",
    defaults: DEFAULT_ACCESS_SECTION_SETTINGS
  });
});

app.get("/admin/settings/server-info", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const settings = await getServerInfoSettings();
  return res.json(settings);
});

app.put("/admin/settings/server-info", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminServerInfoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }
  const normalized = normalizeServerIpAddress(parsed.data.serverIpAddress);
  await setGlobalSettingValue(GLOBAL_SETTING_SERVER_INFO_KEY, {
    serverIpAddress: normalized
  });
  const settings = await getServerInfoSettings();
  return res.json(settings);
});

app.get("/settings/access-section", requireAuth, async (_req, res) => {
  const user = readUserFromLocals(res);
  const bypass = await evaluateAccessSectionBypassForUser(user);
  const [settings, usage] = await Promise.all([
    getAccessSectionSettings(),
    getAccessSectionUsageForUser(user.id)
  ]);

  const visibility = bypass
    ? DEFAULT_ACCESS_SECTION_SETTINGS.visibility
    : settings.visibility;
  const limits = bypass
    ? DEFAULT_ACCESS_SECTION_SETTINGS.limits
    : settings.limits;

  return res.json({
    bypass,
    visibility,
    limits,
    usage,
    remaining: {
      bots: computeRemaining(limits.bots, usage.bots),
      predictionsLocal: computeRemaining(limits.predictionsLocal, usage.predictionsLocal),
      predictionsAi: computeRemaining(limits.predictionsAi, usage.predictionsAi),
      predictionsComposite: computeRemaining(limits.predictionsComposite, usage.predictionsComposite)
    }
  });
});

app.get("/settings/risk", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const accounts = await db.exchangeAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      exchange: true,
      label: true,
      lastUsedAt: true,
      futuresBudgetEquity: true,
      futuresBudgetAvailableMargin: true,
      pnlTodayUsd: true,
      riskProfile: {
        select: {
          dailyLossWarnPct: true,
          dailyLossWarnUsd: true,
          dailyLossCriticalPct: true,
          dailyLossCriticalUsd: true,
          marginWarnPct: true,
          marginWarnUsd: true,
          marginCriticalPct: true,
          marginCriticalUsd: true
        }
      }
    }
  });
  const accountIds = accounts
    .map((row: any) => (typeof row.id === "string" ? String(row.id) : ""))
    .filter(Boolean);
  const botRealizedByAccount = await readBotRealizedPnlTodayByAccount(user.id, accountIds);

  return res.json({
    defaults: DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS,
    items: accounts.map((account: any) => {
      const botRealizedToday = botRealizedByAccount.get(String(account.id)) ?? null;
      const effectivePnlTodayUsd = resolveEffectivePnlTodayUsd(account.pnlTodayUsd, botRealizedToday);
      return toSettingsRiskItem(
        {
          ...account,
          pnlTodayUsd: effectivePnlTodayUsd
        },
        mergeRiskProfileWithDefaults(account.riskProfile)
      );
    })
  });
});

app.put("/settings/risk/:exchangeAccountId", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = settingsRiskAccountParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }
  const parsed = settingsRiskUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const account = await db.exchangeAccount.findFirst({
    where: {
      id: params.data.exchangeAccountId,
      userId: user.id
    },
    select: {
      id: true,
      exchange: true,
      label: true,
      lastUsedAt: true,
      futuresBudgetEquity: true,
      futuresBudgetAvailableMargin: true,
      pnlTodayUsd: true,
      riskProfile: {
        select: {
          dailyLossWarnPct: true,
          dailyLossWarnUsd: true,
          dailyLossCriticalPct: true,
          dailyLossCriticalUsd: true,
          marginWarnPct: true,
          marginWarnUsd: true,
          marginCriticalPct: true,
          marginCriticalUsd: true
        }
      }
    }
  });
  if (!account) {
    return res.status(404).json({ error: "exchange_account_not_found" });
  }

  const current = mergeRiskProfileWithDefaults(account.riskProfile);
  const next: RiskLimitValues = {
    dailyLossWarnPct: parsed.data.dailyLossWarnPct ?? current.dailyLossWarnPct,
    dailyLossWarnUsd: parsed.data.dailyLossWarnUsd ?? current.dailyLossWarnUsd,
    dailyLossCriticalPct: parsed.data.dailyLossCriticalPct ?? current.dailyLossCriticalPct,
    dailyLossCriticalUsd: parsed.data.dailyLossCriticalUsd ?? current.dailyLossCriticalUsd,
    marginWarnPct: parsed.data.marginWarnPct ?? current.marginWarnPct,
    marginWarnUsd: parsed.data.marginWarnUsd ?? current.marginWarnUsd,
    marginCriticalPct: parsed.data.marginCriticalPct ?? current.marginCriticalPct,
    marginCriticalUsd: parsed.data.marginCriticalUsd ?? current.marginCriticalUsd
  };

  const issues = validateRiskLimitValues(next);
  if (issues.length > 0) {
    return res.status(400).json({
      error: "invalid_payload",
      details: { issues }
    });
  }

  await db.exchangeAccountRiskProfile.upsert({
    where: {
      exchangeAccountId: account.id
    },
    create: {
      exchangeAccountId: account.id,
      dailyLossWarnPct: next.dailyLossWarnPct,
      dailyLossWarnUsd: next.dailyLossWarnUsd,
      dailyLossCriticalPct: next.dailyLossCriticalPct,
      dailyLossCriticalUsd: next.dailyLossCriticalUsd,
      marginWarnPct: next.marginWarnPct,
      marginWarnUsd: next.marginWarnUsd,
      marginCriticalPct: next.marginCriticalPct,
      marginCriticalUsd: next.marginCriticalUsd
    },
    update: {
      dailyLossWarnPct: next.dailyLossWarnPct,
      dailyLossWarnUsd: next.dailyLossWarnUsd,
      dailyLossCriticalPct: next.dailyLossCriticalPct,
      dailyLossCriticalUsd: next.dailyLossCriticalUsd,
      marginWarnPct: next.marginWarnPct,
      marginWarnUsd: next.marginWarnUsd,
      marginCriticalPct: next.marginCriticalPct,
      marginCriticalUsd: next.marginCriticalUsd
    }
  });
  const botRealizedByAccount = await readBotRealizedPnlTodayByAccount(user.id, [account.id]);
  const botRealizedToday = botRealizedByAccount.get(account.id) ?? null;
  const effectivePnlTodayUsd = resolveEffectivePnlTodayUsd(account.pnlTodayUsd, botRealizedToday);

  return res.json({
    item: toSettingsRiskItem(
      {
        ...account,
        pnlTodayUsd: effectivePnlTodayUsd
      },
      next
    )
  });
});

function normalizeAiPromptSettingsPayload(
  payload: AdminAiPromptsPayload,
  nowIso: string
): {
  settings: AiPromptSettingsStored;
  invalidKeys: string[];
  duplicatePromptIds: string[];
} {
  const invalidKeys = new Set<string>();
  const duplicatePromptIds = new Set<string>();

  const normalizeIndicatorKeyList = (values: string[]): AiPromptIndicatorKey[] => {
    const deduped: AiPromptIndicatorKey[] = [];
    const seen = new Set<AiPromptIndicatorKey>();
    for (const raw of values) {
      const key = raw.trim();
      if (!isAiPromptIndicatorKey(key)) {
        if (key) invalidKeys.add(key);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(key);
    }
    return deduped;
  };

  const parseIso = (value: string | undefined): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  const normalizePromptTimeframe = (value: unknown): PredictionTimeframe | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim() as PredictionTimeframe;
    return PREDICTION_TIMEFRAMES.has(trimmed) ? trimmed : null;
  };

  const normalizePromptTimeframeSet = (
    values: unknown,
    legacyFallback: PredictionTimeframe | null
  ): PredictionTimeframe[] => {
    const out: PredictionTimeframe[] = [];
    const seen = new Set<PredictionTimeframe>();
    if (Array.isArray(values)) {
      for (const value of values) {
        const normalized = normalizePromptTimeframe(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
        if (out.length >= 4) break;
      }
    }
    if (out.length === 0 && legacyFallback) {
      out.push(legacyFallback);
    }
    return out;
  };

  const normalizePromptRunTimeframe = (
    value: unknown,
    timeframes: readonly PredictionTimeframe[],
    fallback: PredictionTimeframe | null
  ): PredictionTimeframe | null => {
    const direct = normalizePromptTimeframe(value);
    if (direct && timeframes.includes(direct)) return direct;
    if (fallback && timeframes.includes(fallback)) return fallback;
    if (timeframes.length > 0) return timeframes[0];
    return null;
  };

  const seenIds = new Set<string>();
  const prompts: AiPromptTemplate[] = [];
  for (const row of payload.prompts) {
    const id = row.id.trim();
    if (!id) continue;
    if (seenIds.has(id)) {
      duplicatePromptIds.add(id);
      continue;
    }
    seenIds.add(id);

    const createdAt = parseIso(row.createdAt) ?? nowIso;
    const updatedAt = nowIso;
    const legacyTimeframe = normalizePromptTimeframe(row.timeframe);
    const timeframes = normalizePromptTimeframeSet(
      (row as { timeframes?: unknown }).timeframes,
      legacyTimeframe
    );
    const runTimeframe = normalizePromptRunTimeframe(
      (row as { runTimeframe?: unknown }).runTimeframe,
      timeframes,
      legacyTimeframe
    );
    prompts.push({
      id,
      name: row.name.trim(),
      promptText: row.promptText.trim(),
      indicatorKeys: normalizeIndicatorKeyList(row.indicatorKeys),
      ohlcvBars: row.ohlcvBars,
      timeframes,
      runTimeframe,
      timeframe: runTimeframe,
      directionPreference: row.directionPreference,
      confidenceTargetPct: row.confidenceTargetPct,
      slTpSource: row.slTpSource ?? "local",
      newsRiskMode: row.newsRiskMode === "block" ? "block" : "off",
      marketAnalysisUpdateEnabled: Boolean(row.marketAnalysisUpdateEnabled),
      isPublic: Boolean(row.isPublic),
      createdAt,
      updatedAt
    });
  }

  const activePromptIdRaw =
    typeof payload.activePromptId === "string" && payload.activePromptId.trim()
      ? payload.activePromptId.trim()
      : null;
  const activePromptId =
    activePromptIdRaw && prompts.some((item) => item.id === activePromptIdRaw)
      ? activePromptIdRaw
      : (prompts[0]?.id ?? null);

  return {
    settings: {
      activePromptId,
      prompts
    },
    invalidKeys: [...invalidKeys],
    duplicatePromptIds: [...duplicatePromptIds]
  };
}

function readAiPromptLicensePolicyPublic() {
  const mode = getAiPromptLicenseMode();
  return {
    mode,
    allowedPublicPromptIds: getAiPromptAllowedPublicIds(),
    enforcementActive: mode === "enforce"
  } as const;
}

type StrategyEntitlementsPublic = {
  plan: "free" | "pro" | "enterprise";
  allowedStrategyKinds: Array<"local" | "ai" | "composite">;
  allowedStrategyIds: string[] | null;
  maxCompositeNodes: number;
  aiAllowedModels: string[] | null;
  aiMonthlyBudgetUsd: number | null;
  source: "db" | "plan_default";
};

async function resolveStrategyEntitlementsPublicForUser(
  user: { id: string; email: string }
): Promise<StrategyEntitlementsPublic> {
  const ctx = await resolveUserContext(user);
  const entitlements = await resolveStrategyEntitlementsForWorkspace({
    workspaceId: ctx.workspaceId
  });
  return {
    plan: entitlements.plan,
    allowedStrategyKinds: entitlements.allowedStrategyKinds,
    allowedStrategyIds: entitlements.allowedStrategyIds,
    maxCompositeNodes: entitlements.maxCompositeNodes,
    aiAllowedModels: entitlements.aiAllowedModels,
    aiMonthlyBudgetUsd: entitlements.aiMonthlyBudgetUsd,
    source: entitlements.source
  };
}

function canUseStrategyKindByEntitlements(
  entitlements: StrategyEntitlementsPublic,
  kind: "local" | "ai" | "composite"
): boolean {
  return isStrategyKindAllowed(entitlements, kind);
}

function canUseStrategyIdByEntitlements(
  entitlements: StrategyEntitlementsPublic,
  kind: "local" | "ai" | "composite",
  id: string
): boolean {
  return isStrategyIdAllowed(entitlements, kind, id);
}

function evaluateStrategySelectionAccess(params: {
  entitlements: StrategyEntitlementsPublic;
  kind: "local" | "ai" | "composite";
  strategyId?: string | null;
  aiModel?: string | null;
  compositeNodes?: number | null;
}) {
  return evaluateStrategyAccess({
    entitlements: params.entitlements,
    kind: params.kind,
    strategyId: params.strategyId,
    aiModel: params.aiModel,
    compositeNodes: params.compositeNodes
  });
}

function localStrategiesStoreReady(): boolean {
  return Boolean(
    db.localStrategyDefinition
    && typeof db.localStrategyDefinition.findMany === "function"
    && typeof db.localStrategyDefinition.findUnique === "function"
    && typeof db.localStrategyDefinition.create === "function"
    && typeof db.localStrategyDefinition.update === "function"
    && typeof db.localStrategyDefinition.delete === "function"
  );
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function listLocalStrategyRegistryPublic() {
  return listRegisteredLocalStrategies().map((entry) => ({
    type: entry.type,
    defaultConfig: entry.defaultConfig,
    uiSchema: entry.uiSchema
  }));
}

function listLocalFallbackStrategyTypes(): string[] {
  return listRegisteredLocalStrategies().map((entry) => entry.type);
}

function resolvePythonFallbackStrategyType(params: {
  requestedFallbackStrategyType: string | null | undefined;
  strategyType: string;
  remoteStrategyType: string;
  availableTypes: string[];
}): { value: string | null; invalidValue: string | null } {
  const defaultType =
    params.availableTypes.includes("signal_filter")
      ? "signal_filter"
      : (params.availableTypes[0] ?? null);
  const strategyTypeFallback = params.availableTypes.includes(params.strategyType)
    ? params.strategyType
    : defaultType;

  if (params.requestedFallbackStrategyType === null) {
    return { value: null, invalidValue: null };
  }

  if (params.requestedFallbackStrategyType === undefined) {
    return { value: strategyTypeFallback, invalidValue: null };
  }

  const requested = params.requestedFallbackStrategyType.trim();
  if (!requested) {
    return { value: strategyTypeFallback, invalidValue: null };
  }
  if (params.availableTypes.includes(requested)) {
    return { value: requested, invalidValue: null };
  }
  if (requested === params.remoteStrategyType || requested === params.strategyType) {
    return { value: defaultType, invalidValue: null };
  }
  return { value: null, invalidValue: requested };
}

function mapLocalStrategyDefinitionPublic(row: any) {
  const registration =
    typeof row?.strategyType === "string"
      ? getRegisteredLocalStrategy(row.strategyType)
      : null;
  return {
    id: row.id,
    strategyType: row.strategyType,
    engine: row.engine === "python" ? "python" : "ts",
    shadowMode: row.shadowMode === true,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off",
    remoteStrategyType:
      typeof row.remoteStrategyType === "string" && row.remoteStrategyType.trim()
        ? row.remoteStrategyType.trim()
        : null,
    fallbackStrategyType:
      typeof row.fallbackStrategyType === "string" && row.fallbackStrategyType.trim()
        ? row.fallbackStrategyType.trim()
        : null,
    timeoutMs:
      Number.isFinite(Number(row.timeoutMs))
        ? Math.max(200, Math.min(10000, Math.trunc(Number(row.timeoutMs))))
        : null,
    name: row.name,
    description: row.description ?? null,
    version: row.version,
    inputSchema:
      row.inputSchema && typeof row.inputSchema === "object" && !Array.isArray(row.inputSchema)
        ? row.inputSchema
        : null,
    configJson: toJsonRecord(row.configJson),
    isEnabled: Boolean(row.isEnabled),
    registry: registration
      ? {
        registered: true,
        defaultConfig: registration.defaultConfig,
        uiSchema: registration.uiSchema
      }
      : { registered: false },
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

function compositeStrategiesStoreReady(): boolean {
  return Boolean(
    db.compositeStrategy
    && typeof db.compositeStrategy.findMany === "function"
    && typeof db.compositeStrategy.findUnique === "function"
    && typeof db.compositeStrategy.create === "function"
    && typeof db.compositeStrategy.update === "function"
    && typeof db.compositeStrategy.delete === "function"
  );
}

async function resolveCompositeNodeRef(node: { kind: "local" | "ai"; refId: string }): Promise<boolean> {
  if (node.kind === "local") {
    if (!db.localStrategyDefinition || typeof db.localStrategyDefinition.findUnique !== "function") return false;
    const found = await db.localStrategyDefinition.findUnique({
      where: { id: node.refId },
      select: { id: true }
    });
    return Boolean(found);
  }
  const template = await getAiPromptTemplateById(node.refId);
  return Boolean(template);
}

async function validateCompositeStrategyPayload(payload: {
  nodesJson: unknown;
  edgesJson: unknown;
  combineMode?: unknown;
  outputPolicy?: unknown;
  maxCompositeNodes?: number | null;
}) {
  const graph = normalizeCompositeGraph(payload);
  const validation = await validateCompositeGraph(graph, {
    resolveRef: async (node) => resolveCompositeNodeRef(node)
  });
  const maxCompositeNodes =
    Number.isFinite(Number(payload.maxCompositeNodes))
      ? Math.max(0, Math.trunc(Number(payload.maxCompositeNodes)))
      : null;
  if (maxCompositeNodes !== null && graph.nodes.length > maxCompositeNodes) {
    validation.valid = false;
    validation.errors.push(
      `composite_nodes_exceeded:max=${maxCompositeNodes}:actual=${graph.nodes.length}`
    );
  }
  return {
    graph,
    validation
  };
}

function mapCompositeStrategyPublic(row: any) {
  const graph = normalizeCompositeGraph({
    nodesJson: row.nodesJson,
    edgesJson: row.edgesJson,
    combineMode: row.combineMode,
    outputPolicy: row.outputPolicy
  });
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    version: row.version,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off",
    nodesJson: graph.nodes,
    edgesJson: graph.edges,
    combineMode: graph.combineMode,
    outputPolicy: graph.outputPolicy,
    isEnabled: Boolean(row.isEnabled),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

async function getEnabledCompositeStrategyById(id: string | null): Promise<{
  id: string;
  name: string;
  nodesJson: unknown;
  edgesJson: unknown;
  combineMode: unknown;
  outputPolicy: unknown;
  newsRiskMode: "off" | "block";
} | null> {
  if (!id || !compositeStrategiesStoreReady()) return null;
  const row = await db.compositeStrategy.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      nodesJson: true,
      edgesJson: true,
      combineMode: true,
      outputPolicy: true,
      newsRiskMode: true,
      isEnabled: true
    }
  });
  if (!row || !Boolean(row.isEnabled)) return null;
  return {
    id: row.id,
    name: row.name,
    nodesJson: row.nodesJson,
    edgesJson: row.edgesJson,
    combineMode: row.combineMode,
    outputPolicy: row.outputPolicy,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off"
  };
}

function countCompositeStrategyNodes(strategy: {
  nodesJson: unknown;
  edgesJson?: unknown;
  combineMode?: unknown;
  outputPolicy?: unknown;
} | null | undefined): number {
  if (!strategy) return 0;
  try {
    const graph = normalizeCompositeGraph({
      nodesJson: strategy.nodesJson,
      edgesJson: strategy.edgesJson,
      combineMode: strategy.combineMode,
      outputPolicy: strategy.outputPolicy
    });
    return graph.nodes.length;
  } catch {
    return 0;
  }
}

async function getEnabledLocalStrategyById(id: string | null): Promise<{
  id: string;
  name: string;
  strategyType: string;
  version: string;
  newsRiskMode: "off" | "block";
} | null> {
  if (!id || !localStrategiesStoreReady()) return null;
  const row = await db.localStrategyDefinition.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      strategyType: true,
      version: true,
      newsRiskMode: true,
      isEnabled: true
    }
  });
  if (!row || !Boolean(row.isEnabled)) return null;
  return {
    id: row.id,
    name: row.name,
    strategyType: row.strategyType,
    version: row.version,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off"
  };
}

function resolveSelectedAiPromptIndicators(indicatorKeys: readonly string[]): {
  selectedIndicators: Array<{
    key: AiPromptIndicatorKey;
    label: string;
    description: string;
  }>;
  invalidKeys: string[];
} {
  const availableIndicators = getAiPromptIndicatorOptionsPublic();
  const indicatorByKey = new Map(availableIndicators.map((item) => [item.key, item] as const));
  const selectedIndicators: Array<{
    key: AiPromptIndicatorKey;
    label: string;
    description: string;
  }> = [];
  const invalidKeys = new Set<string>();

  for (const rawKey of indicatorKeys) {
    const key = rawKey.trim();
    if (!key) continue;
    const found = indicatorByKey.get(key as AiPromptIndicatorKey);
    if (!found) {
      invalidKeys.add(key);
      continue;
    }
    if (selectedIndicators.some((item) => item.key === found.key)) continue;
    selectedIndicators.push({
      key: found.key,
      label: found.label,
      description: found.description
    });
  }

  return {
    selectedIndicators,
    invalidKeys: [...invalidKeys]
  };
}

app.get("/admin/settings/ai-prompts", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_AI_PROMPTS_KEY },
    select: { value: true, updatedAt: true }
  });
  const settings = parseStoredAiPromptSettings(row?.value);

  return res.json({
    activePromptId: settings.activePromptId,
    prompts: settings.prompts,
    availableIndicators: getAiPromptIndicatorOptionsPublic(),
    licensePolicy: readAiPromptLicensePolicyPublic(),
    updatedAt: row?.updatedAt ?? null,
    source: row ? "db" : "default",
    defaults: DEFAULT_AI_PROMPT_SETTINGS
  });
});

app.put("/admin/settings/ai-prompts", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAiPromptsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const normalized = normalizeAiPromptSettingsPayload(parsed.data, new Date().toISOString());
  if (normalized.invalidKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_indicator_keys",
      details: { invalidKeys: normalized.invalidKeys }
    });
  }
  if (normalized.duplicatePromptIds.length > 0) {
    return res.status(409).json({
      error: "duplicate_prompt_id",
      details: { duplicatePromptIds: normalized.duplicatePromptIds }
    });
  }

  const sanitized = parseStoredAiPromptSettings(normalized.settings);
  const updated = await setGlobalSettingValue(GLOBAL_SETTING_AI_PROMPTS_KEY, sanitized);
  const settings = parseStoredAiPromptSettings(updated.value);
  invalidateAiPromptSettingsCache();

  return res.json({
    activePromptId: settings.activePromptId,
    prompts: settings.prompts,
    availableIndicators: getAiPromptIndicatorOptionsPublic(),
    licensePolicy: readAiPromptLicensePolicyPublic(),
    updatedAt: updated.updatedAt,
    source: "db",
    defaults: DEFAULT_AI_PROMPT_SETTINGS
  });
});

app.post("/admin/settings/ai-prompts/generate-preview", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAiPromptsGeneratePreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const selected = resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
  if (selected.invalidKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_indicator_keys",
      details: { invalidKeys: selected.invalidKeys }
    });
  }

  const generation = await generateHybridPromptText({
    strategyDescription: parsed.data.strategyDescription,
    selectedIndicators: selected.selectedIndicators,
    timeframes: parsed.data.timeframes,
    runTimeframe: parsed.data.runTimeframe ?? null
  }).catch(() => null);

  if (!generation) {
    return res.status(500).json({ error: "generation_failed" });
  }

  return res.json({
    generatedPromptText: generation.promptText,
    generationMeta: {
      mode: generation.mode,
      model: generation.model
    }
  });
});

app.post("/admin/settings/ai-prompts/generate-save", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAiPromptsGenerateSaveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const selected = resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
  if (selected.invalidKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_indicator_keys",
      details: { invalidKeys: selected.invalidKeys }
    });
  }

  const nowIso = new Date().toISOString();
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_AI_PROMPTS_KEY },
    select: { value: true }
  });
  const existingSettings = parseStoredAiPromptSettings(row?.value);

  let generatedPromptText = "";
  let generationMode: "ai" | "fallback" = "fallback";
  let generationModel = parsed.data.generationMeta?.model ?? getAiModel();

  if (typeof parsed.data.generatedPromptText === "string") {
    const provided = parsed.data.generatedPromptText.trim();
    if (!provided) {
      return res.status(400).json({
        error: "invalid_payload",
        details: { reason: "generatedPromptText must not be empty" }
      });
    }
    generatedPromptText = provided;
    generationMode = parsed.data.generationMeta?.mode ?? "fallback";
  } else {
    const generation = await generateHybridPromptText({
      strategyDescription: parsed.data.strategyDescription,
      selectedIndicators: selected.selectedIndicators,
      timeframes: parsed.data.timeframes,
      runTimeframe: parsed.data.runTimeframe ?? null
    }).catch(() => null);

    if (!generation) {
      return res.status(500).json({ error: "generation_failed" });
    }

    generatedPromptText = generation.promptText;
    generationMode = generation.mode;
    generationModel = generation.model;
  }

  let draftPayload: {
    activePromptId: string | null;
    prompts: AiPromptTemplate[];
  };
  let promptId = "";
  try {
    const draft = createGeneratedPromptDraft({
      existingSettings,
      name: parsed.data.name,
      promptText: generatedPromptText,
      indicatorKeys: selected.selectedIndicators.map((item) => item.key),
      ohlcvBars: parsed.data.ohlcvBars,
      timeframes: parsed.data.timeframes,
      runTimeframe: parsed.data.runTimeframe ?? null,
      directionPreference: parsed.data.directionPreference,
      confidenceTargetPct: parsed.data.confidenceTargetPct,
      slTpSource: parsed.data.slTpSource,
      newsRiskMode: parsed.data.newsRiskMode,
      setActive: parsed.data.setActive,
      isPublic: parsed.data.isPublic,
      nowIso
    });
    promptId = draft.promptId;
    draftPayload = draft.payload;
  } catch (error) {
    return res.status(400).json({
      error: "invalid_payload",
      details: { reason: String(error) }
    });
  }

  const normalized = normalizeAiPromptSettingsPayload(draftPayload, nowIso);
  if (normalized.invalidKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_indicator_keys",
      details: { invalidKeys: normalized.invalidKeys }
    });
  }
  if (normalized.duplicatePromptIds.length > 0) {
    return res.status(409).json({
      error: "duplicate_prompt_id",
      details: { duplicatePromptIds: normalized.duplicatePromptIds }
    });
  }

  const sanitized = parseStoredAiPromptSettings(normalized.settings);
  const updated = await setGlobalSettingValue(GLOBAL_SETTING_AI_PROMPTS_KEY, sanitized);
  const settings = parseStoredAiPromptSettings(updated.value);
  invalidateAiPromptSettingsCache();

  const savedPrompt = settings.prompts.find((item) => item.id === promptId) ?? null;
  if (!savedPrompt) {
    return res.status(500).json({ error: "generation_failed" });
  }

  return res.json({
    prompt: savedPrompt,
    activePromptId: settings.activePromptId,
    generatedPromptText: savedPrompt.promptText,
    generationMeta: {
      mode: generationMode,
      model: generationModel
    },
    updatedAt: updated.updatedAt
  });
});

app.post("/admin/settings/ai-prompts/preview", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAiPromptsPreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  let settings: AiPromptSettingsStored;
  if (parsed.data.settingsDraft !== undefined) {
    const draftParsed = adminAiPromptsSchema.safeParse(parsed.data.settingsDraft);
    if (!draftParsed.success) {
      return res.status(400).json({
        error: "invalid_settings_draft",
        details: draftParsed.error.flatten()
      });
    }
    const normalizedDraft = normalizeAiPromptSettingsPayload(
      draftParsed.data,
      new Date().toISOString()
    );
    if (normalizedDraft.invalidKeys.length > 0) {
      return res.status(400).json({
        error: "invalid_indicator_keys",
        details: { invalidKeys: normalizedDraft.invalidKeys }
      });
    }
    if (normalizedDraft.duplicatePromptIds.length > 0) {
      return res.status(409).json({
        error: "duplicate_prompt_id",
        details: { duplicatePromptIds: normalizedDraft.duplicatePromptIds }
      });
    }
    settings = parseStoredAiPromptSettings(normalizedDraft.settings);
  } else {
    const row = await db.globalSetting.findUnique({
      where: { key: GLOBAL_SETTING_AI_PROMPTS_KEY },
      select: { value: true }
    });
    settings = parseStoredAiPromptSettings(row?.value);
  }

  const context = {
    exchange: parsed.data.exchange ?? null,
    accountId: parsed.data.accountId ?? null,
    symbol: parsed.data.symbol,
    timeframe: parsed.data.timeframe
  };
  const runtimeSettings = resolveAiPromptRuntimeSettingsForContext(
    settings,
    context,
    "db"
  );

  const promptInput = {
    symbol: parsed.data.symbol,
    marketType: parsed.data.marketType,
    timeframe: parsed.data.timeframe,
    tsCreated: parsed.data.tsCreated ?? new Date().toISOString(),
    prediction: parsed.data.prediction ?? {
      signal: "neutral" as const,
      expectedMovePct: 0.8,
      confidence: 0.5
    },
    featureSnapshot: parsed.data.featureSnapshot ?? {}
  };

  const preview = await buildPredictionExplainerPromptPreview(promptInput, {
    promptSettings: runtimeSettings,
    promptScopeContext: context
  });

  return res.json({
    scopeContext: preview.scopeContext,
    runtimeSettings: preview.runtimeSettings,
    systemMessage: preview.systemMessage,
    cacheKey: preview.cacheKey,
    userPayload: preview.userPayload
  });
});

app.get("/settings/ai-prompts/own", requireAuth, async (_req, res) => {
  const user = readUserFromLocals(res);
  const strategyFeatureEnabled = await isStrategyFeatureEnabledForUser(user);
  if (!strategyFeatureEnabled) {
    return res.json({
      items: [],
      availableIndicators: getAiPromptIndicatorOptionsPublic(),
      strategyFeatureEnabled: false,
      updatedAt: null
    });
  }

  const items = await listUserAiPromptTemplates(user.id);
  return res.json({
    items,
    availableIndicators: getAiPromptIndicatorOptionsPublic(),
    strategyFeatureEnabled: true,
    updatedAt: items[0]?.updatedAt ?? null
  });
});

app.post("/settings/ai-prompts/own/generate-preview", requireAuth, async (req, res) => {
  const user = readUserFromLocals(res);
  const strategyFeatureEnabled = await isStrategyFeatureEnabledForUser(user);
  if (!strategyFeatureEnabled) {
    return res.status(403).json({ error: "forbidden" });
  }

  const parsed = userAiPromptsGeneratePreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const selected = resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
  if (selected.invalidKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_indicator_keys",
      details: { invalidKeys: selected.invalidKeys }
    });
  }

  const generation = await generateHybridPromptText({
    strategyDescription: parsed.data.strategyDescription,
    selectedIndicators: selected.selectedIndicators,
    timeframes: parsed.data.timeframes,
    runTimeframe: parsed.data.runTimeframe ?? null
  }).catch(() => null);

  if (!generation) {
    return res.status(500).json({ error: "generation_failed" });
  }

  return res.json({
    generatedPromptText: generation.promptText,
    generationMeta: {
      mode: generation.mode,
      model: generation.model
    }
  });
});

app.post("/settings/ai-prompts/own/generate-save", requireAuth, async (req, res) => {
  const user = readUserFromLocals(res);
  const strategyFeatureEnabled = await isStrategyFeatureEnabledForUser(user);
  if (!strategyFeatureEnabled) {
    return res.status(403).json({ error: "forbidden" });
  }

  const parsed = userAiPromptsGenerateSaveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const selected = resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
  if (selected.invalidKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_indicator_keys",
      details: { invalidKeys: selected.invalidKeys }
    });
  }

  let generatedPromptText = "";
  let generationMode: "ai" | "fallback" = "fallback";
  let generationModel = parsed.data.generationMeta?.model ?? getAiModel();

  if (typeof parsed.data.generatedPromptText === "string") {
    const provided = parsed.data.generatedPromptText.trim();
    if (!provided) {
      return res.status(400).json({
        error: "invalid_payload",
        details: { reason: "generatedPromptText must not be empty" }
      });
    }
    generatedPromptText = provided;
    generationMode = parsed.data.generationMeta?.mode ?? "fallback";
  } else {
    const generation = await generateHybridPromptText({
      strategyDescription: parsed.data.strategyDescription,
      selectedIndicators: selected.selectedIndicators,
      timeframes: parsed.data.timeframes,
      runTimeframe: parsed.data.runTimeframe ?? null
    }).catch(() => null);
    if (!generation) {
      return res.status(500).json({ error: "generation_failed" });
    }
    generatedPromptText = generation.promptText;
    generationMode = generation.mode;
    generationModel = generation.model;
  }

  const now = new Date();
  const prompt = await createUserAiPromptTemplate({
    userId: user.id,
    name: parsed.data.name,
    promptText: generatedPromptText,
    indicatorKeys: selected.selectedIndicators.map((item) => item.key),
    ohlcvBars: parsed.data.ohlcvBars,
    timeframes: parsed.data.timeframes,
    runTimeframe: parsed.data.runTimeframe ?? null,
    directionPreference: parsed.data.directionPreference,
    confidenceTargetPct: parsed.data.confidenceTargetPct,
    slTpSource: parsed.data.slTpSource,
    newsRiskMode: parsed.data.newsRiskMode,
    now
  });

  return res.json({
    prompt,
    generatedPromptText: prompt.promptText,
    generationMeta: {
      mode: generationMode,
      model: generationModel
    },
    updatedAt: prompt.updatedAt
  });
});

app.delete("/settings/ai-prompts/own/:id", requireAuth, async (req, res) => {
  const user = readUserFromLocals(res);
  const strategyFeatureEnabled = await isStrategyFeatureEnabledForUser(user);
  if (!strategyFeatureEnabled) {
    return res.status(403).json({ error: "forbidden" });
  }
  const parsed = userAiPromptTemplateIdParamSchema.safeParse(req.params ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_params", details: parsed.error.flatten() });
  }
  const deleted = await deleteUserAiPromptTemplateById(user.id, parsed.data.id);
  if (!deleted) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json({ ok: true });
});

app.get("/settings/ai-prompts/public", requireAuth, async (_req, res) => {
  const user = readUserFromLocals(res);
  const strategyEntitlements = await resolveStrategyEntitlementsPublicForUser(user);
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_AI_PROMPTS_KEY },
    select: { value: true, updatedAt: true }
  });
  const settings = parseStoredAiPromptSettings(row?.value);
  const isSuperadmin = isSuperadminEmail(user.email);
  const visiblePrompts = isSuperadmin ? settings.prompts : getPublicAiPromptTemplates(settings);
  const kindAllowed = canUseStrategyKindByEntitlements(strategyEntitlements, "ai");
  const idFilteredPrompts = kindAllowed
    ? visiblePrompts.filter((item) =>
      canUseStrategyIdByEntitlements(strategyEntitlements, "ai", String(item.id))
    )
    : [];

  return res.json({
    items: idFilteredPrompts.map((item) => ({
      id: item.id,
      name: item.name,
      promptText: item.promptText,
      indicatorKeys: item.indicatorKeys,
      ohlcvBars: item.ohlcvBars,
      timeframes: item.timeframes,
      runTimeframe: item.runTimeframe,
      timeframe: item.timeframe,
      directionPreference: item.directionPreference,
      confidenceTargetPct: item.confidenceTargetPct,
      slTpSource: item.slTpSource,
      newsRiskMode: item.newsRiskMode,
      isPublic: item.isPublic,
      updatedAt: item.updatedAt
    })),
    licensePolicy: readAiPromptLicensePolicyPublic(),
    strategyEntitlements,
    updatedAt: row?.updatedAt ?? null
  });
});

app.get("/admin/local-strategies/registry", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const pythonRegistry = await listPythonStrategyRegistry();
  return res.json({
    items: listLocalStrategyRegistryPublic(),
    templates: getBuiltinLocalStrategyTemplates(),
    pythonRegistry
  });
});

app.get("/admin/local-strategies/python/registry", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const pythonRegistry = await listPythonStrategyRegistry();
  return res.json(pythonRegistry);
});

app.get("/admin/local-strategies", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!localStrategiesStoreReady()) {
    return res.status(503).json({ error: "local_strategies_not_ready" });
  }

  const rows = await db.localStrategyDefinition.findMany({
    orderBy: { updatedAt: "desc" }
  });

  const pythonRegistry = await listPythonStrategyRegistry();
  return res.json({
    items: rows.map((row: any) => mapLocalStrategyDefinitionPublic(row)),
    registry: listLocalStrategyRegistryPublic(),
    templates: getBuiltinLocalStrategyTemplates(),
    pythonRegistry
  });
});

app.get("/admin/local-strategies/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!localStrategiesStoreReady()) {
    return res.status(503).json({ error: "local_strategies_not_ready" });
  }

  const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }

  const row = await db.localStrategyDefinition.findUnique({
    where: { id: params.data.id }
  });
  if (!row) {
    return res.status(404).json({ error: "not_found" });
  }

  const pythonRegistry = await listPythonStrategyRegistry();
  return res.json({
    item: mapLocalStrategyDefinitionPublic(row),
    registry: listLocalStrategyRegistryPublic(),
    pythonRegistry
  });
});

app.post("/admin/local-strategies", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!localStrategiesStoreReady()) {
    return res.status(503).json({ error: "local_strategies_not_ready" });
  }

  const parsed = localStrategyDefinitionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const registration = getRegisteredLocalStrategy(parsed.data.strategyType);
  if (parsed.data.engine === "ts" && !registration) {
    return res.status(400).json({
      error: "unknown_strategy_type",
      availableTypes: listRegisteredLocalStrategies().map((entry) => entry.type)
    });
  }
  const fallbackTypes = listLocalFallbackStrategyTypes();
  const remoteStrategyType =
    parsed.data.engine === "python"
      ? (parsed.data.remoteStrategyType?.trim() || parsed.data.strategyType)
      : null;
  const fallbackResolution =
    parsed.data.engine === "python"
      ? resolvePythonFallbackStrategyType({
        requestedFallbackStrategyType: parsed.data.fallbackStrategyType,
        strategyType: parsed.data.strategyType,
        remoteStrategyType: remoteStrategyType ?? parsed.data.strategyType,
        availableTypes: fallbackTypes
      })
      : { value: null, invalidValue: null as string | null };
  if (fallbackResolution.invalidValue) {
    return res.status(400).json({
      error: "unknown_fallback_strategy_type",
      availableTypes: fallbackTypes
    });
  }

  const now = new Date();
  const template = getBuiltinLocalStrategyTemplates().find(
    (item) => item.strategyType === parsed.data.strategyType
  );
  const configJson = Object.keys(parsed.data.configJson).length > 0
    ? parsed.data.configJson
    : (registration?.defaultConfig ?? {});
  const inputSchema = parsed.data.inputSchema ?? template?.inputSchema ?? null;

  const created = await db.localStrategyDefinition.create({
    data: {
      strategyType: parsed.data.strategyType,
      engine: parsed.data.engine,
      shadowMode: parsed.data.engine === "python" ? parsed.data.shadowMode : false,
      remoteStrategyType,
      fallbackStrategyType: parsed.data.engine === "python" ? fallbackResolution.value : null,
      timeoutMs: parsed.data.engine === "python" ? (parsed.data.timeoutMs ?? null) : null,
      newsRiskMode: parsed.data.newsRiskMode,
      name: parsed.data.name.trim(),
      description:
        typeof parsed.data.description === "string" && parsed.data.description.trim()
          ? parsed.data.description.trim()
          : null,
      version: parsed.data.version.trim() || "1.0.0",
      inputSchema,
      configJson,
      isEnabled: parsed.data.isEnabled,
      createdAt: now,
      updatedAt: now
    }
  });

  return res.status(201).json({
    item: mapLocalStrategyDefinitionPublic(created)
  });
});

app.put("/admin/local-strategies/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!localStrategiesStoreReady()) {
    return res.status(503).json({ error: "local_strategies_not_ready" });
  }

  const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }
  const parsed = localStrategyDefinitionUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const existing = await db.localStrategyDefinition.findUnique({
    where: { id: params.data.id },
    select: {
      id: true,
      strategyType: true,
      engine: true,
      shadowMode: true,
      remoteStrategyType: true
    }
  });
  if (!existing) {
    return res.status(404).json({ error: "not_found" });
  }

  const effectiveEngine =
    parsed.data.engine !== undefined
      ? parsed.data.engine
      : (existing.engine === "python" ? "python" : "ts");
  const effectiveStrategyType =
    typeof parsed.data.strategyType === "string"
      ? parsed.data.strategyType
      : existing.strategyType;

  const fallbackTypes = listLocalFallbackStrategyTypes();
  const effectiveRemoteStrategyType =
    typeof parsed.data.remoteStrategyType === "string" && parsed.data.remoteStrategyType.trim()
      ? parsed.data.remoteStrategyType.trim()
      : (
        typeof existing.remoteStrategyType === "string" && existing.remoteStrategyType.trim()
          ? existing.remoteStrategyType.trim()
          : effectiveStrategyType
      );

  if (effectiveEngine === "ts") {
    const registration = getRegisteredLocalStrategy(effectiveStrategyType);
    if (!registration) {
      return res.status(400).json({
        error: "unknown_strategy_type",
        availableTypes: listRegisteredLocalStrategies().map((entry) => entry.type)
      });
    }
  } else if (parsed.data.fallbackStrategyType !== undefined) {
    const fallbackResolution = resolvePythonFallbackStrategyType({
      requestedFallbackStrategyType: parsed.data.fallbackStrategyType,
      strategyType: effectiveStrategyType,
      remoteStrategyType: effectiveRemoteStrategyType,
      availableTypes: fallbackTypes
    });
    if (fallbackResolution.invalidValue) {
      return res.status(400).json({
        error: "unknown_fallback_strategy_type",
        availableTypes: fallbackTypes
      });
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.strategyType !== undefined) data.strategyType = parsed.data.strategyType;
  if (parsed.data.engine !== undefined) data.engine = parsed.data.engine;
  if (parsed.data.shadowMode !== undefined) data.shadowMode = parsed.data.shadowMode;
  if (parsed.data.remoteStrategyType !== undefined) data.remoteStrategyType = parsed.data.remoteStrategyType;
  if (parsed.data.timeoutMs !== undefined) data.timeoutMs = parsed.data.timeoutMs;
  if (parsed.data.newsRiskMode !== undefined) data.newsRiskMode = parsed.data.newsRiskMode;
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) {
    data.description =
      typeof parsed.data.description === "string" && parsed.data.description.trim()
        ? parsed.data.description.trim()
        : null;
  }
  if (effectiveEngine === "ts") {
    if (parsed.data.shadowMode === undefined) data.shadowMode = false;
    if (parsed.data.remoteStrategyType === undefined) data.remoteStrategyType = null;
    if (parsed.data.fallbackStrategyType === undefined) data.fallbackStrategyType = null;
    if (parsed.data.timeoutMs === undefined) data.timeoutMs = null;
  } else {
    if (parsed.data.fallbackStrategyType !== undefined) {
      data.fallbackStrategyType = resolvePythonFallbackStrategyType({
        requestedFallbackStrategyType: parsed.data.fallbackStrategyType,
        strategyType: effectiveStrategyType,
        remoteStrategyType: effectiveRemoteStrategyType,
        availableTypes: fallbackTypes
      }).value;
    }
    if (parsed.data.remoteStrategyType === undefined && existing.engine !== "python") {
      data.remoteStrategyType = effectiveStrategyType;
    }
    if (parsed.data.fallbackStrategyType === undefined && existing.engine !== "python") {
      data.fallbackStrategyType = resolvePythonFallbackStrategyType({
        requestedFallbackStrategyType: undefined,
        strategyType: effectiveStrategyType,
        remoteStrategyType: effectiveRemoteStrategyType,
        availableTypes: fallbackTypes
      }).value;
    }
  }
  if (parsed.data.version !== undefined) data.version = parsed.data.version.trim();
  if (parsed.data.inputSchema !== undefined) data.inputSchema = parsed.data.inputSchema;
  if (parsed.data.configJson !== undefined) data.configJson = parsed.data.configJson;
  if (parsed.data.isEnabled !== undefined) data.isEnabled = parsed.data.isEnabled;

  try {
    const updated = await db.localStrategyDefinition.update({
      where: { id: params.data.id },
      data
    });
    return res.json({ item: mapLocalStrategyDefinitionPublic(updated) });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "P2025") {
      return res.status(404).json({ error: "not_found" });
    }
    throw error;
  }
});

app.delete("/admin/local-strategies/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!localStrategiesStoreReady()) {
    return res.status(503).json({ error: "local_strategies_not_ready" });
  }

  const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }

  try {
    await db.localStrategyDefinition.delete({
      where: { id: params.data.id }
    });
    return res.json({ ok: true });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "P2025") {
      return res.status(404).json({ error: "not_found" });
    }
    throw error;
  }
});

app.post("/admin/local-strategies/:id/run", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const user = readUserFromLocals(res);
  const strategyEntitlements = await resolveStrategyEntitlementsPublicForUser(user);
  if (!localStrategiesStoreReady()) {
    return res.status(503).json({ error: "local_strategies_not_ready" });
  }

  const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }
  const accessCheck = evaluateStrategySelectionAccess({
    entitlements: strategyEntitlements,
    kind: "local",
    strategyId: params.data.id
  });
  if (!accessCheck.allowed) {
    return res.status(403).json({
      error: "strategy_license_blocked",
      reason: accessCheck.reason,
      maxCompositeNodes: accessCheck.maxCompositeNodes
    });
  }
  const parsed = localStrategyRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const result = await runLocalStrategy(
      params.data.id,
      parsed.data.featureSnapshot,
      parsed.data.ctx
    );
    return res.json({
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "strategy_not_found") {
      return res.status(404).json({ error: message });
    }
    if (message === "local_strategies_not_ready") {
      return res.status(503).json({ error: message });
    }
    if (message.startsWith("strategy_type_not_registered:")) {
      return res.status(409).json({ error: message });
    }
    if (message === "strategy_id_required") {
      return res.status(400).json({ error: message });
    }
    console.warn("[local-strategies] run failed", { id: params.data.id, reason: message });
    return res.status(500).json({ error: "strategy_run_failed", message });
  }
});

app.get("/settings/composite-strategies", requireAuth, async (_req, res) => {
  const user = readUserFromLocals(res);
  const entitlements = await resolveStrategyEntitlementsPublicForUser(user);
  if (!compositeStrategiesStoreReady()) {
    return res.status(503).json({ error: "composite_strategies_not_ready" });
  }
  if (!canUseStrategyKindByEntitlements(entitlements, "composite")) {
    return res.json({
      items: [],
      strategyEntitlements: entitlements
    });
  }
  const rows = await db.compositeStrategy.findMany({
    where: { isEnabled: true },
    orderBy: { updatedAt: "desc" }
  });
  return res.json({
    items: rows
      .filter((row: any) => canUseStrategyIdByEntitlements(entitlements, "composite", String(row.id)))
      .map((row: any) => mapCompositeStrategyPublic(row)),
    strategyEntitlements: entitlements
  });
});

app.get("/settings/local-strategies", requireAuth, async (_req, res) => {
  const user = readUserFromLocals(res);
  const entitlements = await resolveStrategyEntitlementsPublicForUser(user);
  if (!localStrategiesStoreReady()) {
    return res.status(503).json({ error: "local_strategies_not_ready" });
  }
  if (!canUseStrategyKindByEntitlements(entitlements, "local")) {
    return res.json({
      items: [],
      strategyEntitlements: entitlements
    });
  }
  const rows = await db.localStrategyDefinition.findMany({
    where: { isEnabled: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      strategyType: true,
      name: true,
      description: true,
      version: true,
      updatedAt: true
    }
  });
  return res.json({
    items: rows
      .filter((row: any) => canUseStrategyIdByEntitlements(entitlements, "local", String(row.id)))
      .map((row: any) => ({
        id: row.id,
        strategyType: row.strategyType,
        name: row.name,
        description: row.description ?? null,
        version: row.version,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
      })),
    strategyEntitlements: entitlements
  });
});

app.get("/settings/strategy-entitlements", requireAuth, async (_req, res) => {
  const user = readUserFromLocals(res);
  const entitlements = await resolveStrategyEntitlementsPublicForUser(user);
  return res.json({ entitlements });
});

app.get("/admin/composite-strategies", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!compositeStrategiesStoreReady()) {
    return res.status(503).json({ error: "composite_strategies_not_ready" });
  }
  const rows = await db.compositeStrategy.findMany({
    orderBy: { updatedAt: "desc" }
  });
  return res.json({
    items: rows.map((row: any) => mapCompositeStrategyPublic(row))
  });
});

app.get("/admin/composite-strategies/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!compositeStrategiesStoreReady()) {
    return res.status(503).json({ error: "composite_strategies_not_ready" });
  }
  const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }
  const row = await db.compositeStrategy.findUnique({
    where: { id: params.data.id }
  });
  if (!row) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json({
    item: mapCompositeStrategyPublic(row)
  });
});

app.post("/admin/composite-strategies", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const user = readUserFromLocals(res);
  const strategyEntitlements = await resolveStrategyEntitlementsPublicForUser(user);
  const accessCheck = evaluateStrategySelectionAccess({
    entitlements: strategyEntitlements,
    kind: "composite",
    strategyId: null
  });
  if (!accessCheck.allowed) {
    return res.status(403).json({
      error: "strategy_license_blocked",
      reason: accessCheck.reason,
      maxCompositeNodes: accessCheck.maxCompositeNodes
    });
  }
  if (!compositeStrategiesStoreReady()) {
    return res.status(503).json({ error: "composite_strategies_not_ready" });
  }
  const parsed = compositeStrategyCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const validation = await validateCompositeStrategyPayload({
    ...parsed.data,
    maxCompositeNodes: strategyEntitlements.maxCompositeNodes
  });
  if (!validation.validation.valid) {
    return res.status(400).json({
      error: "invalid_graph",
      details: validation.validation
    });
  }

  const created = await db.compositeStrategy.create({
    data: {
      name: parsed.data.name.trim(),
      description:
        typeof parsed.data.description === "string" && parsed.data.description.trim()
          ? parsed.data.description.trim()
          : null,
      version: parsed.data.version.trim(),
      nodesJson: validation.graph.nodes,
      edgesJson: validation.graph.edges,
      combineMode: validation.graph.combineMode,
      outputPolicy: validation.graph.outputPolicy,
      newsRiskMode: parsed.data.newsRiskMode,
      isEnabled: parsed.data.isEnabled
    }
  });

  return res.status(201).json({
    item: mapCompositeStrategyPublic(created),
    validation: validation.validation
  });
});

app.put("/admin/composite-strategies/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const user = readUserFromLocals(res);
  const strategyEntitlements = await resolveStrategyEntitlementsPublicForUser(user);
  if (!compositeStrategiesStoreReady()) {
    return res.status(503).json({ error: "composite_strategies_not_ready" });
  }
  const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }
  const accessCheck = evaluateStrategySelectionAccess({
    entitlements: strategyEntitlements,
    kind: "composite",
    strategyId: params.data.id
  });
  if (!accessCheck.allowed) {
    return res.status(403).json({
      error: "strategy_license_blocked",
      reason: accessCheck.reason,
      maxCompositeNodes: accessCheck.maxCompositeNodes
    });
  }
  const parsed = compositeStrategyUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const current = await db.compositeStrategy.findUnique({
    where: { id: params.data.id }
  });
  if (!current) {
    return res.status(404).json({ error: "not_found" });
  }

  const mergedGraphInput = {
    nodesJson: parsed.data.nodesJson ?? current.nodesJson,
    edgesJson: parsed.data.edgesJson ?? current.edgesJson,
    combineMode: parsed.data.combineMode ?? current.combineMode,
    outputPolicy: parsed.data.outputPolicy ?? current.outputPolicy,
    maxCompositeNodes: strategyEntitlements.maxCompositeNodes
  };
  const validation = await validateCompositeStrategyPayload(mergedGraphInput);
  if (!validation.validation.valid) {
    return res.status(400).json({
      error: "invalid_graph",
      details: validation.validation
    });
  }

  const updateData: Record<string, unknown> = {
    nodesJson: validation.graph.nodes,
    edgesJson: validation.graph.edges,
    combineMode: validation.graph.combineMode,
    outputPolicy: validation.graph.outputPolicy
  };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) {
    updateData.description =
      typeof parsed.data.description === "string" && parsed.data.description.trim()
        ? parsed.data.description.trim()
        : null;
  }
  if (parsed.data.version !== undefined) updateData.version = parsed.data.version.trim();
  if (parsed.data.newsRiskMode !== undefined) updateData.newsRiskMode = parsed.data.newsRiskMode;
  if (parsed.data.isEnabled !== undefined) updateData.isEnabled = parsed.data.isEnabled;

  const updated = await db.compositeStrategy.update({
    where: { id: params.data.id },
    data: updateData
  });

  return res.json({
    item: mapCompositeStrategyPublic(updated),
    validation: validation.validation
  });
});

app.delete("/admin/composite-strategies/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!compositeStrategiesStoreReady()) {
    return res.status(503).json({ error: "composite_strategies_not_ready" });
  }
  const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }
  try {
    await db.compositeStrategy.delete({
      where: { id: params.data.id }
    });
    return res.json({ ok: true });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "P2025") {
      return res.status(404).json({ error: "not_found" });
    }
    throw error;
  }
});

app.post("/admin/composite-strategies/:id/dry-run", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const user = readUserFromLocals(res);
  const strategyEntitlements = await resolveStrategyEntitlementsPublicForUser(user);
  if (!compositeStrategiesStoreReady()) {
    return res.status(503).json({ error: "composite_strategies_not_ready" });
  }
  const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
  if (!params.success) {
    return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
  }
  const parsed = compositeStrategyDryRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const [strategy, prediction] = await Promise.all([
    db.compositeStrategy.findUnique({ where: { id: params.data.id } }),
    db.prediction.findUnique({ where: { id: parsed.data.predictionId } })
  ]);
  if (!strategy) {
    return res.status(404).json({ error: "composite_not_found" });
  }
  const accessCheck = evaluateStrategySelectionAccess({
    entitlements: strategyEntitlements,
    kind: "composite",
    strategyId: strategy.id,
    compositeNodes: countCompositeStrategyNodes(strategy)
  });
  if (!accessCheck.allowed) {
    return res.status(403).json({
      error: "strategy_license_blocked",
      reason: accessCheck.reason,
      maxCompositeNodes: accessCheck.maxCompositeNodes
    });
  }
  if (!prediction) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const featureSnapshot = toJsonRecord(prediction.featuresSnapshot);
  const signal = prediction.signal === "up" || prediction.signal === "down" || prediction.signal === "neutral"
    ? prediction.signal
    : "neutral";
  const timeframe = PREDICTION_TIMEFRAMES.has(prediction.timeframe as PredictionTimeframe)
    ? (prediction.timeframe as PredictionTimeframe)
    : "15m";
  const marketType = PREDICTION_MARKET_TYPES.has(prediction.marketType as PredictionMarketType)
    ? (prediction.marketType as PredictionMarketType)
    : "perp";

  const run = await runCompositeStrategy({
    compositeId: strategy.id,
    nodesJson: strategy.nodesJson,
    edgesJson: strategy.edgesJson,
    combineMode: strategy.combineMode,
    outputPolicy: strategy.outputPolicy,
    featureSnapshot,
    basePrediction: {
      symbol: prediction.symbol,
      marketType,
      timeframe,
      tsCreated: prediction.tsCreated.toISOString(),
      signal,
      expectedMovePct: Number(prediction.expectedMovePct),
      confidence: Number(prediction.confidence)
    },
    context: {
      exchange: typeof featureSnapshot.prefillExchange === "string" ? featureSnapshot.prefillExchange : undefined,
      accountId: typeof featureSnapshot.prefillExchangeAccountId === "string"
        ? featureSnapshot.prefillExchangeAccountId
        : undefined,
      symbol: prediction.symbol,
      marketType,
      timeframe
    }
  }, {
    resolveLocalStrategyRef: async (id) => {
      if (!db.localStrategyDefinition || typeof db.localStrategyDefinition.findUnique !== "function") return false;
      const found = await db.localStrategyDefinition.findUnique({
        where: { id },
        select: { id: true }
      });
      return Boolean(found);
    },
    resolveAiPromptRef: async (id) => {
      const found = await getAiPromptTemplateById(id);
      return Boolean(found);
    }
  });

  return res.json({
    composite: mapCompositeStrategyPublic(strategy),
    prediction: {
      id: prediction.id,
      symbol: prediction.symbol,
      timeframe,
      marketType
    },
    run
  });
});

app.get("/admin/settings/ai-trace", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_AI_TRACE_KEY },
    select: { value: true, updatedAt: true }
  });
  const settings = parseStoredAiTraceSettings(row?.value);

  return res.json({
    ...settings,
    updatedAt: row?.updatedAt ?? null,
    source: row ? "db" : "default",
    defaults: DEFAULT_AI_TRACE_SETTINGS,
    payloadBudget: getAiPayloadBudgetTelemetrySnapshot(),
    qualityGate: getAiQualityGateTelemetrySnapshot()
  });
});

app.put("/admin/settings/ai-trace", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAiTraceSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const sanitized = parseStoredAiTraceSettings(parsed.data);
  const updated = await setGlobalSettingValue(GLOBAL_SETTING_AI_TRACE_KEY, sanitized);
  invalidateAiTraceSettingsCache();

  return res.json({
    ...sanitized,
    updatedAt: updated.updatedAt,
    source: "db",
    defaults: DEFAULT_AI_TRACE_SETTINGS
  });
});

app.get("/admin/ai-trace/logs", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAiTraceLogsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }
  if (!db.aiTraceLog || typeof db.aiTraceLog.findMany !== "function") {
    return res.status(503).json({ error: "ai_trace_not_ready" });
  }

  const [items, total, traceSettings] = await Promise.all([
    db.aiTraceLog.findMany({
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit
    }),
    db.aiTraceLog.count(),
    getAiTraceSettingsCached()
  ]);

  const readTraceMeta = (payload: unknown): { retryUsed: boolean; retryCount: number } => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { retryUsed: false, retryCount: 0 };
    }
    const meta = (payload as Record<string, unknown>).__trace;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      return { retryUsed: false, retryCount: 0 };
    }
    const record = meta as Record<string, unknown>;
    const retryUsed = record.retryUsed === true;
    const retryCountRaw = Number(record.retryCount);
    const retryCount = Number.isFinite(retryCountRaw) ? Math.max(0, Math.trunc(retryCountRaw)) : 0;
    return {
      retryUsed,
      retryCount
    };
  };

  return res.json({
    enabled: traceSettings.settings.enabled,
    source: traceSettings.source,
    total,
    limit: parsed.data.limit,
    items: items.map((row: any) => ({
      ...(readTraceMeta(row.userPayload ?? null)),
      id: row.id,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
      scope: row.scope,
      provider: row.provider ?? null,
      model: row.model ?? null,
      symbol: row.symbol ?? null,
      marketType: row.marketType ?? null,
      timeframe: row.timeframe ?? null,
      promptTemplateId: row.promptTemplateId ?? null,
      promptTemplateName: row.promptTemplateName ?? null,
      systemMessage: row.systemMessage ?? null,
      userPayload: row.userPayload ?? null,
      rawResponse: row.rawResponse ?? null,
      parsedResponse: row.parsedResponse ?? null,
      success: Boolean(row.success),
      error: row.error ?? null,
      fallbackUsed: Boolean(row.fallbackUsed),
      cacheHit: Boolean(row.cacheHit),
      rateLimited: Boolean(row.rateLimited),
      latencyMs:
        Number.isFinite(Number(row.latencyMs)) && row.latencyMs !== null
          ? Math.max(0, Math.trunc(Number(row.latencyMs)))
          : null
    }))
  });
});

app.post("/admin/ai-trace/logs/cleanup", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminAiTraceCleanupSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }
  if (!db.aiTraceLog || typeof db.aiTraceLog.deleteMany !== "function") {
    return res.status(503).json({ error: "ai_trace_not_ready" });
  }

  const where = parsed.data.deleteAll
    ? {}
    : { createdAt: { lt: new Date(Date.now() - parsed.data.olderThanDays * 24 * 60 * 60 * 1000) } };
  const deleted = await db.aiTraceLog.deleteMany({ where });

  return res.json({
    deletedCount: deleted.count,
    mode: parsed.data.deleteAll ? "all" : "older_than_days",
    olderThanDays: parsed.data.deleteAll ? null : parsed.data.olderThanDays
  });
});

app.get("/api/admin/indicator-settings", requireAuth, async (_req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!db.indicatorSetting || typeof db.indicatorSetting.findMany !== "function") {
    return res.status(503).json({ error: "indicator_settings_not_ready" });
  }

  const rows = await db.indicatorSetting.findMany({
    orderBy: { updatedAt: "desc" }
  });

  return res.json({
    items: rows.map((row: any) => {
      const configPatch = normalizeIndicatorSettingsPatch(row.configJson);
      const configEffective = mergeIndicatorSettings(DEFAULT_INDICATOR_SETTINGS, configPatch);
      return {
        id: row.id,
        scopeType: row.scopeType,
        exchange: row.exchange,
        accountId: row.accountId,
        symbol: row.symbol,
        timeframe: row.timeframe,
        configPatch,
        configEffective,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };
    })
  });
});

app.get("/api/admin/indicator-settings/resolved", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  const parsed = adminIndicatorSettingsResolvedQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const resolved = await resolveIndicatorSettings({
    db,
    exchange: normalizeIndicatorSettingExchange(parsed.data.exchange),
    accountId: normalizeIndicatorSettingAccountId(parsed.data.accountId),
    symbol: normalizeIndicatorSettingSymbol(parsed.data.symbol),
    timeframe: normalizeIndicatorSettingTimeframe(parsed.data.timeframe)
  });

  return res.json({
    ...resolved,
    defaults: DEFAULT_INDICATOR_SETTINGS
  });
});

app.post("/api/admin/indicator-settings", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!db.indicatorSetting || typeof db.indicatorSetting.findMany !== "function") {
    return res.status(503).json({ error: "indicator_settings_not_ready" });
  }
  const parsed = indicatorSettingsUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const configPatch = normalizeIndicatorSettingsPatch(parsed.data.config);
  const keyFields = {
    scopeType: parsed.data.scopeType,
    exchange: normalizeIndicatorSettingExchange(parsed.data.exchange),
    accountId: normalizeIndicatorSettingAccountId(parsed.data.accountId),
    symbol: normalizeIndicatorSettingSymbol(parsed.data.symbol),
    timeframe: normalizeIndicatorSettingTimeframe(parsed.data.timeframe)
  };

  const existing = await db.indicatorSetting.findFirst({
    where: keyFields,
    select: { id: true }
  });
  if (existing) {
    return res.status(409).json({
      error: "duplicate_scope",
      message: "An entry for this scope already exists."
    });
  }

  const created = await db.indicatorSetting.create({
    data: {
      ...keyFields,
      configJson: configPatch
    }
  });
  clearIndicatorSettingsCache();

  return res.status(201).json({
    id: created.id,
    scopeType: created.scopeType,
    exchange: created.exchange,
    accountId: created.accountId,
    symbol: created.symbol,
    timeframe: created.timeframe,
    configPatch,
    configEffective: mergeIndicatorSettings(DEFAULT_INDICATOR_SETTINGS, configPatch),
    createdAt: created.createdAt,
    updatedAt: created.updatedAt
  });
});

app.put("/api/admin/indicator-settings/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!db.indicatorSetting || typeof db.indicatorSetting.findMany !== "function") {
    return res.status(503).json({ error: "indicator_settings_not_ready" });
  }
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    return res.status(400).json({ error: "invalid_id" });
  }
  const parsed = indicatorSettingsUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const current = await db.indicatorSetting.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!current) {
    return res.status(404).json({ error: "not_found" });
  }

  const configPatch = normalizeIndicatorSettingsPatch(parsed.data.config);
  const keyFields = {
    scopeType: parsed.data.scopeType,
    exchange: normalizeIndicatorSettingExchange(parsed.data.exchange),
    accountId: normalizeIndicatorSettingAccountId(parsed.data.accountId),
    symbol: normalizeIndicatorSettingSymbol(parsed.data.symbol),
    timeframe: normalizeIndicatorSettingTimeframe(parsed.data.timeframe)
  };
  const duplicate = await db.indicatorSetting.findFirst({
    where: {
      ...keyFields,
      NOT: { id }
    },
    select: { id: true }
  });
  if (duplicate) {
    return res.status(409).json({
      error: "duplicate_scope",
      message: "An entry for this scope already exists."
    });
  }

  const updated = await db.indicatorSetting.update({
    where: { id },
    data: {
      ...keyFields,
      configJson: configPatch
    }
  });
  clearIndicatorSettingsCache();

  return res.json({
    id: updated.id,
    scopeType: updated.scopeType,
    exchange: updated.exchange,
    accountId: updated.accountId,
    symbol: updated.symbol,
    timeframe: updated.timeframe,
    configPatch,
    configEffective: mergeIndicatorSettings(DEFAULT_INDICATOR_SETTINGS, configPatch),
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  });
});

app.delete("/api/admin/indicator-settings/:id", requireAuth, async (req, res) => {
  if (!(await requireSuperadmin(res))) return;
  if (!db.indicatorSetting || typeof db.indicatorSetting.findMany !== "function") {
    return res.status(503).json({ error: "indicator_settings_not_ready" });
  }
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    return res.status(400).json({ error: "invalid_id" });
  }

  const existing = await db.indicatorSetting.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!existing) {
    return res.status(404).json({ error: "not_found" });
  }

  await db.indicatorSetting.delete({ where: { id } });
  clearIndicatorSettingsCache();
  return res.json({ ok: true });
});

app.get("/api/trading/settings", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const settings = await getTradingSettings(user.id);
  return res.json(settings);
});

app.post("/api/trading/settings", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = tradingSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const settings = await saveTradingSettings(user.id, parsed.data);
  return res.json(settings);
});

app.post("/api/predictions/generate", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const requestIsSuperadmin = isSuperadminEmail(user.email);
  const parsed = predictionGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const requestedSignalMode = normalizePredictionSignalMode(payload.signalMode);
  const tsCreated = payload.tsCreated ?? new Date().toISOString();
  const inputFeatureSnapshot = asRecord(payload.featureSnapshot);
  const promptScopeContext = {
    exchange:
      typeof inputFeatureSnapshot.prefillExchange === "string"
        ? normalizeExchangeValue(inputFeatureSnapshot.prefillExchange)
        : null,
    accountId:
      typeof inputFeatureSnapshot.prefillExchangeAccountId === "string"
        ? inputFeatureSnapshot.prefillExchangeAccountId.trim()
        : null,
    symbol: normalizeSymbolInput(payload.symbol) ?? payload.symbol,
    timeframe: payload.timeframe
  };
  const payloadStrategyKind = normalizePredictionStrategyKind(payload.strategyRef?.kind);
  const payloadStrategyId =
    typeof payload.strategyRef?.id === "string" && payload.strategyRef.id.trim()
      ? payload.strategyRef.id.trim()
      : null;
  const requestedPromptTemplateId =
    payloadStrategyKind === "ai"
      ? payloadStrategyId
      : (typeof payload.aiPromptTemplateId === "string" && payload.aiPromptTemplateId.trim()
          ? payload.aiPromptTemplateId.trim()
          : null);
  const requestedLocalStrategyId =
    payloadStrategyKind === "local"
      ? payloadStrategyId
      : null;
  const requestedCompositeStrategyId =
    payloadStrategyKind === "composite"
      ? payloadStrategyId
      : (typeof payload.compositeStrategyId === "string" && payload.compositeStrategyId.trim()
          ? payload.compositeStrategyId.trim()
          : null);
  const selectedLocalStrategy = requestedLocalStrategyId
    ? await getEnabledLocalStrategyById(requestedLocalStrategyId)
    : null;
  const selectedCompositeStrategy = requestedCompositeStrategyId
    ? await getEnabledCompositeStrategyById(requestedCompositeStrategyId)
    : null;
  let selectedStrategyRef: PredictionStrategyRef | null =
    selectedCompositeStrategy
      ? { kind: "composite", id: selectedCompositeStrategy.id, name: selectedCompositeStrategy.name }
      : selectedLocalStrategy
        ? { kind: "local", id: selectedLocalStrategy.id, name: selectedLocalStrategy.name }
        : requestedPromptTemplateId
          ? { kind: "ai", id: requestedPromptTemplateId, name: null }
          : null;
  const signalMode = resolveStrategyBoundSignalMode(
    requestedSignalMode,
    selectedStrategyRef?.kind ?? "ai"
  );
  if (requestedLocalStrategyId && !selectedLocalStrategy) {
    return res.status(400).json({ error: "invalid_local_strategy" });
  }
  if (requestedCompositeStrategyId && !selectedCompositeStrategy) {
    return res.status(400).json({ error: "invalid_composite_strategy" });
  }
  const userCtx = await resolveUserContext(user);
  const strategyEntitlements = await resolveStrategyEntitlementsForWorkspace({
    workspaceId: userCtx.workspaceId
  });
  const requestedPromptSelection = requestedPromptTemplateId
    ? await resolveAiPromptRuntimeForUserSelection({
        userId: user.id,
        templateId: requestedPromptTemplateId,
        context: promptScopeContext,
        requirePublicGlobalPrompt: !requestIsSuperadmin
      })
    : null;
  if (requestedPromptTemplateId && !requestedPromptSelection) {
    return res.status(400).json({ error: "invalid_ai_prompt_template" });
  }
  const selectedPromptIsOwn = Boolean(requestedPromptSelection?.isOwnTemplate);
  if (selectedPromptIsOwn && !(await isStrategyFeatureEnabledForUser(user))) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (selectedStrategyRef?.kind === "ai" && requestedPromptSelection?.templateName) {
    selectedStrategyRef = {
      ...selectedStrategyRef,
      name: requestedPromptSelection.templateName
    };
  }
  const selectedKind: "ai" | "local" | "composite" =
    selectedStrategyRef?.kind ?? "ai";
  const predictionLimitBucket = resolvePredictionLimitBucketFromStrategy({
    strategyRef: selectedStrategyRef,
    signalMode
  });
  const normalizedSymbol = normalizeSymbolInput(payload.symbol) ?? payload.symbol;
  const selectedId =
    selectedStrategyRef?.id
    ?? (
      selectedKind === "ai"
        ? (selectedPromptIsOwn ? null : (requestedPromptTemplateId ?? "default"))
        : null
    );
  const strategyAccess = evaluateStrategySelectionAccess({
    entitlements: strategyEntitlements,
    kind: selectedKind,
    strategyId: selectedId,
    aiModel: selectedKind === "ai" ? await getAiModelAsync() : null,
    compositeNodes:
      selectedKind === "composite"
        ? countCompositeStrategyNodes(selectedCompositeStrategy)
        : null
  });
  if (!strategyAccess.allowed) {
    return res.status(403).json({
      error: "strategy_license_blocked",
      reason: strategyAccess.reason,
      maxCompositeNodes: strategyAccess.maxCompositeNodes
    });
  }
  const promptLicenseDecision = selectedPromptIsOwn
    ? {
        allowed: true,
        reason: "ok" as const,
        mode: "off" as const,
        wouldBlock: false
      }
    : evaluateAiPromptAccess({
        userId: user.id,
        selectedPromptId: requestedPromptTemplateId
      });
  if (!promptLicenseDecision.allowed) {
    return res.status(403).json({ error: "ai_prompt_license_blocked" });
  }
  if (promptLicenseDecision.wouldBlock) {
    // eslint-disable-next-line no-console
    console.warn("[license] ai prompt selection would be blocked in enforce mode", {
      userId: user.id,
      selectedPromptId: requestedPromptTemplateId,
      mode: promptLicenseDecision.mode
    });
  }
  const selectedPromptSettings =
    signalMode === "local_only"
      ? null
      : requestedPromptTemplateId
        ? (requestedPromptSelection?.runtimeSettings ?? null)
        : await getAiPromptRuntimeSettings(promptScopeContext);
  if (requestedPromptTemplateId && !selectedPromptSettings) {
    return res.status(400).json({ error: "invalid_ai_prompt_template" });
  }
  const promptTimeframeConfig = normalizePromptTimeframeSetForRuntime(
    selectedPromptSettings,
    payload.timeframe
  );
  const effectiveTimeframe =
    selectedStrategyRef?.kind === "ai" || !selectedStrategyRef
      ? promptTimeframeConfig.runTimeframe
      : payload.timeframe;
  const strategyRefForScope: PredictionStrategyRef | null =
    selectedStrategyRef?.kind === "ai"
      ? {
          kind: "ai",
          id: selectedPromptSettings?.activePromptId ?? selectedStrategyRef.id,
          name: selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name
        }
      : selectedStrategyRef;
  const exchangeAccountIdForLimit = readPrefillExchangeAccountId(inputFeatureSnapshot);
  const exchangeForLimit =
    typeof inputFeatureSnapshot.prefillExchange === "string"
      ? normalizeExchangeValue(inputFeatureSnapshot.prefillExchange)
      : null;
  const existingStateIdForLimit =
    exchangeAccountIdForLimit && exchangeForLimit
      ? await findPredictionStateIdByScope({
          userId: user.id,
          exchange: exchangeForLimit,
          accountId: exchangeAccountIdForLimit,
          symbol: normalizedSymbol,
          marketType: payload.marketType,
          timeframe: effectiveTimeframe,
          signalMode,
          strategyRef: strategyRefForScope
        })
      : null;
  const consumesPredictionSlot = isAutoScheduleEnabled(inputFeatureSnapshot.autoScheduleEnabled);
  const predictionCreateAccess = await canCreatePredictionForUser({
    userId: user.id,
    bypass: Boolean(userCtx.hasAdminBackendAccess),
    bucket: predictionLimitBucket,
    existingStateId: existingStateIdForLimit,
    consumesSlot: consumesPredictionSlot
  });
  if (!predictionCreateAccess.allowed) {
    const code = predictionLimitExceededCode(predictionLimitBucket);
    return res.status(403).json({
      error: code,
      code,
      message: code,
      details: {
        limit: predictionCreateAccess.limit,
        usage: predictionCreateAccess.usage,
        remaining: predictionCreateAccess.remaining
      }
    });
  }
  const featureSnapshotWithPrompt = {
    ...inputFeatureSnapshot,
    promptTimeframe:
      selectedPromptSettings?.runTimeframe
      ?? selectedPromptSettings?.timeframe
      ?? null,
    promptTimeframes: promptTimeframeConfig.timeframes,
    promptSlTpSource: selectedPromptSettings?.slTpSource ?? "local",
    promptRunTimeframe:
      selectedStrategyRef?.kind === "ai" || !selectedStrategyRef
        ? promptTimeframeConfig.runTimeframe
        : null,
    aiPromptTemplateRequestedId: requestedPromptTemplateId,
    aiPromptTemplateId: selectedPromptSettings?.activePromptId ?? requestedPromptTemplateId,
    aiPromptTemplateName: selectedPromptSettings?.activePromptName ?? null,
    aiPromptMarketAnalysisUpdateEnabled:
      selectedStrategyRef?.kind === "ai"
        ? Boolean(selectedPromptSettings?.marketAnalysisUpdateEnabled)
        : false,
    localStrategyId: selectedLocalStrategy?.id ?? null,
    localStrategyName: selectedLocalStrategy?.name ?? null,
    compositeStrategyId: selectedCompositeStrategy?.id ?? null,
    compositeStrategyName: selectedCompositeStrategy?.name ?? null,
    strategyRef: selectedStrategyRef
      ? {
          kind: selectedStrategyRef.kind,
          id: selectedStrategyRef.id,
          name:
            selectedStrategyRef.kind === "ai"
              ? (selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name)
              : selectedStrategyRef.name
        }
      : null,
    aiPromptLicenseMode: promptLicenseDecision.mode,
    aiPromptLicenseWouldBlock: promptLicenseDecision.wouldBlock
  };
  const featureSnapshotWithStrategy = withStrategyRunSnapshot(
    featureSnapshotWithPrompt,
    {
      strategyRef: selectedStrategyRef
        ? {
            kind: selectedStrategyRef.kind,
            id: selectedStrategyRef.id,
            name:
              selectedStrategyRef.kind === "ai"
                ? (selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name)
                : selectedStrategyRef.name
          }
        : null,
      status: "skipped",
      signal: payload.prediction.signal,
      expectedMovePct: payload.prediction.expectedMovePct,
      confidence: payload.prediction.confidence,
      source: resolvePreferredSignalSourceForMode(
        signalMode,
        PREDICTION_PRIMARY_SIGNAL_SOURCE
      ),
      aiCalled: false,
      explanation: "Manual prediction created; strategy runner applies on refresh cycle.",
      tags: normalizeTagList(inputFeatureSnapshot.tags),
      keyDrivers: [],
      ts: tsCreated
    },
    {
      phase: "manual_generate",
      strategyRef: selectedStrategyRef
    }
  );
  const strategyNewsRiskMode = resolveStrategyNewsRiskMode({
    strategyRef: strategyRefForScope,
    promptSettings: selectedPromptSettings,
    localStrategy: selectedLocalStrategy,
    compositeStrategy: selectedCompositeStrategy
  });
  const globalNewsRiskBlockEnabled = await readGlobalNewsRiskEnforcement();
  const newsRiskBlocked = shouldBlockByNewsRisk({
    featureSnapshot: featureSnapshotWithStrategy,
    globalEnabled: globalNewsRiskBlockEnabled,
    strategyMode: strategyNewsRiskMode
  });
  const featureSnapshotForGenerate = newsRiskBlocked
    ? withStrategyRunSnapshot(
        featureSnapshotWithStrategy,
        {
          strategyRef: strategyRefForScope,
          status: "fallback",
          signal: "neutral",
          expectedMovePct: 0,
          confidence: 0,
          source: resolvePreferredSignalSourceForMode(
            signalMode,
            PREDICTION_PRIMARY_SIGNAL_SOURCE
          ),
          aiCalled: false,
          explanation: "News blackout active; setup suspended.",
          tags: ["news_risk"],
          keyDrivers: [
            { name: "featureSnapshot.newsRisk", value: true },
            { name: "policy.reasonCode", value: "news_risk_blocked" }
          ],
          ts: tsCreated
        },
        {
          phase: "manual_generate",
          strategyRef: strategyRefForScope,
          reasonCode: "news_risk_blocked",
          strategyNewsRiskMode
        }
      )
    : featureSnapshotWithStrategy;
  const tracking = derivePredictionTrackingFromSnapshot(
    featureSnapshotForGenerate,
    effectiveTimeframe
  );

  const created = await generateAndPersistPrediction({
    symbol: payload.symbol,
    marketType: payload.marketType,
    timeframe: effectiveTimeframe,
    tsCreated,
      prediction: payload.prediction,
      featureSnapshot: featureSnapshotForGenerate,
    signalMode,
    preferredSignalSource: resolvePreferredSignalSourceForMode(
      signalMode,
      PREDICTION_PRIMARY_SIGNAL_SOURCE
    ),
    tracking,
    userId: user.id,
    botId: payload.botId ?? null,
    modelVersionBase: payload.modelVersionBase,
    promptSettings: selectedPromptSettings ?? undefined,
    promptScopeContext,
    newsRiskBlocked: newsRiskBlocked
      ? {
          reasonCode: "news_risk_blocked",
          strategyMode: strategyNewsRiskMode
        }
      : null
  });

  const snapshot = asRecord(created.featureSnapshot);
  const exchangeAccountId = readPrefillExchangeAccountId(snapshot);
  if (exchangeAccountId) {
    const exchange =
      typeof snapshot.prefillExchange === "string" && snapshot.prefillExchange.trim()
        ? normalizeExchangeValue(snapshot.prefillExchange)
        : "bitget";
    const tags = enforceNewsRiskTag(
      created.explanation.tags.length > 0
        ? created.explanation.tags
        : created.featureSnapshot.tags,
      created.featureSnapshot
    );
    const keyDrivers = normalizeKeyDriverList(created.explanation.keyDrivers);
    const tsDate = new Date(tsCreated);
    const changeHash = buildPredictionChangeHash({
      signal: created.prediction.signal,
      confidence: created.prediction.confidence,
      tags,
      keyDrivers,
      featureSnapshot: created.featureSnapshot
    });
    const existingStateId = await findPredictionStateIdByScope({
      userId: user.id,
      exchange,
      accountId: exchangeAccountId,
      symbol: normalizedSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signalMode,
      strategyRef: readPredictionStrategyRef(snapshot)
    });
    const statePayload = {
      ...toPredictionStateStrategyScope(readPredictionStrategyRef(created.featureSnapshot)),
      exchange,
      accountId: exchangeAccountId,
      userId: user.id,
      symbol: normalizedSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signalMode,
      tsUpdated: tsDate,
      tsPredictedFor: new Date(tsDate.getTime() + timeframeToIntervalMs(effectiveTimeframe)),
      signal: created.prediction.signal,
      expectedMovePct: Number.isFinite(Number(created.prediction.expectedMovePct))
        ? Number(created.prediction.expectedMovePct)
        : null,
      confidence: Number.isFinite(Number(created.prediction.confidence))
        ? Number(created.prediction.confidence)
        : 0,
      tags,
      explanation: created.explanation.explanation,
      keyDrivers,
      featuresSnapshot: created.featureSnapshot,
      modelVersion: created.modelVersion,
      lastAiExplainedAt: signalMode === "local_only" ? null : tsDate,
      lastChangeHash: changeHash,
      lastChangeReason: "manual",
      autoScheduleEnabled: isAutoScheduleEnabled(snapshot.autoScheduleEnabled),
      autoSchedulePaused: isAutoSchedulePaused(snapshot),
      directionPreference: parseDirectionPreference(snapshot.directionPreference),
      confidenceTargetPct: readConfidenceTarget(snapshot),
      leverage: readRequestedLeverage(snapshot)
    };
    const stateRow = await persistPredictionState({
      existingStateId,
      stateData: statePayload,
      scope: {
        userId: user.id,
        exchange,
        accountId: exchangeAccountId,
        symbol: normalizedSymbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signalMode
      }
    });

    await db.predictionEvent.create({
      data: {
        stateId: stateRow.id,
        changeType: "manual",
        prevSnapshot: null,
        newSnapshot: {
          signal: created.prediction.signal,
          confidence: created.prediction.confidence,
          expectedMovePct: created.prediction.expectedMovePct,
          tags
        },
        delta: { reason: "manual_generate" },
        horizonEvalRef: created.rowId,
        modelVersion: created.modelVersion,
        reason: "manual_generate"
      }
    });
  }

  await notifyTradablePrediction({
    userId: user.id,
    exchange:
      typeof snapshot.prefillExchange === "string" &&
      snapshot.prefillExchange.trim()
        ? snapshot.prefillExchange.trim().toLowerCase()
        : "bitget",
    exchangeAccountLabel:
      typeof snapshot.prefillExchangeAccountId === "string" &&
      snapshot.prefillExchangeAccountId.trim()
        ? snapshot.prefillExchangeAccountId.trim()
        : "n/a",
    symbol: payload.symbol,
    marketType: payload.marketType,
    timeframe: effectiveTimeframe,
    signal: created.prediction.signal,
    confidence: created.prediction.confidence,
    confidenceTargetPct: readConfidenceTarget(snapshot),
    expectedMovePct: created.prediction.expectedMovePct,
    predictionId: created.rowId,
    explanation: created.explanation.explanation,
    source: "manual",
    signalSource: created.signalSource,
    aiPromptTemplateName: resolveNotificationStrategyName({
      signalSource: created.signalSource,
      snapshot,
      strategyRef: readPredictionStrategyRef(snapshot)
    })
  });
  if (readAiPromptMarketAnalysisUpdateEnabled(snapshot)) {
    await notifyMarketAnalysisUpdate({
      userId: user.id,
      exchange:
        typeof snapshot.prefillExchange === "string" &&
        snapshot.prefillExchange.trim()
          ? snapshot.prefillExchange.trim().toLowerCase()
          : "bitget",
      exchangeAccountLabel:
        typeof snapshot.prefillExchangeAccountId === "string" &&
        snapshot.prefillExchangeAccountId.trim()
          ? snapshot.prefillExchangeAccountId.trim()
          : "n/a",
      symbol: payload.symbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signal: created.prediction.signal,
      confidence: created.prediction.confidence,
      expectedMovePct: created.prediction.expectedMovePct,
      predictionId: created.rowId,
      explanation: created.explanation.explanation,
      source: "manual",
      signalSource: created.signalSource,
      aiPromptTemplateName: resolveNotificationStrategyName({
        signalSource: created.signalSource,
        snapshot,
        strategyRef: readPredictionStrategyRef(snapshot)
      })
    });
  }

  return res.status(created.persisted ? 201 : 202).json({
    persisted: created.persisted,
    prediction: {
      symbol: payload.symbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      tsCreated,
      ...created.prediction
    },
    signalMode,
    signalSource: created.signalSource,
    explanation: created.explanation,
    modelVersion: created.modelVersion,
    predictionId: created.rowId,
    aiPromptTemplateId: readAiPromptTemplateId(snapshot),
    aiPromptTemplateName: readAiPromptTemplateName(snapshot),
    localStrategyId: readLocalStrategyId(snapshot),
    localStrategyName: readLocalStrategyName(snapshot),
    compositeStrategyId: readCompositeStrategyId(snapshot),
    compositeStrategyName: readCompositeStrategyName(snapshot),
    strategyRef: readPredictionStrategyRef(snapshot)
  });
});

app.post("/api/predictions/generate-auto", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionGenerateAutoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const userCtx = await resolveUserContext(user);

  try {
    const created = await generateAutoPredictionForUser(user.id, payload, {
      isSuperadmin: isSuperadminEmail(user.email),
      hasAdminBackendAccess: userCtx.hasAdminBackendAccess,
      userEmail: user.email
    });
    return res.status(created.persisted ? 201 : 202).json({
      persisted: created.persisted,
      existing: created.existing ?? false,
      existingStateId: created.existingStateId ?? null,
      prediction: {
        symbol: normalizeSymbolInput(payload.symbol),
        marketType: payload.marketType,
        timeframe: created.timeframe,
        tsCreated: created.tsCreated,
        ...created.prediction
      },
      directionPreference: created.directionPreference,
      confidenceTargetPct: created.confidenceTargetPct,
      leverage: payload.leverage ?? null,
      signalMode: created.signalMode,
      signalSource: created.signalSource,
      explanation: created.explanation,
      modelVersion: created.modelVersion,
      predictionId: created.predictionId,
      aiPromptTemplateId: created.aiPromptTemplateId,
      aiPromptTemplateName: created.aiPromptTemplateName,
      localStrategyId: created.localStrategyId,
      localStrategyName: created.localStrategyName,
      compositeStrategyId: created.compositeStrategyId,
      compositeStrategyName: created.compositeStrategyName,
      strategyRef: created.strategyRef
    });
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/predictions", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  if (parsed.data.mode === "state") {
    const rows = await db.predictionState.findMany({
      where: { userId: user.id },
      orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }],
      take: parsed.data.limit,
      select: {
        id: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        tsUpdated: true,
        signal: true,
        expectedMovePct: true,
        confidence: true,
        explanation: true,
        tags: true,
        featuresSnapshot: true,
        signalMode: true,
        autoScheduleEnabled: true,
        autoSchedulePaused: true,
        confidenceTargetPct: true,
        exchange: true,
        accountId: true,
        lastChangeReason: true
      }
    });

    const items = rows.map((row: any) => {
      const snapshot = asRecord(row.featuresSnapshot);
      const signalMode = readStateSignalMode(row.signalMode, snapshot);
      return {
        id: row.id,
        symbol: row.symbol,
        marketType: normalizePredictionMarketType(row.marketType),
        timeframe: normalizePredictionTimeframe(row.timeframe),
        tsCreated:
          row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : new Date().toISOString(),
        signal: normalizePredictionSignal(row.signal),
        expectedMovePct: Number.isFinite(Number(row.expectedMovePct))
          ? Number(row.expectedMovePct)
          : 0,
        confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
        explanation: typeof row.explanation === "string" ? row.explanation : "",
        tags: normalizeTagList(row.tags),
        entryPrice: null,
        stopLossPrice: null,
        takeProfitPrice: null,
        horizonMs: timeframeToIntervalMs(normalizePredictionTimeframe(row.timeframe)) * PREDICTION_OUTCOME_HORIZON_BARS,
        outcomeStatus: "pending",
        outcomeResult: null,
        outcomePnlPct: null,
        maxFavorablePct: null,
        maxAdversePct: null,
        outcomeEvaluatedAt: null,
        localPrediction: readLocalPredictionSnapshot(snapshot),
        aiPrediction: readAiPredictionSnapshot(snapshot),
        aiPromptTemplateId: readAiPromptTemplateId(snapshot),
        aiPromptTemplateName: readAiPromptTemplateName(snapshot),
        localStrategyId: readLocalStrategyId(snapshot),
        localStrategyName: readLocalStrategyName(snapshot),
        compositeStrategyId: readCompositeStrategyId(snapshot),
        compositeStrategyName: readCompositeStrategyName(snapshot),
        strategyRef: readPredictionStrategyRef(snapshot),
        signalMode,
        autoScheduleEnabled: Boolean(row.autoScheduleEnabled) && !Boolean(row.autoSchedulePaused),
        confidenceTargetPct:
          Number.isFinite(Number(row.confidenceTargetPct))
          && row.confidenceTargetPct !== null
          && row.confidenceTargetPct !== undefined
            ? Number(row.confidenceTargetPct)
            : 55,
        exchange:
          typeof row.exchange === "string" && row.exchange.trim()
            ? row.exchange
            : "bitget",
        accountId: typeof row.accountId === "string" ? row.accountId : null,
        lastUpdatedAt:
          row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : null,
        lastChangeReason:
          typeof row.lastChangeReason === "string" ? row.lastChangeReason : null
      };
    });

    return res.json({ items });
  }

  const rows = await db.prediction.findMany({
    where: { userId: user.id },
    orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
    take: parsed.data.limit
  });

  const botIds = rows
    .map((row: any) => (typeof row.botId === "string" && row.botId.trim() ? row.botId : null))
    .filter((value: string | null): value is string => Boolean(value));

  const [bots, exchangeAccounts] = await Promise.all([
    botIds.length > 0
      ? db.bot.findMany({
          where: {
            id: { in: botIds },
            userId: user.id
          },
          select: {
            id: true,
            exchange: true,
            exchangeAccountId: true
          }
        })
      : Promise.resolve([]),
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        exchange: true
      }
    })
  ]);

  const botMap = new Map<string, { exchange: string; exchangeAccountId: string | null }>();
  for (const bot of bots) {
    botMap.set(bot.id, {
      exchange: bot.exchange,
      exchangeAccountId: bot.exchangeAccountId ?? null
    });
  }

  const defaultAccount = exchangeAccounts[0] ?? null;
  const accountMap = new Map<string, { exchange: string }>();
  for (const account of exchangeAccounts) {
    accountMap.set(account.id, { exchange: account.exchange });
  }

  const items = rows.map((row: any) => {
    const linkedBot = typeof row.botId === "string" ? botMap.get(row.botId) : undefined;
    const snapshot = asRecord(row.featuresSnapshot);
    const requestedPrefillAccountId =
      typeof snapshot.prefillExchangeAccountId === "string"
        ? snapshot.prefillExchangeAccountId
        : null;
    const requestedPrefillExchange =
      typeof snapshot.prefillExchange === "string"
        ? snapshot.prefillExchange
        : null;

    const prefillAccountId =
      requestedPrefillAccountId && accountMap.has(requestedPrefillAccountId)
        ? requestedPrefillAccountId
        : null;

    const fallbackAccountId =
      prefillAccountId ??
      linkedBot?.exchangeAccountId ??
      defaultAccount?.id ??
      null;

    const accountExchange = fallbackAccountId ? accountMap.get(fallbackAccountId)?.exchange : null;
    const fallbackExchange =
      requestedPrefillExchange ??
      accountExchange ??
      linkedBot?.exchange ??
      defaultAccount?.exchange ??
      "bitget";
    const realized = readRealizedPayloadFromOutcomeMeta(row.outcomeMeta);
    const errorMetrics = asRecord(realized.errorMetrics);
    const realizedAbsError = Number(errorMetrics.absError);
    const realizedSqError = Number(errorMetrics.sqError);
    const realizedHitRaw = errorMetrics.hit;
    const realizedHit =
      typeof realizedHitRaw === "boolean"
        ? realizedHitRaw
        : typeof realizedHitRaw === "number"
          ? realizedHitRaw > 0
          : null;

    return {
      id: row.id,
      symbol: row.symbol,
      marketType: normalizePredictionMarketType(row.marketType),
      timeframe: normalizePredictionTimeframe(row.timeframe),
      tsCreated: row.tsCreated.toISOString(),
      signal: normalizePredictionSignal(row.signal),
      expectedMovePct: row.expectedMovePct,
      confidence: row.confidence,
      explanation: typeof row.explanation === "string" ? row.explanation : "",
      tags: asStringArray(row.tags).slice(0, 10),
      entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
      stopLossPrice: Number.isFinite(Number(row.stopLossPrice)) ? Number(row.stopLossPrice) : null,
      takeProfitPrice: Number.isFinite(Number(row.takeProfitPrice)) ? Number(row.takeProfitPrice) : null,
      horizonMs: Number.isFinite(Number(row.horizonMs)) ? Number(row.horizonMs) : null,
      outcomeStatus: typeof row.outcomeStatus === "string" ? row.outcomeStatus : "pending",
      outcomeResult: typeof row.outcomeResult === "string" ? row.outcomeResult : null,
      outcomePnlPct: Number.isFinite(Number(row.outcomePnlPct)) ? Number(row.outcomePnlPct) : null,
      maxFavorablePct: Number.isFinite(Number(row.maxFavorablePct)) ? Number(row.maxFavorablePct) : null,
      maxAdversePct: Number.isFinite(Number(row.maxAdversePct)) ? Number(row.maxAdversePct) : null,
      outcomeEvaluatedAt:
        row.outcomeEvaluatedAt instanceof Date ? row.outcomeEvaluatedAt.toISOString() : null,
      realizedReturnPct:
        typeof realized.realizedReturnPct === "number" ? realized.realizedReturnPct : null,
      realizedEvaluatedAt: realized.evaluatedAt,
      realizedHit,
      realizedAbsError: Number.isFinite(realizedAbsError) ? realizedAbsError : null,
      realizedSqError: Number.isFinite(realizedSqError) ? realizedSqError : null,
      localPrediction:
        readLocalPredictionSnapshot(snapshot) ??
        normalizeSnapshotPrediction(asRecord({
          signal: row.signal,
          expectedMovePct: row.expectedMovePct,
          confidence: row.confidence
        })),
      aiPrediction: readAiPredictionSnapshot(snapshot),
      aiPromptTemplateId: readAiPromptTemplateId(snapshot),
      aiPromptTemplateName: readAiPromptTemplateName(snapshot),
      localStrategyId: readLocalStrategyId(snapshot),
      localStrategyName: readLocalStrategyName(snapshot),
      compositeStrategyId: readCompositeStrategyId(snapshot),
      compositeStrategyName: readCompositeStrategyName(snapshot),
      strategyRef: readPredictionStrategyRef(snapshot),
      signalMode: readSignalMode(snapshot),
      autoScheduleEnabled: isAutoScheduleEnabled(snapshot.autoScheduleEnabled),
      confidenceTargetPct: readConfiguredConfidenceTarget(snapshot),
      exchange: fallbackExchange,
      accountId: fallbackAccountId
    };
  });

  return res.json({
    items
  });
});

app.post("/api/predictions/performance/reset", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const resetAt = await setPredictionPerformanceResetAt(user.id, new Date().toISOString());
  return res.json({
    ok: true,
    resetAt
  });
});

app.get("/api/predictions/quality", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionQualityQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const timeframeInput = parsed.data.timeframe ?? parsed.data.tf;
  const timeframe = timeframeInput ? normalizePredictionTimeframe(timeframeInput) : null;
  const symbol = parsed.data.symbol ? normalizeSymbolInput(parsed.data.symbol) : null;
  const signalSource = parsed.data.signalSource;
  if (parsed.data.symbol !== undefined && !symbol) {
    return res.status(400).json({ error: "invalid_symbol" });
  }

  const resetAt = await getPredictionPerformanceResetAt(user.id);
  const where: Record<string, unknown> = {
    userId: user.id,
    outcomeStatus: "closed"
  };
  if (timeframe) where.timeframe = timeframe;
  if (symbol) where.symbol = symbol;
  if (resetAt) {
    where.tsCreated = { gte: resetAt };
  }

  const rowsRaw = await db.prediction.findMany({
    where,
    orderBy: { tsCreated: "desc" },
    take: 2000,
    select: {
      tsCreated: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      featuresSnapshot: true,
      outcomeMeta: true,
      outcomeResult: true,
      outcomePnlPct: true
    }
  });
  const rows = signalSource
    ? rowsRaw.filter((row) => {
        const snapshot = asRecord(row.featuresSnapshot);
        return readSelectedSignalSource(snapshot) === signalSource;
      })
    : rowsRaw;

  let tp = 0;
  let sl = 0;
  let expired = 0;
  let skipped = 0;
  let invalid = 0;
  let pnlSum = 0;
  let pnlCount = 0;
  let compare24hSampleSize = 0;
  let compare24hLocalHits = 0;
  let compare24hAiHits = 0;
  const compare24hWindowStartMs = Date.now() - 24 * 60 * 60 * 1000;

  for (const row of rows) {
    const result = typeof row.outcomeResult === "string" ? row.outcomeResult : "";
    if (result === "tp_hit") tp += 1;
    else if (result === "sl_hit") sl += 1;
    else if (result === "expired") expired += 1;
    else if (result === "skipped") skipped += 1;
    else if (result === "invalid") invalid += 1;

    const pnl = Number(row.outcomePnlPct);
    if (Number.isFinite(pnl)) {
      pnlSum += pnl;
      pnlCount += 1;
    }

    if (!(row.tsCreated instanceof Date) || row.tsCreated.getTime() < compare24hWindowStartMs) {
      continue;
    }
    const outcomeMeta = asRecord(row.outcomeMeta);
    const startClose = Number(outcomeMeta.realizedStartClose);
    const endClose = Number(outcomeMeta.realizedEndClose);
    if (!Number.isFinite(startClose) || startClose <= 0 || !Number.isFinite(endClose) || endClose <= 0) {
      continue;
    }

    const snapshot = asRecord(row.featuresSnapshot);
    const localPrediction =
      readLocalPredictionSnapshot(snapshot) ??
      normalizeSnapshotPrediction(asRecord({
        signal: row.signal,
        expectedMovePct: row.expectedMovePct,
        confidence: row.confidence
      }));
    const aiPrediction = readAiPredictionSnapshot(snapshot);
    if (!localPrediction || !aiPrediction) {
      continue;
    }

    const localMetrics = computePredictionErrorMetrics({
      signal: localPrediction.signal,
      expectedMovePct: localPrediction.expectedMovePct,
      realizedReturnPct: computeDirectionalRealizedReturnPct(
        localPrediction.signal,
        startClose,
        endClose
      )
    });
    const aiMetrics = computePredictionErrorMetrics({
      signal: aiPrediction.signal,
      expectedMovePct: aiPrediction.expectedMovePct,
      realizedReturnPct: computeDirectionalRealizedReturnPct(aiPrediction.signal, startClose, endClose)
    });
    if (typeof localMetrics.hit !== "boolean" || typeof aiMetrics.hit !== "boolean") {
      continue;
    }

    compare24hSampleSize += 1;
    if (localMetrics.hit) compare24hLocalHits += 1;
    if (aiMetrics.hit) compare24hAiHits += 1;
  }

  const sampleSize = rows.length;
  const winRatePct = sampleSize > 0 ? Number(((tp / sampleSize) * 100).toFixed(2)) : null;
  const avgOutcomePnlPct = pnlCount > 0 ? Number((pnlSum / pnlCount).toFixed(4)) : null;
  const localHitRate24hPct = compare24hSampleSize > 0
    ? Number(((compare24hLocalHits / compare24hSampleSize) * 100).toFixed(2))
    : null;
  const aiHitRate24hPct = compare24hSampleSize > 0
    ? Number(((compare24hAiHits / compare24hSampleSize) * 100).toFixed(2))
    : null;
  const deltaAiVsLocal24hPct =
    localHitRate24hPct !== null && aiHitRate24hPct !== null
      ? Number((aiHitRate24hPct - localHitRate24hPct).toFixed(2))
      : null;

  return res.json({
    resetAt: resetAt ? resetAt.toISOString() : null,
    sampleSize,
    tp,
    sl,
    expired,
    skipped,
    invalid,
    winRatePct,
    avgOutcomePnlPct,
    comparison24h: {
      sampleSize: compare24hSampleSize,
      localHits: compare24hLocalHits,
      aiHits: compare24hAiHits,
      localHitRatePct: localHitRate24hPct,
      aiHitRatePct: aiHitRate24hPct,
      deltaAiVsLocalPct: deltaAiVsLocal24hPct
    }
  });
});

app.get("/api/predictions/metrics", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionMetricsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const timeframeInput = parsed.data.timeframe ?? parsed.data.tf;
  const timeframe = timeframeInput ? normalizePredictionTimeframe(timeframeInput) : null;
  const symbol = parsed.data.symbol ? normalizeSymbolInput(parsed.data.symbol) : null;
  const signalSource = parsed.data.signalSource;
  const from = parsed.data.from ? new Date(parsed.data.from) : null;
  const to = parsed.data.to ? new Date(parsed.data.to) : null;
  if (symbol !== null && !symbol) {
    return res.status(400).json({ error: "invalid_symbol" });
  }
  const resetAt = await getPredictionPerformanceResetAt(user.id);
  const effectiveFrom =
    from && resetAt
      ? from.getTime() > resetAt.getTime()
        ? from
        : resetAt
      : from ?? resetAt;

  const where: Record<string, unknown> = { userId: user.id };
  if (timeframe) where.timeframe = timeframe;
  if (symbol) where.symbol = symbol;
  if (effectiveFrom || to) {
    where.tsCreated = {
      ...(effectiveFrom ? { gte: effectiveFrom } : {}),
      ...(to ? { lte: to } : {})
    };
  }

  const rows = await db.prediction.findMany({
    where,
    orderBy: [{ tsCreated: "desc" }],
    take: 5000,
    select: {
      id: true,
      signal: true,
      confidence: true,
      expectedMovePct: true,
      featuresSnapshot: true,
      outcomeMeta: true
    }
  });

  const samples: PredictionEvaluatorSample[] = [];
  for (const row of rows) {
    if (signalSource) {
      const snapshot = asRecord(row.featuresSnapshot);
      if (readSelectedSignalSource(snapshot) !== signalSource) continue;
    }
    const signal = normalizePredictionSignal(row.signal);
    const realized = readRealizedPayloadFromOutcomeMeta(row.outcomeMeta);
    if (typeof realized.realizedReturnPct !== "number") continue;

    const metrics = asRecord(realized.errorMetrics);
    const hitRaw = metrics.hit;
    const hit =
      typeof hitRaw === "boolean"
        ? hitRaw
        : typeof hitRaw === "number"
          ? hitRaw > 0
          : null;
    const absError = Number(metrics.absError);
    const sqError = Number(metrics.sqError);
    const normalizedConfidence = normalizeConfidencePct(Number(row.confidence));
    if (normalizedConfidence === null) continue;

    samples.push({
      confidence: normalizedConfidence,
      signal,
      expectedMovePct: Number.isFinite(Number(row.expectedMovePct)) ? Number(row.expectedMovePct) : null,
      realizedReturnPct: realized.realizedReturnPct,
      hit,
      absError: Number.isFinite(absError) ? absError : null,
      sqError: Number.isFinite(sqError) ? sqError : null
    });
  }

  const summary = buildPredictionMetricsSummary(samples, parsed.data.bins);
  return res.json({
    resetAt: resetAt ? resetAt.toISOString() : null,
    timeframe,
    symbol,
    from: effectiveFrom ? effectiveFrom.toISOString() : null,
    to: to ? to.toISOString() : null,
    signalSource: signalSource ?? null,
    bins: parsed.data.bins,
    ...summary
  });
});

app.get("/api/thresholds/latest", requireAuth, async (req, res) => {
  const parsed = thresholdsLatestQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const timeframe = normalizePredictionTimeframe(parsed.data.timeframe ?? parsed.data.tf ?? "15m");
  const marketType = normalizePredictionMarketType(parsed.data.marketType);
  const exchange = normalizeExchangeValue(parsed.data.exchange);
  const symbol = normalizeSymbolInput(parsed.data.symbol);
  if (!symbol) {
    return res.status(400).json({ error: "invalid_symbol" });
  }

  const resolved = await resolveFeatureThresholds({
    exchange,
    symbol,
    marketType,
    timeframe
  });

  return res.json({
    exchange,
    symbol,
    marketType,
    timeframe,
    source: resolved.source,
    computedAt: resolved.computedAt,
    windowFrom: resolved.windowFrom,
    windowTo: resolved.windowTo,
    nBars: resolved.nBars,
    version: resolved.version,
    thresholds: resolved.thresholds
  });
});

app.get("/api/predictions/running", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);

  const [rows, exchangeAccounts] = await Promise.all([
    db.predictionState.findMany({
      where: { userId: user.id },
      orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }],
      take: Math.max(200, PREDICTION_REFRESH_SCAN_LIMIT),
      select: {
        id: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        signalMode: true,
        tsUpdated: true,
        tsPredictedFor: true,
        exchange: true,
        accountId: true,
        directionPreference: true,
        confidenceTargetPct: true,
        leverage: true,
        autoScheduleEnabled: true,
        autoSchedulePaused: true,
        featuresSnapshot: true
      }
    }),
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        exchange: true,
        label: true
      }
    })
  ]);

  const accountMap = new Map<string, { exchange: string; label: string }>();
  for (const account of exchangeAccounts) {
    accountMap.set(account.id, {
      exchange: account.exchange,
      label: account.label
    });
  }

  const items: Array<{
    id: string;
    symbol: string;
    marketType: PredictionMarketType;
    timeframe: PredictionTimeframe;
    exchangeAccountId: string;
    exchange: string;
    label: string;
    directionPreference: DirectionPreference;
    confidenceTargetPct: number;
    leverage: number | null;
    signalMode: PredictionSignalMode;
    aiPromptTemplateId: string | null;
    aiPromptTemplateName: string | null;
    localStrategyId: string | null;
    localStrategyName: string | null;
    compositeStrategyId: string | null;
    compositeStrategyName: string | null;
    strategyRef: PredictionStrategyRef | null;
    paused: boolean;
    tsCreated: string;
    nextRunAt: string;
    dueInSec: number;
  }> = [];

  const now = Date.now();
  for (const row of rows) {
    const snapshot = asRecord(row.featuresSnapshot);
    const exchangeAccountId =
      typeof row.accountId === "string" && row.accountId.trim()
        ? row.accountId.trim()
        : readPrefillExchangeAccountId(snapshot);
    if (!exchangeAccountId) continue;

    const symbol = normalizeSymbolInput(row.symbol);
    if (!symbol) continue;

    const timeframe = normalizePredictionTimeframe(row.timeframe);
    const marketType = normalizePredictionMarketType(row.marketType);
    const signalMode = readStateSignalMode(row.signalMode, snapshot);
    if (!Boolean(row.autoScheduleEnabled)) continue;

    const paused = Boolean(row.autoSchedulePaused);
    const dueAt = row.tsPredictedFor instanceof Date
      ? row.tsPredictedFor.getTime()
      : row.tsUpdated.getTime() + refreshIntervalMsForTimeframe(timeframe);
    const dueInSec = Math.max(0, Math.floor((dueAt - now) / 1000));
    const account = accountMap.get(exchangeAccountId);

    items.push({
      id: row.id,
      symbol,
      marketType,
      timeframe,
      exchangeAccountId,
      exchange:
        (typeof row.exchange === "string" && row.exchange.trim()) ||
        account?.exchange ||
        "bitget",
      label: account?.label ?? exchangeAccountId,
      directionPreference: parseDirectionPreference(
        row.directionPreference ?? snapshot.directionPreference
      ),
      confidenceTargetPct:
        Number.isFinite(Number(row.confidenceTargetPct))
          && row.confidenceTargetPct !== null
          && row.confidenceTargetPct !== undefined
          ? Number(row.confidenceTargetPct)
          : readConfidenceTarget(snapshot),
      leverage:
        Number.isFinite(Number(row.leverage))
          && row.leverage !== null
          && row.leverage !== undefined
          ? Math.max(1, Math.trunc(Number(row.leverage)))
          : readRequestedLeverage(snapshot) ?? null,
      signalMode,
      aiPromptTemplateId: readAiPromptTemplateId(snapshot),
      aiPromptTemplateName: readAiPromptTemplateName(snapshot),
      localStrategyId: readLocalStrategyId(snapshot),
      localStrategyName: readLocalStrategyName(snapshot),
      compositeStrategyId: readCompositeStrategyId(snapshot),
      compositeStrategyName: readCompositeStrategyName(snapshot),
      strategyRef: readPredictionStrategyRef(snapshot),
      paused,
      tsCreated:
        row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : new Date().toISOString(),
      nextRunAt: new Date(dueAt).toISOString(),
      dueInSec
    });
  }

  items.sort((a, b) => a.dueInSec - b.dueInSec);

  return res.json({ items });
});

app.post("/api/predictions/:id/pause", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = predictionIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "invalid_prediction_id" });
  }
  const body = predictionPauseSchema.safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: "invalid_payload", details: body.error.flatten() });
  }

  const stateRow = await db.predictionState.findFirst({
    where: {
      id: params.data.id,
      userId: user.id
    },
    select: {
      id: true,
      signalMode: true,
      featuresSnapshot: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      accountId: true
    }
  });

  if (stateRow) {
    const snapshot = asRecord(stateRow.featuresSnapshot);
    const signalMode = readStateSignalMode(stateRow.signalMode, snapshot);
    await db.predictionState.update({
      where: { id: stateRow.id },
      data: {
        autoScheduleEnabled: true,
        autoSchedulePaused: body.data.paused,
        featuresSnapshot: {
          ...snapshot,
          autoScheduleEnabled: true,
          autoSchedulePaused: body.data.paused
        }
      }
    });

    const normalizedSymbol = normalizeSymbolInput(stateRow.symbol);
    const templateRowIds = await findPredictionTemplateRowIds(user.id, {
      symbol: normalizedSymbol || stateRow.symbol,
      marketType: normalizePredictionMarketType(stateRow.marketType),
      timeframe: normalizePredictionTimeframe(stateRow.timeframe),
      exchangeAccountId: typeof stateRow.accountId === "string" ? stateRow.accountId : null,
      signalMode,
      strategyRef: readPredictionStrategyRef(snapshot)
    });

    if (templateRowIds.length > 0) {
      const rows = await db.prediction.findMany({
        where: {
          id: { in: templateRowIds },
          userId: user.id
        },
        select: {
          id: true,
          featuresSnapshot: true
        }
      });

      await Promise.all(
        rows.map((row: any) => {
          const snapshot = asRecord(row.featuresSnapshot);
          return db.prediction.update({
            where: { id: row.id },
            data: {
              featuresSnapshot: {
                ...snapshot,
                autoScheduleEnabled: true,
                autoSchedulePaused: body.data.paused
              }
            }
          });
        })
      );
    }

    return res.json({
      ok: true,
      paused: body.data.paused,
      updatedCount: 1
    });
  }

  const scope = await resolvePredictionTemplateScope(user.id, params.data.id);
  if (!scope) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const templateRowIds = await findPredictionTemplateRowIds(user.id, {
    symbol: scope.symbol,
    marketType: scope.marketType,
    timeframe: scope.timeframe,
    exchangeAccountId: scope.exchangeAccountId,
    signalMode: scope.signalMode,
    strategyRef: scope.strategyRef
  });
  const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

  const rows = await db.prediction.findMany({
    where: {
      id: { in: ids },
      userId: user.id
    },
    select: {
      id: true,
      featuresSnapshot: true
    }
  });

  await Promise.all(
    rows.map((row: any) => {
      const snapshot = asRecord(row.featuresSnapshot);
      return db.prediction.update({
        where: { id: row.id },
        data: {
          featuresSnapshot: {
            ...snapshot,
            autoScheduleEnabled: true,
            autoSchedulePaused: body.data.paused
          }
        }
      });
    })
  );

  return res.json({
    ok: true,
    paused: body.data.paused,
    updatedCount: rows.length
  });
});

app.post("/api/predictions/:id/stop", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = predictionIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "invalid_prediction_id" });
  }

  const stateRow = await db.predictionState.findFirst({
    where: {
      id: params.data.id,
      userId: user.id
    },
    select: {
      id: true,
      signalMode: true,
      featuresSnapshot: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      accountId: true
    }
  });

  if (stateRow) {
    const snapshot = asRecord(stateRow.featuresSnapshot);
    const signalMode = readStateSignalMode(stateRow.signalMode, snapshot);
    await db.predictionState.update({
      where: { id: stateRow.id },
      data: {
        autoScheduleEnabled: false,
        autoSchedulePaused: false,
        featuresSnapshot: {
          ...snapshot,
          autoScheduleEnabled: false,
          autoSchedulePaused: false
        }
      }
    });

    const normalizedSymbol = normalizeSymbolInput(stateRow.symbol);
    const templateRowIds = await findPredictionTemplateRowIds(user.id, {
      symbol: normalizedSymbol || stateRow.symbol,
      marketType: normalizePredictionMarketType(stateRow.marketType),
      timeframe: normalizePredictionTimeframe(stateRow.timeframe),
      exchangeAccountId: typeof stateRow.accountId === "string" ? stateRow.accountId : null,
      signalMode,
      strategyRef: readPredictionStrategyRef(snapshot)
    });

    if (templateRowIds.length > 0) {
      const rows = await db.prediction.findMany({
        where: {
          id: { in: templateRowIds },
          userId: user.id
        },
        select: {
          id: true,
          featuresSnapshot: true
        }
      });

      await Promise.all(
        rows.map((row: any) =>
          db.prediction.update({
            where: { id: row.id },
            data: {
              featuresSnapshot: withAutoScheduleFlag(row.featuresSnapshot, false)
            }
          })
        )
      );
    }

    return res.json({
      ok: true,
      stoppedCount: 1
    });
  }

  const scope = await resolvePredictionTemplateScope(user.id, params.data.id);
  if (!scope) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const templateRowIds = await findPredictionTemplateRowIds(user.id, {
    symbol: scope.symbol,
    marketType: scope.marketType,
    timeframe: scope.timeframe,
    exchangeAccountId: scope.exchangeAccountId,
    signalMode: scope.signalMode,
    strategyRef: scope.strategyRef
  });
  const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

  const rows = await db.prediction.findMany({
    where: {
      id: { in: ids },
      userId: user.id
    },
    select: {
      id: true,
      featuresSnapshot: true
    }
  });

  await Promise.all(
    rows.map((row: any) =>
      db.prediction.update({
        where: { id: row.id },
        data: {
          featuresSnapshot: withAutoScheduleFlag(row.featuresSnapshot, false)
        }
      })
    )
  );

  return res.json({
    ok: true,
    stoppedCount: rows.length
  });
});

app.post("/api/predictions/:id/delete-schedule", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const params = predictionIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "invalid_prediction_id" });
  }

  const stateRow = await db.predictionState.findFirst({
    where: {
      id: params.data.id,
      userId: user.id
    },
    select: {
      id: true,
      signalMode: true,
      featuresSnapshot: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      accountId: true
    }
  });

  if (stateRow) {
    await db.predictionState.delete({
      where: { id: stateRow.id }
    });
    predictionTriggerDebounceState.delete(stateRow.id);
    const normalizedSymbol = normalizeSymbolInput(stateRow.symbol);
    const stateSnapshot = asRecord(stateRow.featuresSnapshot);
    const stateSignalMode = readStateSignalMode(stateRow.signalMode, stateSnapshot);

    const templateRowIds = await findPredictionTemplateRowIds(user.id, {
      symbol: normalizedSymbol || stateRow.symbol,
      marketType: normalizePredictionMarketType(stateRow.marketType),
      timeframe: normalizePredictionTimeframe(stateRow.timeframe),
      exchangeAccountId: typeof stateRow.accountId === "string" ? stateRow.accountId : null,
      signalMode: stateSignalMode,
      strategyRef: readPredictionStrategyRef(stateSnapshot)
    });

    const deletedTemplates =
      templateRowIds.length > 0
        ? await db.prediction.deleteMany({
            where: {
              userId: user.id,
              id: { in: templateRowIds }
            }
          })
        : { count: 0 };

    return res.json({
      ok: true,
      deletedCount: 1 + deletedTemplates.count
    });
  }

  const scope = await resolvePredictionTemplateScope(user.id, params.data.id);
  if (!scope) {
    return res.status(404).json({ error: "prediction_not_found" });
  }

  const templateRowIds = await findPredictionTemplateRowIds(user.id, {
    symbol: scope.symbol,
    marketType: scope.marketType,
    timeframe: scope.timeframe,
    exchangeAccountId: scope.exchangeAccountId,
    signalMode: scope.signalMode,
    strategyRef: scope.strategyRef
  });
  const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

  const deleted = await db.prediction.deleteMany({
    where: {
      userId: user.id,
      id: { in: ids }
    }
  });

  return res.json({
    ok: true,
    deletedCount: deleted.count
  });
});

app.get("/api/predictions/state", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionStateQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const symbol = normalizeSymbolInput(parsed.data.symbol);
  if (!symbol) {
    return res.status(400).json({ error: "invalid_symbol" });
  }

  const row = await db.predictionState.findFirst({
    where: {
      userId: user.id,
      exchange: normalizeExchangeValue(parsed.data.exchange),
      accountId: parsed.data.accountId,
      symbol,
      marketType: parsed.data.marketType,
      timeframe: parsed.data.timeframe,
      signalMode: parsed.data.signalMode
        ? normalizePredictionSignalMode(parsed.data.signalMode)
        : undefined
    },
    orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }]
  });

  if (!row) {
    return res.status(404).json({ error: "prediction_state_not_found" });
  }

  return res.json({
    signalMode: readStateSignalMode(row.signalMode, asRecord(row.featuresSnapshot)),
    id: row.id,
    exchange: row.exchange,
    accountId: row.accountId,
    symbol: row.symbol,
    marketType: normalizePredictionMarketType(row.marketType),
    timeframe: normalizePredictionTimeframe(row.timeframe),
    tsUpdated: row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : null,
    tsPredictedFor: row.tsPredictedFor instanceof Date ? row.tsPredictedFor.toISOString() : null,
    signal: normalizePredictionSignal(row.signal),
    expectedMovePct: Number.isFinite(Number(row.expectedMovePct))
      ? Number(row.expectedMovePct)
      : null,
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
    tags: normalizeTagList(row.tags),
    explanation: typeof row.explanation === "string" ? row.explanation : null,
    keyDrivers: normalizeKeyDriverList(row.keyDrivers),
    featureSnapshot: asRecord(row.featuresSnapshot),
    aiPromptTemplateId: readAiPromptTemplateId(asRecord(row.featuresSnapshot)),
    aiPromptTemplateName: readAiPromptTemplateName(asRecord(row.featuresSnapshot)),
    localStrategyId: readLocalStrategyId(asRecord(row.featuresSnapshot)),
    localStrategyName: readLocalStrategyName(asRecord(row.featuresSnapshot)),
    compositeStrategyId: readCompositeStrategyId(asRecord(row.featuresSnapshot)),
    compositeStrategyName: readCompositeStrategyName(asRecord(row.featuresSnapshot)),
    strategyRef: readPredictionStrategyRef(asRecord(row.featuresSnapshot)),
    modelVersion: row.modelVersion,
    autoScheduleEnabled: Boolean(row.autoScheduleEnabled),
    autoSchedulePaused: Boolean(row.autoSchedulePaused),
    lastChangeReason:
      typeof row.lastChangeReason === "string" ? row.lastChangeReason : null
  });
});

app.get("/api/predictions/events", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = predictionEventsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const state = await db.predictionState.findFirst({
    where: {
      id: parsed.data.stateId,
      userId: user.id,
    },
    select: { id: true }
  });
  if (!state) {
    return res.status(404).json({ error: "prediction_state_not_found" });
  }

  const rows = await db.predictionEvent.findMany({
    where: {
      stateId: state.id
    },
    orderBy: [{ tsCreated: "desc" }],
    take: parsed.data.limit
  });

  return res.json({
    items: rows.map((row: any) => ({
      id: row.id,
      stateId: row.stateId,
      tsCreated: row.tsCreated instanceof Date ? row.tsCreated.toISOString() : null,
      changeType: row.changeType,
      reason: typeof row.reason === "string" ? row.reason : null,
      delta: asRecord(row.delta),
      prevSnapshot: row.prevSnapshot ?? null,
      newSnapshot: row.newSnapshot ?? null,
      modelVersion: row.modelVersion
    }))
  });
});

registerPredictionDetailRoute(app, db);
registerEconomicCalendarRoutes(app, {
  db,
  requireSuperadmin,
  refreshJob: economicCalendarRefreshJob
});
registerNewsRoutes(app, { db });

app.get("/api/symbols", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const resolved = await resolveMarketDataTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);

    try {
      const symbols = await listSymbols(adapter);
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        exchange: resolved.selectedAccount.exchange,
        marketDataExchange: resolved.marketDataAccount.exchange,
        ...symbols
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/market/candles", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = marketCandlesQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  try {
    const resolved = await resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);

    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }

      const exchangeSymbol = await adapter.toExchangeSymbol(symbol);
      const granularity = marketTimeframeToBitgetGranularity(parsed.data.timeframe as "1m" | PredictionTimeframe);
      const raw = await adapter.marketApi.getCandles({
        symbol: exchangeSymbol,
        productType: adapter.productType,
        granularity,
        limit: parsed.data.limit
      });

      const items = parseBitgetCandles(raw);

      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        exchange: resolved.selectedAccount.exchange,
        marketDataExchange: resolved.marketDataAccount.exchange,
        symbol,
        timeframe: parsed.data.timeframe,
        granularity,
        items
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/account/summary", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const resolved = await resolveMarketDataTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);

    try {
      if (isPaperTradingAccount(resolved.selectedAccount)) {
        const [summary, positions] = await Promise.all([
          getPaperAccountState(resolved.selectedAccount, adapter),
          listPaperPositions(resolved.selectedAccount, adapter)
        ]);

        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: resolved.marketDataAccount.exchange,
          equity: summary.equity ?? null,
          availableMargin: summary.availableMargin ?? null,
          marginMode: summary.marginMode ?? null,
          positionsCount: positions.length,
          updatedAt: new Date().toISOString()
        });
      }

      const [summary, positions] = await Promise.all([adapter.getAccountState(), adapter.getPositions()]);

      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        exchange: resolved.selectedAccount.exchange,
        marketDataExchange: resolved.marketDataAccount.exchange,
        equity: summary.equity ?? null,
        availableMargin: summary.availableMargin ?? null,
        marginMode: summary.marginMode ?? null,
        positionsCount: positions.length,
        updatedAt: new Date().toISOString()
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/account/leverage", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = adjustLeverageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const account = await resolveTradingAccount(user.id, parsed.data.exchangeAccountId);
    const symbol = normalizeSymbolInput(parsed.data.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "symbol_required" });
    }
    if (isPaperTradingAccount(account)) {
      return res.json({
        ok: true,
        exchangeAccountId: account.id,
        symbol,
        leverage: parsed.data.leverage,
        marginMode: parsed.data.marginMode
      });
    }

    const adapter = createBitgetAdapter(account);
    try {
      await adapter.setLeverage(symbol, parsed.data.leverage, parsed.data.marginMode);
      return res.json({
        ok: true,
        exchangeAccountId: account.id,
        symbol,
        leverage: parsed.data.leverage,
        marginMode: parsed.data.marginMode
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/positions", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const symbol = normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);

    const resolved = await resolveMarketDataTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);
    try {
      const items = isPaperTradingAccount(resolved.selectedAccount)
        ? await listPaperPositions(resolved.selectedAccount, adapter, symbol ?? undefined)
        : await listPositions(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        items
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/api/orders/open", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : undefined;
    const symbol = normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);

    const resolved = await resolveMarketDataTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);
    try {
      const items = isPaperTradingAccount(resolved.selectedAccount)
        ? await listPaperOpenOrders(resolved.selectedAccount, adapter, symbol ?? undefined)
        : await listOpenOrders(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        items
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const resolved = await resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);

    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }

      if (isPaperTradingAccount(resolved.selectedAccount)) {
        const orderSide = parsed.data.side === "long" ? "buy" : "sell";
        const placed = await placePaperOrder(resolved.selectedAccount, adapter, {
          symbol,
          side: orderSide,
          type: parsed.data.type,
          qty: parsed.data.qty,
          price: parsed.data.price,
          takeProfitPrice: parsed.data.takeProfitPrice,
          stopLossPrice: parsed.data.stopLossPrice,
          reduceOnly: parsed.data.reduceOnly
        });
        return res.status(201).json({
          exchangeAccountId: resolved.selectedAccount.id,
          orderId: placed.orderId,
          status: "accepted"
        });
      }

      if (parsed.data.leverage !== undefined) {
        await adapter.setLeverage(
          symbol,
          parsed.data.leverage,
          parsed.data.marginMode ?? "cross"
        );
      }

      const side = parsed.data.side === "long" ? "buy" : "sell";
      const placed = await adapter.placeOrder({
        symbol,
        side,
        type: parsed.data.type,
        qty: parsed.data.qty,
        price: parsed.data.price,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice,
        reduceOnly: parsed.data.reduceOnly,
        marginMode: parsed.data.marginMode
      });

      return res.status(201).json({
        exchangeAccountId: resolved.selectedAccount.id,
        orderId: placed.orderId,
        status: "accepted"
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders/edit", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = editOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const resolved = await resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }
      if (isPaperTradingAccount(resolved.selectedAccount)) {
        const updated = await editPaperOrder(resolved.selectedAccount, adapter, {
          orderId: parsed.data.orderId,
          symbol,
          price: parsed.data.price,
          qty: parsed.data.qty,
          takeProfitPrice: parsed.data.takeProfitPrice,
          stopLossPrice: parsed.data.stopLossPrice
        });
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          orderId: updated.orderId,
          ok: true
        });
      }
      const updated = await editOpenOrder(adapter, {
        symbol,
        orderId: parsed.data.orderId,
        price: parsed.data.price,
        qty: parsed.data.qty,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice
      });
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        orderId: updated.orderId,
        ok: true
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders/cancel", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = cancelOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const resolved = await resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (isPaperTradingAccount(resolved.selectedAccount)) {
        await cancelPaperOrder(resolved.selectedAccount, adapter, parsed.data.orderId, symbol ?? undefined);
        return res.json({ ok: true });
      }
      if (symbol) {
        await adapter.tradeApi.cancelOrder({
          symbol: await adapter.toExchangeSymbol(symbol),
          orderId: parsed.data.orderId,
          productType: adapter.productType
        });
      } else {
        await adapter.cancelOrder(parsed.data.orderId);
      }
      return res.json({ ok: true });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/orders/cancel-all", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
      ? req.query.exchangeAccountId
      : typeof req.body?.exchangeAccountId === "string"
        ? req.body.exchangeAccountId
        : undefined;
    const symbol = normalizeSymbolInput(
      typeof req.query.symbol === "string"
        ? req.query.symbol
        : typeof req.body?.symbol === "string"
          ? req.body.symbol
          : null
    );
    const resolved = await resolveMarketDataTradingAccount(user.id, exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);

    try {
      const result = isPaperTradingAccount(resolved.selectedAccount)
        ? await cancelAllPaperOrders(resolved.selectedAccount, adapter, symbol ?? undefined)
        : await cancelAllOrders(adapter, symbol ?? undefined);
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        ...result
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/positions/tpsl", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = positionTpSlSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const resolved = await resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }
      if (isPaperTradingAccount(resolved.selectedAccount)) {
        await setPaperPositionTpSl(resolved.selectedAccount, adapter, {
          symbol,
          side: parsed.data.side,
          takeProfitPrice: parsed.data.takeProfitPrice,
          stopLossPrice: parsed.data.stopLossPrice
        });
      } else {
        await setPositionTpSl(adapter, {
          symbol,
          side: parsed.data.side,
          takeProfitPrice: parsed.data.takeProfitPrice,
          stopLossPrice: parsed.data.stopLossPrice
        });
      }
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        symbol,
        ok: true
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.post("/api/positions/close", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = closePositionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  try {
    const resolved = await resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
    const adapter = createBitgetAdapter(resolved.marketDataAccount);
    try {
      const symbol = normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }
      const preCloseRows = isPaperTradingAccount(resolved.selectedAccount)
        ? await listPaperPositions(resolved.selectedAccount, adapter, symbol)
        : await listPositions(adapter, symbol);
      const exitPriceBySide = new Map<"long" | "short", number>();
      for (const row of preCloseRows) {
        if (normalizeSymbolInput(row.symbol) !== symbol) continue;
        if (!(Number.isFinite(Number(row.size)) && Number(row.size) > 0)) continue;
        if (parsed.data.side && row.side !== parsed.data.side) continue;
        const markPrice = Number(row.markPrice);
        const entryPrice = Number(row.entryPrice);
        const exitPrice =
          Number.isFinite(markPrice) && markPrice > 0
            ? markPrice
            : Number.isFinite(entryPrice) && entryPrice > 0
              ? entryPrice
              : null;
        if (exitPrice !== null && !exitPriceBySide.has(row.side)) {
          exitPriceBySide.set(row.side, exitPrice);
        }
      }
      const orderIds = isPaperTradingAccount(resolved.selectedAccount)
        ? await closePaperPosition(resolved.selectedAccount, adapter, symbol, parsed.data.side)
        : await closePositionsMarket(adapter, symbol, parsed.data.side);
      const stateSync: {
        hasRemainingLivePosition: boolean;
        syncedTradeStates: number;
        closedHistoryRows: number;
        error?: string;
      } = {
        hasRemainingLivePosition: false,
        syncedTradeStates: 0,
        closedHistoryRows: 0
      };
      try {
        const liveRows = isPaperTradingAccount(resolved.selectedAccount)
          ? await listPaperPositions(resolved.selectedAccount, adapter, symbol)
          : await listPositions(adapter, symbol);
        stateSync.hasRemainingLivePosition = liveRows.some((row) => {
          if (normalizeSymbolInput(row.symbol) !== symbol) return false;
          if (!(Number.isFinite(Number(row.size)) && Number(row.size) > 0)) return false;
          if (parsed.data.side && row.side !== parsed.data.side) return false;
          return true;
        });

        if (!stateSync.hasRemainingLivePosition || orderIds.length > 0) {
          const accountIds = Array.from(
            new Set(
              [resolved.selectedAccount.id, parsed.data.exchangeAccountId]
                .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            )
          );
          const botRows = await db.bot.findMany({
            where: {
              userId: user.id,
              exchangeAccountId: { in: accountIds }
            },
            select: { id: true, symbol: true }
          });
          const botIds = botRows
            .filter((row: any) => normalizeSymbolInput(row.symbol) === symbol)
            .map((row: any) => String(row.id))
            .filter((id: string) => id.length > 0);

          if (botIds.length > 0) {
            const stateRowsRaw = await ignoreMissingTable(() => db.botTradeState.findMany({
              where: {
                botId: { in: botIds },
                ...(parsed.data.side ? { openSide: parsed.data.side } : {})
              },
              select: { id: true, symbol: true }
            }));
            const stateRows = Array.isArray(stateRowsRaw) ? stateRowsRaw : [];
            const stateIds = stateRows
              .filter((row: any) => normalizeSymbolInput(row.symbol) === symbol)
              .map((row: any) => String(row.id))
              .filter((id: string) => id.length > 0);
            if (stateIds.length > 0) {
              const clearedState = await ignoreMissingTable(() => db.botTradeState.updateMany({
                where: {
                  id: { in: stateIds }
                },
                data: {
                  openSide: null,
                  openQty: null,
                  openEntryPrice: null,
                  openTs: null,
                  lastTradeTs: new Date()
                }
              }));
              stateSync.syncedTradeStates = Number((clearedState as any)?.count ?? 0);
            }

            const openHistoryRowsRaw = await ignoreMissingTable(() => db.botTradeHistory.findMany({
              where: {
                botId: { in: botIds },
                status: "open",
                ...(parsed.data.side ? { side: parsed.data.side } : {})
              },
              select: {
                id: true,
                symbol: true,
                side: true,
                entryPrice: true,
                entryQty: true,
                entryNotionalUsd: true
              }
            }));
            const openHistoryRows = Array.isArray(openHistoryRowsRaw) ? openHistoryRowsRaw : [];
            const historyRows = openHistoryRows
              .filter((row: any) => normalizeSymbolInput(row.symbol) === symbol)
              .map((row: any) => ({
                id: String(row.id),
                side: String(row.side ?? "").trim().toLowerCase(),
                entryPrice: Number(row.entryPrice),
                entryQty: Number(row.entryQty),
                entryNotionalUsd: Number(row.entryNotionalUsd)
              }))
              .filter((row) => row.id.length > 0);
            if (historyRows.length > 0) {
              const exitTs = new Date();
              const exitOrderId = orderIds.length > 0 ? orderIds[0] : null;
              const updates = historyRows.map((row) => {
                const closeSide: "long" | "short" | null = row.side === "short"
                  ? "short"
                  : row.side === "long"
                    ? "long"
                    : null;
                const exitPrice = closeSide ? (exitPriceBySide.get(closeSide) ?? null) : null;
                const qty = Math.abs(Number(row.entryQty));
                const entryPrice = Number(row.entryPrice);
                const entryNotionalUsd = Number(row.entryNotionalUsd);
                const exitNotionalUsd =
                  exitPrice !== null && Number.isFinite(qty) && qty > 0
                    ? Number((exitPrice * qty).toFixed(8))
                    : null;
                const realizedPnlUsd =
                  exitPrice !== null &&
                  Number.isFinite(entryPrice) &&
                  entryPrice > 0 &&
                  Number.isFinite(qty) &&
                  qty > 0
                    ? Number((
                        closeSide === "short"
                          ? (entryPrice - exitPrice) * qty
                          : (exitPrice - entryPrice) * qty
                      ).toFixed(4))
                    : null;
                const realizedPnlPct =
                  realizedPnlUsd !== null &&
                  Number.isFinite(entryNotionalUsd) &&
                  entryNotionalUsd > 0
                    ? Number(((realizedPnlUsd / entryNotionalUsd) * 100).toFixed(6))
                    : null;
                return db.botTradeHistory.update({
                  where: { id: row.id },
                  data: {
                    status: "closed",
                    outcome: "manual_exit",
                    exitReason: "manual_close",
                    exitTs,
                    exitPrice,
                    exitNotionalUsd,
                    realizedPnlUsd,
                    realizedPnlPct,
                    exitOrderId
                  }
                });
              });
              await ignoreMissingTable(() => db.$transaction(updates));
              stateSync.closedHistoryRows = updates.length;
            }
          }
        }
      } catch (error) {
        stateSync.error = error instanceof Error ? error.message : String(error);
      }
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        closedCount: orderIds.length,
        orderIds,
        stateSync
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.get("/exchange-accounts", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const rows = await db.exchangeAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  const paperIds = rows
    .filter((row: any) => normalizeExchangeValue(String(row.exchange ?? "")) === "paper")
    .map((row: any) => String(row.id));
  const paperBindings = await listPaperMarketDataAccountIds(paperIds);
  const linkedIds = Array.from(
    new Set(
      Object.values(paperBindings)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  );
  const linkedAccounts = linkedIds.length > 0
    ? await db.exchangeAccount.findMany({
        where: {
          userId: user.id,
          id: { in: linkedIds }
        },
        select: {
          id: true,
          exchange: true,
          label: true
        }
      })
    : [];
  const linkedById = new Map<string, { exchange: string; label: string }>(
    linkedAccounts.map((row: any) => [
      row.id,
      { exchange: String(row.exchange ?? ""), label: String(row.label ?? "") }
    ])
  );

  const items = rows.map((row: any) => {
    let apiKeyMasked = "****";
    try {
      apiKeyMasked = maskSecret(decryptSecret(row.apiKeyEnc));
    } catch {
      apiKeyMasked = "****";
    }
    const linkedMarketDataId = paperBindings[row.id] ?? null;
    const linkedMarketData = linkedMarketDataId ? linkedById.get(linkedMarketDataId) ?? null : null;
    return {
      id: row.id,
      exchange: row.exchange,
      label: row.label,
      apiKeyMasked,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt,
      futuresBudget:
        row.futuresBudgetEquity !== null || row.futuresBudgetAvailableMargin !== null
          ? {
              equity: row.futuresBudgetEquity,
              availableMargin: row.futuresBudgetAvailableMargin,
              marginCoin:
                normalizeExchangeValue(String(row.exchange ?? "")) === "hyperliquid"
                  ? "USDC"
                  : "USDT"
            }
          : null,
      lastSyncError:
        row.lastSyncErrorAt || row.lastSyncErrorMessage
          ? {
              at: toIso(row.lastSyncErrorAt),
              message: row.lastSyncErrorMessage ?? null
            }
          : null,
      marketDataExchangeAccountId: linkedMarketDataId,
      marketDataExchange: linkedMarketData?.exchange ?? null,
      marketDataLabel: linkedMarketData?.label ?? null
    };
  });

  return res.json({ items });
});

app.get("/dashboard/overview", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const dayStartUtc = new Date();
  dayStartUtc.setUTCHours(0, 0, 0, 0);

  const [accounts, bots, predictionStates] = await Promise.all([
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        spotBudgetTotal: true,
        spotBudgetAvailable: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        lastSyncErrorAt: true,
        lastSyncErrorMessage: true
      }
    }),
    db.bot.findMany({
      where: {
        userId: user.id,
        exchangeAccountId: { not: null }
      },
      select: {
        id: true,
        exchangeAccountId: true,
        status: true,
        lastError: true,
        runtime: {
          select: {
            updatedAt: true,
            lastHeartbeatAt: true,
            lastTickAt: true,
            lastError: true,
            freeUsdt: true
          }
        }
      }
    }),
    db.predictionState.findMany({
      where: {
        userId: user.id,
        autoScheduleEnabled: true,
        autoSchedulePaused: false
      },
      orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }],
      take: Math.max(200, PREDICTION_REFRESH_SCAN_LIMIT),
      select: {
        accountId: true
      }
    })
  ]);
  const accountIds = accounts
    .map((row: any) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value));
  const botRealizedRows = accountIds.length > 0
    ? await ignoreMissingTable(() => db.botTradeHistory.findMany({
        where: {
          userId: user.id,
          exchangeAccountId: { in: accountIds },
          status: "closed",
          exitTs: { gte: dayStartUtc }
        },
        select: {
          exchangeAccountId: true,
          realizedPnlUsd: true
        }
      }))
    : [];
  const botRealizedByAccount = new Map<string, { pnl: number; count: number }>();
  for (const row of Array.isArray(botRealizedRows) ? botRealizedRows : []) {
    const exchangeAccountId =
      typeof (row as any)?.exchangeAccountId === "string" ? String((row as any).exchangeAccountId) : "";
    if (!exchangeAccountId) continue;
    const pnl = toFiniteNumber((row as any)?.realizedPnlUsd);
    if (pnl === null) continue;
    const current = botRealizedByAccount.get(exchangeAccountId) ?? { pnl: 0, count: 0 };
    current.pnl += pnl;
    current.count += 1;
    botRealizedByAccount.set(exchangeAccountId, current);
  }
  const paperIds = accounts
    .filter((row: any) => normalizeExchangeValue(String(row.exchange ?? "")) === "paper")
    .map((row: any) => String(row.id));
  const paperBindings = await listPaperMarketDataAccountIds(paperIds);
  const accountById = new Map<string, any>(accounts.map((row: any) => [String(row.id), row]));

  const aggregate = new Map<string, {
    running: number;
    stopped: number;
    error: number;
    latestSyncAt: Date | null;
    latestRuntimeAt: Date | null;
    latestRuntimeFreeUsdt: number | null;
    lastErrorMessage: string | null;
  }>();

  for (const account of accounts) {
    aggregate.set(account.id, {
      running: 0,
      stopped: 0,
      error: 0,
      latestSyncAt: null,
      latestRuntimeAt: null,
      latestRuntimeFreeUsdt: null,
      lastErrorMessage: null
    });
  }

  const runningPredictionCounts = new Map<string, number>();

  for (const row of predictionStates) {
    const exchangeAccountId =
      typeof row.accountId === "string" && row.accountId.trim()
        ? row.accountId.trim()
        : null;
    if (!exchangeAccountId) continue;
    runningPredictionCounts.set(
      exchangeAccountId,
      (runningPredictionCounts.get(exchangeAccountId) ?? 0) + 1
    );
  }

  for (const bot of bots) {
    const exchangeAccountId = bot.exchangeAccountId as string | null;
    if (!exchangeAccountId) continue;
    const current = aggregate.get(exchangeAccountId);
    if (!current) continue;

    if (bot.status === "running") current.running += 1;
    else if (bot.status === "error") current.error += 1;
    else current.stopped += 1;

    if (!current.lastErrorMessage) {
      current.lastErrorMessage = bot.lastError ?? bot.runtime?.lastError ?? null;
    }

    const lastSyncAt = resolveLastSyncAt(bot.runtime);
    if (lastSyncAt && (!current.latestSyncAt || lastSyncAt.getTime() > current.latestSyncAt.getTime())) {
      current.latestSyncAt = lastSyncAt;
    }

    const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
    if (runtimeUpdatedAt && (!current.latestRuntimeAt || runtimeUpdatedAt.getTime() > current.latestRuntimeAt.getTime())) {
      current.latestRuntimeAt = runtimeUpdatedAt;
      current.latestRuntimeFreeUsdt =
        typeof bot.runtime?.freeUsdt === "number" ? bot.runtime.freeUsdt : null;
    }
  }

  const overview: ExchangeAccountOverview[] = accounts.map((account) => {
    const row = aggregate.get(account.id);
    const botRealizedToday = botRealizedByAccount.get(account.id) ?? null;
    const exchangePnlToday =
      account.pnlTodayUsd === null || account.pnlTodayUsd === undefined
        ? null
        : toFiniteNumber(account.pnlTodayUsd);
    const pnlTodayUsd = exchangePnlToday !== null
      ? exchangePnlToday
      : botRealizedToday && botRealizedToday.count > 0
        ? Number(botRealizedToday.pnl.toFixed(6))
        : 0;
    const isPaper = normalizeExchangeValue(String(account.exchange ?? "")) === "paper";
    const linkedMarketDataId = isPaper ? (paperBindings[account.id] ?? null) : null;
    const linkedMarketDataAccount = linkedMarketDataId
      ? accountById.get(linkedMarketDataId) ?? null
      : null;
    const linkedMarketDataAggregate = linkedMarketDataId
      ? aggregate.get(linkedMarketDataId) ?? null
      : null;
    const lastSyncAt =
      row?.latestSyncAt
      ?? linkedMarketDataAggregate?.latestSyncAt
      ?? linkedMarketDataAccount?.lastUsedAt
      ?? account.lastUsedAt
      ?? null;
    const hasBotActivity =
      ((row?.running ?? 0) + (row?.error ?? 0)) > 0;
    const status = isPaper
      ? "connected"
      : computeConnectionStatus(lastSyncAt, hasBotActivity);

    return {
      exchangeAccountId: account.id,
      exchange: account.exchange,
      label: account.label,
      status,
      lastSyncAt: toIso(lastSyncAt),
      spotBudget:
        account.spotBudgetTotal !== null || account.spotBudgetAvailable !== null
          ? {
              total: account.spotBudgetTotal,
              available: account.spotBudgetAvailable
            }
          : null,
      futuresBudget: (() => {
        const availableMargin =
          row?.latestRuntimeFreeUsdt !== null && row?.latestRuntimeFreeUsdt !== undefined
            ? row.latestRuntimeFreeUsdt
            : account.futuresBudgetAvailableMargin;
        const equity = account.futuresBudgetEquity;
        if (equity === null && availableMargin === null) return null;
        return {
          equity,
          availableMargin
        };
      })(),
      pnlTodayUsd,
      lastSyncError:
        account.lastSyncErrorAt || account.lastSyncErrorMessage
          ? {
              at: toIso(account.lastSyncErrorAt),
              message: account.lastSyncErrorMessage ?? null
            }
          : null,
      bots: {
        running: row?.running ?? 0,
        stopped: row?.stopped ?? 0,
        error: row?.error ?? 0
      },
      runningPredictions: runningPredictionCounts.get(account.id) ?? 0,
      alerts: {
        hasErrors: (row?.error ?? 0) > 0,
        message: row?.lastErrorMessage ?? null
      }
    };
  });

  const totals = overview.reduce<DashboardOverviewTotals>(
    (acc, row) => {
      const spotTotal = toFiniteNumber(row.spotBudget?.total);
      const futuresEquity = toFiniteNumber(row.futuresBudget?.equity);
      const availableMargin = toFiniteNumber(row.futuresBudget?.availableMargin);
      const pnlToday = toFiniteNumber(row.pnlTodayUsd);

      let contributes = false;

      if (spotTotal !== null) {
        acc.totalEquity += spotTotal;
        contributes = true;
      }
      if (futuresEquity !== null) {
        acc.totalEquity += futuresEquity;
        contributes = true;
      }
      if (availableMargin !== null) {
        acc.totalAvailableMargin += availableMargin;
        contributes = true;
      }
      if (pnlToday !== null) {
        acc.totalTodayPnl += pnlToday;
        contributes = true;
      }
      if (contributes) acc.includedAccounts += 1;

      return acc;
    },
    {
      totalEquity: 0,
      totalAvailableMargin: 0,
      totalTodayPnl: 0,
      currency: "USDT",
      includedAccounts: 0
    }
  );

  const response: DashboardOverviewResponse = {
    accounts: overview,
    totals: {
      ...totals,
      totalEquity: Number(totals.totalEquity.toFixed(6)),
      totalAvailableMargin: Number(totals.totalAvailableMargin.toFixed(6)),
      totalTodayPnl: Number(totals.totalTodayPnl.toFixed(6))
    }
  };

  return res.json(response);
});

app.get("/dashboard/performance", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = dashboardPerformanceQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const range = parsed.data.range as DashboardPerformanceRange;
  const now = new Date();
  const from = new Date(now.getTime() - DASHBOARD_PERFORMANCE_RANGE_MS[range]);
  const rows = await db.dashboardPerformanceSnapshot.findMany({
    where: {
      userId: user.id,
      bucketTs: {
        gte: from,
        lte: now
      }
    },
    orderBy: { bucketTs: "asc" },
    select: {
      bucketTs: true,
      totalEquity: true,
      totalAvailableMargin: true,
      totalTodayPnl: true,
      includedAccounts: true
    }
  });

  const points: DashboardPerformancePoint[] = rows.map((row: any) => ({
    ts: row.bucketTs.toISOString(),
    totalEquity: Number(Number(row.totalEquity ?? 0).toFixed(6)),
    totalAvailableMargin: Number(Number(row.totalAvailableMargin ?? 0).toFixed(6)),
    totalTodayPnl: Number(Number(row.totalTodayPnl ?? 0).toFixed(6)),
    includedAccounts: Math.max(0, Number(row.includedAccounts ?? 0) || 0)
  }));

  return res.json({
    range,
    bucketSeconds: DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS,
    points
  });
});

app.get("/dashboard/risk-analysis", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = dashboardRiskAnalysisQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const [accounts, bots] = await Promise.all([
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        riskProfile: {
          select: {
            dailyLossWarnPct: true,
            dailyLossWarnUsd: true,
            dailyLossCriticalPct: true,
            dailyLossCriticalUsd: true,
            marginWarnPct: true,
            marginWarnUsd: true,
            marginCriticalPct: true,
            marginCriticalUsd: true
          }
        }
      }
    }),
    db.bot.findMany({
      where: {
        userId: user.id,
        exchangeAccountId: {
          not: null
        }
      },
      select: {
        exchangeAccountId: true,
        runtime: {
          select: {
            updatedAt: true
          }
        }
      }
    })
  ]);
  const accountIds = accounts
    .map((row: any) => (typeof row.id === "string" ? String(row.id) : ""))
    .filter(Boolean);
  const botRealizedByAccount = await readBotRealizedPnlTodayByAccount(user.id, accountIds);

  const runtimeUpdatedByAccountId = new Map<string, Date>();
  for (const bot of bots) {
    const exchangeAccountId =
      typeof bot.exchangeAccountId === "string" && bot.exchangeAccountId.trim()
        ? bot.exchangeAccountId.trim()
        : null;
    if (!exchangeAccountId) continue;
    const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
    if (!runtimeUpdatedAt) continue;
    const current = runtimeUpdatedByAccountId.get(exchangeAccountId);
    if (!current || runtimeUpdatedAt.getTime() > current.getTime()) {
      runtimeUpdatedByAccountId.set(exchangeAccountId, runtimeUpdatedAt);
    }
  }

  const rankedItems = (Array.isArray(accounts) ? accounts : []).map((account: any) => {
    const botRealizedToday = botRealizedByAccount.get(String(account.id)) ?? null;
    const effectivePnlTodayUsd = resolveEffectivePnlTodayUsd(account.pnlTodayUsd, botRealizedToday);
    const limits = mergeRiskProfileWithDefaults(account.riskProfile);
    const assessment = computeAccountRiskAssessment(
      {
        ...account,
        pnlTodayUsd: effectivePnlTodayUsd
      },
      limits
    );
    const runtimeUpdatedAt = runtimeUpdatedByAccountId.get(String(account.id)) ?? null;
    const recencyTs = Math.max(
      account.lastUsedAt instanceof Date ? account.lastUsedAt.getTime() : 0,
      runtimeUpdatedAt instanceof Date ? runtimeUpdatedAt.getTime() : 0
    );
    return {
      exchangeAccountId: String(account.id),
      exchange: String(account.exchange ?? ""),
      label: String(account.label ?? ""),
      severity: assessment.severity,
      triggers: assessment.triggers,
      riskScore: assessment.riskScore,
      insufficientData: assessment.insufficientData,
      lossUsd: assessment.lossUsd,
      lossPct: assessment.lossPct,
      marginPct: assessment.marginPct,
      availableMarginUsd: assessment.availableMarginUsd,
      pnlTodayUsd: assessment.pnlTodayUsd,
      lastSyncAt: toIso(account.lastUsedAt),
      runtimeUpdatedAt: toIso(runtimeUpdatedAt),
      _recencyTs: recencyTs
    };
  });

  const summary = rankedItems.reduce(
    (acc, item) => {
      if (item.severity === "critical") acc.critical += 1;
      else if (item.severity === "warning") acc.warning += 1;
      else acc.ok += 1;
      return acc;
    },
    {
      critical: 0,
      warning: 0,
      ok: 0
    }
  );

  rankedItems.sort((a, b) => {
    const severityDiff = riskSeverityRank(b.severity) - riskSeverityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    return b._recencyTs - a._recencyTs;
  });

  return res.json({
    items: rankedItems.slice(0, parsed.data.limit).map((item) => {
      const { _recencyTs: _dropRecencyTs, ...publicItem } = item;
      return publicItem;
    }),
    summary,
    evaluatedAt: new Date().toISOString()
  });
});

app.get("/dashboard/open-positions", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const accounts = await db.exchangeAccount.findMany({
    where: { userId: user.id },
    orderBy: [
      { exchange: "asc" },
      { label: "asc" },
      { createdAt: "asc" }
    ],
    select: {
      id: true,
      exchange: true,
      label: true
    }
  });

  const items: DashboardOpenPositionItem[] = [];
  const failedExchangeAccountIds: string[] = [];

  const results = await Promise.allSettled(
    accounts.map(async (account: any) => {
      const exchangeAccountId = String(account.id);
      const exchange = String(account.exchange ?? "");
      const exchangeLabel = String(account.label ?? "").trim() || exchange.toUpperCase();
      const resolved = await resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      const adapter = createBitgetAdapter(resolved.marketDataAccount);
      try {
        const rows = isPaperTradingAccount(resolved.selectedAccount)
          ? await listPaperPositions(resolved.selectedAccount, adapter)
          : await listPositions(adapter);

        return rows.map((row) => ({
          exchangeAccountId,
          exchange,
          exchangeLabel,
          symbol: String(row.symbol ?? ""),
          side: row.side === "short" ? "short" : "long",
          size: Number(row.size ?? 0),
          entryPrice: toFiniteNumber(row.entryPrice),
          stopLossPrice: toFiniteNumber(row.stopLossPrice),
          takeProfitPrice: toFiniteNumber(row.takeProfitPrice),
          unrealizedPnl: toFiniteNumber(row.unrealizedPnl)
        }));
      } finally {
        await adapter.close();
      }
    })
  );

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const account = accounts[index];
    if (result.status === "fulfilled") {
      for (const item of result.value) {
        if (!(item.symbol.length > 0 && Number.isFinite(item.size) && item.size > 0)) continue;
        items.push(item);
      }
      continue;
    }
    if (account?.id) {
      failedExchangeAccountIds.push(String(account.id));
    }
  }

  items.sort((a, b) => {
    const exchangeDiff = a.exchange.localeCompare(b.exchange);
    if (exchangeDiff !== 0) return exchangeDiff;
    const labelDiff = a.exchangeLabel.localeCompare(b.exchangeLabel);
    if (labelDiff !== 0) return labelDiff;
    const symbolDiff = a.symbol.localeCompare(b.symbol);
    if (symbolDiff !== 0) return symbolDiff;
    return a.side.localeCompare(b.side);
  });

  const exchanges = accounts.map((account: any) => ({
    exchangeAccountId: String(account.id),
    exchange: String(account.exchange ?? ""),
    label: String(account.label ?? "").trim() || String(account.exchange ?? "").toUpperCase()
  }));

  return res.json({
    items,
    exchanges,
    meta: {
      fetchedAt: new Date().toISOString(),
      partialErrors: failedExchangeAccountIds.length,
      failedExchangeAccountIds
    }
  });
});

app.get("/dashboard/alerts", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = dashboardAlertsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const limit = parsed.data.limit;
  const [accounts, bots, circuitEvents] = await Promise.all([
    db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        lastSyncErrorAt: true,
        lastSyncErrorMessage: true
      }
    }),
    db.bot.findMany({
      where: {
        userId: user.id,
        exchangeAccountId: { not: null }
      },
      select: {
        id: true,
        name: true,
        status: true,
        lastError: true,
        updatedAt: true,
        exchangeAccountId: true,
        runtime: {
          select: {
            updatedAt: true,
            lastHeartbeatAt: true,
            lastTickAt: true,
            lastError: true,
            lastErrorAt: true,
            lastErrorMessage: true,
            reason: true,
            freeUsdt: true
          }
        }
      }
    }),
    db.riskEvent.findMany({
      where: {
        type: "CIRCUIT_BREAKER_TRIPPED",
        bot: {
          userId: user.id
        }
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 3, 30),
      select: {
        id: true,
        botId: true,
        createdAt: true,
        message: true,
        meta: true,
        bot: {
          select: {
            id: true,
            name: true,
            exchangeAccountId: true,
            exchangeAccount: {
              select: {
                id: true,
                exchange: true,
                label: true
              }
            }
          }
        }
      }
    })
  ]);

  const accountById = new Map<string, any>(
    accounts.map((row: any) => [String(row.id), row] as const)
  );
  const paperIds = accounts
    .filter((row: any) => normalizeExchangeValue(String(row.exchange ?? "")) === "paper")
    .map((row: any) => String(row.id));
  const paperBindings = await listPaperMarketDataAccountIds(paperIds);
  const aggregate = new Map<string, {
    running: number;
    stopped: number;
    error: number;
    latestSyncAt: Date | null;
    latestRuntimeAt: Date | null;
    latestRuntimeFreeUsdt: number | null;
  }>();

  for (const account of accounts) {
    aggregate.set(account.id, {
      running: 0,
      stopped: 0,
      error: 0,
      latestSyncAt: null,
      latestRuntimeAt: null,
      latestRuntimeFreeUsdt: null
    });
  }

  for (const bot of bots) {
    const exchangeAccountId = bot.exchangeAccountId as string | null;
    if (!exchangeAccountId) continue;
    const current = aggregate.get(exchangeAccountId);
    if (!current) continue;

    if (bot.status === "running") current.running += 1;
    else if (bot.status === "error") current.error += 1;
    else current.stopped += 1;

    const lastSyncAt = resolveLastSyncAt(bot.runtime);
    if (lastSyncAt && (!current.latestSyncAt || lastSyncAt.getTime() > current.latestSyncAt.getTime())) {
      current.latestSyncAt = lastSyncAt;
    }

    const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
    if (runtimeUpdatedAt && (!current.latestRuntimeAt || runtimeUpdatedAt.getTime() > current.latestRuntimeAt.getTime())) {
      current.latestRuntimeAt = runtimeUpdatedAt;
      current.latestRuntimeFreeUsdt =
        typeof bot.runtime?.freeUsdt === "number" ? bot.runtime.freeUsdt : null;
    }
  }

  const now = Date.now();
  const alerts: DashboardAlert[] = [];

  for (const account of accounts) {
    const row = aggregate.get(account.id);
    const isPaper = normalizeExchangeValue(String(account.exchange ?? "")) === "paper";
    const linkedMarketDataId = isPaper ? (paperBindings[account.id] ?? null) : null;
    const linkedMarketDataAccount = linkedMarketDataId
      ? accountById.get(linkedMarketDataId) ?? null
      : null;
    const linkedMarketDataAggregate = linkedMarketDataId
      ? aggregate.get(linkedMarketDataId) ?? null
      : null;
    const lastSyncAt =
      row?.latestSyncAt
      ?? linkedMarketDataAggregate?.latestSyncAt
      ?? linkedMarketDataAccount?.lastUsedAt
      ?? account.lastUsedAt
      ?? null;
    const hasBotActivity = ((row?.running ?? 0) + (row?.error ?? 0)) > 0;
    const status = isPaper
      ? "connected"
      : computeConnectionStatus(lastSyncAt, hasBotActivity);

    if (status === "disconnected") {
      const ts = lastSyncAt ?? new Date(now);
      alerts.push({
        id: createDashboardAlertId(["API_DOWN", account.id, ts.toISOString()]),
        severity: "critical",
        type: "API_DOWN",
        title: `${account.exchange.toUpperCase()} · API disconnected`,
        message: `No healthy sync for account "${account.label}".`,
        exchange: account.exchange,
        exchangeAccountId: account.id,
        ts: ts.toISOString(),
        link: `/settings/exchange-accounts`
      });
    } else if (hasBotActivity && lastSyncAt && now - lastSyncAt.getTime() > DASHBOARD_ALERT_STALE_SYNC_MS) {
      alerts.push({
        id: createDashboardAlertId(["SYNC_FAIL", account.id, String(lastSyncAt.getTime())]),
        severity: "warning",
        type: "SYNC_FAIL",
        title: `${account.exchange.toUpperCase()} · Sync stale`,
        message: `Last successful sync is older than ${Math.round(DASHBOARD_ALERT_STALE_SYNC_MS / 60000)} minutes.`,
        exchange: account.exchange,
        exchangeAccountId: account.id,
        ts: lastSyncAt.toISOString(),
        link: `/settings/exchange-accounts`
      });
    }

    if (account.lastSyncErrorMessage) {
      const ts = account.lastSyncErrorAt ?? lastSyncAt ?? new Date(now);
      alerts.push({
        id: createDashboardAlertId(["SYNC_FAIL", account.id, account.lastSyncErrorMessage, ts.toISOString()]),
        severity: status === "disconnected" ? "critical" : "warning",
        type: "SYNC_FAIL",
        title: `${account.exchange.toUpperCase()} · Sync error`,
        message: account.lastSyncErrorMessage.slice(0, 220),
        exchange: account.exchange,
        exchangeAccountId: account.id,
        ts: ts.toISOString(),
        link: `/settings/exchange-accounts`
      });
    }

    const equity = toFiniteNumber(account.futuresBudgetEquity);
    const availableMargin = toFiniteNumber(
      row?.latestRuntimeFreeUsdt !== null && row?.latestRuntimeFreeUsdt !== undefined
        ? row.latestRuntimeFreeUsdt
        : account.futuresBudgetAvailableMargin
    );

    if (
      equity !== null &&
      equity > 0 &&
      availableMargin !== null &&
      availableMargin >= 0 &&
      availableMargin / equity < DASHBOARD_MARGIN_WARN_RATIO
    ) {
      const ts = row?.latestRuntimeAt ?? lastSyncAt ?? new Date(now);
      const ratioPct = Math.max(0, Math.round((availableMargin / equity) * 100));
      alerts.push({
        id: createDashboardAlertId(["MARGIN_WARN", account.id, String(ts.getTime()), String(ratioPct)]),
        severity: "warning",
        type: "MARGIN_WARN",
        title: `${account.exchange.toUpperCase()} · Low available margin`,
        message: `Available margin is at ${ratioPct}% of equity.`,
        exchange: account.exchange,
        exchangeAccountId: account.id,
        ts: ts.toISOString(),
        link: `/trade?exchangeAccountId=${encodeURIComponent(account.id)}`
      });
    }
  }

  for (const bot of bots) {
    if (bot.status !== "error") continue;
    const accountId = typeof bot.exchangeAccountId === "string" ? bot.exchangeAccountId : null;
    const account = accountId ? (accountById.get(accountId) as any) : null;
    const ts = bot.runtime?.lastErrorAt ?? bot.runtime?.updatedAt ?? bot.updatedAt ?? new Date(now);
    const message =
      bot.runtime?.lastErrorMessage ??
      bot.lastError ??
      bot.runtime?.lastError ??
      `Bot "${bot.name}" reported an execution error.`;
    alerts.push({
      id: createDashboardAlertId(["BOT_ERROR", bot.id, ts.toISOString(), message]),
      severity: "warning",
      type: "BOT_ERROR",
      title: `Bot error · ${bot.name}`,
      message: String(message).slice(0, 220),
      exchange: account?.exchange,
      exchangeAccountId: accountId ?? undefined,
      botId: bot.id,
      ts: ts.toISOString(),
      link: accountId
        ? `/bots?exchangeAccountId=${encodeURIComponent(accountId)}&status=error`
        : `/bots?status=error`
    });
  }

  const circuitAlertByBot = new Map<string, DashboardAlert>();
  for (const event of circuitEvents) {
    if (circuitAlertByBot.has(event.botId)) continue;
    const account = event.bot?.exchangeAccount ?? null;
    const messageFromMeta =
      event.meta && typeof event.meta === "object" && "reason" in (event.meta as any)
        ? String((event.meta as any).reason ?? "")
        : "";
    const message =
      event.message ??
      (messageFromMeta || `Circuit breaker triggered for bot "${event.bot?.name ?? event.botId}".`);
    const alert: DashboardAlert = {
      id: createDashboardAlertId(["CIRCUIT_BREAKER", event.botId, event.createdAt.toISOString()]),
      severity: "critical",
      type: "CIRCUIT_BREAKER",
      title: `Circuit breaker tripped · ${event.bot?.name ?? event.botId}`,
      message: message.slice(0, 220),
      exchange: account?.exchange ?? undefined,
      exchangeAccountId: account?.id ?? undefined,
      botId: event.botId,
      ts: event.createdAt.toISOString(),
      link: account?.id
        ? `/bots?exchangeAccountId=${encodeURIComponent(account.id)}&status=error`
        : `/bots?status=error`
    };
    circuitAlertByBot.set(event.botId, alert);
  }

  for (const alert of circuitAlertByBot.values()) {
    alerts.push(alert);
  }

  const aiPayloadAlert = getAiPayloadBudgetAlertSnapshot();
  if (aiPayloadAlert.highWaterAlert) {
    alerts.push({
      id: createDashboardAlertId([
        "AI_PAYLOAD_BUDGET",
        "high_water",
        String(aiPayloadAlert.highWaterConsecutive),
        String(aiPayloadAlert.lastHighWaterAt ?? "")
      ]),
      severity: "warning",
      type: "AI_PAYLOAD_BUDGET",
      title: "AI payload near budget limit",
      message:
        `AI prompt payload exceeded 90% budget for ${aiPayloadAlert.highWaterConsecutive}` +
        ` consecutive calls (threshold ${aiPayloadAlert.highWaterConsecutiveThreshold}).`,
      ts: aiPayloadAlert.lastHighWaterAt ?? new Date(now).toISOString(),
      link: "/settings/ai-trace"
    });
  }
  if (aiPayloadAlert.trimAlert) {
    alerts.push({
      id: createDashboardAlertId([
        "AI_PAYLOAD_BUDGET",
        "trim_rate",
        String(aiPayloadAlert.trimCountLastHour),
        String(aiPayloadAlert.trimAlertThresholdPerHour)
      ]),
      severity: "critical",
      type: "AI_PAYLOAD_BUDGET",
      title: "AI payload trimming rate high",
      message:
        `Payload trimming happened ${aiPayloadAlert.trimCountLastHour} times in the last hour` +
        ` (threshold ${aiPayloadAlert.trimAlertThresholdPerHour}/h).`,
      ts: new Date(now).toISOString(),
      link: "/settings/ai-trace"
    });
  }

  alerts.sort((a, b) => {
    const severityDiff = alertSeverityRank(b.severity) - alertSeverityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.ts).getTime() - new Date(a.ts).getTime();
  });

  return res.json({
    items: alerts.slice(0, limit)
  });
});

app.post("/exchange-accounts", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = exchangeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const requestedExchange = normalizeExchangeValue(parsed.data.exchange);
  const allowedExchanges = await getAllowedExchangeValues();
  if (!allowedExchanges.includes(requestedExchange)) {
    return res.status(400).json({
      error: "exchange_not_allowed",
      allowed: allowedExchanges
    });
  }

  let marketDataExchangeAccountId: string | null = null;
  if (requestedExchange === "paper") {
    marketDataExchangeAccountId = parsed.data.marketDataExchangeAccountId?.trim() || null;
    if (!marketDataExchangeAccountId) {
      return res.status(400).json({
        error: "paper_market_data_account_required"
      });
    }
    const marketDataAccount = await db.exchangeAccount.findFirst({
      where: {
        id: marketDataExchangeAccountId,
        userId: user.id
      },
      select: {
        id: true,
        exchange: true
      }
    });
    if (!marketDataAccount) {
      return res.status(404).json({ error: "paper_market_data_account_not_found" });
    }
    if (normalizeExchangeValue(marketDataAccount.exchange) === "paper") {
      return res.status(400).json({ error: "paper_market_data_account_invalid" });
    }
  }

  const created = await db.exchangeAccount.create({
    data: {
      userId: user.id,
      exchange: requestedExchange,
      label: parsed.data.label,
      apiKeyEnc: encryptSecret(parsed.data.apiKey?.trim() || `paper_${crypto.randomUUID()}`),
      apiSecretEnc: encryptSecret(parsed.data.apiSecret?.trim() || `paper_${crypto.randomUUID()}`),
      passphraseEnc: requestedExchange === "paper"
        ? null
        : parsed.data.passphrase
          ? encryptSecret(parsed.data.passphrase)
          : null
    }
  });

  if (requestedExchange === "paper" && marketDataExchangeAccountId) {
    await setPaperMarketDataAccountId(created.id, marketDataExchangeAccountId);
  }

  return res.status(201).json({
    id: created.id,
    exchange: created.exchange,
    label: created.label,
    apiKeyMasked: parsed.data.apiKey ? maskSecret(parsed.data.apiKey) : "paper",
    marketDataExchangeAccountId
  });
});

app.delete("/exchange-accounts/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const id = req.params.id;
  const account = await db.exchangeAccount.findFirst({
    where: { id, userId: user.id }
  });
  if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

  const linkedBots = await db.bot.count({
    where: { userId: user.id, exchangeAccountId: id }
  });
  if (linkedBots > 0) {
    return res.status(409).json({ error: "exchange_account_in_use" });
  }

  const paperAccounts = await db.exchangeAccount.findMany({
    where: {
      userId: user.id,
      exchange: "paper"
    },
    select: {
      id: true
    }
  });
  const bindings = await listPaperMarketDataAccountIds(paperAccounts.map((row: any) => row.id));
  const dependentPaperAccountIds = paperAccounts
    .map((row: any) => row.id as string)
    .filter((paperId) => paperId !== id && bindings[paperId] === id);
  if (dependentPaperAccountIds.length > 0) {
    return res.status(409).json({
      error: "exchange_account_in_use_by_paper",
      dependentPaperAccountIds
    });
  }

  await db.exchangeAccount.delete({ where: { id } });
  await clearPaperMarketDataAccountId(id);
  await clearPaperState(id);
  return res.json({ ok: true });
});

app.post("/exchange-accounts/:id/test-connection", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const id = req.params.id;
  const account: ExchangeAccountSecrets | null = await db.exchangeAccount.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      userId: true,
      exchange: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true
    }
  });
  if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

  if (normalizeExchangeValue(account.exchange) === "paper") {
    try {
      const resolved = await resolveMarketDataTradingAccount(user.id, account.id);
      const adapter = createBitgetAdapter(resolved.marketDataAccount);
      try {
        const summary = await getPaperAccountState(resolved.selectedAccount, adapter);
        const synced: Awaited<ReturnType<typeof syncExchangeAccount>> = {
          syncedAt: new Date(),
          spotBudget: null,
          futuresBudget: {
            equity: summary.equity,
            availableMargin: summary.availableMargin,
            marginCoin: "USDT"
          },
          pnlTodayUsd: null,
          details: {
            exchange: "paper",
            endpoint: "paper/simulated"
          }
        };
        await persistExchangeSyncSuccess(account.userId, account.id, synced);
        return res.json({
          ok: true,
          message: "paper_sync_ok",
          syncedAt: synced.syncedAt.toISOString(),
          spotBudget: synced.spotBudget,
          futuresBudget: synced.futuresBudget,
          pnlTodayUsd: synced.pnlTodayUsd,
          details: synced.details
        });
      } finally {
        await adapter.close();
      }
    } catch (error) {
      return sendManualTradingError(res, error);
    }
  }

  try {
    const synced = await executeExchangeSync(account);
    await persistExchangeSyncSuccess(account.userId, account.id, synced);

    return res.json({
      ok: true,
      message: "sync_ok",
      syncedAt: synced.syncedAt.toISOString(),
      spotBudget: synced.spotBudget,
      futuresBudget: synced.futuresBudget,
      pnlTodayUsd: synced.pnlTodayUsd,
      details: synced.details
    });
  } catch (error) {
    await persistExchangeSyncFailure(
      account.id,
      error instanceof ExchangeSyncError
        ? error.message
        : "Manual sync failed due to unexpected error."
    );

    if (error instanceof ExchangeSyncError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code
      });
    }
    return res.status(500).json({
      error: "exchange_sync_failed",
      message: "Unexpected exchange sync failure."
    });
  }
});

app.get("/bots", requireAuth, async (_req, res) => {
  const user = getUserFromLocals(res);
  const bots = await db.bot.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });
  return res.json(bots.map(toSafeBot));
});

app.get("/bots/prediction-sources", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = botPredictionSourcesQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const account = await db.exchangeAccount.findFirst({
    where: {
      id: parsed.data.exchangeAccountId,
      userId: user.id
    },
    select: { id: true }
  });
  if (!account) {
    return res.status(400).json({ error: "exchange_account_not_found" });
  }

  const symbolFilter = parsed.data.symbol ? normalizeSymbolInput(parsed.data.symbol) : null;
  const rows = await db.predictionState.findMany({
    where: {
      userId: user.id,
      accountId: parsed.data.exchangeAccountId,
      autoScheduleEnabled: true,
      autoSchedulePaused: false,
      ...(symbolFilter ? { symbol: symbolFilter } : {}),
      ...(parsed.data.strategyKind ? { strategyKind: parsed.data.strategyKind } : {})
    },
    orderBy: [{ tsUpdated: "desc" }],
    select: {
      id: true,
      symbol: true,
      timeframe: true,
      signalMode: true,
      strategyKind: true,
      strategyId: true,
      signal: true,
      confidence: true,
      tsUpdated: true,
      lastChangeReason: true,
      featuresSnapshot: true
    }
  });

  const items = rows
    .map((row: any) => {
      const snapshot = asRecord(row.featuresSnapshot);
      const signalMode = readStateSignalMode(row.signalMode, snapshot);
      if (parsed.data.signalMode && signalMode !== parsed.data.signalMode) return null;
      const snapshotStrategyRef = readPredictionStrategyRef(snapshot);
      const rowKind = normalizePredictionStrategyKind(row.strategyKind);
      const rowStrategyId = typeof row.strategyId === "string" && row.strategyId.trim()
        ? row.strategyId.trim()
        : null;
      const strategyRef = snapshotStrategyRef ?? (rowKind && rowStrategyId
        ? { kind: rowKind, id: rowStrategyId, name: null }
        : null);
      return {
        stateId: row.id,
        symbol: normalizeSymbolInput(String(row.symbol ?? "")),
        timeframe: String(row.timeframe ?? ""),
        signalMode,
        strategyRef: strategyRef ? `${strategyRef.kind}:${strategyRef.id}` : null,
        strategyKind: strategyRef?.kind ?? null,
        strategyName: strategyRef?.name ?? null,
        lastSignal: String(row.signal ?? "neutral"),
        confidence: Number(row.confidence ?? 0),
        tsUpdated: row.tsUpdated,
        lastChangeReason: row.lastChangeReason ?? null
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return res.json({ items });
});

app.get("/bots/overview", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = botOverviewListQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const bots = await db.bot.findMany({
    where: {
      userId: user.id,
      ...(parsed.data.exchangeAccountId ? { exchangeAccountId: parsed.data.exchangeAccountId } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {})
    },
    orderBy: [{ updatedAt: "desc" }],
    include: {
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          lastError: true,
          lastErrorAt: true,
          mid: true,
          bid: true,
          ask: true
        }
      }
    }
  });

  const botIds = bots.map((bot) => bot.id);
  const dayStartUtc = new Date();
  dayStartUtc.setUTCHours(0, 0, 0, 0);

  const tradeRowsRaw = botIds.length
    ? await ignoreMissingTable(() => db.botTradeState.findMany({
      where: { botId: { in: botIds } },
      select: {
        botId: true,
        symbol: true,
        lastSignal: true,
        lastSignalTs: true,
        lastTradeTs: true,
        dailyTradeCount: true,
        openSide: true,
        openQty: true,
        openEntryPrice: true,
        openTs: true
      }
    }))
    : null;
  const tradeRows: BotTradeStateOverviewRow[] = Array.isArray(tradeRowsRaw)
    ? tradeRowsRaw as BotTradeStateOverviewRow[]
    : [];
  const historyRowsRaw = botIds.length
    ? await ignoreMissingTable(() => db.botTradeHistory.findMany({
      where: { botId: { in: botIds } },
      select: {
        botId: true,
        status: true,
        realizedPnlUsd: true
      }
    }))
    : null;
  const historyRows = Array.isArray(historyRowsRaw) ? historyRowsRaw : [];
  const historyByBot = new Map<string, { realizedPnlTotalUsd: number; openTradesCount: number }>();
  for (const row of historyRows) {
    const current = historyByBot.get(row.botId) ?? { realizedPnlTotalUsd: 0, openTradesCount: 0 };
    const status = String(row.status ?? "").trim().toLowerCase();
    if (status === "open") {
      current.openTradesCount += 1;
    } else if (status === "closed") {
      const realized = Number(row.realizedPnlUsd ?? 0);
      if (Number.isFinite(realized)) {
        current.realizedPnlTotalUsd = Number((current.realizedPnlTotalUsd + realized).toFixed(4));
      }
    }
    historyByBot.set(row.botId, current);
  }
  const realizedEventsRaw = botIds.length
    ? await ignoreMissingTable(() => db.riskEvent.findMany({
      where: {
        botId: { in: botIds },
        type: "PREDICTION_COPIER_TRADE",
        createdAt: { gte: dayStartUtc }
      },
      select: {
        botId: true,
        message: true,
        meta: true
      }
    }))
    : null;
  const realizedEvents = Array.isArray(realizedEventsRaw) ? realizedEventsRaw : [];
  const realizedByBot = new Map<string, number>();
  for (const event of realizedEvents) {
    const next = sumRealizedPnlUsdFromTradeEvents([{ message: event.message, meta: event.meta }]);
    if (!next) continue;
    const current = realizedByBot.get(event.botId) ?? 0;
    realizedByBot.set(event.botId, Number((current + next).toFixed(4)));
  }

  const items = bots.map((bot) => {
    const trade = readBotPrimaryTradeState(tradeRows, bot.id, bot.symbol);
    const markPrice = computeRuntimeMarkPrice({
      mid: bot.runtime?.mid ?? null,
      bid: bot.runtime?.bid ?? null,
      ask: bot.runtime?.ask ?? null
    });
    const openPnlUsd = computeOpenPnlUsd({
      side: trade?.openSide ?? null,
      qty: trade?.openQty ?? null,
      entryPrice: trade?.openEntryPrice ?? null,
      markPrice
    });
    const historyAggregate = historyByBot.get(bot.id) ?? { realizedPnlTotalUsd: 0, openTradesCount: 0 };
    const realizedPnlTodayUsd = realizedByBot.get(bot.id) ?? 0;
    const stoppedWhy = deriveStoppedWhy({
      botStatus: bot.status,
      runtimeReason: bot.runtime?.reason,
      runtimeLastError: bot.runtime?.lastError,
      botLastError: bot.lastError
    });

    return {
      id: bot.id,
      name: bot.name,
      symbol: bot.symbol,
      exchange: bot.exchange,
      exchangeAccountId: bot.exchangeAccountId ?? null,
      status: bot.status,
      exchangeAccount: bot.exchangeAccount
        ? {
            id: bot.exchangeAccount.id,
            exchange: bot.exchangeAccount.exchange,
            label: bot.exchangeAccount.label
          }
        : null,
      runtime: {
        status: bot.runtime?.status ?? null,
        reason: bot.runtime?.reason ?? null,
        updatedAt: bot.runtime?.updatedAt ?? null,
        lastError: bot.runtime?.lastError ?? bot.lastError ?? null,
        lastErrorAt: bot.runtime?.lastErrorAt ?? null,
        mid: bot.runtime?.mid ?? null,
        bid: bot.runtime?.bid ?? null,
        ask: bot.runtime?.ask ?? null
      },
      trade: {
        openSide: trade?.openSide ?? null,
        openQty: trade?.openQty ?? null,
        openEntryPrice: trade?.openEntryPrice ?? null,
        openPnlUsd,
        realizedPnlTodayUsd,
        realizedPnlTotalUsd: historyAggregate.realizedPnlTotalUsd,
        openTradesCount: historyAggregate.openTradesCount,
        openTs: trade?.openTs ?? null,
        dailyTradeCount: trade?.dailyTradeCount ?? 0,
        lastTradeTs: trade?.lastTradeTs ?? null,
        lastSignal: trade?.lastSignal ?? null,
        lastSignalTs: trade?.lastSignalTs ?? null
      },
      stoppedWhy
    };
  });

  return res.json(items);
});

app.get("/bots/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: {
      id: req.params.id,
      userId: user.id
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });

  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  return res.json(toSafeBot(bot));
});

app.get("/bots/:id/overview", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const queryParsed = botOverviewDetailQuerySchema.safeParse(req.query ?? {});
  if (!queryParsed.success) {
    return res.status(400).json({ error: "invalid_query", details: queryParsed.error.flatten() });
  }

  const bot = await db.bot.findFirst({
    where: {
      id: req.params.id,
      userId: user.id
    },
    select: {
      id: true,
      name: true,
      symbol: true,
      exchange: true,
      exchangeAccountId: true,
      status: true,
      lastError: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          lastError: true,
          lastErrorAt: true,
          mid: true,
          bid: true,
          ask: true
        }
      }
    }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const tradeRowsRaw = await ignoreMissingTable(() => db.botTradeState.findMany({
    where: { botId: bot.id },
    select: {
      botId: true,
      symbol: true,
      lastSignal: true,
      lastSignalTs: true,
      lastTradeTs: true,
      dailyTradeCount: true,
      openSide: true,
      openQty: true,
      openEntryPrice: true,
      openTs: true
    }
  }));
  const tradeRows: BotTradeStateOverviewRow[] = Array.isArray(tradeRowsRaw)
    ? tradeRowsRaw as BotTradeStateOverviewRow[]
    : [];
  const trade = readBotPrimaryTradeState(tradeRows, bot.id, bot.symbol);
  const historyRowsRaw = await ignoreMissingTable(() => db.botTradeHistory.findMany({
    where: {
      botId: bot.id
    },
    select: {
      id: true,
      side: true,
      entryTs: true,
      exitTs: true,
      entryPrice: true,
      exitPrice: true,
      realizedPnlUsd: true,
      status: true
    }
  }));
  const historyRows = Array.isArray(historyRowsRaw) ? historyRowsRaw : [];
  const closedHistoryRows = historyRows.filter((row: any) => String(row.status ?? "").toLowerCase() === "closed");
  const openTradesCount = historyRows.filter((row: any) => String(row.status ?? "").toLowerCase() === "open").length;
  const realizedPnlTotalUsd = Number(
    closedHistoryRows.reduce((acc: number, row: any) => {
      const realized = Number(row.realizedPnlUsd ?? 0);
      if (!Number.isFinite(realized)) return acc;
      return acc + realized;
    }, 0).toFixed(4)
  );
  const coreMetrics = computeCoreMetricsFromClosedTrades(
    closedHistoryRows.map((row: any) => ({
      id: String(row.id),
      side: typeof row.side === "string" ? row.side : null,
      entryTs: row.entryTs instanceof Date ? row.entryTs : null,
      exitTs: row.exitTs instanceof Date ? row.exitTs : null,
      entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
      exitPrice: Number.isFinite(Number(row.exitPrice)) ? Number(row.exitPrice) : null,
      realizedPnlUsd: Number.isFinite(Number(row.realizedPnlUsd)) ? Number(row.realizedPnlUsd) : null
    }))
  );

  const recentEventsRaw = await ignoreMissingTable(() => db.riskEvent.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: "desc" },
    take: queryParsed.data.limit
  }));
  const recentEvents = Array.isArray(recentEventsRaw) ? recentEventsRaw : [];
  const lastPredictionConfidence = extractLastDecisionConfidence(
    recentEvents.map((event) => ({ type: event.type, meta: event.meta }))
  );
  const dayStartUtc = new Date();
  dayStartUtc.setUTCHours(0, 0, 0, 0);
  const realizedEventsRaw = await ignoreMissingTable(() => db.riskEvent.findMany({
    where: {
      botId: bot.id,
      type: "PREDICTION_COPIER_TRADE",
      createdAt: { gte: dayStartUtc }
    },
    select: {
      message: true,
      meta: true
    }
  }));
  const realizedEvents = Array.isArray(realizedEventsRaw) ? realizedEventsRaw : [];
  const realizedPnlTodayUsd = sumRealizedPnlUsdFromTradeEvents(
    realizedEvents.map((event) => ({ message: event.message, meta: event.meta }))
  );
  const markPrice = computeRuntimeMarkPrice({
    mid: bot.runtime?.mid ?? null,
    bid: bot.runtime?.bid ?? null,
    ask: bot.runtime?.ask ?? null
  });
  const openPnlUsd = computeOpenPnlUsd({
    side: trade?.openSide ?? null,
    qty: trade?.openQty ?? null,
    entryPrice: trade?.openEntryPrice ?? null,
    markPrice
  });

  const hasOpenQty = Number.isFinite(Number(trade?.openQty ?? NaN)) && Number(trade?.openQty ?? 0) > 0;
  const hasEntryPrice =
    Number.isFinite(Number(trade?.openEntryPrice ?? NaN)) && Number(trade?.openEntryPrice ?? 0) > 0;
  const openNotionalApprox = hasOpenQty && hasEntryPrice
    ? Number((Number(trade?.openQty) * Number(trade?.openEntryPrice)).toFixed(4))
    : null;
  const stoppedWhy = deriveStoppedWhy({
    botStatus: bot.status,
    runtimeReason: bot.runtime?.reason,
    runtimeLastError: bot.runtime?.lastError,
    botLastError: bot.lastError
  });

  return res.json({
    id: bot.id,
    name: bot.name,
    symbol: bot.symbol,
    exchange: bot.exchange,
    exchangeAccountId: bot.exchangeAccountId ?? null,
    status: bot.status,
    exchangeAccount: bot.exchangeAccount
      ? {
          id: bot.exchangeAccount.id,
          exchange: bot.exchangeAccount.exchange,
          label: bot.exchangeAccount.label
        }
      : null,
    runtime: {
      status: bot.runtime?.status ?? null,
      reason: bot.runtime?.reason ?? null,
      updatedAt: bot.runtime?.updatedAt ?? null,
      lastError: bot.runtime?.lastError ?? bot.lastError ?? null,
      lastErrorAt: bot.runtime?.lastErrorAt ?? null,
      mid: bot.runtime?.mid ?? null,
      bid: bot.runtime?.bid ?? null,
      ask: bot.runtime?.ask ?? null
    },
    trade: {
      openSide: trade?.openSide ?? null,
      openQty: trade?.openQty ?? null,
      openEntryPrice: trade?.openEntryPrice ?? null,
      openPnlUsd,
      realizedPnlTodayUsd,
      realizedPnlTotalUsd,
      openTradesCount,
      openTs: trade?.openTs ?? null,
      dailyTradeCount: trade?.dailyTradeCount ?? 0,
      lastTradeTs: trade?.lastTradeTs ?? null,
      lastSignal: trade?.lastSignal ?? null,
      lastSignalTs: trade?.lastSignalTs ?? null
    },
    stoppedWhy,
    opsMetrics: {
      isOpen: Boolean(trade?.openSide && hasOpenQty),
      openNotionalApprox,
      openPnlUsd,
      realizedPnlTodayUsd,
      realizedPnlTotalUsd,
      openTradesCount,
      dailyTradeCount: trade?.dailyTradeCount ?? 0,
      lastTradeTs: trade?.lastTradeTs ?? null,
      lastSignal: trade?.lastSignal ?? null,
      lastSignalTs: trade?.lastSignalTs ?? null,
      lastPredictionConfidence,
      winRatePct: coreMetrics.winRatePct,
      avgWinUsd: coreMetrics.avgWinUsd,
      avgLossUsd: coreMetrics.avgLossUsd,
      profitFactor: coreMetrics.profitFactor,
      netPnlUsd: coreMetrics.netPnlUsd,
      maxDrawdownUsd: coreMetrics.maxDrawdownUsd,
      avgHoldMinutes: coreMetrics.avgHoldMinutes,
      closedTrades: coreMetrics.trades,
      wins: coreMetrics.wins,
      losses: coreMetrics.losses
    },
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message ?? null,
      createdAt: event.createdAt,
      meta: event.meta ?? null
    }))
  });
});

app.get("/bots/:id/trade-history", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const queryParsed = botTradeHistoryQuerySchema.safeParse(req.query ?? {});
  if (!queryParsed.success) {
    return res.status(400).json({ error: "invalid_query", details: queryParsed.error.flatten() });
  }

  const bot = await db.bot.findFirst({
    where: {
      id: req.params.id,
      userId: user.id
    },
    select: {
      id: true
    }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const cursor = decodeTradeHistoryCursor(queryParsed.data.cursor);
  if (queryParsed.data.cursor && !cursor) {
    return res.status(400).json({ error: "invalid_cursor" });
  }

  const fromDate = queryParsed.data.from ? new Date(queryParsed.data.from) : null;
  const toDate = queryParsed.data.to ? new Date(queryParsed.data.to) : null;

  const baseWhere: Record<string, unknown> = {
    botId: bot.id,
    status: "closed",
    ...(queryParsed.data.outcome ? { outcome: queryParsed.data.outcome } : {}),
    ...((fromDate || toDate)
      ? {
          entryTs: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  };
  const whereWithCursor = cursor
    ? {
        ...baseWhere,
        OR: [
          { entryTs: { lt: cursor.entryTs } },
          { entryTs: cursor.entryTs, id: { lt: cursor.id } }
        ]
      }
    : baseWhere;

  const rowsRaw = await ignoreMissingTable(() => db.botTradeHistory.findMany({
    where: whereWithCursor,
    orderBy: [{ entryTs: "desc" }, { id: "desc" }],
    take: queryParsed.data.limit + 1
  }));
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  const hasMore = rows.length > queryParsed.data.limit;
  const selected = hasMore ? rows.slice(0, queryParsed.data.limit) : rows;
  const nextCursor = hasMore
    ? encodeTradeHistoryCursor(selected[selected.length - 1].entryTs, selected[selected.length - 1].id)
    : null;

  const summaryRowsRaw = await ignoreMissingTable(() => db.botTradeHistory.findMany({
    where: baseWhere,
    select: {
      realizedPnlUsd: true,
      status: true
    }
  }));
  const summaryRows = Array.isArray(summaryRowsRaw) ? summaryRowsRaw : [];
  let wins = 0;
  let losses = 0;
  let netPnlUsd = 0;
  let count = 0;
  for (const row of summaryRows) {
    const status = String(row.status ?? "").trim().toLowerCase();
    if (status !== "closed") continue;
    count += 1;
    const realized = Number(row.realizedPnlUsd ?? 0);
    if (!Number.isFinite(realized)) continue;
    netPnlUsd += realized;
    if (realized > 0) wins += 1;
    if (realized < 0) losses += 1;
  }

  return res.json({
    items: selected.map((row) => ({
      id: row.id,
      botId: row.botId,
      userId: row.userId,
      exchangeAccountId: row.exchangeAccountId,
      symbol: row.symbol,
      marketType: row.marketType,
      side: row.side,
      status: row.status,
      entryTs: row.entryTs,
      entryPrice: row.entryPrice,
      entryQty: row.entryQty,
      entryNotionalUsd: row.entryNotionalUsd,
      tpPrice: row.tpPrice,
      slPrice: row.slPrice,
      exitTs: row.exitTs,
      exitPrice: row.exitPrice,
      exitNotionalUsd: row.exitNotionalUsd,
      realizedPnlUsd: row.realizedPnlUsd,
      realizedPnlPct:
        Number.isFinite(Number(row.realizedPnlPct))
          ? Number(row.realizedPnlPct)
          : computeRealizedPnlPct({
              side: row.side,
              entryPrice: row.entryPrice,
              exitPrice: row.exitPrice
            }),
      outcome: (typeof row.outcome === "string" && row.outcome.trim()
        ? row.outcome
        : classifyOutcomeFromClose({ exitReason: row.exitReason })) as BotTradeHistoryOutcome,
      exitReason: row.exitReason,
      entryOrderId: row.entryOrderId,
      exitOrderId: row.exitOrderId,
      predictionStateId: row.predictionStateId,
      predictionHash: row.predictionHash,
      predictionSignal: row.predictionSignal,
      predictionConfidence: row.predictionConfidence,
      predictionTags: Array.isArray(row.predictionTagsJson) ? row.predictionTagsJson : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })),
    nextCursor,
    summary: {
      count,
      wins,
      losses,
      netPnlUsd: Number(netPnlUsd.toFixed(4))
    }
  });
});

app.get("/bots/:id/open-trades", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: {
      id: req.params.id,
      userId: user.id
    },
    select: {
      id: true,
      symbol: true,
      exchangeAccountId: true,
      runtime: {
        select: {
          mid: true,
          bid: true,
          ask: true
        }
      }
    }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const tradeRowsRaw = await ignoreMissingTable(() => db.botTradeState.findMany({
    where: { botId: bot.id },
    select: {
      botId: true,
      symbol: true,
      lastSignal: true,
      lastSignalTs: true,
      lastTradeTs: true,
      dailyTradeCount: true,
      openSide: true,
      openQty: true,
      openEntryPrice: true,
      openTs: true
    }
  }));
  const tradeRows: BotTradeStateOverviewRow[] = Array.isArray(tradeRowsRaw)
    ? tradeRowsRaw as BotTradeStateOverviewRow[]
    : [];
  const trade = readBotPrimaryTradeState(tradeRows, bot.id, bot.symbol);

  const historyOpenRaw = await ignoreMissingTable(() => db.botTradeHistory.findFirst({
    where: {
      botId: bot.id,
      symbol: normalizeSymbolInput(bot.symbol),
      status: "open"
    },
    orderBy: [{ entryTs: "desc" }, { createdAt: "desc" }]
  }));
  const historyOpen =
    historyOpenRaw && typeof historyOpenRaw === "object"
      ? historyOpenRaw as any
      : null;

  const hasStateOpen =
    !!trade?.openSide &&
    Number.isFinite(Number(trade?.openQty ?? NaN)) &&
    Number(trade?.openQty ?? 0) > 0;
  const botPosition = hasStateOpen || historyOpen
    ? {
        side: hasStateOpen ? trade?.openSide ?? null : historyOpen?.side ?? null,
        qty: hasStateOpen ? Number(trade?.openQty ?? 0) : Number(historyOpen?.entryQty ?? 0),
        entryPrice: hasStateOpen
          ? (Number.isFinite(Number(trade?.openEntryPrice)) ? Number(trade?.openEntryPrice) : null)
          : (Number.isFinite(Number(historyOpen?.entryPrice)) ? Number(historyOpen?.entryPrice) : null),
        openTs: hasStateOpen ? trade?.openTs ?? null : historyOpen?.entryTs ?? null,
        tpPrice: historyOpen?.tpPrice ?? null,
        slPrice: historyOpen?.slPrice ?? null,
        historyId: historyOpen?.id ?? null
      }
    : null;

  let exchangePosition: Record<string, unknown> | null = null;
  let exchangeError: string | null = null;
  if (bot.exchangeAccountId) {
    try {
      const resolved = await resolveMarketDataTradingAccount(user.id, bot.exchangeAccountId);
      const adapter = createBitgetAdapter(resolved.marketDataAccount);
      try {
        const liveRows = isPaperTradingAccount(resolved.selectedAccount)
          ? await listPaperPositions(resolved.selectedAccount, adapter, bot.symbol)
          : await listPositions(adapter, bot.symbol);
        const normalizedSymbol = normalizeSymbolInput(bot.symbol);
        const live = liveRows.find((row) => normalizeSymbolInput(row.symbol) === normalizedSymbol) ?? liveRows[0] ?? null;
        if (live) {
          exchangePosition = {
            symbol: live.symbol,
            side: live.side,
            qty: live.size,
            entryPrice: live.entryPrice,
            markPrice: live.markPrice,
            unrealizedPnl: live.unrealizedPnl,
            tpPrice: live.takeProfitPrice,
            slPrice: live.stopLossPrice
          };
        }
      } finally {
        await adapter.close();
      }
    } catch (error) {
      exchangeError = error instanceof Error ? error.message : String(error);
    }
  }

  const markPrice = computeRuntimeMarkPrice({
    mid: bot.runtime?.mid ?? null,
    bid: bot.runtime?.bid ?? null,
    ask: bot.runtime?.ask ?? null
  });
  const mergedSide = String(
    botPosition?.side
    ?? exchangePosition?.side
    ?? ""
  ).toLowerCase();
  const mergedQty =
    [botPosition?.qty, exchangePosition?.qty]
      .map((value) => toFiniteNumber(value))
      .find((value): value is number => value !== null && value > 0)
    ?? null;
  const mergedEntry =
    [botPosition?.entryPrice, exchangePosition?.entryPrice]
      .map((value) => toFiniteNumber(value))
      .find((value): value is number => value !== null && value > 0)
    ?? null;
  const mergedMark =
    [exchangePosition?.markPrice, markPrice]
      .map((value) => toFiniteNumber(value))
      .find((value): value is number => value !== null && value > 0)
    ?? null;
  const exchangeUnrealizedPnl = toFiniteNumber(exchangePosition?.unrealizedPnl);
  const mergedOpenPnl = computeOpenPnlUsd({
    side: mergedSide,
    qty: mergedQty,
    entryPrice: mergedEntry,
    markPrice: mergedMark
  });
  const mergedUnrealizedPnlUsd = exchangeUnrealizedPnl ?? mergedOpenPnl ?? null;

  let consistency: "matched" | "mismatch" | "missing_live" | "live_only" | "none" = "none";
  if (botPosition && exchangePosition) {
    const sideMatches = String(botPosition.side ?? "").toLowerCase() === String(exchangePosition.side ?? "").toLowerCase();
    const qtyDiff = Math.abs(Number(botPosition.qty ?? 0) - Number(exchangePosition.qty ?? 0));
    consistency = sideMatches && qtyDiff <= 1e-10 ? "matched" : "mismatch";
  } else if (botPosition && !exchangePosition) {
    consistency = "missing_live";
  } else if (!botPosition && exchangePosition) {
    consistency = "live_only";
  }

  return res.json({
    botPosition,
    exchangePosition,
    mergedView: mergedQty && mergedEntry
      ? {
          symbol: normalizeSymbolInput(bot.symbol),
          side: mergedSide || null,
          qty: mergedQty,
          entryPrice: mergedEntry,
          markPrice: mergedMark,
          tpPrice: exchangePosition?.tpPrice ?? botPosition?.tpPrice ?? null,
          slPrice: exchangePosition?.slPrice ?? botPosition?.slPrice ?? null,
          unrealizedPnlUsd: mergedUnrealizedPnlUsd,
          openTs: botPosition?.openTs ?? null
        }
      : null,
    consistency,
    exchangeError,
    updatedAt: new Date().toISOString()
  });
});

app.put("/bots/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = botUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const bot = await db.bot.findFirst({
    where: {
      id: req.params.id,
      userId: user.id
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });

  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  if (!bot.futuresConfig) return res.status(409).json({ error: "futures_config_missing" });

  const nextStrategyKey = parsed.data.strategyKey ?? bot.futuresConfig.strategyKey;
  const nextParamsJson = parsed.data.paramsJson ?? (bot.futuresConfig.paramsJson as Record<string, unknown> ?? {});
  let nextSymbol = normalizeSymbolInput(parsed.data.symbol ?? bot.symbol);
  let finalParamsJson = asRecord(nextParamsJson);

  if (nextStrategyKey === "prediction_copier") {
    const { root, nested } = readPredictionCopierRootConfig(nextParamsJson);
    const copierParsed = predictionCopierSettingsSchema.safeParse(root);
    if (!copierParsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: copierParsed.error.flatten() });
    }

    const copierConfig = { ...copierParsed.data };
    const sourceStateId = typeof copierConfig.sourceStateId === "string" ? copierConfig.sourceStateId.trim() : "";
    if (sourceStateId) {
      const sourceState = await findPredictionSourceStateForCopier({
        userId: user.id,
        exchangeAccountId: bot.exchangeAccountId ?? "",
        sourceStateId,
        requireActive: true
      });
      if (!sourceState) {
        return res.status(400).json({ error: "prediction_source_not_found" });
      }
      if (String(sourceState.accountId) !== String(bot.exchangeAccountId ?? "")) {
        return res.status(400).json({ error: "prediction_source_account_mismatch" });
      }
      nextSymbol = normalizeSymbolInput(String(sourceState.symbol ?? nextSymbol));
      copierConfig.sourceSnapshot = readPredictionSourceSnapshotFromState(sourceState);
      copierConfig.timeframe = normalizeCopierTimeframe(sourceState.timeframe) ?? copierConfig.timeframe;
    }
    finalParamsJson = writePredictionCopierRootConfig(nextParamsJson, copierConfig, nested);
  }

  const updated = await db.bot.update({
    where: { id: bot.id },
    data: {
      name: parsed.data.name ?? bot.name,
      symbol: nextSymbol,
      futuresConfig: {
        update: {
          strategyKey: nextStrategyKey,
          marginMode: parsed.data.marginMode ?? bot.futuresConfig.marginMode,
          leverage: parsed.data.leverage ?? bot.futuresConfig.leverage,
          tickMs: parsed.data.tickMs ?? bot.futuresConfig.tickMs,
          paramsJson: finalParamsJson
        }
      }
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          workerId: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          consecutiveErrors: true,
          errorWindowStartAt: true,
          lastErrorAt: true,
          lastErrorMessage: true
        }
      }
    }
  });

  const safe = toSafeBot(updated);
  const restartRequired = bot.status === "running";
  return res.json({
    ...safe,
    restartRequired
  });
});

app.get("/bots/:id/runtime", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const runtime = await db.botRuntime.findUnique({
    where: { botId: req.params.id },
    select: {
      botId: true,
      status: true,
      reason: true,
      updatedAt: true,
      workerId: true,
      lastHeartbeatAt: true,
      lastTickAt: true,
      lastError: true,
      consecutiveErrors: true,
      errorWindowStartAt: true,
      lastErrorAt: true,
      lastErrorMessage: true
    }
  });
  if (!runtime) return res.status(404).json({ error: "runtime_not_found" });
  return res.json(runtime);
});

app.get("/bots/:id/risk-events", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const queryParsed = botRiskEventsQuerySchema.safeParse(req.query ?? {});
  if (!queryParsed.success) {
    return res.status(400).json({ error: "invalid_query", details: queryParsed.error.flatten() });
  }
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const items = await db.riskEvent.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: "desc" },
    take: queryParsed.data.limit
  });
  return res.json({ items });
});

app.post("/bots", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsed = botCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const account = await db.exchangeAccount.findFirst({
    where: {
      id: parsed.data.exchangeAccountId,
      userId: user.id
    }
  });
  if (!account) return res.status(400).json({ error: "exchange_account_not_found" });

  let symbolForCreate = normalizeSymbolInput(parsed.data.symbol);
  let paramsJsonForCreate = asRecord(parsed.data.paramsJson);

  if (parsed.data.strategyKey === "prediction_copier") {
    const { root, nested } = readPredictionCopierRootConfig(parsed.data.paramsJson);
    const copierParsed = predictionCopierSettingsSchema.safeParse(root);
    if (!copierParsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: copierParsed.error.flatten() });
    }
    const copierConfig = { ...copierParsed.data };
    const sourceStateId = typeof copierConfig.sourceStateId === "string" ? copierConfig.sourceStateId.trim() : "";
    if (sourceStateId) {
      const sourceState = await findPredictionSourceStateForCopier({
        userId: user.id,
        exchangeAccountId: account.id,
        sourceStateId,
        requireActive: true
      });
      if (!sourceState) {
        return res.status(400).json({ error: "prediction_source_not_found" });
      }
      symbolForCreate = normalizeSymbolInput(String(sourceState.symbol ?? symbolForCreate));
      copierConfig.sourceSnapshot = readPredictionSourceSnapshotFromState(sourceState);
      copierConfig.timeframe = normalizeCopierTimeframe(sourceState.timeframe) ?? copierConfig.timeframe;
    }
    paramsJsonForCreate = writePredictionCopierRootConfig(parsed.data.paramsJson, copierConfig, nested);
  }

  const bypass = await evaluateAccessSectionBypassForUser(user);
  const botCreateAccess = await canCreateBotForUser({
    userId: user.id,
    bypass
  });
  if (!botCreateAccess.allowed) {
    return res.status(403).json({
      error: "bot_create_limit_exceeded",
      code: "bot_create_limit_exceeded",
      message: "bot_create_limit_exceeded",
      details: {
        limit: botCreateAccess.limit,
        usage: botCreateAccess.usage,
        remaining: botCreateAccess.remaining
      }
    });
  }

  const created = await db.bot.create({
    data: {
      userId: user.id,
      exchangeAccountId: account.id,
      name: parsed.data.name,
      symbol: symbolForCreate,
      exchange: account.exchange,
      status: "stopped",
      lastError: null,
      futuresConfig: {
        create: {
          strategyKey: parsed.data.strategyKey,
          marginMode: parsed.data.marginMode,
          leverage: parsed.data.leverage,
          tickMs: parsed.data.tickMs,
          paramsJson: paramsJsonForCreate
        }
      }
    },
    include: {
      futuresConfig: true,
      exchangeAccount: {
        select: {
          id: true,
          exchange: true,
          label: true
        }
      }
    }
  });

  return res.status(201).json(toSafeBot(created));
});

app.post("/bots/:id/start", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  let bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id },
    include: { futuresConfig: true }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });
  if (!bot.futuresConfig) return res.status(409).json({ error: "futures_config_missing" });
  if (!bot.exchangeAccountId) return res.status(409).json({ error: "exchange_account_missing" });

  if (bot.futuresConfig.strategyKey === "prediction_copier") {
    const { root, nested } = readPredictionCopierRootConfig(bot.futuresConfig.paramsJson);
    const copierParsed = predictionCopierSettingsSchema.safeParse(root);
    if (!copierParsed.success) {
      return res.status(409).json({ error: "prediction_copier_config_invalid" });
    }

    const copierConfig = { ...copierParsed.data };
    let sourceStateId = typeof copierConfig.sourceStateId === "string" ? copierConfig.sourceStateId.trim() : "";
    let sourceState: any | null = null;
    let usedLegacyFallback = false;

    if (sourceStateId) {
      sourceState = await findPredictionSourceStateForCopier({
        userId: user.id,
        exchangeAccountId: bot.exchangeAccountId,
        sourceStateId,
        requireActive: true
      });
    } else {
      const timeframe = normalizeCopierTimeframe(copierConfig.timeframe) ?? "15m";
      sourceState = await findLegacyPredictionSourceForCopier({
        userId: user.id,
        exchangeAccountId: bot.exchangeAccountId,
        symbol: bot.symbol,
        timeframe
      });
      if (sourceState) {
        sourceStateId = sourceState.id;
        usedLegacyFallback = true;
      }
    }

    if (!sourceState || !sourceStateId) {
      return res.status(409).json({ error: "prediction_source_required" });
    }

    const sourceSymbol = normalizeSymbolInput(String(sourceState.symbol ?? bot.symbol));
    const snapshot = readPredictionSourceSnapshotFromState(sourceState);
    copierConfig.sourceStateId = sourceStateId;
    copierConfig.sourceSnapshot = snapshot;
    copierConfig.timeframe = normalizeCopierTimeframe(sourceState.timeframe) ?? copierConfig.timeframe;

    const paramsJson = writePredictionCopierRootConfig(bot.futuresConfig.paramsJson, copierConfig, nested);
    const needsBotUpdate =
      bot.symbol !== sourceSymbol
      || JSON.stringify(paramsJson) !== JSON.stringify(bot.futuresConfig.paramsJson);

    if (needsBotUpdate) {
      bot = await db.bot.update({
        where: { id: bot.id },
        data: {
          symbol: sourceSymbol,
          futuresConfig: {
            update: {
              paramsJson
            }
          }
        },
        include: { futuresConfig: true }
      });
    }

    if (usedLegacyFallback) {
      await ignoreMissingTable(() => db.riskEvent.create({
        data: {
          botId: bot.id,
          type: "legacy_source_fallback",
          message: "sourceStateId auto-migrated on bot start",
          meta: {
            sourceStateId,
            symbol: sourceSymbol
          }
        }
      }));
    }
  }

  const [totalBots, runningBots] = await Promise.all([
    db.bot.count({ where: { userId: user.id } }),
    db.bot.count({ where: { userId: user.id, status: "running" } })
  ]);

  const decision = await enforceBotStartLicense({
    userId: user.id,
    exchange: bot.exchange,
    totalBots,
    runningBots,
    isAlreadyRunning: bot.status === "running"
  });
  if (!decision.allowed) {
    return res.status(403).json({
      error: "license_blocked",
      reason: decision.reason
    });
  }

  const updated = await db.bot.update({
    where: { id: bot.id },
    data: {
      status: "running",
      lastError: null
    }
  });

  await db.botRuntime.upsert({
    where: { botId: bot.id },
    update: {
      status: "running",
      reason: "start_requested",
      lastError: null,
      lastHeartbeatAt: new Date()
    },
    create: {
      botId: bot.id,
      status: "running",
      reason: "start_requested",
      lastError: null,
      lastHeartbeatAt: new Date()
    }
  });

  try {
    await enqueueBotRun(bot.id);
  } catch (error) {
    const reason = `queue_enqueue_failed:${String(error)}`;
    await Promise.allSettled([
      db.bot.update({
        where: { id: bot.id },
        data: {
          status: "error",
          lastError: reason
        }
      }),
      db.botRuntime.upsert({
        where: { botId: bot.id },
        update: {
          status: "error",
          reason,
          lastError: reason,
          lastHeartbeatAt: new Date()
        },
        create: {
          botId: bot.id,
          status: "error",
          reason,
          lastError: reason,
          lastHeartbeatAt: new Date()
        }
      })
    ]);

    return res.status(503).json({
      error: "queue_enqueue_failed",
      reason: String(error)
    });
  }

  return res.json({ id: updated.id, status: updated.status });
});

app.post("/bots/:id/stop", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  const parsedBody = botStopSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ error: "invalid_payload", details: parsedBody.error.flatten() });
  }
  const bot = await db.bot.findFirst({
    where: { id: req.params.id, userId: user.id }
  });
  if (!bot) return res.status(404).json({ error: "bot_not_found" });

  const updated = await db.bot.update({
    where: { id: bot.id },
    data: {
      status: "stopped"
    }
  });

  await db.botRuntime.upsert({
    where: { botId: bot.id },
    update: {
      status: "stopped",
      reason: "stopped_by_user",
      lastHeartbeatAt: new Date()
    },
    create: {
      botId: bot.id,
      status: "stopped",
      reason: "stopped_by_user",
      lastHeartbeatAt: new Date()
    }
  });

  try {
    await cancelBotRun(bot.id);
  } catch {
    // Worker loop also exits on DB status check even if queue cleanup is unavailable.
  }

  const closeRequested = parsedBody.data.closeOpenPosition === true;
  let closeResult: {
    requested: boolean;
    closedCount: number;
    orderIds: string[];
    error?: string;
  } | null = null;

  if (closeRequested) {
    closeResult = {
      requested: true,
      closedCount: 0,
      orderIds: []
    };
    try {
      if (!bot.exchangeAccountId) {
        throw new Error("bot_exchange_account_missing");
      }
      const symbol = normalizeSymbolInput(bot.symbol);
      if (!symbol) {
        throw new Error("bot_symbol_invalid");
      }
      const resolved = await resolveMarketDataTradingAccount(user.id, bot.exchangeAccountId);
      const adapter = createBitgetAdapter(resolved.marketDataAccount);
      try {
        const orderIds = isPaperTradingAccount(resolved.selectedAccount)
          ? await closePaperPosition(resolved.selectedAccount, adapter, symbol)
          : await closePositionsMarket(adapter, symbol);
        closeResult.closedCount = orderIds.length;
        closeResult.orderIds = orderIds;
      } finally {
        await adapter.close();
      }
    } catch (error) {
      closeResult.error = error instanceof Error ? error.message : String(error);
    }
  }

  return res.json({
    id: updated.id,
    status: updated.status,
    ...(closeResult ? { positionClose: closeResult } : {})
  });
});

async function deleteBotForUser(userId: string, botId: string): Promise<{ deletedBotId: string }> {
  const bot = await db.bot.findFirst({
    where: { id: botId, userId },
    select: { id: true }
  });
  if (!bot) {
    throw new ManualTradingError("bot_not_found", 404, "bot_not_found");
  }

  try {
    await cancelBotRun(bot.id);
  } catch {
    // Worker loop also exits on DB status lookup, queue cleanup is best-effort only.
  }

  // Best-effort cleanup without one shared SQL transaction.
  // Reason: older VPS schemas may miss some tables; in a single transaction
  // one failing statement aborts the whole transaction (Postgres 25P02).
  await ignoreMissingTable(() => db.botMetric.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botAlert.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.riskEvent.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botRuntime.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botTradeState.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botTradeHistory.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.futuresBotConfig.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.marketMakingConfig.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.volumeConfig.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.riskConfig.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botNotificationConfig.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botPriceSupportConfig.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botFillCursor.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botFillSeen.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.botOrderMap.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.manualTradeLog.deleteMany({ where: { botId: bot.id } }));
  await ignoreMissingTable(() => db.prediction.updateMany({
    where: { botId: bot.id },
    data: { botId: null }
  }));
  await ignoreMissingTable(() => db.bot.delete({ where: { id: bot.id } }));

  return { deletedBotId: bot.id };
}

app.post("/bots/:id/delete", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const out = await deleteBotForUser(user.id, req.params.id);
    return res.json({ ok: true, ...out });
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

app.delete("/bots/:id", requireAuth, async (req, res) => {
  const user = getUserFromLocals(res);
  try {
    const out = await deleteBotForUser(user.id, req.params.id);
    return res.json({ ok: true, ...out });
  } catch (error) {
    return sendManualTradingError(res, error);
  }
});

function wsSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as any).code ?? "") : "";
  const message = "message" in error ? String((error as any).message ?? "") : String(error);
  if (code === "P2021") return true;
  return /table .* does not exist/i.test(message) || /relation .* does not exist/i.test(message);
}

async function ignoreMissingTable<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

function coerceFirstItem(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (payload && typeof payload === "object") {
    const list = (payload as Record<string, unknown>).list;
    if (Array.isArray(list)) return list[0] ?? null;
  }
  return payload;
}

async function handleMarketWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");
  const requestedSymbol = url.searchParams.get("symbol");

  let context: MarketWsContext | null = null;
  let cleaned = false;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (context) await context.stop();
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const resolved = await createMarketWsContext(
      user.id,
      exchangeAccountId ?? settings.exchangeAccountId
    );
    context = resolved.ctx;

    const contracts = context.adapter.contractCache.snapshot();
    const symbol = pickWsSymbol(
      requestedSymbol ?? settings.symbol,
      contracts.map((row) => ({
        canonicalSymbol: row.canonicalSymbol,
        apiAllowed: row.apiAllowed
      }))
    );
    if (!symbol) {
      throw new ManualTradingError("no_symbols_available", 404, "no_symbols_available");
    }

    await saveTradingSettings(user.id, {
      exchangeAccountId: resolved.accountId,
      symbol
    });

    unsubs.push(
      context.adapter.onTicker((payload) => {
        const row = coerceFirstItem(extractWsDataArray(payload));
        const normalized = normalizeTickerPayload(row);
        wsSend(socket, {
          type: "ticker",
          symbol,
          data: {
            ...normalized,
            symbol
          }
        });
      })
    );
    unsubs.push(
      context.adapter.onDepth((payload) => {
        const row = coerceFirstItem(extractWsDataArray(payload));
        const normalized = normalizeOrderBookPayload(row);
        wsSend(socket, {
          type: "orderbook",
          symbol,
          data: normalized
        });
      })
    );
    unsubs.push(
      (context.adapter as any).onTrades((payload: unknown) => {
        const rows = extractWsDataArray(payload);
        const normalized = normalizeTradesPayload(rows).map((trade) => ({
          ...trade,
          symbol: symbol
        }));
        wsSend(socket, {
          type: "trades",
          symbol,
          data: normalized
        });
      })
    );

    await Promise.all([
      context.adapter.subscribeTicker(symbol),
      context.adapter.subscribeDepth(symbol),
      (context.adapter as any).subscribeTrades(symbol)
    ]);

    const exchangeSymbol = await context.adapter.toExchangeSymbol(symbol);

    const [tickerSnapshot, depthSnapshot, tradesSnapshot] = await Promise.allSettled([
      context.adapter.marketApi.getTicker(exchangeSymbol, context.adapter.productType),
      context.adapter.marketApi.getDepth(exchangeSymbol, 50, context.adapter.productType),
      context.adapter.marketApi.getTrades(exchangeSymbol, 60, context.adapter.productType)
    ]);

    if (tickerSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:ticker",
        symbol,
        data: {
          ...normalizeTickerPayload(coerceFirstItem(tickerSnapshot.value)),
          symbol
        }
      });
    }

    if (depthSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:orderbook",
        symbol,
        data: normalizeOrderBookPayload(depthSnapshot.value)
      });
    }

    if (tradesSnapshot.status === "fulfilled") {
      wsSend(socket, {
        type: "snapshot:trades",
        symbol,
        data: normalizeTradesPayload(tradesSnapshot.value).map((trade) => ({
          ...trade,
          symbol
        }))
      });
    }

    wsSend(socket, {
      type: "ready",
      exchangeAccountId: resolved.accountId,
      symbol
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "market_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });

  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

async function handleUserWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");

  let context: MarketWsContext | null = null;
  let cleaned = false;
  let balanceTimer: NodeJS.Timeout | null = null;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (balanceTimer) clearInterval(balanceTimer);
    if (context) await context.stop();
    balanceTimer = null;
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const resolved = await createMarketWsContext(
      user.id,
      exchangeAccountId ?? settings.exchangeAccountId
    );
    context = resolved.ctx;
    const paperMode = isPaperTradingAccount(context.selectedAccount);

    await saveTradingSettings(user.id, {
      exchangeAccountId: resolved.accountId
    });

    if (!paperMode) {
      unsubs.push(
        context.adapter.onFill((event) => {
          wsSend(socket, {
            type: "fill",
            data: event
          });
        })
      );
      unsubs.push(
        context.adapter.onOrderUpdate((event) => {
          wsSend(socket, {
            type: "order",
            data: event
          });
        })
      );
      unsubs.push(
        context.adapter.onPositionUpdate((event) => {
          wsSend(socket, {
            type: "position",
            data: event
          });
        })
      );
    }

    const sendSummary = async () => {
      if (!context) return;
      const [accountSummary, positions, openOrders] = paperMode
        ? await Promise.all([
            getPaperAccountState(context.selectedAccount, context.adapter),
            listPaperPositions(context.selectedAccount, context.adapter),
            listPaperOpenOrders(context.selectedAccount, context.adapter)
          ])
        : await Promise.all([
            context.adapter.getAccountState(),
            listPositions(context.adapter),
            listOpenOrders(context.adapter)
          ]);
      wsSend(socket, {
        type: "account",
        data: {
          exchangeAccountId: resolved.accountId,
          equity: accountSummary.equity ?? null,
          availableMargin: accountSummary.availableMargin ?? null,
          positions,
          openOrders
        }
      });
    };

    await sendSummary();
    balanceTimer = setInterval(() => {
      void sendSummary().catch(() => {
        // ignore timer errors
      });
    }, 10_000);

    wsSend(socket, {
      type: "ready",
      exchangeAccountId: resolved.accountId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "user_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });
  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

const marketWss = new WebSocketServer({ noServer: true });
const userWss = new WebSocketServer({ noServer: true });

const port = Number(process.env.API_PORT ?? "4000");
const listenHost = process.env.API_HOST?.trim() || "::";
const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (url.pathname !== "/ws/market" && url.pathname !== "/ws/user") {
    wsReject(socket, 404, "Not Found");
    return;
  }

  void (async () => {
    const user = await authenticateWsUser(req);
    if (!user) {
      wsReject(socket, 401, "Unauthorized");
      return;
    }

    if (url.pathname === "/ws/market") {
      marketWss.handleUpgrade(req, socket, head, (ws) => {
        void handleMarketWsConnection(ws, user, url);
      });
      return;
    }

    userWss.handleUpgrade(req, socket, head, (ws) => {
      void handleUserWsConnection(ws, user, url);
    });
  })().catch(() => {
    wsReject(socket, 500, "Internal Server Error");
  });
});

async function startApiServer() {
  try {
    await ensureAdminUserSeed();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[admin] seed failed", String(error));
  }

  server.listen(
    {
      port,
      host: listenHost,
      ipv6Only: false
    },
    () => {
    // eslint-disable-next-line no-console
      console.log(`[api] listening on ${listenHost}:${port}`);
    startExchangeAutoSyncScheduler();
    startFeatureThresholdCalibrationScheduler();
    startPredictionAutoScheduler();
    startPredictionOutcomeEvalScheduler();
    startPredictionPerformanceEvalScheduler();
    startBotQueueRecoveryScheduler();
    economicCalendarRefreshJob.start();
    }
  );
}

void startApiServer();

process.on("SIGTERM", () => {
  stopExchangeAutoSyncScheduler();
  stopFeatureThresholdCalibrationScheduler();
  stopPredictionAutoScheduler();
  stopPredictionOutcomeEvalScheduler();
  stopPredictionPerformanceEvalScheduler();
  stopBotQueueRecoveryScheduler();
  economicCalendarRefreshJob.stop();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});

process.on("SIGINT", () => {
  stopExchangeAutoSyncScheduler();
  stopFeatureThresholdCalibrationScheduler();
  stopPredictionAutoScheduler();
  stopPredictionOutcomeEvalScheduler();
  stopPredictionPerformanceEvalScheduler();
  stopBotQueueRecoveryScheduler();
  economicCalendarRefreshJob.stop();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});
