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

export function getAiModel(): string {
  return process.env.AI_MODEL?.trim() || "gpt-4o-mini";
}

export async function callAi(prompt: string, options: CallAiOptions = {}): Promise<string> {
  const provider = resolveProvider(process.env.AI_PROVIDER);
  if (provider === "disabled") throw new Error("ai_provider_disabled");

  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) throw new Error("ai_api_key_missing");

  const model = options.model ?? getAiModel();
  const timeoutMs = Number(options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? "8000");
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

