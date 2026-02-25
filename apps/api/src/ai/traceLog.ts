import { prisma } from "@mm/db";
import { logger } from "../logger.js";

const db = prisma as any;

export const AI_TRACE_SETTINGS_GLOBAL_SETTING_KEY = "admin.aiTrace";

export type StoredAiTraceSettings = {
  enabled: boolean;
  maxSystemMessageChars: number;
  maxUserPayloadChars: number;
  maxRawResponseChars: number;
};

export const DEFAULT_AI_TRACE_SETTINGS: StoredAiTraceSettings = {
  enabled: false,
  maxSystemMessageChars: 12000,
  maxUserPayloadChars: 60000,
  maxRawResponseChars: 12000
};

const SETTINGS_CACHE_TTL_MS = Math.max(
  5,
  Number(process.env.AI_TRACE_SETTINGS_CACHE_TTL_SEC ?? "30")
) * 1000;

let settingsCacheUntil = 0;
let settingsCacheValue:
  | {
      settings: StoredAiTraceSettings;
      source: "default" | "db";
    }
  | null = null;
let settingsInFlight:
  | Promise<{
      settings: StoredAiTraceSettings;
      source: "default" | "db";
    }>
  | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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

function readInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

export function parseStoredAiTraceSettings(value: unknown): StoredAiTraceSettings {
  const record = asRecord(value);
  return {
    enabled: asBoolean(record.enabled, DEFAULT_AI_TRACE_SETTINGS.enabled),
    maxSystemMessageChars: readInt(
      record.maxSystemMessageChars,
      DEFAULT_AI_TRACE_SETTINGS.maxSystemMessageChars,
      500,
      50_000
    ),
    maxUserPayloadChars: readInt(
      record.maxUserPayloadChars,
      DEFAULT_AI_TRACE_SETTINGS.maxUserPayloadChars,
      1_000,
      250_000
    ),
    maxRawResponseChars: readInt(
      record.maxRawResponseChars,
      DEFAULT_AI_TRACE_SETTINGS.maxRawResponseChars,
      500,
      50_000
    )
  };
}

export function invalidateAiTraceSettingsCache() {
  settingsCacheUntil = 0;
  settingsCacheValue = null;
  settingsInFlight = null;
}

async function loadAiTraceSettings() {
  const row = await db.globalSetting.findUnique({
    where: { key: AI_TRACE_SETTINGS_GLOBAL_SETTING_KEY },
    select: { value: true }
  });
  if (!row) {
    return {
      settings: DEFAULT_AI_TRACE_SETTINGS,
      source: "default" as const
    };
  }
  return {
    settings: parseStoredAiTraceSettings(row.value),
    source: "db" as const
  };
}

export async function getAiTraceSettingsCached(): Promise<{
  settings: StoredAiTraceSettings;
  source: "default" | "db";
}> {
  const now = Date.now();
  if (settingsCacheValue && now < settingsCacheUntil) return settingsCacheValue;

  if (!settingsInFlight) {
    settingsInFlight = (async () => {
      try {
        return await loadAiTraceSettings();
      } catch (error) {
        logger.warn("ai_trace_settings_load_failed", {
          reason: String(error)
        });
        return {
          settings: DEFAULT_AI_TRACE_SETTINGS,
          source: "default" as const
        };
      } finally {
        settingsInFlight = null;
      }
    })();
  }

  settingsCacheValue = await settingsInFlight;
  settingsCacheUntil = Date.now() + SETTINGS_CACHE_TTL_MS;
  return settingsCacheValue;
}

function truncateText(value: string | null | undefined, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)} …[truncated ${trimmed.length - maxChars} chars]`;
}

function truncateJson(value: unknown, maxChars: number): unknown {
  try {
    const serialized = JSON.stringify(value ?? null);
    if (serialized.length <= maxChars) return value ?? null;
    return {
      truncated: true,
      originalChars: serialized.length,
      preview: serialized.slice(0, maxChars)
    };
  } catch {
    return {
      truncated: true,
      reason: "json_stringify_failed"
    };
  }
}

function isAiTraceLogModelReady(): boolean {
  return Boolean(db.aiTraceLog && typeof db.aiTraceLog.create === "function");
}

export type AiTraceLogRecordInput = {
  userId?: string | null;
  scope: string;
  provider?: string | null;
  model?: string | null;
  symbol?: string | null;
  marketType?: string | null;
  timeframe?: string | null;
  promptTemplateId?: string | null;
  promptTemplateName?: string | null;
  systemMessage?: string | null;
  userPayload?: unknown;
  rawResponse?: string | null;
  parsedResponse?: unknown;
  success: boolean;
  error?: string | null;
  fallbackUsed?: boolean;
  cacheHit?: boolean;
  rateLimited?: boolean;
  latencyMs?: number | null;
};

export async function recordAiTraceLog(input: AiTraceLogRecordInput): Promise<void> {
  if (!isAiTraceLogModelReady()) return;

  const { settings } = await getAiTraceSettingsCached();
  if (!settings.enabled) return;

  try {
    await db.aiTraceLog.create({
      data: {
        userId: truncateText(input.userId ?? null, 191),
        scope: input.scope,
        provider: truncateText(input.provider ?? null, 64),
        model: truncateText(input.model ?? null, 128),
        symbol: truncateText(input.symbol ?? null, 40),
        marketType: truncateText(input.marketType ?? null, 16),
        timeframe: truncateText(input.timeframe ?? null, 16),
        promptTemplateId: truncateText(input.promptTemplateId ?? null, 120),
        promptTemplateName: truncateText(input.promptTemplateName ?? null, 255),
        systemMessage: truncateText(input.systemMessage ?? null, settings.maxSystemMessageChars),
        userPayload: truncateJson(input.userPayload ?? null, settings.maxUserPayloadChars),
        rawResponse: truncateText(input.rawResponse ?? null, settings.maxRawResponseChars),
        parsedResponse: truncateJson(input.parsedResponse ?? null, settings.maxUserPayloadChars),
        success: Boolean(input.success),
        error: truncateText(input.error ?? null, 2000),
        fallbackUsed: Boolean(input.fallbackUsed),
        cacheHit: Boolean(input.cacheHit),
        rateLimited: Boolean(input.rateLimited),
        latencyMs:
          Number.isFinite(Number(input.latencyMs)) && input.latencyMs !== null
            ? Math.max(0, Math.trunc(Number(input.latencyMs)))
            : null
      }
    });
  } catch (error) {
    logger.warn("ai_trace_log_write_failed", {
      reason: String(error)
    });
  }
}
