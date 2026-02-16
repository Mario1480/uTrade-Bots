import { prisma } from "@mm/db";
import { logger } from "../logger.js";

export const AI_PROMPT_SETTINGS_GLOBAL_SETTING_KEY = "admin.aiPrompts";

export const AI_PROMPT_INDICATOR_OPTIONS = [
  {
    key: "rsi",
    label: "RSI (14)",
    group: "Core",
    description: "Momentum oscillator (overbought/oversold).",
    paths: ["rsi", "indicators.rsi_14"]
  },
  {
    key: "macd",
    label: "MACD",
    group: "Core",
    description: "Trend momentum via line/signal/hist.",
    paths: ["indicators.macd"]
  },
  {
    key: "adx",
    label: "ADX + DI",
    group: "Core",
    description: "Trend strength and directional movement.",
    paths: ["indicators.adx"]
  },
  {
    key: "bollinger",
    label: "Bollinger Bands",
    group: "Core",
    description: "Volatility bands and band position.",
    paths: ["indicators.bb"]
  },
  {
    key: "atr_pct",
    label: "ATR%",
    group: "Core",
    description: "Normalized volatility proxy.",
    paths: ["atrPct", "indicators.atr_pct"]
  },
  {
    key: "vwap",
    label: "VWAP",
    group: "Core",
    description: "Price anchor and distance to VWAP.",
    paths: ["indicators.vwap"]
  },
  {
    key: "stochrsi",
    label: "Stoch RSI",
    group: "Core",
    description: "Momentum oscillator using RSI range position.",
    paths: ["indicators.stochrsi"]
  },
  {
    key: "volume",
    label: "Volume Features",
    group: "Core",
    description: "Relative volume, z-score and volume trend.",
    paths: ["indicators.volume"]
  },
  {
    key: "fvg",
    label: "FVG Summary",
    group: "Core",
    description: "Open gap counts and nearest gap distances.",
    paths: ["indicators.fvg"]
  },
  {
    key: "history_context",
    label: "History Context Pack",
    group: "Context",
    description: "Derived multi-horizon context (windows, events, anchors, last bars).",
    paths: ["historyContext"]
  },
  {
    key: "emas_cloud",
    label: "EMAs + Cloud",
    group: "Advanced",
    description: "EMA stack/spreads and cloud position.",
    paths: [
      "advancedIndicators.emas",
      "advancedIndicators.cloud",
      "tradersReality.emas",
      "tradersReality.cloud"
    ]
  },
  {
    key: "levels",
    label: "Levels (D/W/M)",
    group: "Advanced",
    description: "Daily/weekly/monthly level context.",
    paths: ["advancedIndicators.levels", "tradersReality.levels"]
  },
  {
    key: "ranges",
    label: "Ranges (ADR/AWR/AMR/RD/RW)",
    group: "Advanced",
    description: "Range envelopes and distance context.",
    paths: ["advancedIndicators.ranges", "tradersReality.ranges"]
  },
  {
    key: "sessions",
    label: "Sessions",
    group: "Advanced",
    description: "Session state and opening range context.",
    paths: ["advancedIndicators.sessions", "tradersReality.sessions"]
  },
  {
    key: "pvsra",
    label: "PVSRA",
    group: "Advanced",
    description: "Volume/price vector tier and pattern context.",
    paths: ["advancedIndicators.pvsra", "tradersReality.pvsra"]
  },
  {
    key: "smc",
    label: "Smart Money Concepts (SMC)",
    group: "Advanced",
    description: "Structure, order blocks, equal highs/lows, zones.",
    paths: [
      "advancedIndicators.smartMoneyConcepts",
      "tradersReality.smartMoneyConcepts"
    ]
  }
] as const;

export type AiPromptIndicatorKey =
  (typeof AI_PROMPT_INDICATOR_OPTIONS)[number]["key"];

export type AiPromptIndicatorOptionPublic = {
  key: AiPromptIndicatorKey;
  label: string;
  group: string;
  description: string;
};

export type AiPromptTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type AiPromptDirectionPreference = "long" | "short" | "either";

export type AiPromptTemplate = {
  id: string;
  name: string;
  promptText: string;
  indicatorKeys: AiPromptIndicatorKey[];
  ohlcvBars: number;
  timeframe: AiPromptTimeframe | null;
  directionPreference: AiPromptDirectionPreference;
  confidenceTargetPct: number;
  marketAnalysisUpdateEnabled: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiPromptSettingsStored = {
  activePromptId: string | null;
  prompts: AiPromptTemplate[];
};

export type AiPromptScopeContext = {
  exchange?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
};

export type AiPromptRuntimeSettings = {
  promptText: string;
  indicatorKeys: AiPromptIndicatorKey[];
  ohlcvBars: number;
  timeframe: AiPromptTimeframe | null;
  directionPreference: AiPromptDirectionPreference;
  confidenceTargetPct: number;
  marketAnalysisUpdateEnabled: boolean;
  source: "default" | "db";
  activePromptId: string | null;
  activePromptName: string | null;
  selectedFrom: "active_prompt" | "default";
  matchedScopeType: null;
  matchedOverrideId: null;
};

const AI_PROMPT_CONTEXT_BASE_KEYS = new Set<string>([
  "meta",
  "tags",
  "newsRisk",
  "newsBlackout",
  "riskFlags",
  "positionSizeHint",
  "requestedLeverage",
  "directionPreference",
  "confidenceTargetPct",
  "autoScheduleEnabled",
  "autoSchedulePaused",
  "signalMode",
  "selectedSignalSource",
  "prefillExchange",
  "prefillExchangeAccountId",
  "suggestedEntryType",
  "suggestedEntryPrice",
  "suggestedStopLoss",
  "suggestedTakeProfit",
  "thresholdSource",
  "thresholdVersion",
  "thresholdComputedAt",
  "thresholdWindowFrom",
  "thresholdWindowTo",
  "thresholdBars",
  "ohlcvSeries",
  "historyContext",
  "qualitySampleSize",
  "qualityWinRatePct",
  "qualityTpCount",
  "qualitySlCount",
  "qualityExpiredCount",
  "qualityAvgOutcomePnlPct",
  "aiPromptTemplateRequestedId",
  "aiPromptTemplateId",
  "aiPromptTemplateName",
  "aiPromptLicenseMode",
  "aiPromptLicenseWouldBlock"
]);

function shouldPreservePromptContextKey(key: string): boolean {
  if (AI_PROMPT_CONTEXT_BASE_KEYS.has(key)) return true;
  if (key.startsWith("aiPrompt")) return true;
  return false;
}

const db = prisma as any;

const indicatorKeySet = new Set<AiPromptIndicatorKey>(
  AI_PROMPT_INDICATOR_OPTIONS.map((option) => option.key)
);

const defaultIndicatorKeys = AI_PROMPT_INDICATOR_OPTIONS.map(
  (option) => option.key
) as AiPromptIndicatorKey[];
const DEFAULT_PROMPT_OHLCV_BARS = 100;
const MIN_PROMPT_OHLCV_BARS = 20;
const MAX_PROMPT_OHLCV_BARS = 500;
const DEFAULT_PROMPT_DIRECTION_PREFERENCE: AiPromptDirectionPreference = "either";
const DEFAULT_PROMPT_CONFIDENCE_TARGET_PCT = 60;

const cacheTtlMs =
  Math.max(5, Number(process.env.AI_PROMPT_SETTINGS_CACHE_TTL_SEC ?? "30")) *
  1000;

export const DEFAULT_AI_PROMPT_SETTINGS: AiPromptSettingsStored = {
  activePromptId: "default_core",
  prompts: [
    {
      id: "default_core",
      name: "Default",
      promptText: "",
      indicatorKeys: [...defaultIndicatorKeys],
      ohlcvBars: DEFAULT_PROMPT_OHLCV_BARS,
      timeframe: null,
      directionPreference: DEFAULT_PROMPT_DIRECTION_PREFERENCE,
      confidenceTargetPct: DEFAULT_PROMPT_CONFIDENCE_TARGET_PCT,
      marketAnalysisUpdateEnabled: false,
      isPublic: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }
  ]
};

type CachedStoredSettings = {
  settings: AiPromptSettingsStored;
  source: "default" | "db";
};

let settingsCacheUntil = 0;
let settingsCacheValue: CachedStoredSettings | null = null;
let settingsInFlight: Promise<CachedStoredSettings> | null = null;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sanitizePromptText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4000) return trimmed;
  return trimmed.slice(0, 4000).trimEnd();
}

function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed.length <= 64) return trimmed;
  return trimmed.slice(0, 64).trimEnd();
}

function normalizeIndicatorKeys(raw: unknown): AiPromptIndicatorKey[] {
  if (!Array.isArray(raw)) return [...defaultIndicatorKeys];
  const deduped: AiPromptIndicatorKey[] = [];
  const seen = new Set<AiPromptIndicatorKey>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim() as AiPromptIndicatorKey;
    if (!indicatorKeySet.has(key) || seen.has(key)) continue;
    seen.add(key);
    deduped.push(key);
  }
  return deduped;
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseDateIso(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function normalizeTimeframe(value: unknown): AiPromptTimeframe | null {
  if (typeof value !== "string") return null;
  if (
    value === "5m"
    || value === "15m"
    || value === "1h"
    || value === "4h"
    || value === "1d"
  ) {
    return value;
  }
  return null;
}

function normalizeDirectionPreference(
  value: unknown,
  fallback: AiPromptDirectionPreference
): AiPromptDirectionPreference {
  if (value === "long" || value === "short" || value === "either") return value;
  return fallback;
}

function normalizeConfidenceTarget(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeOhlcvBars(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_PROMPT_OHLCV_BARS, Math.min(MAX_PROMPT_OHLCV_BARS, Math.trunc(parsed)));
}

function parseTemplate(value: unknown, index: number): AiPromptTemplate | null {
  const objectValue = asObject(value);
  if (!objectValue) return null;

  const nowIso = new Date().toISOString();
  const idRaw = typeof objectValue.id === "string" ? objectValue.id.trim() : "";
  const id = idRaw || `prompt_${index}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    name: sanitizeName(objectValue.name, `Prompt ${index + 1}`),
    promptText: sanitizePromptText(objectValue.promptText),
    indicatorKeys: normalizeIndicatorKeys(objectValue.indicatorKeys),
    ohlcvBars: normalizeOhlcvBars(objectValue.ohlcvBars, DEFAULT_PROMPT_OHLCV_BARS),
    timeframe: normalizeTimeframe(objectValue.timeframe),
    directionPreference: normalizeDirectionPreference(
      objectValue.directionPreference,
      DEFAULT_PROMPT_DIRECTION_PREFERENCE
    ),
    confidenceTargetPct: normalizeConfidenceTarget(
      objectValue.confidenceTargetPct,
      DEFAULT_PROMPT_CONFIDENCE_TARGET_PCT
    ),
    marketAnalysisUpdateEnabled: normalizeBool(
      objectValue.marketAnalysisUpdateEnabled,
      false
    ),
    isPublic: normalizeBool(objectValue.isPublic, false),
    createdAt: parseDateIso(objectValue.createdAt, nowIso),
    updatedAt: parseDateIso(objectValue.updatedAt, nowIso)
  };
}

function dedupeTemplates(value: AiPromptTemplate[]): AiPromptTemplate[] {
  const seen = new Set<string>();
  const out: AiPromptTemplate[] = [];
  for (const item of value) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function cloneStoredSettings(value: AiPromptSettingsStored): AiPromptSettingsStored {
  return {
    activePromptId: value.activePromptId,
    prompts: value.prompts.map((item) => ({
      id: item.id,
      name: item.name,
      promptText: item.promptText,
      indicatorKeys: [...item.indicatorKeys],
      ohlcvBars: item.ohlcvBars,
      timeframe: item.timeframe,
      directionPreference: item.directionPreference,
      confidenceTargetPct: item.confidenceTargetPct,
      marketAnalysisUpdateEnabled: item.marketAnalysisUpdateEnabled,
      isPublic: item.isPublic,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  };
}

function deepClone(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    out[key] = deepClone(entry);
  }
  return out;
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = source;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = deepClone(value);
}

async function loadStoredSettingsFromDb(): Promise<CachedStoredSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: AI_PROMPT_SETTINGS_GLOBAL_SETTING_KEY },
    select: { value: true }
  });
  if (!row) {
    return {
      settings: cloneStoredSettings(DEFAULT_AI_PROMPT_SETTINGS),
      source: "default"
    };
  }

  return {
    settings: parseStoredAiPromptSettings(row.value),
    source: "db"
  };
}

export function invalidateAiPromptSettingsCache() {
  settingsCacheUntil = 0;
  settingsCacheValue = null;
  settingsInFlight = null;
}

async function getCachedStoredSettings(): Promise<CachedStoredSettings> {
  const now = Date.now();
  if (settingsCacheValue && now < settingsCacheUntil) {
    return settingsCacheValue;
  }

  if (!settingsInFlight) {
    settingsInFlight = (async () => {
      try {
        return await loadStoredSettingsFromDb();
      } catch (error) {
        logger.warn("ai_prompt_settings_load_failed", {
          reason: String(error)
        });
        return {
          settings: cloneStoredSettings(DEFAULT_AI_PROMPT_SETTINGS),
          source: "default" as const
        };
      } finally {
        settingsInFlight = null;
      }
    })();
  }

  settingsCacheValue = await settingsInFlight;
  settingsCacheUntil = Date.now() + cacheTtlMs;
  return settingsCacheValue;
}

export function resolveAiPromptRuntimeSettingsForContext(
  settings: AiPromptSettingsStored,
  _context: AiPromptScopeContext,
  source: "default" | "db"
): AiPromptRuntimeSettings {
  const active =
    settings.prompts.find((item) => item.id === settings.activePromptId) ??
    settings.prompts[0] ??
    DEFAULT_AI_PROMPT_SETTINGS.prompts[0];

  const selectedFrom =
    settings.prompts.length > 0 ? "active_prompt" : "default";

  return {
    promptText: active.promptText,
    indicatorKeys: [...active.indicatorKeys],
    ohlcvBars: active.ohlcvBars,
    timeframe: active.timeframe,
    directionPreference: active.directionPreference,
    confidenceTargetPct: active.confidenceTargetPct,
    marketAnalysisUpdateEnabled: active.marketAnalysisUpdateEnabled,
    source,
    activePromptId: active.id,
    activePromptName: active.name,
    selectedFrom,
    matchedScopeType: null,
    matchedOverrideId: null
  };
}

function toRuntimeFromTemplate(
  template: AiPromptTemplate,
  source: "default" | "db"
): AiPromptRuntimeSettings {
  return {
    promptText: template.promptText,
    indicatorKeys: [...template.indicatorKeys],
    ohlcvBars: template.ohlcvBars,
    timeframe: template.timeframe,
    directionPreference: template.directionPreference,
    confidenceTargetPct: template.confidenceTargetPct,
    marketAnalysisUpdateEnabled: template.marketAnalysisUpdateEnabled,
    source,
    activePromptId: template.id,
    activePromptName: template.name,
    selectedFrom: "active_prompt",
    matchedScopeType: null,
    matchedOverrideId: null
  };
}

function normalizeTemplateId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getAiPromptTemplateByIdFromSettings(
  settings: AiPromptSettingsStored,
  templateId: string | null | undefined,
  options: {
    requirePublic?: boolean;
  } = {}
): AiPromptTemplate | null {
  const normalizedId = normalizeTemplateId(templateId);
  if (!normalizedId) return null;
  const found = settings.prompts.find((item) => item.id === normalizedId) ?? null;
  if (!found) return null;
  if (options.requirePublic && !found.isPublic) return null;
  return {
    id: found.id,
    name: found.name,
    promptText: found.promptText,
    indicatorKeys: [...found.indicatorKeys],
    ohlcvBars: found.ohlcvBars,
    timeframe: found.timeframe,
    directionPreference: found.directionPreference,
    confidenceTargetPct: found.confidenceTargetPct,
    marketAnalysisUpdateEnabled: found.marketAnalysisUpdateEnabled,
    isPublic: found.isPublic,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt
  };
}

export function resolveAiPromptRuntimeSettingsForTemplateId(
  settings: AiPromptSettingsStored,
  templateId: string | null | undefined,
  context: AiPromptScopeContext,
  source: "default" | "db",
  options: {
    requirePublic?: boolean;
  } = {}
): AiPromptRuntimeSettings {
  const fromTemplateId = getAiPromptTemplateByIdFromSettings(
    settings,
    templateId,
    options
  );
  if (fromTemplateId) {
    return toRuntimeFromTemplate(fromTemplateId, source);
  }
  return resolveAiPromptRuntimeSettingsForContext(settings, context, source);
}

export async function getAiPromptRuntimeSettings(
  context: AiPromptScopeContext = {}
): Promise<AiPromptRuntimeSettings> {
  const cached = await getCachedStoredSettings();
  return resolveAiPromptRuntimeSettingsForContext(
    cached.settings,
    context,
    cached.source
  );
}

export async function getAiPromptRuntimeSettingsByTemplateId(
  params: {
    templateId?: string | null;
    context?: AiPromptScopeContext;
    requirePublic?: boolean;
  } = {}
): Promise<AiPromptRuntimeSettings> {
  const cached = await getCachedStoredSettings();
  return resolveAiPromptRuntimeSettingsForTemplateId(
    cached.settings,
    params.templateId ?? null,
    params.context ?? {},
    cached.source,
    { requirePublic: params.requirePublic }
  );
}

export async function getAiPromptTemplateById(
  templateId: string | null | undefined,
  options: {
    requirePublic?: boolean;
  } = {}
): Promise<AiPromptTemplate | null> {
  const cached = await getCachedStoredSettings();
  return getAiPromptTemplateByIdFromSettings(cached.settings, templateId, options);
}

export function getAiPromptIndicatorOptionsPublic(): AiPromptIndicatorOptionPublic[] {
  return AI_PROMPT_INDICATOR_OPTIONS.map((option) => ({
    key: option.key,
    label: option.label,
    group: option.group,
    description: option.description
  }));
}

export function getPublicAiPromptTemplates(
  settings: AiPromptSettingsStored
): AiPromptTemplate[] {
  return settings.prompts
    .filter((item) => item.isPublic)
    .map((item) => ({
      id: item.id,
      name: item.name,
      promptText: item.promptText,
      indicatorKeys: [...item.indicatorKeys],
      ohlcvBars: item.ohlcvBars,
      timeframe: item.timeframe,
      directionPreference: item.directionPreference,
      confidenceTargetPct: item.confidenceTargetPct,
      marketAnalysisUpdateEnabled: item.marketAnalysisUpdateEnabled,
      isPublic: item.isPublic,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));
}

export function parseStoredAiPromptSettings(value: unknown): AiPromptSettingsStored {
  const objectValue = asObject(value);
  if (!objectValue) {
    return cloneStoredSettings(DEFAULT_AI_PROMPT_SETTINGS);
  }

  const nowIso = new Date().toISOString();

  const isLegacySingle =
    Object.prototype.hasOwnProperty.call(objectValue, "promptText") ||
    Object.prototype.hasOwnProperty.call(objectValue, "indicatorKeys");

  if (isLegacySingle && !objectValue.prompts && !objectValue.presets) {
    const prompt: AiPromptTemplate = {
      id: "legacy_prompt",
      name: "Legacy Prompt",
      promptText: sanitizePromptText(objectValue.promptText),
      indicatorKeys: normalizeIndicatorKeys(objectValue.indicatorKeys),
      ohlcvBars: normalizeOhlcvBars(objectValue.ohlcvBars, DEFAULT_PROMPT_OHLCV_BARS),
      timeframe: normalizeTimeframe(objectValue.timeframe),
      directionPreference: normalizeDirectionPreference(
        objectValue.directionPreference,
        DEFAULT_PROMPT_DIRECTION_PREFERENCE
      ),
      confidenceTargetPct: normalizeConfidenceTarget(
        objectValue.confidenceTargetPct,
        DEFAULT_PROMPT_CONFIDENCE_TARGET_PCT
      ),
      marketAnalysisUpdateEnabled: normalizeBool(
        objectValue.marketAnalysisUpdateEnabled,
        false
      ),
      isPublic: false,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    return {
      activePromptId: prompt.id,
      prompts: [prompt]
    };
  }

  if (objectValue.presets) {
    const presets = asObject(objectValue.presets) ?? {};
    const activePresetRaw =
      typeof objectValue.activePresetKey === "string"
        ? objectValue.activePresetKey.trim().toUpperCase()
        : "A";
    const activePreset = activePresetRaw === "B" ? "B" : "A";

    const fromPreset = (key: "A" | "B", fallbackName: string): AiPromptTemplate => {
      const raw = asObject(presets[key]) ?? {};
      return {
        id: `legacy_preset_${key.toLowerCase()}`,
        name: sanitizeName(raw.name, fallbackName),
        promptText: sanitizePromptText(raw.promptText),
        indicatorKeys: normalizeIndicatorKeys(raw.indicatorKeys),
        ohlcvBars: normalizeOhlcvBars(raw.ohlcvBars, DEFAULT_PROMPT_OHLCV_BARS),
        timeframe: normalizeTimeframe(raw.timeframe),
        directionPreference: normalizeDirectionPreference(
          raw.directionPreference,
          DEFAULT_PROMPT_DIRECTION_PREFERENCE
        ),
        confidenceTargetPct: normalizeConfidenceTarget(
          raw.confidenceTargetPct,
          DEFAULT_PROMPT_CONFIDENCE_TARGET_PCT
        ),
        marketAnalysisUpdateEnabled: normalizeBool(
          raw.marketAnalysisUpdateEnabled,
          false
        ),
        isPublic: false,
        createdAt: nowIso,
        updatedAt: nowIso
      };
    };

    const prompts = [fromPreset("A", "Preset A"), fromPreset("B", "Preset B")];
    return {
      activePromptId: activePreset === "B" ? prompts[1].id : prompts[0].id,
      prompts
    };
  }

  const promptsRaw = Array.isArray(objectValue.prompts) ? objectValue.prompts : [];
  const promptsParsed = dedupeTemplates(
    promptsRaw
      .map((entry, index) => parseTemplate(entry, index))
      .filter((entry): entry is AiPromptTemplate => Boolean(entry))
  );

  const prompts = promptsParsed.length > 0
    ? promptsParsed
    : cloneStoredSettings(DEFAULT_AI_PROMPT_SETTINGS).prompts;

  const activePromptIdRaw =
    typeof objectValue.activePromptId === "string" && objectValue.activePromptId.trim()
      ? objectValue.activePromptId.trim()
      : null;

  const activePromptId =
    activePromptIdRaw && prompts.some((item) => item.id === activePromptIdRaw)
      ? activePromptIdRaw
      : (prompts[0]?.id ?? null);

  return {
    activePromptId,
    prompts
  };
}

export function isAiPromptIndicatorKey(value: string): value is AiPromptIndicatorKey {
  return indicatorKeySet.has(value as AiPromptIndicatorKey);
}

export function filterFeatureSnapshotForAiPrompt(
  snapshot: Record<string, unknown>,
  indicatorKeys: readonly AiPromptIndicatorKey[]
): Record<string, unknown> {
  const base = asObject(snapshot) ?? {};
  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(base)) {
    if (key === "indicators" || key === "advancedIndicators" || key === "tradersReality") continue;
    if (!shouldPreservePromptContextKey(key)) continue;
    filtered[key] = deepClone(value);
  }

  const selected = new Set<AiPromptIndicatorKey>(indicatorKeys);
  for (const option of AI_PROMPT_INDICATOR_OPTIONS) {
    if (!selected.has(option.key)) continue;
    for (const path of option.paths) {
      const value = getByPath(base, path);
      if (value === undefined) continue;
      setByPath(filtered, path, value);
    }
  }

  return filtered;
}
