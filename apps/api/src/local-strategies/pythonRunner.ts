import { logger } from "../logger.js";
import {
  PythonStrategyClientError,
  runPythonStrategy,
  type PythonStrategyRunContext,
  type PythonStrategyRunResponse
} from "./pythonClient.js";

type PythonRunnerInput = {
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
};

type PythonRunnerResult = {
  ok: true;
  result: PythonStrategyRunResponse;
};

type PythonRunnerFailure = {
  ok: false;
  errorCode: string;
  status: number | null;
  message: string;
};

const counters = {
  calls: 0,
  failures: 0,
  timeouts: 0
};

export function getPythonRunnerMetrics() {
  return { ...counters };
}

export async function executePythonStrategy(input: PythonRunnerInput): Promise<PythonRunnerResult | PythonRunnerFailure> {
  counters.calls += 1;
  try {
    const result = await runPythonStrategy({
      strategyType: input.strategyType,
      strategyVersion: input.strategyVersion,
      config: input.config,
      featureSnapshot: input.featureSnapshot,
      context: input.context,
      timeoutMs:
        typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
          ? input.timeoutMs
          : undefined,
      trace: input.trace
    });
    return {
      ok: true,
      result
    };
  } catch (error) {
    counters.failures += 1;
    if (error instanceof PythonStrategyClientError && error.code === "timeout") {
      counters.timeouts += 1;
    }
    const asClientError = error instanceof PythonStrategyClientError ? error : null;
    logger.warn("local_strategy_python_error", {
      strategyType: input.strategyType,
      errorCode: asClientError?.code ?? "unknown",
      status: asClientError?.status ?? null,
      message: asClientError?.message ?? String(error)
    });
    return {
      ok: false,
      errorCode: asClientError?.code ?? "unknown",
      status: asClientError?.status ?? null,
      message: asClientError?.message ?? String(error)
    };
  }
}
