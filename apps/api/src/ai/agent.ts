import { z } from "zod";
import { logger } from "../logger.js";
import {
  callAiChat,
  type ChatMessage,
  type CallAiChatOptions,
  type EnabledAiProvider
} from "./provider.js";
import {
  AI_AGENT_TOOL_DEFINITIONS,
  MAX_TOOL_ITERATIONS,
  executeAiTool
} from "./tools/index.js";

const agentSignalSchema = z.object({
  decision: z.enum(["long", "short", "no_trade"]),
  entry: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  take_profit: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(1000),
  explanation: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
  keyDrivers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        value: z.unknown()
      })
    )
    .max(5)
    .optional(),
  timeframe: z.string().trim().min(1).max(24).optional(),
  symbol: z.string().trim().min(1).max(32).optional(),
  invalidations: z.array(z.string().trim().min(1).max(200)).max(10).optional()
});

export type AgentSignal = z.infer<typeof agentSignalSchema>;

export type AgentAnalysisMode = "market_analysis" | "trading_explainer";

export type AgentSignalProfile = {
  explanationRequired?: boolean;
  explanationMinLength?: number;
  analysisMode?: AgentAnalysisMode;
};

const DEFAULT_AGENT_SIGNAL_PROFILE: Required<AgentSignalProfile> = {
  explanationRequired: true,
  explanationMinLength: 1,
  analysisMode: "trading_explainer"
};
const MAX_FINAL_FORMAT_RETRIES = 1;

function normalizeSignalProfile(profile: AgentSignalProfile | undefined): Required<AgentSignalProfile> {
  const explanationMinLengthRaw = Number(profile?.explanationMinLength);
  const explanationMinLength =
    Number.isFinite(explanationMinLengthRaw) && explanationMinLengthRaw > 0
      ? Math.min(900, Math.trunc(explanationMinLengthRaw))
      : DEFAULT_AGENT_SIGNAL_PROFILE.explanationMinLength;
  return {
    explanationRequired: profile?.explanationRequired !== false,
    explanationMinLength,
    analysisMode:
      profile?.analysisMode === "market_analysis"
        ? "market_analysis"
        : DEFAULT_AGENT_SIGNAL_PROFILE.analysisMode
  };
}

export function buildSignalSchema(profile: AgentSignalProfile = {}): Record<string, unknown> {
  const normalized = normalizeSignalProfile(profile);
  const required = ["decision", "confidence", "reason"];
  if (normalized.explanationRequired) {
    required.push("explanation");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: {
        type: "string",
        enum: ["long", "short", "no_trade"]
      },
      entry: {
        type: ["number", "null"]
      },
      stop_loss: {
        type: ["number", "null"]
      },
      take_profit: {
        type: ["number", "null"]
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1
      },
      reason: {
        type: "string",
        minLength: 1,
        maxLength: 1000
      },
      explanation: {
        type: "string",
        minLength: normalized.explanationMinLength,
        maxLength: 1000
      },
      tags: {
        type: "array",
        maxItems: 5,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 60
        }
      },
      keyDrivers: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: 120
            },
            value: {}
          },
          required: ["name", "value"]
        }
      },
      timeframe: {
        type: "string",
        minLength: 1,
        maxLength: 24
      },
      symbol: {
        type: "string",
        minLength: 1,
        maxLength: 32
      },
      invalidations: {
        type: "array",
        maxItems: 10,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 200
        }
      }
    },
    required
  } as const;
}

function validateAgentSignal(
  raw: unknown,
  profile: Required<AgentSignalProfile>
): AgentSignal {
  const parsed = agentSignalSchema.parse(sanitizeAgentSignalRaw(raw));
  const explanation = typeof parsed.explanation === "string" ? parsed.explanation.trim() : "";
  if (profile.explanationRequired && !explanation) {
    throw new Error("ai_agent_schema_explanation_missing");
  }
  if (explanation && explanation.length < profile.explanationMinLength) {
    throw new Error(
      `ai_agent_schema_explanation_short:${explanation.length}<${profile.explanationMinLength}`
    );
  }
  return {
    ...parsed,
    ...(explanation ? { explanation } : {})
  };
}

export type RunSignalAgentInput = {
  systemMessage: string;
  userPayload: Record<string, unknown>;
  model?: string;
  billingUserId?: string | null;
  billingScope?: string;
  timeoutMs?: number;
  maxTokens?: number;
  maxToolIterations?: number;
  profile?: AgentSignalProfile;
};

export type RunSignalAgentResult = {
  signal: AgentSignal;
  model: string;
  provider: EnabledAiProvider;
  toolIterations: number;
  content: string;
  usageTotalTokens: number | null;
};

function stripCodeFenceJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return raw;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
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
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

function normalizeJsonCandidate(raw: string): string {
  return raw
    .replace(/^[^\[{]*(\{[\s\S]*\})[^\]}]*$/m, "$1")
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

function parseFirstJsonObject(raw: string): unknown {
  const stripped = stripCodeFenceJson(raw).trim();
  if (!stripped) throw new Error("ai_agent_empty_final_response");
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

  throw new Error(`ai_agent_invalid_json:${String(lastError ?? "unknown")}`);
}

function normalizeOptionalNumberField(record: Record<string, unknown>, key: string) {
  if (!(key in record)) return;
  const raw = record[key];
  if (raw === null) {
    record[key] = null;
    return;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    delete record[key];
    return;
  }
  record[key] = parsed;
}

function sanitizeAgentSignalRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = { ...(raw as Record<string, unknown>) };

  const decisionRaw = typeof record.decision === "string" ? record.decision.trim().toLowerCase() : "";
  if (decisionRaw === "neutral" || decisionRaw === "flat" || decisionRaw === "hold" || decisionRaw === "no-trade") {
    record.decision = "no_trade";
  } else if (decisionRaw === "long" || decisionRaw === "short" || decisionRaw === "no_trade") {
    record.decision = decisionRaw;
  }

  const confidenceRaw = Number(record.confidence);
  if (Number.isFinite(confidenceRaw)) {
    const normalized = confidenceRaw > 1 && confidenceRaw <= 100 ? confidenceRaw / 100 : confidenceRaw;
    record.confidence = Number(Math.max(0, Math.min(1, normalized)).toFixed(4));
  }

  const reasonRaw = typeof record.reason === "string" ? record.reason.trim() : "";
  const explanationRaw = typeof record.explanation === "string" ? record.explanation.trim() : "";
  if (!reasonRaw && explanationRaw) {
    record.reason = explanationRaw.slice(0, 1000);
  }
  if (!explanationRaw && reasonRaw) {
    record.explanation = reasonRaw.slice(0, 1000);
  }

  normalizeOptionalNumberField(record, "entry");
  normalizeOptionalNumberField(record, "stop_loss");
  normalizeOptionalNumberField(record, "take_profit");
  return record;
}

function normalizeTotalTokens(value: number | null, next: number | null): number | null {
  if (value === null && next === null) return null;
  return (value ?? 0) + (next ?? 0);
}

function stringifyToolResult(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, error: "tool_result_unserializable" });
  }
}

export function mapDecisionToSignal(decision: AgentSignal["decision"]): "up" | "down" | "neutral" {
  if (decision === "long") return "up";
  if (decision === "short") return "down";
  return "neutral";
}

export async function runSignalAgent(input: RunSignalAgentInput): Promise<RunSignalAgentResult> {
  const signalProfile = normalizeSignalProfile(input.profile);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: input.systemMessage
    },
    {
      role: "user",
      content: JSON.stringify(input.userPayload)
    }
  ];

  const maxIterations = Math.max(1, input.maxToolIterations ?? MAX_TOOL_ITERATIONS);
  let iteration = 0;
  let finalFormatRetries = 0;
  let usageTotalTokens: number | null = null;

  while (true) {
    const result = await callAiChat(messages, {
      model: input.model,
      timeoutMs: input.timeoutMs,
      maxTokens: input.maxTokens,
      temperature: 0,
      billingUserId: input.billingUserId ?? null,
      billingScope: input.billingScope ?? "prediction_explainer_agent",
      tools: AI_AGENT_TOOL_DEFINITIONS,
      toolChoice: "auto",
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "trading_signal",
          strict: true,
          schema: buildSignalSchema(signalProfile)
        }
      }
    } satisfies CallAiChatOptions);

    usageTotalTokens = normalizeTotalTokens(usageTotalTokens, result.usage.totalTokens);

    if (result.toolCalls.length === 0) {
      try {
        const parsed = parseFirstJsonObject(result.content);
        const signal = validateAgentSignal(parsed, signalProfile);
        return {
          signal,
          model: result.model,
          provider: result.provider,
          toolIterations: iteration,
          content: result.content,
          usageTotalTokens
        };
      } catch (error) {
        if (finalFormatRetries >= MAX_FINAL_FORMAT_RETRIES) {
          throw error;
        }
        finalFormatRetries += 1;
        logger.warn("ai_agent_final_response_invalid", {
          model: result.model,
          provider: result.provider,
          retry: finalFormatRetries,
          reason: String(error),
          content_chars: result.content.length
        });
        messages.push({
          role: "assistant",
          content: result.content || ""
        });
        messages.push({
          role: "user",
          content:
            "Return only one valid JSON object. Keep analysis unchanged, but strictly match schema: " +
            "decision(long|short|no_trade), confidence(0..1), reason(string), explanation(string), optional " +
            "entry/stop_loss/take_profit/tags/keyDrivers/timeframe/symbol/invalidations. " +
            "No markdown, no prose, no code fences."
        });
        continue;
      }
    }

    if (iteration >= maxIterations) {
      throw new Error("ai_agent_max_tool_iterations_exceeded");
    }

    const assistantToolMessage: ChatMessage = {
      role: "assistant",
      content: result.content || "",
      tool_calls: result.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsText
        }
      }))
    };
    messages.push(assistantToolMessage);

    for (const toolCall of result.toolCalls) {
      const startedAt = Date.now();
      let toolPayload: unknown;
      try {
        toolPayload = await executeAiTool(toolCall.name, toolCall.argumentsText);
      } catch (error) {
        toolPayload = {
          ok: false,
          error: String(error)
        };
      }

      const toolPayloadText = stringifyToolResult(toolPayload);
      logger.info("ai_agent_tool_call", {
        tool_name: toolCall.name,
        tool_args_chars: toolCall.argumentsText.length,
        tool_result_chars: toolPayloadText.length,
        iteration,
        duration_ms: Date.now() - startedAt
      });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolPayloadText
      });
    }

    iteration += 1;
  }
}
