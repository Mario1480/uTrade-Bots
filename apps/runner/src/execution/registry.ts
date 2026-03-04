import type { ActiveFuturesBot } from "../db.js";
import { createLegacyFuturesExecutionMode } from "./legacyFuturesExecutionMode.js";
import { predictionCopierExecutionMode } from "./predictionCopierExecutionMode.js";
import type { ExecutionMode } from "./types.js";

export type ExecutionModeKey = "futures_engine" | "prediction_copier";

type StrategyExecutionBindings = Record<string, ExecutionModeKey>;

type RegistryOptions = {
  defaultModeKey?: ExecutionModeKey;
  strategyBindings?: StrategyExecutionBindings;
  modes?: Partial<Record<ExecutionModeKey, ExecutionMode>>;
};

const DEFAULT_MODE_KEY: ExecutionModeKey = "futures_engine";

const DEFAULT_BINDINGS: StrategyExecutionBindings = {
  prediction_copier: "prediction_copier"
};

const BUILTIN_MODES: Record<ExecutionModeKey, ExecutionMode> = {
  futures_engine: createLegacyFuturesExecutionMode(),
  prediction_copier: predictionCopierExecutionMode
};

function normalizeString(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isExecutionModeKey(value: string): value is ExecutionModeKey {
  return value === "futures_engine" || value === "prediction_copier";
}

function readExecutionModeOverrideFromParams(bot: ActiveFuturesBot): ExecutionModeKey | null {
  const params = bot.paramsJson;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const row = params as Record<string, unknown>;
  const directRaw = normalizeString(row.executionMode);
  if (isExecutionModeKey(directRaw)) {
    return directRaw;
  }

  const predictionCopier = row.predictionCopier;
  if (predictionCopier && typeof predictionCopier === "object" && !Array.isArray(predictionCopier)) {
    const nestedRaw = normalizeString((predictionCopier as Record<string, unknown>).executionMode);
    if (isExecutionModeKey(nestedRaw)) {
      return nestedRaw;
    }
  }

  return null;
}

export function resolveExecutionModeKeyForBot(
  bot: ActiveFuturesBot,
  options: RegistryOptions = {}
): ExecutionModeKey {
  const override = readExecutionModeOverrideFromParams(bot);
  if (override) return override;

  const strategyKey = normalizeString(bot.strategyKey);
  const bindings = options.strategyBindings ?? DEFAULT_BINDINGS;
  const fromBinding = bindings[strategyKey];
  if (fromBinding) return fromBinding;

  return options.defaultModeKey ?? DEFAULT_MODE_KEY;
}

export function resolveExecutionModeForBot(
  bot: ActiveFuturesBot,
  options: RegistryOptions = {}
): ExecutionMode {
  const modeKey = resolveExecutionModeKeyForBot(bot, options);
  const modes = {
    ...BUILTIN_MODES,
    ...(options.modes ?? {})
  };
  return modes[modeKey] ?? modes[options.defaultModeKey ?? DEFAULT_MODE_KEY] ?? BUILTIN_MODES.futures_engine;
}
