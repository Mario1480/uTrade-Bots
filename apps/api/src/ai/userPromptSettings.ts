import { prisma } from "@mm/db";
import {
  getAiPromptRuntimeSettings,
  getAiPromptRuntimeSettingsByTemplateId,
  getAiPromptTemplateById,
  isAiPromptIndicatorKey,
  type AiPromptDirectionPreference,
  type AiPromptIndicatorKey,
  type AiPromptNewsRiskMode,
  type AiPromptRuntimeSettings,
  type AiPromptScopeContext,
  type AiPromptSlTpSource,
  type AiPromptTemplate,
  type AiPromptTimeframe
} from "./promptSettings.js";

const db = prisma as any;

const MAX_PROMPT_TEXT_CHARS = 8000;

export type UserAiPromptTemplate = AiPromptTemplate;

type UserPromptTemplateRow = {
  id: string;
  userId: string;
  name: string;
  promptText: string;
  indicatorKeys: string[];
  ohlcvBars: number;
  timeframes: string[];
  runTimeframe: string | null;
  timeframe: string | null;
  directionPreference: string;
  confidenceTargetPct: number;
  slTpSource: string;
  newsRiskMode: string;
  marketAnalysisUpdateEnabled: boolean;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateUserAiPromptInput = {
  userId: string;
  name: string;
  promptText: string;
  indicatorKeys: AiPromptIndicatorKey[];
  ohlcvBars: number;
  timeframes: AiPromptTimeframe[];
  runTimeframe: AiPromptTimeframe | null;
  directionPreference: AiPromptDirectionPreference;
  confidenceTargetPct: number;
  slTpSource: AiPromptSlTpSource;
  newsRiskMode: AiPromptNewsRiskMode;
  now: Date;
};

export type ResolvedAiPromptSelection = {
  runtimeSettings: AiPromptRuntimeSettings;
  source: "own" | "global" | "default";
  templateId: string | null;
  templateName: string | null;
  isOwnTemplate: boolean;
};

function isTimeframe(value: unknown): value is AiPromptTimeframe {
  return value === "5m" || value === "15m" || value === "1h" || value === "4h" || value === "1d";
}

function sanitizePromptText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_PROMPT_TEXT_CHARS) return trimmed;
  return trimmed.slice(0, MAX_PROMPT_TEXT_CHARS).trimEnd();
}

function uniqueTimeframes(value: readonly AiPromptTimeframe[]): AiPromptTimeframe[] {
  const out: AiPromptTimeframe[] = [];
  const seen = new Set<AiPromptTimeframe>();
  for (const timeframe of value) {
    if (seen.has(timeframe)) continue;
    seen.add(timeframe);
    out.push(timeframe);
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeRunTimeframe(
  timeframes: readonly AiPromptTimeframe[],
  runTimeframe: AiPromptTimeframe | null
): AiPromptTimeframe | null {
  if (timeframes.length === 0) return null;
  if (runTimeframe && timeframes.includes(runTimeframe)) return runTimeframe;
  return timeframes[0];
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 60;
  return Math.max(0, Math.min(100, parsed));
}

function clampOhlcvBars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(20, Math.min(500, Math.trunc(parsed)));
}

function makeUserPromptId(): string {
  return `uap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toPublicTemplate(row: UserPromptTemplateRow): UserAiPromptTemplate {
  const normalizedTimeframes = uniqueTimeframes(
    (Array.isArray(row.timeframes) ? row.timeframes : [])
      .filter((entry): entry is AiPromptTimeframe => isTimeframe(entry))
  );
  const normalizedRunTimeframe =
    isTimeframe(row.runTimeframe) && normalizedTimeframes.includes(row.runTimeframe)
      ? row.runTimeframe
      : normalizeRunTimeframe(normalizedTimeframes, null);
  const timeframe = normalizedRunTimeframe;
  const directionPreference: AiPromptDirectionPreference =
    row.directionPreference === "long" || row.directionPreference === "short"
      ? row.directionPreference
      : "either";
  const slTpSource: AiPromptSlTpSource =
    row.slTpSource === "ai" || row.slTpSource === "hybrid"
      ? row.slTpSource
      : "local";
  const newsRiskMode: AiPromptNewsRiskMode = row.newsRiskMode === "block" ? "block" : "off";

  const indicatorKeys: AiPromptIndicatorKey[] = [];
  const seenIndicatorKeys = new Set<AiPromptIndicatorKey>();
  for (const entry of Array.isArray(row.indicatorKeys) ? row.indicatorKeys : []) {
    const normalized = typeof entry === "string" ? entry.trim() : "";
    if (!normalized || !isAiPromptIndicatorKey(normalized)) continue;
    if (seenIndicatorKeys.has(normalized)) continue;
    seenIndicatorKeys.add(normalized);
    indicatorKeys.push(normalized);
  }

  return {
    id: row.id,
    name: row.name.trim(),
    promptText: sanitizePromptText(row.promptText),
    indicatorKeys,
    ohlcvBars: clampOhlcvBars(row.ohlcvBars),
    timeframes: normalizedTimeframes,
    runTimeframe: normalizedRunTimeframe,
    timeframe,
    directionPreference,
    confidenceTargetPct: clampConfidence(row.confidenceTargetPct),
    slTpSource,
    newsRiskMode,
    marketAnalysisUpdateEnabled: Boolean(row.marketAnalysisUpdateEnabled),
    isPublic: Boolean(row.isPublic),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toRuntimeFromUserTemplate(template: UserAiPromptTemplate): AiPromptRuntimeSettings {
  const indicatorKeys = template.indicatorKeys.filter((key): key is AiPromptIndicatorKey =>
    isAiPromptIndicatorKey(key)
  );
  return {
    promptText: template.promptText,
    indicatorKeys: [...indicatorKeys],
    ohlcvBars: template.ohlcvBars,
    timeframes: [...template.timeframes],
    runTimeframe: template.runTimeframe,
    timeframe: template.timeframe,
    directionPreference: template.directionPreference,
    confidenceTargetPct: template.confidenceTargetPct,
    slTpSource: template.slTpSource,
    newsRiskMode: template.newsRiskMode,
    marketAnalysisUpdateEnabled: template.marketAnalysisUpdateEnabled,
    source: "db",
    activePromptId: template.id,
    activePromptName: template.name,
    selectedFrom: "active_prompt",
    matchedScopeType: null,
    matchedOverrideId: null
  };
}

export async function listUserAiPromptTemplates(userId: string): Promise<UserAiPromptTemplate[]> {
  const rows = await db.userAiPromptTemplate.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  });
  return rows.map((row: UserPromptTemplateRow) => toPublicTemplate(row));
}

export async function getUserAiPromptTemplateById(
  userId: string,
  templateId: string | null | undefined
): Promise<UserAiPromptTemplate | null> {
  const id = typeof templateId === "string" ? templateId.trim() : "";
  if (!id) return null;
  const row = await db.userAiPromptTemplate.findFirst({
    where: { id, userId }
  });
  if (!row) return null;
  return toPublicTemplate(row as UserPromptTemplateRow);
}

export async function createUserAiPromptTemplate(
  input: CreateUserAiPromptInput
): Promise<UserAiPromptTemplate> {
  const now = input.now;
  const timeframes = uniqueTimeframes(input.timeframes);
  const runTimeframe = normalizeRunTimeframe(timeframes, input.runTimeframe);
  const indicatorKeys: AiPromptIndicatorKey[] = [];
  const seenIndicatorKeys = new Set<AiPromptIndicatorKey>();
  for (const key of input.indicatorKeys) {
    if (!isAiPromptIndicatorKey(key)) continue;
    if (seenIndicatorKeys.has(key)) continue;
    seenIndicatorKeys.add(key);
    indicatorKeys.push(key);
  }
  const created = await db.userAiPromptTemplate.create({
    data: {
      id: makeUserPromptId(),
      userId: input.userId,
      name: input.name.trim().slice(0, 64),
      promptText: sanitizePromptText(input.promptText),
      indicatorKeys,
      ohlcvBars: clampOhlcvBars(input.ohlcvBars),
      timeframes,
      runTimeframe,
      timeframe: runTimeframe,
      directionPreference: input.directionPreference,
      confidenceTargetPct: clampConfidence(input.confidenceTargetPct),
      slTpSource: input.slTpSource,
      newsRiskMode: input.newsRiskMode,
      marketAnalysisUpdateEnabled: false,
      isPublic: false,
      createdAt: now,
      updatedAt: now
    }
  });
  return toPublicTemplate(created as UserPromptTemplateRow);
}

export async function deleteUserAiPromptTemplateById(
  userId: string,
  templateId: string
): Promise<boolean> {
  const id = templateId.trim();
  if (!id) return false;
  const result = await db.userAiPromptTemplate.deleteMany({
    where: { id, userId }
  });
  return result.count > 0;
}

export async function resolveAiPromptRuntimeForUserSelection(params: {
  userId: string;
  templateId: string | null | undefined;
  context: AiPromptScopeContext;
  requirePublicGlobalPrompt?: boolean;
  deps?: {
    getOwnById?: (userId: string, templateId: string) => Promise<UserAiPromptTemplate | null>;
    getRuntimeSettings?: (context: AiPromptScopeContext) => Promise<AiPromptRuntimeSettings>;
    getGlobalTemplateById?: (
      templateId: string,
      options: { requirePublic?: boolean }
    ) => Promise<AiPromptTemplate | null>;
    getRuntimeByTemplateId?: (params: {
      templateId?: string | null;
      context?: AiPromptScopeContext;
      requirePublic?: boolean;
    }) => Promise<AiPromptRuntimeSettings>;
  };
}): Promise<ResolvedAiPromptSelection | null> {
  const getOwnById = params.deps?.getOwnById ?? ((userId: string, templateId: string) =>
    getUserAiPromptTemplateById(userId, templateId));
  const getRuntimeSettings = params.deps?.getRuntimeSettings ?? getAiPromptRuntimeSettings;
  const getGlobalTemplateById = params.deps?.getGlobalTemplateById ?? getAiPromptTemplateById;
  const getRuntimeByTemplateId =
    params.deps?.getRuntimeByTemplateId ?? getAiPromptRuntimeSettingsByTemplateId;
  const selectedTemplateId =
    typeof params.templateId === "string" && params.templateId.trim()
      ? params.templateId.trim()
      : null;

  if (!selectedTemplateId) {
    const runtimeSettings = await getRuntimeSettings(params.context);
    return {
      runtimeSettings,
      source: "default",
      templateId: runtimeSettings.activePromptId,
      templateName: runtimeSettings.activePromptName,
      isOwnTemplate: false
    };
  }

  const ownTemplate = await getOwnById(params.userId, selectedTemplateId);
  if (ownTemplate) {
    return {
      runtimeSettings: toRuntimeFromUserTemplate(ownTemplate),
      source: "own",
      templateId: ownTemplate.id,
      templateName: ownTemplate.name,
      isOwnTemplate: true
    };
  }

  const globalTemplate = await getGlobalTemplateById(selectedTemplateId, {
    requirePublic: Boolean(params.requirePublicGlobalPrompt)
  });
  if (!globalTemplate) return null;

  const runtimeSettings = await getRuntimeByTemplateId({
    templateId: selectedTemplateId,
    context: params.context,
    requirePublic: Boolean(params.requirePublicGlobalPrompt)
  });
  return {
    runtimeSettings,
    source: "global",
    templateId: globalTemplate.id,
    templateName: globalTemplate.name,
    isOwnTemplate: false
  };
}
