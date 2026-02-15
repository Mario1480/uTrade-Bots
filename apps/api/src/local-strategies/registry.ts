import { prisma } from "@mm/db";
import { hashStableObject } from "../ai/analyzer.js";
import { logger } from "../logger.js";
import {
  executePythonStrategy,
  getPythonRunnerMetrics
} from "./pythonRunner.js";
import {
  type PythonStrategyRunContext,
  getPythonStrategyHealth,
  listPythonStrategies
} from "./pythonClient.js";

const db = prisma as any;

export type LocalStrategySignal = "up" | "down" | "neutral";

export type LocalStrategyExecutionContext = {
  signal?: LocalStrategySignal;
  exchange?: string;
  accountId?: string;
  symbol?: string;
  marketType?: string;
  timeframe?: string;
  [key: string]: unknown;
};

export type LocalStrategyResult = {
  strategyId: string;
  strategyType: string;
  strategyName: string;
  version: string;
  isEnabled: boolean;
  allow: boolean;
  score: number;
  reasonCodes: string[];
  tags: string[];
  explanation: string;
  configHash: string;
  snapshotHash: string;
  meta: Record<string, unknown>;
};

export type LocalStrategyDefinitionRecord = {
  id: string;
  strategyType: string;
  engine: "ts" | "python";
  shadowMode: boolean;
  remoteStrategyType: string | null;
  fallbackStrategyType: string | null;
  timeoutMs: number | null;
  name: string;
  description: string | null;
  version: string;
  inputSchema: Record<string, unknown> | null;
  configJson: Record<string, unknown>;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type LocalStrategyHandler = (
  featureSnapshot: Record<string, unknown>,
  config: Record<string, unknown>,
  ctx: LocalStrategyExecutionContext
) => {
  allow: boolean;
  score?: number;
  reasonCodes?: string[];
  tags?: string[];
  explanation?: string;
  meta?: Record<string, unknown>;
};

export type LocalStrategyRegistration = {
  type: string;
  handler: LocalStrategyHandler;
  defaultConfig: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
};

const localStrategyRegistry = new Map<string, LocalStrategyRegistration>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const normalized = sanitizeUnknown(entry);
      if (normalized !== undefined) {
        out[key] = normalized;
      }
    }
    return out;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined) return undefined;
  return value;
}

function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = out[key];
    const baseRecord = asRecord(baseValue);
    const valueRecord = asRecord(value);
    if (baseRecord && valueRecord) {
      out[key] = mergeConfig(baseRecord, valueRecord);
      continue;
    }
    out[key] = sanitizeUnknown(value);
  }
  return out;
}

function normalizeReasonCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const value = item.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeDefinitionRecord(value: unknown): LocalStrategyDefinitionRecord | null {
  const row = asRecord(value);
  if (!row) return null;

  const id = typeof row.id === "string" ? row.id.trim() : "";
  const strategyType = typeof row.strategyType === "string" ? row.strategyType.trim() : "";
  const engine = row.engine === "python" ? "python" : "ts";
  const shadowMode = row.shadowMode === true;
  const remoteStrategyType =
    typeof row.remoteStrategyType === "string" && row.remoteStrategyType.trim()
      ? row.remoteStrategyType.trim()
      : null;
  const fallbackStrategyType =
    typeof row.fallbackStrategyType === "string" && row.fallbackStrategyType.trim()
      ? row.fallbackStrategyType.trim()
      : null;
  const timeoutMsRaw = normalizeFiniteNumber(row.timeoutMs);
  const timeoutMs =
    timeoutMsRaw !== null ? Math.max(200, Math.min(10_000, Math.trunc(timeoutMsRaw))) : null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const version = typeof row.version === "string" ? row.version.trim() : "1.0.0";
  const isEnabled = row.isEnabled !== false;

  if (!id || !strategyType || !name) return null;

  const description =
    typeof row.description === "string" && row.description.trim()
      ? row.description.trim()
      : null;

  const inputSchemaRaw = asRecord(row.inputSchema);
  const configRaw = asRecord(row.configJson) ?? {};

  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt ?? ""));
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt ?? ""));

  return {
    id,
    strategyType,
    engine,
    shadowMode,
    remoteStrategyType,
    fallbackStrategyType,
    timeoutMs,
    name,
    description,
    version,
    inputSchema: inputSchemaRaw ? (sanitizeUnknown(inputSchemaRaw) as Record<string, unknown>) : null,
    configJson: sanitizeUnknown(configRaw) as Record<string, unknown>,
    isEnabled,
    createdAt: Number.isFinite(createdAt.getTime()) ? createdAt : new Date(0),
    updatedAt: Number.isFinite(updatedAt.getTime()) ? updatedAt : new Date(0)
  };
}

function safeObject(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) return {};
  return sanitizeUnknown(record) as Record<string, unknown>;
}

function compactSignal(value: unknown): LocalStrategySignal | undefined {
  if (value === "up" || value === "down" || value === "neutral") return value;
  return undefined;
}

function buildSnapshotHash(params: {
  strategyId: string;
  strategyType: string;
  featureSnapshot: Record<string, unknown>;
  config: Record<string, unknown>;
  ctx: LocalStrategyExecutionContext;
}): string {
  return hashStableObject({
    strategyId: params.strategyId,
    strategyType: params.strategyType,
    featureSnapshot: sanitizeUnknown(params.featureSnapshot),
    config: sanitizeUnknown(params.config),
    ctx: {
      signal: compactSignal(params.ctx.signal),
      exchange: typeof params.ctx.exchange === "string" ? params.ctx.exchange : null,
      accountId: typeof params.ctx.accountId === "string" ? params.ctx.accountId : null,
      symbol: typeof params.ctx.symbol === "string" ? params.ctx.symbol : null,
      marketType: typeof params.ctx.marketType === "string" ? params.ctx.marketType : null,
      timeframe: typeof params.ctx.timeframe === "string" ? params.ctx.timeframe : null
    }
  });
}

function runRegimeGateStrategy(
  featureSnapshot: Record<string, unknown>,
  configInput: Record<string, unknown>,
  ctx: LocalStrategyExecutionContext
) {
  const defaultConfig = {
    allowStates: ["trend_up", "trend_down", "transition"],
    minRegimeConfidencePct: 45,
    requireStackAlignment: true,
    allowUnknownRegime: false
  };
  const config = mergeConfig(defaultConfig, configInput);

  const history = asRecord(featureSnapshot.historyContext);
  const reg = asRecord(history?.reg);
  const ema = asRecord(history?.ema);

  const state = typeof reg?.state === "string" ? reg.state.trim() : "unknown";
  const conf = normalizeFiniteNumber(reg?.conf);
  const stack = typeof ema?.stk === "string" ? ema.stk.trim() : "unknown";
  const signal = compactSignal(ctx.signal) ?? "neutral";

  const allowStates = Array.isArray(config.allowStates)
    ? config.allowStates.filter((item): item is string => typeof item === "string")
    : defaultConfig.allowStates;
  const minRegimeConfidencePct =
    normalizeFiniteNumber(config.minRegimeConfidencePct) ?? defaultConfig.minRegimeConfidencePct;
  const requireStackAlignment = config.requireStackAlignment !== false;
  const allowUnknownRegime = config.allowUnknownRegime === true;

  const reasonCodes: string[] = [];
  let allow = true;

  if (state === "unknown" && !allowUnknownRegime) {
    allow = false;
    reasonCodes.push("regime_unknown");
  }

  if (allow && !allowStates.includes(state)) {
    allow = false;
    reasonCodes.push("regime_state_not_allowed");
  }

  if (allow && conf !== null && conf < minRegimeConfidencePct) {
    allow = false;
    reasonCodes.push("regime_confidence_low");
  }

  if (allow && requireStackAlignment) {
    const stateStackMismatch =
      (state === "trend_up" && stack === "bear")
      || (state === "trend_down" && stack === "bull");
    if (stateStackMismatch) {
      allow = false;
      reasonCodes.push("ema_stack_conflict");
    }
    const signalStackMismatch =
      (signal === "up" && stack === "bear")
      || (signal === "down" && stack === "bull");
    if (allow && signalStackMismatch) {
      allow = false;
      reasonCodes.push("signal_stack_conflict");
    }
  }

  const scoreBase = conf !== null ? conf : 50;
  const score = Math.max(0, Math.min(100, allow ? scoreBase : Math.min(scoreBase, 35)));

  return {
    allow,
    score,
    reasonCodes,
    tags: allow ? ["regime_ok"] : ["regime_block"],
    explanation: allow
      ? "Regime gate passed with aligned structure context."
      : "Regime gate blocked due to incompatible regime/EMA alignment.",
    meta: {
      regimeState: state,
      regimeConfidencePct: conf,
      emaStack: stack,
      signal,
      minRegimeConfidencePct,
      requireStackAlignment
    }
  };
}

function runSignalFilterStrategy(
  featureSnapshot: Record<string, unknown>,
  configInput: Record<string, unknown>
) {
  const defaultConfig = {
    blockedTags: ["data_gap", "news_risk"],
    requiredTags: [] as string[],
    maxVolZ: 2.5,
    blockRangeStates: ["range"],
    allowRangeWhenTrendTag: false
  };
  const config = mergeConfig(defaultConfig, configInput);

  const tags = Array.isArray(featureSnapshot.tags)
    ? featureSnapshot.tags.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase())
    : [];

  const history = asRecord(featureSnapshot.historyContext);
  const reg = asRecord(history?.reg);
  const vol = asRecord(history?.vol);

  const state = typeof reg?.state === "string" ? reg.state.trim() : "unknown";
  const volZ = normalizeFiniteNumber(vol?.z);

  const blockedTags = Array.isArray(config.blockedTags)
    ? config.blockedTags.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase())
    : defaultConfig.blockedTags;
  const requiredTags = Array.isArray(config.requiredTags)
    ? config.requiredTags.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase())
    : defaultConfig.requiredTags;
  const blockRangeStates = Array.isArray(config.blockRangeStates)
    ? config.blockRangeStates.filter((item): item is string => typeof item === "string")
    : defaultConfig.blockRangeStates;
  const allowRangeWhenTrendTag = config.allowRangeWhenTrendTag === true;
  const maxVolZ = normalizeFiniteNumber(config.maxVolZ) ?? defaultConfig.maxVolZ;

  const reasonCodes: string[] = [];
  let allow = true;

  if (allow && blockedTags.some((tag) => tags.includes(tag))) {
    allow = false;
    reasonCodes.push("blocked_tag_match");
  }

  if (allow && requiredTags.length > 0 && !requiredTags.every((tag) => tags.includes(tag))) {
    allow = false;
    reasonCodes.push("required_tag_missing");
  }

  if (allow && volZ !== null && Math.abs(volZ) > maxVolZ) {
    allow = false;
    reasonCodes.push("volatility_guard");
  }

  const hasTrendTag = tags.includes("trend_up") || tags.includes("trend_down");
  if (allow && blockRangeStates.includes(state)) {
    if (!(allowRangeWhenTrendTag && hasTrendTag)) {
      allow = false;
      reasonCodes.push("range_state_block");
    }
  }

  let score = 70;
  if (volZ !== null) {
    score = Math.max(0, Math.min(100, score - Math.max(0, Math.abs(volZ) - 1) * 10));
  }
  if (!allow) {
    score = Math.min(score, 30);
  }

  return {
    allow,
    score,
    reasonCodes,
    tags: allow ? ["signal_filter_ok"] : ["signal_filter_block"],
    explanation: allow
      ? "Signal filter passed with acceptable tag/volatility regime context."
      : "Signal filter blocked due to tag, volatility, or range-state restrictions.",
    meta: {
      tags,
      blockedTags,
      requiredTags,
      regimeState: state,
      volZ,
      maxVolZ,
      allowRangeWhenTrendTag
    }
  };
}

const BUILTIN_STRATEGIES: Array<{
  type: string;
  handler: LocalStrategyHandler;
  defaultConfig: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
}> = [
  {
    type: "regime_gate",
    handler: runRegimeGateStrategy,
    defaultConfig: {
      allowStates: ["trend_up", "trend_down", "transition"],
      minRegimeConfidencePct: 45,
      requireStackAlignment: true,
      allowUnknownRegime: false
    },
    uiSchema: {
      title: "Regime Gate",
      description: "Uses historyContext.reg and historyContext.ema.stk to allow/block deterministic setups.",
      fields: {
        allowStates: { type: "multiselect", options: ["trend_up", "trend_down", "range", "transition", "unknown"] },
        minRegimeConfidencePct: { type: "number", min: 0, max: 100, step: 1 },
        requireStackAlignment: { type: "boolean" },
        allowUnknownRegime: { type: "boolean" }
      }
    }
  },
  {
    type: "signal_filter",
    handler: runSignalFilterStrategy,
    defaultConfig: {
      blockedTags: ["data_gap", "news_risk"],
      requiredTags: [],
      maxVolZ: 2.5,
      blockRangeStates: ["range"],
      allowRangeWhenTrendTag: false
    },
    uiSchema: {
      title: "Signal Filter",
      description: "Blocks setups by tags, volatility pressure, and range-state constraints.",
      fields: {
        blockedTags: { type: "string_array" },
        requiredTags: { type: "string_array" },
        maxVolZ: { type: "number", min: 0, max: 10, step: 0.1 },
        blockRangeStates: { type: "multiselect", options: ["range", "transition", "unknown"] },
        allowRangeWhenTrendTag: { type: "boolean" }
      }
    }
  }
];

export function registerLocalStrategy(
  type: string,
  handler: LocalStrategyHandler,
  defaultConfig: Record<string, unknown>,
  uiSchema: Record<string, unknown>
): void {
  const normalizedType = type.trim();
  if (!normalizedType) {
    throw new Error("strategy_type_required");
  }
  if (typeof handler !== "function") {
    throw new Error("strategy_handler_required");
  }
  if (localStrategyRegistry.has(normalizedType)) {
    throw new Error(`strategy_already_registered:${normalizedType}`);
  }
  localStrategyRegistry.set(normalizedType, {
    type: normalizedType,
    handler,
    defaultConfig: safeObject(defaultConfig),
    uiSchema: safeObject(uiSchema)
  });
}

export function listRegisteredLocalStrategies(): LocalStrategyRegistration[] {
  return [...localStrategyRegistry.values()].map((entry) => ({
    type: entry.type,
    handler: entry.handler,
    defaultConfig: safeObject(entry.defaultConfig),
    uiSchema: safeObject(entry.uiSchema)
  }));
}

export function getRegisteredLocalStrategy(type: string): LocalStrategyRegistration | null {
  return localStrategyRegistry.get(type.trim()) ?? null;
}

function registerBuiltins() {
  for (const entry of BUILTIN_STRATEGIES) {
    if (localStrategyRegistry.has(entry.type)) continue;
    registerLocalStrategy(entry.type, entry.handler, entry.defaultConfig, entry.uiSchema);
  }
}

registerBuiltins();

export function getBuiltinLocalStrategyTemplates(): Array<{
  strategyType: string;
  name: string;
  description: string;
  version: string;
  inputSchema: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
}> {
  return BUILTIN_STRATEGIES.map((entry) => ({
    strategyType: entry.type,
    name: entry.uiSchema.title as string,
    description: entry.uiSchema.description as string,
    version: "1.0.0",
    inputSchema: {
      featureSnapshot: "record",
      ctx: {
        signal: "up|down|neutral"
      }
    },
    defaultConfig: safeObject(entry.defaultConfig),
    uiSchema: safeObject(entry.uiSchema)
  }));
}

export async function listPythonStrategyRegistry(): Promise<{
  enabled: boolean;
  health: { status: string; version: string } | null;
  items: Array<{
    type: string;
    name: string;
    version: string;
    defaultConfig: Record<string, unknown>;
    uiSchema: Record<string, unknown>;
  }>;
  metrics: {
    calls: number;
    failures: number;
    timeouts: number;
    cbOpenTotal: number;
    cbSkippedTotal: number;
    cbOpen: boolean;
    cbUntilTs: string | null;
  };
}> {
  const enabled = String(process.env.PY_STRATEGY_ENABLED ?? "false").trim().toLowerCase() === "true";
  if (!enabled) {
    return {
      enabled,
      health: null,
      items: [],
      metrics: getPythonRunnerMetrics()
    };
  }
  try {
    const [health, items] = await Promise.all([
      getPythonStrategyHealth(),
      listPythonStrategies()
    ]);
    return {
      enabled,
      health,
      items,
      metrics: getPythonRunnerMetrics()
    };
  } catch (error) {
    logger.warn("local_strategy_python_registry_unavailable", {
      reason: String(error)
    });
    return {
      enabled,
      health: null,
      items: [],
      metrics: getPythonRunnerMetrics()
    };
  }
}

export async function runLocalStrategy(
  strategyId: string,
  featureSnapshot: Record<string, unknown>,
  ctx: LocalStrategyExecutionContext = {},
  deps?: {
    getStrategyById?: (id: string) => Promise<LocalStrategyDefinitionRecord | null>;
    runPythonStrategy?: (params: {
      strategyType: string;
      strategyVersion?: string;
      config: Record<string, unknown>;
      featureSnapshot: Record<string, unknown>;
      context: PythonStrategyRunContext;
      timeoutMs?: number | null;
      trace?: {
        runId?: string;
        source?: string;
      };
    }) => Promise<
      | { ok: true; result: { allow: boolean; score: number; reasonCodes: string[]; tags: string[]; explanation: string; meta: Record<string, unknown> } }
      | { ok: false; errorCode: string; status: number | null; message: string; meta: Record<string, unknown> }
    >;
  }
): Promise<LocalStrategyResult> {
  const normalizedId = strategyId.trim();
  if (!normalizedId) {
    throw new Error("strategy_id_required");
  }

  const row = deps?.getStrategyById
    ? await deps.getStrategyById(normalizedId)
    : await (async () => {
      if (!db.localStrategyDefinition || typeof db.localStrategyDefinition.findUnique !== "function") {
        throw new Error("local_strategies_not_ready");
      }
      const found = await db.localStrategyDefinition.findUnique({ where: { id: normalizedId } });
      return normalizeDefinitionRecord(found);
    })();

  const definition = normalizeDefinitionRecord(row);
  if (!definition) {
    throw new Error("strategy_not_found");
  }

  const normalizedFeatureSnapshot = safeObject(featureSnapshot);
  const normalizedCtx = sanitizeUnknown(ctx) as LocalStrategyExecutionContext;
  const pythonStrategyType =
    definition.remoteStrategyType && definition.remoteStrategyType.trim()
      ? definition.remoteStrategyType.trim()
      : definition.strategyType;
  const configHash = hashStableObject({
    strategyType: definition.strategyType,
    engine: definition.engine,
    shadowMode: definition.shadowMode,
    remoteStrategyType: pythonStrategyType,
    fallbackStrategyType: definition.fallbackStrategyType,
    timeoutMs: definition.timeoutMs,
    configJson: definition.configJson
  });
  const snapshotHash = buildSnapshotHash({
    strategyId: definition.id,
    strategyType: definition.strategyType,
    featureSnapshot: normalizedFeatureSnapshot,
    config: definition.configJson,
    ctx: normalizedCtx
  });

  if (!definition.isEnabled) {
    return {
      strategyId: definition.id,
      strategyType: definition.strategyType,
      strategyName: definition.name,
      version: definition.version,
      isEnabled: false,
      allow: false,
      score: 0,
      reasonCodes: ["strategy_disabled"],
      tags: ["disabled"],
      explanation: "Strategy is disabled and was not executed.",
      configHash,
      snapshotHash,
      meta: {
        strategyType: definition.strategyType,
        skipped: true
      }
    };
  }

  const toResult = (raw: {
    allow: boolean;
    score?: number;
    reasonCodes?: string[];
    tags?: string[];
    explanation?: string;
    meta?: Record<string, unknown>;
  }): LocalStrategyResult => {
    const score = normalizeFiniteNumber(raw.score);
    return {
      strategyId: definition.id,
      strategyType: definition.strategyType,
      strategyName: definition.name,
      version: definition.version,
      isEnabled: true,
      allow: raw.allow !== false,
      score: Math.max(0, Math.min(100, score ?? 0)),
      reasonCodes: normalizeReasonCodes(raw.reasonCodes),
      tags: normalizeTags(raw.tags),
      explanation:
        typeof raw.explanation === "string" && raw.explanation.trim()
          ? raw.explanation.trim()
          : (raw.allow !== false
            ? "Strategy check passed."
            : "Strategy check blocked."),
      configHash,
      snapshotHash,
      meta: safeObject(raw.meta)
    };
  };

  const runTsStrategy = (
    registration: LocalStrategyRegistration,
    mode: "primary" | "fallback",
    fallbackReason?: string
  ): LocalStrategyResult => {
    const effectiveConfig = mergeConfig(registration.defaultConfig, definition.configJson);
    const raw = registration.handler(
      normalizedFeatureSnapshot,
      effectiveConfig,
      normalizedCtx
    );
    return toResult({
      ...raw,
      meta: {
        ...safeObject(raw.meta),
        engine: "ts",
        strategyType: definition.strategyType,
        strategyRegistrationType: registration.type,
        mode,
        ...(fallbackReason ? { fallbackReason } : {})
      }
    });
  };

  const appendReasonCode = (codes: string[], code: string): string[] => {
    if (!code.trim()) return codes;
    if (codes.includes(code)) return codes;
    return [...codes, code];
  };

  const appendTag = (tags: string[], tag: string): string[] => {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) return tags;
    if (tags.includes(normalized)) return tags;
    return [...tags, normalized];
  };

  const resolveFallbackRegistration = (): LocalStrategyRegistration | null => {
    if (definition.fallbackStrategyType && definition.fallbackStrategyType.trim()) {
      return getRegisteredLocalStrategy(definition.fallbackStrategyType.trim());
    }
    return getRegisteredLocalStrategy(definition.strategyType);
  };

  const logPythonRun = (params: {
    runtimeMs: number;
    errorCode: string | null;
    fallbackUsed: boolean;
    cbOpen: boolean;
    cbUntilTs: string | null;
  }) => {
    logger.info("local_strategy_python_dispatch", {
      engine: "python",
      strategyId: definition.id,
      strategyType: definition.strategyType,
      remoteStrategyType: pythonStrategyType,
      shadowMode: definition.shadowMode,
      runtimeMs: params.runtimeMs,
      cbOpen: params.cbOpen,
      cbUntilTs: params.cbUntilTs,
      fallbackUsed: params.fallbackUsed,
      errorCode: params.errorCode
    });
  };

  if (definition.engine === "python") {
    const pythonExecutor = deps?.runPythonStrategy ?? executePythonStrategy;
    const pythonResult = await pythonExecutor({
      strategyType: pythonStrategyType,
      strategyVersion: definition.version,
      config: safeObject(definition.configJson),
      featureSnapshot: normalizedFeatureSnapshot,
      context: {
        ...normalizedCtx,
        nowTs: new Date().toISOString()
      },
      timeoutMs: definition.timeoutMs,
      trace: {
        runId: snapshotHash.slice(0, 32),
        source: "api_local_strategy"
      }
    });

    const fallbackRegistration = resolveFallbackRegistration();
    const runtimeMeta = pythonResult.ok
      ? safeObject(pythonResult.result.meta)
      : safeObject(pythonResult.meta);
    const runtimeMs = Math.max(0, Number(runtimeMeta.runtimeMs ?? 0) || 0);
    const cbOpen = runtimeMeta.cbOpen === true;
    const cbUntilTs =
      typeof runtimeMeta.cbUntilTs === "string" && runtimeMeta.cbUntilTs.trim()
        ? runtimeMeta.cbUntilTs.trim()
        : null;

    if (pythonResult.ok && !definition.shadowMode) {
      logPythonRun({
        runtimeMs,
        errorCode: null,
        fallbackUsed: false,
        cbOpen,
        cbUntilTs
      });
      return sanitizeUnknown(toResult({
        allow: pythonResult.result.allow,
        score: pythonResult.result.score,
        reasonCodes: pythonResult.result.reasonCodes,
        tags: pythonResult.result.tags,
        explanation: pythonResult.result.explanation,
        meta: {
          ...safeObject(pythonResult.result.meta),
          engine: "python",
          strategyType: definition.strategyType,
          remoteStrategyType: pythonStrategyType,
          timeoutMs: definition.timeoutMs,
          shadowMode: false
        }
      })) as LocalStrategyResult;
    }

    if (definition.shadowMode) {
      let effective: LocalStrategyResult;
      if (fallbackRegistration) {
        effective = runTsStrategy(
          fallbackRegistration,
          "fallback",
          pythonResult.ok ? "shadow_mode_not_enforced" : `python_${pythonResult.errorCode}`
        );
      } else {
        effective = toResult({
          allow: false,
          score: 0,
          reasonCodes: ["shadow_mode_no_fallback"],
          tags: ["shadow_mode", "fallback_missing"],
          explanation: "Shadow mode enabled. Python decision recorded but not enforced.",
          meta: {
            engine: "ts",
            strategyType: definition.strategyType,
            mode: "fallback",
            fallbackReason: "shadow_mode_no_fallback"
          }
        });
      }

      effective.reasonCodes = appendReasonCode(effective.reasonCodes, "shadow_mode_not_enforced");
      effective.tags = appendTag(effective.tags, "shadow_mode");
      effective.meta = {
        ...effective.meta,
        shadowMode: true,
        pythonDecision: pythonResult.ok
          ? {
            allow: pythonResult.result.allow,
            score: pythonResult.result.score,
            reasonCodes: pythonResult.result.reasonCodes,
            tags: pythonResult.result.tags,
            explanation: pythonResult.result.explanation,
            meta: safeObject(pythonResult.result.meta)
          }
          : {
            errorCode: pythonResult.errorCode,
            status: pythonResult.status,
            message: pythonResult.message,
            meta: safeObject(pythonResult.meta)
          },
        effectiveDecision: {
          allow: effective.allow,
          score: effective.score,
          reasonCodes: [...effective.reasonCodes],
          tags: [...effective.tags]
        }
      };

      logPythonRun({
        runtimeMs,
        errorCode: pythonResult.ok ? null : pythonResult.errorCode,
        fallbackUsed: true,
        cbOpen,
        cbUntilTs
      });
      return sanitizeUnknown(effective) as LocalStrategyResult;
    }

    const pythonFailure = pythonResult.ok ? null : pythonResult;
    if (!pythonFailure) {
      const impossible = toResult({
        allow: false,
        score: 0,
        reasonCodes: ["python_state_inconsistent"],
        tags: ["python_error"],
        explanation: "Python execution state inconsistent.",
        meta: {
          engine: "python",
          strategyType: definition.strategyType,
          remoteStrategyType: pythonStrategyType
        }
      });
      logPythonRun({
        runtimeMs,
        errorCode: "python_state_inconsistent",
        fallbackUsed: false,
        cbOpen,
        cbUntilTs
      });
      return sanitizeUnknown(impossible) as LocalStrategyResult;
    }

    logger.warn("local_strategy_python_fallback", {
      strategyId: definition.id,
      strategyType: definition.strategyType,
      remoteStrategyType: pythonStrategyType,
      fallbackStrategyType: definition.fallbackStrategyType ?? definition.strategyType,
      errorCode: pythonFailure.errorCode,
      status: pythonFailure.status,
      message: pythonFailure.message
    });
    if (fallbackRegistration) {
      const fallback = runTsStrategy(
        fallbackRegistration,
        "fallback",
        `python_${pythonFailure.errorCode}`
      );
      fallback.meta = {
        ...fallback.meta,
        pythonFailure: {
          errorCode: pythonFailure.errorCode,
          status: pythonFailure.status,
          message: pythonFailure.message,
          meta: safeObject(pythonFailure.meta)
        }
      };
      logPythonRun({
        runtimeMs,
        errorCode: pythonFailure.errorCode,
        fallbackUsed: true,
        cbOpen,
        cbUntilTs
      });
      return sanitizeUnknown(fallback) as LocalStrategyResult;
    }
    logPythonRun({
      runtimeMs,
      errorCode: pythonFailure.errorCode,
      fallbackUsed: false,
      cbOpen,
      cbUntilTs
    });
    return sanitizeUnknown(toResult({
      allow: false,
      score: 0,
      reasonCodes: ["python_unavailable_no_fallback", pythonFailure.errorCode],
      tags: ["python_error", "fallback_missing"],
      explanation: "Python strategy unavailable and no TS fallback is configured.",
      meta: {
        engine: "python",
        strategyType: definition.strategyType,
        remoteStrategyType: pythonStrategyType,
        timeoutMs: definition.timeoutMs,
        shadowMode: false,
        pythonError: {
          code: pythonFailure.errorCode,
          status: pythonFailure.status,
          message: pythonFailure.message,
          meta: safeObject(pythonFailure.meta)
        }
      }
    })) as LocalStrategyResult;
  }

  const registration = getRegisteredLocalStrategy(definition.strategyType);
  if (!registration) {
    throw new Error(`strategy_type_not_registered:${definition.strategyType}`);
  }
  return sanitizeUnknown(runTsStrategy(registration, "primary")) as LocalStrategyResult;
}
