import { prisma } from "@mm/db";
import { decryptSecret } from "../secret-crypto.js";
import { logger } from "../logger.js";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type OpenAiErrorPayload = {
  error?: {
    message?: string;
  };
};

type ResponsesApiResponse = OpenAiErrorPayload & {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

export type CallAiOptions = {
  systemMessage?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
};

const OPENAI_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
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
export type AiModelSource = "db" | "env" | "default";
const OPENAI_DEFAULT_MODEL: OpenAiAdminModel = "gpt-4o-mini";
const OPENAI_ADMIN_MODEL_OPTION_SET = new Set<string>(OPENAI_ADMIN_MODEL_OPTIONS);

const db = prisma as any;
let dbApiKeyCacheUntil = 0;
let dbApiKeyCached: string | null = null;
let dbApiKeyInFlight: Promise<string | null> | null = null;
let dbModelCacheUntil = 0;
let dbModelCached: OpenAiAdminModel | null = null;
let dbModelInFlight: Promise<OpenAiAdminModel | null> | null = null;

function resolveProvider(value: string | undefined): "openai" | "disabled" {
  const normalized = (value ?? "openai").trim().toLowerCase();
  if (normalized === "off" || normalized === "disabled" || normalized === "none") {
    return "disabled";
  }
  return "openai";
}

function readContent(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text.length > 0) return text;
  }
  throw new Error("ai_empty_response");
}

function readResponsesContent(payload: ResponsesApiResponse): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }
  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if (typeof part.text === "string" && part.text.trim().length > 0) {
        chunks.push(part.text.trim());
      }
    }
  }
  const combined = chunks.join("\n").trim();
  if (combined.length > 0) return combined;
  throw new Error("ai_empty_response");
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

function isGpt5Model(model: string): boolean {
  return model.startsWith("gpt-5");
}

function resolveFallbackModel(primaryModel: string): string | null {
  const envFallback = process.env.AI_FALLBACK_MODEL?.trim() ?? "";
  const fallback = envFallback || "gpt-4o-mini";
  return fallback && fallback !== primaryModel ? fallback : null;
}

async function callOpenAiChatCompletions(params: {
  apiKey: string;
  model: string;
  prompt: string;
  systemMessage?: string;
  temperature?: number;
  maxTokens?: number;
  signal: AbortSignal;
}): Promise<string> {
  const requestedMaxTokens = params.maxTokens ?? 220;
  const gpt5 = isGpt5Model(params.model);
  const completionTokensParam = gpt5
    ? { max_completion_tokens: requestedMaxTokens }
    : { max_tokens: requestedMaxTokens };
  const temperatureParam = gpt5 ? {} : { temperature: params.temperature ?? 0.1 };

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      ...temperatureParam,
      ...completionTokensParam,
      messages: [
        ...(params.systemMessage
          ? [{ role: "system", content: params.systemMessage }]
          : []),
        { role: "user", content: params.prompt }
      ]
    }),
    signal: params.signal
  });

  let payload: ChatCompletionResponse | null = null;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(readProviderError(response.status, payload, "openai_http"));
  }
  return readContent(payload ?? {});
}

async function callOpenAiResponses(params: {
  apiKey: string;
  model: string;
  prompt: string;
  systemMessage?: string;
  maxTokens?: number;
  signal: AbortSignal;
}): Promise<string> {
  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      max_output_tokens: params.maxTokens ?? 220,
      input: [
        ...(params.systemMessage
          ? [{
              role: "system",
              content: [{ type: "input_text", text: params.systemMessage }]
            }]
          : []),
        {
          role: "user",
          content: [{ type: "input_text", text: params.prompt }]
        }
      ]
    }),
    signal: params.signal
  });

  let payload: ResponsesApiResponse | null = null;
  try {
    payload = (await response.json()) as ResponsesApiResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(readProviderError(response.status, payload, "openai_responses_http"));
  }
  return readResponsesContent(payload ?? {});
}

function parseStoredOpenAiKeyEnc(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).openaiApiKeyEnc;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeConfiguredOpenAiModel(value: unknown): OpenAiAdminModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!OPENAI_ADMIN_MODEL_OPTION_SET.has(trimmed)) {
    return null;
  }
  return trimmed as OpenAiAdminModel;
}

function parseStoredOpenAiModel(value: unknown): OpenAiAdminModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).openaiModel;
  return normalizeConfiguredOpenAiModel(raw);
}

async function loadDbOpenAiApiKey(): Promise<string | null> {
  const row = await db.globalSetting.findUnique({
    where: { key: AI_API_KEYS_GLOBAL_SETTING_KEY },
    select: { value: true }
  });
  const openaiApiKeyEnc = parseStoredOpenAiKeyEnc(row?.value);
  if (!openaiApiKeyEnc) return null;
  const decrypted = decryptSecret(openaiApiKeyEnc).trim();
  return decrypted.length > 0 ? decrypted : null;
}

async function loadDbOpenAiModel(): Promise<OpenAiAdminModel | null> {
  const row = await db.globalSetting.findUnique({
    where: { key: AI_API_KEYS_GLOBAL_SETTING_KEY },
    select: { value: true }
  });
  return parseStoredOpenAiModel(row?.value);
}

async function resolveOpenAiApiKey(): Promise<string | null> {
  const envApiKey = process.env.AI_API_KEY?.trim() || null;
  const now = Date.now();
  if (now < dbApiKeyCacheUntil) {
    return dbApiKeyCached ?? envApiKey;
  }

  if (!dbApiKeyInFlight) {
    dbApiKeyInFlight = (async () => {
      try {
        return await loadDbOpenAiApiKey();
      } catch (error) {
        logger.warn("ai_provider_key_lookup_failed", {
          reason: String(error)
        });
        return null;
      } finally {
        dbApiKeyInFlight = null;
      }
    })();
  }

  dbApiKeyCached = await dbApiKeyInFlight;
  dbApiKeyCacheUntil = Date.now() + AI_DB_KEY_CACHE_TTL_MS;
  return dbApiKeyCached ?? envApiKey;
}

export function invalidateAiApiKeyCache() {
  dbApiKeyCacheUntil = 0;
  dbApiKeyCached = null;
  dbApiKeyInFlight = null;
}

export function invalidateAiModelCache() {
  dbModelCacheUntil = 0;
  dbModelCached = null;
  dbModelInFlight = null;
}

async function resolveDbConfiguredOpenAiModel(): Promise<OpenAiAdminModel | null> {
  const now = Date.now();
  if (now < dbModelCacheUntil) {
    return dbModelCached;
  }

  if (!dbModelInFlight) {
    dbModelInFlight = (async () => {
      try {
        return await loadDbOpenAiModel();
      } catch (error) {
        logger.warn("ai_provider_model_lookup_failed", {
          reason: String(error)
        });
        return null;
      } finally {
        dbModelInFlight = null;
      }
    })();
  }

  dbModelCached = await dbModelInFlight;
  dbModelCacheUntil = Date.now() + AI_DB_MODEL_CACHE_TTL_MS;
  return dbModelCached;
}

export function resolveAiModelFromConfig(input: {
  dbModel?: string | null;
  envModel?: string | null | undefined;
}): { model: OpenAiAdminModel; source: AiModelSource } {
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

export async function resolveAiModelWithSource(): Promise<{
  model: OpenAiAdminModel;
  source: AiModelSource;
}> {
  const dbModel = await resolveDbConfiguredOpenAiModel();
  return resolveAiModelFromConfig({
    dbModel,
    envModel: process.env.AI_MODEL
  });
}

export async function getAiModelAsync(): Promise<OpenAiAdminModel> {
  const resolved = await resolveAiModelWithSource();
  return resolved.model;
}

export function getAiModel(): OpenAiAdminModel {
  return resolveAiModelFromConfig({
    envModel: process.env.AI_MODEL
  }).model;
}

export async function callAi(prompt: string, options: CallAiOptions = {}): Promise<string> {
  const provider = resolveProvider(process.env.AI_PROVIDER);
  if (provider === "disabled") throw new Error("ai_provider_disabled");

  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) throw new Error("ai_api_key_missing");

  const model = options.model ?? (await getAiModelAsync());
  const timeoutMs = Number(options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? "15000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  const startedAt = Date.now();

  try {
    if (isGpt5Model(model)) {
      try {
        return await callOpenAiResponses({
          apiKey,
          model,
          prompt,
          systemMessage: options.systemMessage,
          maxTokens: options.maxTokens,
          signal: controller.signal
        });
      } catch (primaryError) {
        const fallbackModel = resolveFallbackModel(model);
        if (!fallbackModel) {
          throw primaryError;
        }
        logger.warn("ai_provider_model_fallback_triggered", {
          primary_model: model,
          fallback_model: fallbackModel,
          reason: String(primaryError)
        });
        return await callOpenAiChatCompletions({
          apiKey,
          model: fallbackModel,
          prompt,
          systemMessage: options.systemMessage,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          signal: controller.signal
        });
      }
    }

    return await callOpenAiChatCompletions({
      apiKey,
      model,
      prompt,
      systemMessage: options.systemMessage,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: controller.signal
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    logger.warn("ai_provider_call_failed", {
      ai_model: model,
      ai_call_ms: Date.now() - startedAt,
      reason: isAbort ? "timeout" : String(error)
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
