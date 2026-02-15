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
  meta: Record<string, unknown>;
};

type PythonRunDeps = {
  nowMs?: () => number;
  runFn?: typeof runPythonStrategy;
};

type CircuitBreakerState = {
  windowStartMs: number;
  failures: number;
  timeouts: number;
  openUntilMs: number;
};

const counters = {
  calls: 0,
  failures: 0,
  timeouts: 0,
  cbOpenTotal: 0,
  cbSkippedTotal: 0
};

const breakerState: CircuitBreakerState = {
  windowStartMs: Date.now(),
  failures: 0,
  timeouts: 0,
  openUntilMs: 0
};

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function cbConfig() {
  return {
    windowMs: readIntEnv("PY_STRATEGY_CB_WINDOW_MS", 60_000, 1_000, 3_600_000),
    maxFailures: readIntEnv("PY_STRATEGY_CB_MAX_FAILURES", 5, 1, 1_000),
    maxTimeouts: readIntEnv("PY_STRATEGY_CB_MAX_TIMEOUTS", 3, 1, 1_000),
    cooldownMs: readIntEnv("PY_STRATEGY_CB_COOLDOWN_MS", 60_000, 1_000, 3_600_000)
  };
}

function resetWindowIfNeeded(nowMs: number, windowMs: number) {
  if (nowMs - breakerState.windowStartMs < windowMs) return;
  breakerState.windowStartMs = nowMs;
  breakerState.failures = 0;
  breakerState.timeouts = 0;
}

function isBreakerOpen(nowMs: number): boolean {
  return breakerState.openUntilMs > nowMs;
}

function openBreaker(nowMs: number, cooldownMs: number) {
  const wasOpen = isBreakerOpen(nowMs);
  breakerState.openUntilMs = nowMs + cooldownMs;
  if (!wasOpen) counters.cbOpenTotal += 1;
}

function recordFailure(kind: "timeout" | "failure", nowMs: number) {
  const config = cbConfig();
  resetWindowIfNeeded(nowMs, config.windowMs);
  if (kind === "timeout") {
    breakerState.timeouts += 1;
  } else {
    breakerState.failures += 1;
  }
  if (breakerState.failures >= config.maxFailures || breakerState.timeouts >= config.maxTimeouts) {
    openBreaker(nowMs, config.cooldownMs);
  }
}

function cbUntilIso(): string | null {
  return breakerState.openUntilMs > 0 ? new Date(breakerState.openUntilMs).toISOString() : null;
}

export function getPythonRunnerMetrics() {
  return {
    ...counters,
    cbOpen: isBreakerOpen(Date.now()),
    cbUntilTs: cbUntilIso()
  };
}

export function resetPythonRunnerStateForTests() {
  counters.calls = 0;
  counters.failures = 0;
  counters.timeouts = 0;
  counters.cbOpenTotal = 0;
  counters.cbSkippedTotal = 0;
  breakerState.windowStartMs = Date.now();
  breakerState.failures = 0;
  breakerState.timeouts = 0;
  breakerState.openUntilMs = 0;
}

export async function executePythonStrategy(
  input: PythonRunnerInput,
  deps?: PythonRunDeps
): Promise<PythonRunnerResult | PythonRunnerFailure> {
  const nowMs = deps?.nowMs ?? (() => Date.now());
  const runFn = deps?.runFn ?? runPythonStrategy;
  counters.calls += 1;

  const startMs = nowMs();
  const config = cbConfig();
  resetWindowIfNeeded(startMs, config.windowMs);

  if (isBreakerOpen(startMs)) {
    counters.cbSkippedTotal += 1;
    const failure: PythonRunnerFailure = {
      ok: false,
      errorCode: "cb_open",
      status: null,
      message: "python circuit breaker is open",
      meta: {
        pythonSkipped: true,
        skipReason: "circuit_breaker_open",
        cbOpen: true,
        cbUntilTs: cbUntilIso(),
        runtimeMs: 0
      }
    };
    logger.warn("local_strategy_python_run", {
      engine: "python",
      remoteStrategyType: input.strategyType,
      runtimeMs: 0,
      cbOpen: true,
      cbUntilTs: cbUntilIso(),
      fallbackUsed: false,
      errorCode: "cb_open"
    });
    return failure;
  }

  try {
    const result = await runFn({
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
    const runtimeMs = Math.max(0, nowMs() - startMs);
    logger.info("local_strategy_python_run", {
      engine: "python",
      remoteStrategyType: input.strategyType,
      runtimeMs,
      cbOpen: false,
      cbUntilTs: cbUntilIso(),
      fallbackUsed: false,
      errorCode: null
    });
    return {
      ok: true,
      result
    };
  } catch (error) {
    counters.failures += 1;
    const asClientError = error instanceof PythonStrategyClientError ? error : null;
    const errorCode = asClientError?.code ?? "unknown";
    const isTimeout = errorCode === "timeout";
    if (isTimeout) {
      counters.timeouts += 1;
    }
    recordFailure(isTimeout ? "timeout" : "failure", nowMs());
    const runtimeMs = Math.max(0, nowMs() - startMs);
    const cbOpen = isBreakerOpen(nowMs());
    const failure: PythonRunnerFailure = {
      ok: false,
      errorCode,
      status: asClientError?.status ?? null,
      message: asClientError?.message ?? String(error),
      meta: {
        pythonSkipped: false,
        skipReason: null,
        cbOpen,
        cbUntilTs: cbUntilIso(),
        runtimeMs
      }
    };
    logger.warn("local_strategy_python_run", {
      engine: "python",
      remoteStrategyType: input.strategyType,
      runtimeMs,
      cbOpen,
      cbUntilTs: cbUntilIso(),
      fallbackUsed: false,
      errorCode
    });
    return failure;
  }
}
