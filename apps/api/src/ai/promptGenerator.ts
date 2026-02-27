import { callAi, getAiModelAsync, type CallAiOptions } from "./provider.js";
import {
  AI_PROMPT_INDICATOR_OPTIONS,
  type AiPromptDirectionPreference,
  type AiPromptIndicatorKey,
  type AiPromptIndicatorOptionPublic,
  type AiPromptNewsRiskMode,
  type AiPromptSettingsStored,
  type AiPromptSlTpSource,
  type AiPromptTemplate,
  type AiPromptTimeframe
} from "./promptSettings.js";

export const PROMPT_GENERATOR_MAX_PROMPT_CHARS = 8000;

const PROMPT_GENERATOR_SUMMARY_MAX_CHARS = 1600;

const PROMPT_GENERATOR_AI_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.AI_PROMPT_GENERATOR_TIMEOUT_MS ?? process.env.AI_TIMEOUT_MS ?? "12000")
);

const PROMPT_GENERATOR_AI_MAX_TOKENS = Math.max(
  250,
  Number(process.env.AI_PROMPT_GENERATOR_MAX_TOKENS ?? "700")
);

type CallAiFn = (prompt: string, options?: CallAiOptions) => Promise<string>;

type SelectedIndicator = Pick<AiPromptIndicatorOptionPublic, "key" | "label" | "description">;

const indicatorPathsByKey = new Map<AiPromptIndicatorKey, readonly string[]>(
  AI_PROMPT_INDICATOR_OPTIONS.map((option) => [option.key, option.paths] as const)
);

export type GenerateHybridPromptTextInput = {
  strategyDescription: string;
  selectedIndicators: SelectedIndicator[];
  timeframes: AiPromptTimeframe[];
  runTimeframe: AiPromptTimeframe | null;
  billingUserId?: string | null;
  callAiFn?: CallAiFn;
};

export type GenerateHybridPromptTextResult = {
  promptText: string;
  mode: "ai" | "fallback";
  model: string;
};

export type CreateGeneratedPromptDraftInput = {
  existingSettings: AiPromptSettingsStored;
  name: string;
  promptText: string;
  indicatorKeys: AiPromptIndicatorKey[];
  ohlcvBars?: number;
  timeframes: AiPromptTimeframe[];
  runTimeframe: AiPromptTimeframe | null;
  directionPreference?: AiPromptDirectionPreference;
  confidenceTargetPct?: number;
  slTpSource?: AiPromptSlTpSource;
  newsRiskMode?: AiPromptNewsRiskMode;
  setActive: boolean;
  isPublic: boolean;
  nowIso: string;
  promptId?: string;
};

export type CreateGeneratedPromptDraftResult = {
  promptId: string;
  payload: {
    activePromptId: string | null;
    prompts: AiPromptTemplate[];
  };
};

function sanitizeMultiline(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars).trimEnd();
}

function sanitizeAiSummary(raw: string): string | null {
  const withoutFences = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`/g, "")
    .trim();

  const cleaned = sanitizeMultiline(withoutFences);
  if (cleaned.length < 40) return null;
  return truncateText(cleaned, PROMPT_GENERATOR_SUMMARY_MAX_CHARS);
}

function ensurePromptMaxLength(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= PROMPT_GENERATOR_MAX_PROMPT_CHARS) return trimmed;
  return trimmed.slice(0, PROMPT_GENERATOR_MAX_PROMPT_CHARS).trimEnd();
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
  if (timeframes.length === 0) {
    if (runTimeframe) {
      throw new Error("run_timeframe_requires_timeframes");
    }
    return null;
  }
  if (!runTimeframe) return timeframes[0];
  if (!timeframes.includes(runTimeframe)) {
    throw new Error("run_timeframe_not_in_timeframes");
  }
  return runTimeframe;
}

function makePromptId(): string {
  return `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeConfidenceTarget(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 60;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeOhlcvBars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(20, Math.min(500, Math.trunc(parsed)));
}

function buildIndicatorPathScope(selectedIndicators: SelectedIndicator[]): string[] {
  const seen = new Set<string>();
  for (const indicator of selectedIndicators) {
    const paths = indicatorPathsByKey.get(indicator.key);
    if (!paths) continue;
    for (const path of paths) {
      const trimmed = String(path).trim();
      if (!trimmed) continue;
      seen.add(trimmed);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function buildAllowedDataLines(input: {
  indicatorPaths: readonly string[];
  timeframes: readonly AiPromptTimeframe[];
}): string {
  const lines = [
    "- featureSnapshot.mtf.runTimeframe",
    "- featureSnapshot.mtf.timeframes"
  ];

  if (input.timeframes.length > 0 && input.indicatorPaths.length > 0) {
    const timeframeUnion = input.timeframes.map((timeframe) => `"${timeframe}"`).join(" | ");
    for (const path of input.indicatorPaths) {
      lines.push(`- featureSnapshot.mtf.frames[${timeframeUnion}].${path} (if present)`);
    }
  } else if (input.timeframes.length > 0) {
    for (const timeframe of input.timeframes) {
      lines.push(`- featureSnapshot.mtf.frames["${timeframe}"] (use only explicit fields selected via selectedIndicatorKeys)`);
    }
  } else if (input.indicatorPaths.length > 0) {
    for (const path of input.indicatorPaths) {
      lines.push(`- featureSnapshot.mtf.frames["<existing_tf>"].${path} (if present)`);
    }
  } else {
    lines.push("- featureSnapshot.mtf.frames (use only existing frame keys and explicit selected fields)");
  }

  lines.push(
    "- prediction",
    "- selectedIndicatorKeys",
    "- tagsAllowlist (only for selecting tags)"
  );
  return lines.join("\n");
}

function buildTimeframeRulesLines(input: {
  timeframes: readonly AiPromptTimeframe[];
  runTimeframe: AiPromptTimeframe | null;
}): string {
  const lines: string[] = [];
  if (input.timeframes.length > 0) {
    lines.push(`- Template timeframe set: ${input.timeframes.join(", ")}`);
    lines.push(`- Template run timeframe: ${input.runTimeframe ?? input.timeframes[0]}`);
  } else {
    lines.push("- Template timeframe set: none (payload determines available frames).");
    lines.push("- Template run timeframe: none.");
  }

  lines.push(
    "- Use only timeframes that actually exist under featureSnapshot.mtf.frames.",
    "- featureSnapshot.mtf.runTimeframe is execution/schedule context only.",
    "- Never infer hidden timeframes or unavailable structure.",
    "- If required evidence is missing, trimmed, ambiguous, or conflicting, return neutral."
  );
  return lines.join("\n");
}

function buildFallbackStrategySummary(input: {
  strategyDescription: string;
  selectedIndicators: SelectedIndicator[];
  timeframes: AiPromptTimeframe[];
  runTimeframe: AiPromptTimeframe | null;
}): string {
  const indicatorText =
    input.selectedIndicators.length > 0
      ? input.selectedIndicators.map((item) => `${item.label} (${item.key})`).join(", ")
      : "No explicit indicator lock; use selectedIndicatorKeys from payload only.";

  const timeframeText =
    input.timeframes.length > 0
      ? input.timeframes.join(", ")
      : "No fixed timeframe set. Use only existing MTF frames from payload.";

  const runTfText = input.runTimeframe ?? "none";
  const strategySource = truncateText(
    sanitizeMultiline(input.strategyDescription),
    PROMPT_GENERATOR_SUMMARY_MAX_CHARS
  );

  return [
    "1) Extract the core market thesis from the strategy description and keep execution deterministic.",
    "2) Use only evidence that explicitly exists in featureSnapshot, prediction, and selectedIndicatorKeys.",
    `3) Prioritize selected indicators: ${indicatorText}`,
    `4) Timeframe policy: template set = ${timeframeText}; run timeframe = ${runTfText}.`,
    "5) If evidence is missing or conflicting, return neutral with reduced confidence.",
    "6) Keep explanation concise, factual, and grounded in real featureSnapshot paths.",
    `7) Strategy description source:\n${strategySource}`
  ].join("\n");
}

function buildPromptText(input: {
  strategySummary: string;
  selectedIndicators: SelectedIndicator[];
  timeframes: AiPromptTimeframe[];
  runTimeframe: AiPromptTimeframe | null;
}): string {
  const indicatorPaths = buildIndicatorPathScope(input.selectedIndicators);
  const allowedDataLines = buildAllowedDataLines({
    indicatorPaths,
    timeframes: input.timeframes
  });
  const timeframeRuleLines = buildTimeframeRulesLines({
    timeframes: input.timeframes,
    runTimeframe: input.runTimeframe
  });
  const indicatorScopeLines =
    input.selectedIndicators.length > 0
      ? input.selectedIndicators.map((item) => `- ${item.key}: ${item.label}`).join("\n")
      : "- No explicit indicator lock. Use selectedIndicatorKeys from payload only.";

  const sections = [
    "========================",
    "ROLE / STRATEGY SCOPE",
    "========================",
    "You are a strict crypto trading validator and signal refiner.",
    "Use ONLY data present in the provided payload.",
    "Apply the operator strategy brief deterministically.",
    input.strategySummary,
    "",
    "========================",
    "ALLOWED DATA (HARD LIMIT)",
    "========================",
    "Use ONLY data present in:",
    allowedDataLines,
    "",
    "Do NOT use any other payload fields.",
    "Do NOT infer missing fields.",
    "Do NOT fabricate levels, events, timestamps, prices, or indicator states.",
    "",
    "========================",
    "IMPORTANT OUTPUT CONTRACT",
    "========================",
    "Return exactly one valid JSON object (no markdown, no code fences, no comments) with exactly these keys:",
    "{",
    "  \"explanation\": \"string <= 1000 chars\",",
    "  \"tags\": [\"max 5 items, only from tagsAllowlist\"],",
    "  \"keyDrivers\": [{\"name\":\"featureSnapshot.path\", \"value\":\"matching value\"}],",
    "  \"aiPrediction\": {",
    "    \"signal\": \"up | down | neutral\",",
    "    \"expectedMovePct\": 0.0,",
    "    \"confidence\": 0.0",
    "  },",
    "  \"disclaimer\": \"grounded_features_only\"",
    "}",
    "",
    "========================",
    "TIMEFRAME RULES",
    "========================",
    timeframeRuleLines,
    "",
    "========================",
    "KEYDRIVERS PATH FORMAT",
    "========================",
    "- keyDrivers[].name MUST be a real existing featureSnapshot path using dot-notation.",
    "- Do NOT use bracket notation in keyDrivers.name.",
    "- Use 1-5 keyDrivers only.",
    "",
    "========================",
    "INDICATOR SCOPE",
    "========================",
    indicatorScopeLines,
    "",
    "========================",
    "CONFLICT / AMBIGUITY HANDLING",
    "========================",
    "- Return neutral when required evidence is missing, inconsistent, trimmed, or ambiguous.",
    "- Return neutral when selectedIndicatorKeys imply context but relevant fields are absent.",
    "- Do not force directional signals under conflicting evidence.",
    "",
    "========================",
    "CONFIDENCE (0..1)",
    "========================",
    "- confidence must be numeric and clamped to [0.0, 1.0].",
    "- Base confidence on explicit, aligned evidence only.",
    "- Reduce confidence for missing or conflicting evidence.",
    "- If prediction.confidence is numeric, you may cap derived confidence by it.",
    "",
    "========================",
    "EXPECTED MOVE (>= 0, NUMERIC ONLY)",
    "========================",
    "- expectedMovePct must be numeric and never negative.",
    "- Use allowed numeric fields only; if unavailable, use prediction.expectedMovePct when numeric, otherwise 0.0.",
    "",
    "========================",
    "TAGS (ALLOWLIST ONLY)",
    "========================",
    "- tags max 5, only items from tagsAllowlist.",
    "- Select tags only when explicit evidence supports them.",
    "- If no relevant allowed tags exist, return [].",
    "",
    "========================",
    "EXPLANATION (<=1000 CHARS)",
    "========================",
    "- Keep explanation deterministic and concise (2-5 short sentences).",
    "- Reference only exact used featureSnapshot paths (dot-notation).",
    "- If neutral, state clear cause: missing data, ambiguity, or conflict.",
    "- Do not mention TradingView.",
    "Return the JSON object and nothing else."
  ];

  return ensurePromptMaxLength(sections.join("\n"));
}

async function summarizeStrategyWithAi(params: {
  strategyDescription: string;
  selectedIndicators: SelectedIndicator[];
  timeframes: AiPromptTimeframe[];
  runTimeframe: AiPromptTimeframe | null;
  billingUserId?: string | null;
  callAiFn: CallAiFn;
  model: string;
}): Promise<string | null> {
  const indicatorLine = params.selectedIndicators.length > 0
    ? params.selectedIndicators.map((item) => `${item.label} (${item.key})`).join(", ")
    : "No explicit indicator lock.";

  const prompt = [
    "Convert this strategy brief into concise operator instructions for an AI trading explainer prompt.",
    "Return plain text only.",
    "Return 6-10 numbered lines.",
    "Do not output JSON.",
    "Do not output markdown headings.",
    "Do not mention any data that is not explicitly available in payload.",
    "",
    `Strategy description:\n${sanitizeMultiline(params.strategyDescription)}`,
    `Selected indicators: ${indicatorLine}`,
    `Allowed timeframes: ${params.timeframes.length > 0 ? params.timeframes.join(", ") : "payload timeframe only"}`,
    `Run timeframe: ${params.runTimeframe ?? "none"}`
  ].join("\n");

  const aiText = await params.callAiFn(prompt, {
    systemMessage:
      "You are a quantitative trading prompt engineer. Output concise, deterministic operator instructions in English.",
    model: params.model,
    temperature: 0.2,
    timeoutMs: PROMPT_GENERATOR_AI_TIMEOUT_MS,
    maxTokens: PROMPT_GENERATOR_AI_MAX_TOKENS,
    billingUserId: params.billingUserId ?? null,
    billingScope: "prompt_generator"
  });

  return sanitizeAiSummary(aiText);
}

export async function generateHybridPromptText(
  input: GenerateHybridPromptTextInput
): Promise<GenerateHybridPromptTextResult> {
  const model = await getAiModelAsync();
  const timeframes = uniqueTimeframes(input.timeframes);
  const runTimeframe = normalizeRunTimeframe(timeframes, input.runTimeframe);
  const callAiFn = input.callAiFn ?? callAi;

  let mode: "ai" | "fallback" = "ai";
  let strategySummary: string | null = null;

  try {
    strategySummary = await summarizeStrategyWithAi({
      strategyDescription: input.strategyDescription,
      selectedIndicators: input.selectedIndicators,
      timeframes,
      runTimeframe,
      billingUserId: input.billingUserId ?? null,
      callAiFn,
      model
    });
  } catch {
    strategySummary = null;
  }

  if (!strategySummary) {
    mode = "fallback";
    strategySummary = buildFallbackStrategySummary({
      strategyDescription: input.strategyDescription,
      selectedIndicators: input.selectedIndicators,
      timeframes,
      runTimeframe
    });
  }

  const promptText = buildPromptText({
    strategySummary,
    selectedIndicators: input.selectedIndicators,
    timeframes,
    runTimeframe
  });

  return {
    promptText,
    mode,
    model
  };
}

export function createGeneratedPromptDraft(
  input: CreateGeneratedPromptDraftInput
): CreateGeneratedPromptDraftResult {
  const promptId = input.promptId ?? makePromptId();
  const timeframes = uniqueTimeframes(input.timeframes);
  const runTimeframe = normalizeRunTimeframe(timeframes, input.runTimeframe);
  const directionPreference = input.directionPreference ?? "either";
  const confidenceTargetPct = normalizeConfidenceTarget(input.confidenceTargetPct);
  const slTpSource = input.slTpSource ?? "local";
  const newsRiskMode = input.newsRiskMode ?? "off";
  const ohlcvBars = normalizeOhlcvBars(input.ohlcvBars);

  const createdPrompt: AiPromptTemplate = {
    id: promptId,
    name: input.name.trim(),
    promptText: ensurePromptMaxLength(input.promptText),
    indicatorKeys: [...input.indicatorKeys],
    ohlcvBars,
    timeframes,
    runTimeframe,
    timeframe: runTimeframe,
    directionPreference,
    confidenceTargetPct,
    slTpSource,
    newsRiskMode,
    marketAnalysisUpdateEnabled: false,
    isPublic: input.isPublic,
    createdAt: input.nowIso,
    updatedAt: input.nowIso
  };

  return {
    promptId,
    payload: {
      activePromptId: input.setActive
        ? promptId
        : (input.existingSettings.activePromptId ?? null),
      prompts: [createdPrompt, ...input.existingSettings.prompts]
    }
  };
}
