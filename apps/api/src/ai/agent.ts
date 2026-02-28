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
  const parsed = agentSignalSchema.parse(raw);
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

function parseFirstJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("ai_agent_empty_final_response");

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("ai_agent_invalid_json");
  }
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
