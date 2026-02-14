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

export type CallAiOptions = {
  systemMessage?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const AI_API_KEYS_GLOBAL_SETTING_KEY = "admin.apiKeys";
const AI_DB_KEY_CACHE_TTL_MS =
  Math.max(5, Number(process.env.AI_DB_KEY_CACHE_TTL_SEC ?? "30")) * 1000;

const db = prisma as any;
let dbApiKeyCacheUntil = 0;
let dbApiKeyCached: string | null = null;
let dbApiKeyInFlight: Promise<string | null> | null = null;

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

function parseStoredOpenAiKeyEnc(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).openaiApiKeyEnc;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export function getAiModel(): string {
  return process.env.AI_MODEL?.trim() || "gpt-4o-mini";
}

export async function callAi(prompt: string, options: CallAiOptions = {}): Promise<string> {
  const provider = resolveProvider(process.env.AI_PROVIDER);
  if (provider === "disabled") throw new Error("ai_provider_disabled");

  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) throw new Error("ai_api_key_missing");

  const model = options.model ?? getAiModel();
  const timeoutMs = Number(options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? "15000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  const startedAt = Date.now();

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 220,
        messages: [
          ...(options.systemMessage
            ? [{ role: "system", content: options.systemMessage }]
            : []),
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });

    let payload: ChatCompletionResponse | null = null;
    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errMessage = payload?.error?.message ?? `openai_http_${response.status}`;
      throw new Error(errMessage);
    }

    return readContent(payload ?? {});
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
