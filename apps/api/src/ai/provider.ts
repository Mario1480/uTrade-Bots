import { logger } from "../logger.js";

type Provider = "none" | "openai";

export type AiCallResult = {
  ok: boolean;
  data?: any;
  error?: string;
  status?: number;
  requestId?: string;
  durationMs?: number;
};

function getProvider(): Provider {
  const raw = String(process.env.AI_PROVIDER ?? "none").toLowerCase();
  if (raw === "openai") return "openai";
  return "none";
}

function extractJson(content: string): any | null {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    // continue
  }
  const fenced = content.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }
  const start = content.search(/[\[{]/);
  if (start >= 0) {
    const end = Math.max(content.lastIndexOf("}"), content.lastIndexOf("]"));
    if (end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function callAi(prompt: string): Promise<AiCallResult> {
  const provider = getProvider();
  if (provider === "none") {
    return { ok: false, error: "disabled" };
  }

  const baseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.AI_API_KEY ?? "";
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? "10000") || 10_000;

  const requestId = `ai_${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are a read-only market-making telemetry analyst. Return strict JSON only." },
          { role: "user", content: prompt }
        ]
      })
    });

    const durationMs = Date.now() - startedAt;
    const status = resp.status;
    const text = await resp.text();
    let data: any = null;

    try {
      const parsed = JSON.parse(text);
      const content = parsed?.choices?.[0]?.message?.content ?? "";
      data = extractJson(content) ?? extractJson(text);
    } catch {
      data = extractJson(text);
    }

    if (!resp.ok || !data) {
      logger.warn("ai request failed", { requestId, status, durationMs });
      return { ok: false, error: "ai_failed", status, requestId, durationMs };
    }

    logger.info("ai request ok", { requestId, status, durationMs });
    return { ok: true, data, status, requestId, durationMs };
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    logger.warn("ai request error", { requestId, durationMs });
    return { ok: false, error: "ai_error", requestId, durationMs };
  } finally {
    clearTimeout(timeout);
  }
}
