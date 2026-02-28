import { prisma } from "@mm/db";
import { decryptSecret } from "../secret-crypto.js";
import { logger } from "../logger.js";
import { checkAiTokenAccess, debitAiTokens } from "../billing/service.js";

type OpenAiErrorPayload = {
  error?: {
    message?: string;
  };
};

type ChatCompletionMessageContentPart = {
  type?: string;
  text?: string;
};

type ChatCompletionToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ChatCompletionMessage = {
  role?: string;
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: ChatCompletionToolCall[];
  [key: string]: unknown;
};

type ChatCompletionResponse = OpenAiErrorPayload & {
  choices?: Array<{
    message?: ChatCompletionMessage;
    text?: unknown;
  }>;
  message?: ChatCompletionMessage;
  response?: unknown;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type AiUsageTokens = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type AiProvider = "openai" | "ollama" | "disabled";
export type EnabledAiProvider = Exclude<AiProvider, "disabled">;
export type AiProviderSource = "db" | "env" | "default";
export type AiBaseUrlSource = "db" | "env" | "default";
export type AiModelSource = "db" | "env" | "default";

export const AI_PROVIDER_OPTIONS = ["openai", "ollama"] as const;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const AI_API_KEYS_GLOBAL_SETTING_KEY = "admin.apiKeys";

const AI_DB_KEY_CACHE_TTL_MS =
  Math.max(5, Number(process.env.AI_DB_KEY_CACHE_TTL_SEC ?? "30")) * 1000;
const AI_DB_MODEL_CACHE_TTL_MS =
  Math.max(
    5,
    Number(process.env.AI_DB_MODEL_CACHE_TTL_SEC ?? process.env.AI_DB_KEY_CACHE_TTL_SEC ?? "30")
  ) * 1000;

export const OPENAI_ADMIN_MODEL_OPTIONS = [
  "gpt-5-nano",
  "gpt-5-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini"
] as const;
export type OpenAiAdminModel = (typeof OPENAI_ADMIN_MODEL_OPTIONS)[number];

const OPENAI_DEFAULT_MODEL: OpenAiAdminModel = "gpt-4o-mini";
const OLLAMA_DEFAULT_MODEL = "qwen3:8b";
const OLLAMA_MIN_MAX_TOKENS = (() => {
  const parsed = Number(process.env.AI_OLLAMA_MIN_MAX_TOKENS ?? "900");
  if (!Number.isFinite(parsed) || parsed < 1) return 900;
  return Math.trunc(parsed);
})();
const OPENAI_ADMIN_MODEL_OPTION_SET = new Set<string>(OPENAI_ADMIN_MODEL_OPTIONS);

const db = prisma as any;

let dbAiSettingsCacheUntil = 0;
let dbAiSettingsCached: DbAiSettings | null = null;
let dbAiSettingsInFlight: Promise<DbAiSettings> | null = null;

type DbAiSettings = {
  aiApiKey: string | null;
  aiModel: string | null;
  aiProvider: AiProvider | null;
  aiBaseUrl: string | null;
};

export type CallAiOptions = {
  systemMessage?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  billingUserId?: string | null;
  billingScope?: string;
  onUsage?: (usage: AiUsageTokens) => void;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

export type CallAiChatOptions = {
  systemMessage?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  billingUserId?: string | null;
  billingScope?: string;
  onUsage?: (usage: AiUsageTokens) => void;
  tools?: ChatToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
};

export type AiToolCall = {
  id: string;
  name: string;
  argumentsText: string;
};

export type AiChatResult = {
  content: string;
  toolCalls: AiToolCall[];
  usage: AiUsageTokens;
  model: string;
  provider: EnabledAiProvider;
  finishReason: string | null;
};

type AiCallResult = {
  usage: AiUsageTokens;
  message: ChatCompletionMessage;
  finishReason: string | null;
  modelUsed: string;
};

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeAiProvider(value: unknown): EnabledAiProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "openai") return "openai";
  if (normalized === "ollama") return "ollama";
  return null;
}

function resolveProvider(value: string | undefined): AiProvider {
  const normalized = (value ?? "openai").trim().toLowerCase();
  if (normalized === "off" || normalized === "disabled" || normalized === "none") {
    return "disabled";
  }
  if (normalized === "ollama") return "ollama";
  return "openai";
}

function defaultBaseUrlForProvider(provider: EnabledAiProvider): string {
  if (provider === "ollama") return DEFAULT_OLLAMA_BASE_URL;
  return DEFAULT_OPENAI_BASE_URL;
}

function normalizeConfiguredOpenAiModel(value: unknown): OpenAiAdminModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!OPENAI_ADMIN_MODEL_OPTION_SET.has(trimmed)) {
    return null;
  }
  return trimmed as OpenAiAdminModel;
}

export function resolveAiModelFromConfig(input: {
  dbModel?: string | null;
  envModel?: string | null | undefined;
  provider?: EnabledAiProvider | null;
}): { model: string; source: AiModelSource } {
  const provider = input.provider ?? "openai";
  if (provider === "openai") {
    const dbModel = normalizeConfiguredOpenAiModel(input.dbModel);
    if (dbModel) {
      return { model: dbModel, source: "db" };
    }
    const envModel = normalizeConfiguredOpenAiModel(input.envModel);
    if (envModel) {
      return { model: envModel, source: "env" };
    }
    return { model: OPENAI_DEFAULT_MODEL, source: "default" };
  }

  const dbModel = toNonEmptyString(input.dbModel);
  if (dbModel) {
    return { model: dbModel, source: "db" };
  }
  const envModel = toNonEmptyString(input.envModel ?? null);
  if (envModel) {
    return { model: envModel, source: "env" };
  }
  return { model: OLLAMA_DEFAULT_MODEL, source: "default" };
}

function resolveAiBaseUrlFromConfig(input: {
  provider: EnabledAiProvider;
  dbBaseUrl?: string | null;
  envBaseUrl?: string | null | undefined;
}): { baseUrl: string; source: AiBaseUrlSource } {
  const dbBaseUrl = toNonEmptyString(input.dbBaseUrl);
  const envBaseUrl = toNonEmptyString(input.envBaseUrl ?? null);
  if (dbBaseUrl) {
    return { baseUrl: dbBaseUrl, source: "db" };
  }
  if (envBaseUrl) {
    return { baseUrl: envBaseUrl, source: "env" };
  }
  return {
    baseUrl: defaultBaseUrlForProvider(input.provider),
    source: "default"
  };
}

function parseStoredAiSettings(value: unknown): DbAiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      aiApiKey: null,
      aiModel: null,
      aiProvider: null,
      aiBaseUrl: null
    };
  }

  const record = value as Record<string, unknown>;
  const aiApiKeyEnc =
    toNonEmptyString(record.aiApiKeyEnc)
    ?? toNonEmptyString(record.openaiApiKeyEnc);
  let aiApiKey: string | null = null;
  if (aiApiKeyEnc) {
    try {
      const decrypted = decryptSecret(aiApiKeyEnc).trim();
      aiApiKey = decrypted.length > 0 ? decrypted : null;
    } catch {
      aiApiKey = null;
    }
  }

  const aiModel =
    toNonEmptyString(record.aiModel)
    ?? toNonEmptyString(record.openaiModel);
  const aiProviderRaw = toNonEmptyString(record.aiProvider)?.toLowerCase() ?? "";
  const aiProvider =
    aiProviderRaw === "disabled" || aiProviderRaw === "off" || aiProviderRaw === "none"
      ? "disabled"
      : (normalizeAiProvider(aiProviderRaw) ?? null);
  const aiBaseUrl = toNonEmptyString(record.aiBaseUrl);

  return {
    aiApiKey,
    aiModel,
    aiProvider,
    aiBaseUrl
  };
}

async function loadDbAiSettings(): Promise<DbAiSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: AI_API_KEYS_GLOBAL_SETTING_KEY },
    select: { value: true }
  });
  return parseStoredAiSettings(row?.value);
}

async function resolveDbAiSettings(): Promise<DbAiSettings> {
  const now = Date.now();
  if (now < dbAiSettingsCacheUntil && dbAiSettingsCached) {
    return dbAiSettingsCached;
  }

  if (!dbAiSettingsInFlight) {
    dbAiSettingsInFlight = (async () => {
      try {
        return await loadDbAiSettings();
      } catch (error) {
        logger.warn("ai_provider_settings_lookup_failed", {
          reason: String(error)
        });
        return {
          aiApiKey: null,
          aiModel: null,
          aiProvider: null,
          aiBaseUrl: null
        } satisfies DbAiSettings;
      } finally {
        dbAiSettingsInFlight = null;
      }
    })();
  }

  dbAiSettingsCached = await dbAiSettingsInFlight;
  dbAiSettingsCacheUntil = Date.now() + Math.max(AI_DB_KEY_CACHE_TTL_MS, AI_DB_MODEL_CACHE_TTL_MS);
  return dbAiSettingsCached;
}

export function invalidateAiApiKeyCache() {
  dbAiSettingsCacheUntil = 0;
  dbAiSettingsCached = null;
  dbAiSettingsInFlight = null;
}

export function invalidateAiModelCache() {
  dbAiSettingsCacheUntil = 0;
  dbAiSettingsCached = null;
  dbAiSettingsInFlight = null;
}

export async function resolveAiProviderWithSource(): Promise<{
  provider: AiProvider;
  source: AiProviderSource;
}> {
  const dbSettings = await resolveDbAiSettings();
  if (dbSettings.aiProvider) {
    return {
      provider: dbSettings.aiProvider,
      source: "db"
    };
  }

  const envRaw = toNonEmptyString(process.env.AI_PROVIDER);
  if (envRaw) {
    return {
      provider: resolveProvider(envRaw),
      source: "env"
    };
  }

  return {
    provider: "openai",
    source: "default"
  };
}

export async function getAiProviderAsync(): Promise<AiProvider> {
  const resolved = await resolveAiProviderWithSource();
  return resolved.provider;
}

export async function resolveAiBaseUrlWithSource(): Promise<{
  baseUrl: string;
  source: AiBaseUrlSource;
}> {
  const providerResolved = await resolveAiProviderWithSource();
  const provider: EnabledAiProvider = providerResolved.provider === "ollama" ? "ollama" : "openai";
  const dbSettings = await resolveDbAiSettings();
  return resolveAiBaseUrlFromConfig({
    provider,
    dbBaseUrl: dbSettings.aiBaseUrl,
    envBaseUrl: process.env.AI_BASE_URL
  });
}

export async function resolveAiModelWithSource(): Promise<{
  model: string;
  source: AiModelSource;
}> {
  const providerResolved = await resolveAiProviderWithSource();
  const provider: EnabledAiProvider = providerResolved.provider === "ollama" ? "ollama" : "openai";
  const dbSettings = await resolveDbAiSettings();
  return resolveAiModelFromConfig({
    provider,
    dbModel: dbSettings.aiModel,
    envModel: process.env.AI_MODEL
  });
}

export async function getAiModelAsync(): Promise<string> {
  const resolved = await resolveAiModelWithSource();
  return resolved.model;
}

export function getAiModel(): string {
  const provider = resolveProvider(process.env.AI_PROVIDER);
  const normalizedProvider: EnabledAiProvider = provider === "ollama" ? "ollama" : "openai";
  return resolveAiModelFromConfig({
    provider: normalizedProvider,
    envModel: process.env.AI_MODEL
  }).model;
}

async function resolveAiApiKey(provider: EnabledAiProvider): Promise<string | null> {
  const dbSettings = await resolveDbAiSettings();
  if (dbSettings.aiApiKey) return dbSettings.aiApiKey;

  const envApiKey = toNonEmptyString(process.env.AI_API_KEY);
  if (envApiKey) return envApiKey;

  if (provider === "ollama") {
    return "ollama";
  }

  return null;
}

function readProviderError(status: number, payload: unknown, prefix: string): string {
  if (payload && typeof payload === "object") {
    const message = (payload as OpenAiErrorPayload).error?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }
  return `${prefix}_${status}`;
}

function normalizeTokenCount(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function readChatUsage(payload: ChatCompletionResponse | null | undefined): AiUsageTokens {
  const promptTokens = normalizeTokenCount(payload?.usage?.prompt_tokens);
  const completionTokens = normalizeTokenCount(payload?.usage?.completion_tokens);
  const totalTokens =
    normalizeTokenCount(payload?.usage?.total_tokens)
    ?? (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function flattenMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((part) => flattenMessageText(part)).join("");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "value", "output_text", "output"]) {
      const extracted = flattenMessageText(record[key]);
      if (extracted.trim()) return extracted;
    }
    const nested = Object.values(record)
      .map((part) => flattenMessageText(part))
      .filter((part) => part.trim().length > 0);
    if (nested.length > 0) return nested.join("");
  }

  return "";
}

function readMessageContent(message: ChatCompletionMessage | null | undefined): string {
  if (!message) return "";
  const contentText = flattenMessageText(message.content).trim();
  if (contentText) return contentText;

  const reasoningText =
    flattenMessageText(message.reasoning).trim()
    || flattenMessageText(message.reasoning_content).trim();
  if (reasoningText) return reasoningText;

  return "";
}

function readToolCalls(message: ChatCompletionMessage | null | undefined): AiToolCall[] {
  const toolCallsRaw = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const out: AiToolCall[] = [];
  for (const row of toolCallsRaw) {
    const id = toNonEmptyString(row?.id);
    const name = toNonEmptyString(row?.function?.name);
    const argumentsText = typeof row?.function?.arguments === "string"
      ? row.function.arguments
      : "{}";
    if (!id || !name) continue;
    out.push({
      id,
      name,
      argumentsText
    });
  }
  return out;
}

function isOpenAiGpt5Model(provider: EnabledAiProvider, model: string): boolean {
  return provider === "openai" && model.startsWith("gpt-5");
}

function resolveOllamaDockerFallbackBaseUrl(baseUrl: string): string | null {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      return null;
    }
    parsed.hostname = "host.docker.internal";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveFallbackModel(primaryModel: string): string | null {
  const envFallback = process.env.AI_FALLBACK_MODEL?.trim() ?? "";
  const fallback = envFallback || "gpt-4o-mini";
  return fallback && fallback !== primaryModel ? fallback : null;
}

async function callChatCompletions(params: {
  provider: EnabledAiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  signal: AbortSignal;
}): Promise<AiCallResult> {
  const requestedMaxTokensRaw = params.maxTokens ?? 220;
  const requestedMaxTokens = params.provider === "ollama"
    ? Math.max(OLLAMA_MIN_MAX_TOKENS, requestedMaxTokensRaw)
    : requestedMaxTokensRaw;
  const completionTokensParam = isOpenAiGpt5Model(params.provider, params.model)
    ? { max_completion_tokens: requestedMaxTokens }
    : { max_tokens: requestedMaxTokens };
  const temperatureParam = isOpenAiGpt5Model(params.provider, params.model)
    ? {}
    : { temperature: params.temperature ?? 0.1 };

  const endpoint = `${params.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: params.model,
    ...temperatureParam,
    ...completionTokensParam,
    messages: params.messages,
    stream: false
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice ?? "auto";
  }
  if (params.responseFormat) {
    body.response_format = params.responseFormat;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (params.apiKey.trim()) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const bodyText = JSON.stringify(body);
  const doFetch = (url: string) =>
    fetch(url, {
      method: "POST",
      headers,
      body: bodyText,
      signal: params.signal
    });

  let response: Response;
  try {
    response = await doFetch(endpoint);
  } catch (error) {
    const fallbackBaseUrl =
      params.provider === "ollama" ? resolveOllamaDockerFallbackBaseUrl(params.baseUrl) : null;
    if (!fallbackBaseUrl || params.signal.aborted) {
      throw error;
    }
    const fallbackEndpoint = `${fallbackBaseUrl}/chat/completions`;
    logger.info("ai_provider_ollama_docker_fallback", {
      from_base_url: params.baseUrl,
      to_base_url: fallbackBaseUrl
    });
    response = await doFetch(fallbackEndpoint);
  }

  let payload: ChatCompletionResponse | null = null;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(readProviderError(response.status, payload, `${params.provider}_chat_completions_http`));
  }

  const messageFromChoice = payload?.choices?.[0]?.message;
  const messageFromTopLevel = payload?.message;
  const textFromChoice = flattenMessageText(payload?.choices?.[0]?.text).trim();
  const textFromTopLevel = flattenMessageText(payload?.response).trim();
  const message = messageFromChoice
    ?? messageFromTopLevel
    ?? (textFromChoice
      ? {
          role: "assistant",
          content: textFromChoice
        }
      : textFromTopLevel
        ? {
            role: "assistant",
            content: textFromTopLevel
          }
        : null);
  if (!message) {
    throw new Error("ai_empty_response");
  }

  return {
    usage: readChatUsage(payload),
    message,
    modelUsed: params.model,
    finishReason: typeof (payload as any)?.choices?.[0]?.finish_reason === "string"
      ? String((payload as any).choices[0].finish_reason)
      : null
  };
}

export async function callAiChat(
  messages: ChatMessage[],
  options: CallAiChatOptions = {}
): Promise<AiChatResult> {
  const providerResolved = await resolveAiProviderWithSource();
  if (providerResolved.provider === "disabled") throw new Error("ai_provider_disabled");

  const provider: EnabledAiProvider = providerResolved.provider;
  const key = await resolveAiApiKey(provider);
  if (!key && provider === "openai") throw new Error("ai_api_key_missing");

  const baseUrlResolved = await resolveAiBaseUrlWithSource();
  const model = options.model ?? (await getAiModelAsync());

  const timeoutMs = Number(options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? "15000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  const startedAt = Date.now();

  const billingUserId =
    typeof options.billingUserId === "string" && options.billingUserId.trim()
      ? options.billingUserId.trim()
      : null;

  if (billingUserId) {
    const access = await checkAiTokenAccess(billingUserId);
    if (!access.allowed && access.reason !== "billing_disabled") {
      if (access.reason === "pro_required") throw new Error("ai_billing_requires_pro");
      if (access.reason === "token_exhausted") throw new Error("ai_token_balance_exhausted");
      throw new Error("ai_billing_blocked");
    }
  }

  try {
    let result: AiCallResult;
    try {
      result = await callChatCompletions({
        provider,
        apiKey: key ?? "",
        baseUrl: baseUrlResolved.baseUrl,
        model,
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        tools: options.tools,
        toolChoice: options.toolChoice,
        responseFormat: options.responseFormat,
        signal: controller.signal
      });
    } catch (primaryError) {
      const fallbackModel = isOpenAiGpt5Model(provider, model)
        ? resolveFallbackModel(model)
        : null;
      if (!fallbackModel) {
        throw primaryError;
      }
      logger.warn("ai_provider_model_fallback_triggered", {
        provider,
        primary_model: model,
        fallback_model: fallbackModel,
        reason: String(primaryError)
      });
      result = await callChatCompletions({
        provider,
        apiKey: key ?? "",
        baseUrl: baseUrlResolved.baseUrl,
        model: fallbackModel,
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        tools: options.tools,
        toolChoice: options.toolChoice,
        responseFormat: options.responseFormat,
        signal: controller.signal
      });
    }

    if (billingUserId) {
      const tokenDebit =
        result.usage.totalTokens
        ?? ((result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0));
      const debit = await debitAiTokens({
        userId: billingUserId,
        tokens: tokenDebit,
        scope: options.billingScope ?? "ai_call",
        meta: {
          model: result.modelUsed,
          provider,
          promptChars: messages.reduce((sum, row) => sum + row.content.length, 0)
        }
      });
      if (!debit.charged && debit.reason !== "billing_disabled" && tokenDebit > 0) {
        if (debit.reason === "pro_required") throw new Error("ai_billing_requires_pro");
        if (debit.reason === "token_exhausted") throw new Error("ai_token_balance_exhausted");
        throw new Error("ai_billing_debit_failed");
      }
    }

    if (options.onUsage) {
      options.onUsage(result.usage);
    }

    return {
      content: readMessageContent(result.message),
      toolCalls: readToolCalls(result.message),
      usage: result.usage,
      model: result.modelUsed,
      provider,
      finishReason: result.finishReason
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    logger.warn("ai_provider_call_failed", {
      ai_provider: provider,
      ai_base_url: baseUrlResolved.baseUrl,
      ai_model: model,
      ai_call_ms: Date.now() - startedAt,
      reason: isAbort ? "timeout" : String(error)
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callAi(prompt: string, options: CallAiOptions = {}): Promise<string> {
  const messages: ChatMessage[] = [
    ...(options.systemMessage
      ? [{ role: "system" as const, content: options.systemMessage }]
      : []),
    { role: "user" as const, content: prompt }
  ];

  const result = await callAiChat(messages, {
    systemMessage: undefined,
    model: options.model,
    timeoutMs: options.timeoutMs,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    billingUserId: options.billingUserId,
    billingScope: options.billingScope,
    onUsage: options.onUsage
  });

  const text = result.content.trim();
  if (!text) {
    const reasonBits = [
      result.finishReason ? `finish_reason:${result.finishReason}` : null,
      result.toolCalls.length > 0 ? `tool_calls:${result.toolCalls.length}` : null
    ].filter(Boolean);
    if (reasonBits.length > 0) {
      throw new Error(`ai_empty_response:${reasonBits.join(",")}`);
    }
    throw new Error("ai_empty_response");
  }
  return text;
}
