export type CircuitBreakerAction = "stop" | "cooldown";

export type CircuitBreakerConfig = {
  maxErrors: number;
  windowSeconds: number;
  cooldownSeconds: number;
  action: CircuitBreakerAction;
};

export type CircuitBreakerState = {
  consecutiveErrors: number;
  errorWindowStartAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

export type CircuitBreakerOutcome = {
  state: CircuitBreakerState;
  tripped: boolean;
};

export type TickOutcome = "ok" | "blocked" | "error";

function readPositiveInt(raw: string | null | undefined, fallback: number): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalize(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export function getCircuitBreakerConfigFromEnv(): CircuitBreakerConfig {
  const actionRaw = normalize(process.env.BOT_CB_ACTION);
  const action: CircuitBreakerAction = actionRaw === "cooldown" ? "cooldown" : "stop";

  return {
    maxErrors: readPositiveInt(process.env.BOT_CB_MAX_ERRORS, 5),
    windowSeconds: readPositiveInt(process.env.BOT_CB_WINDOW_SECONDS, 300),
    cooldownSeconds: readPositiveInt(process.env.BOT_CB_COOLDOWN_SECONDS, 900),
    action
  };
}

export function defaultCircuitBreakerState(): CircuitBreakerState {
  return {
    consecutiveErrors: 0,
    errorWindowStartAt: null,
    lastErrorAt: null,
    lastErrorMessage: null
  };
}

export function toCircuitBreakerState(raw: Partial<CircuitBreakerState> | null | undefined): CircuitBreakerState {
  return {
    consecutiveErrors: Number(raw?.consecutiveErrors ?? 0),
    errorWindowStartAt: raw?.errorWindowStartAt ?? null,
    lastErrorAt: raw?.lastErrorAt ?? null,
    lastErrorMessage: raw?.lastErrorMessage ?? null
  };
}

export function applyCircuitBreakerOutcome(params: {
  outcome: TickOutcome;
  state: CircuitBreakerState;
  config: CircuitBreakerConfig;
  now: Date;
  errorMessage?: string;
}): CircuitBreakerOutcome {
  const state = toCircuitBreakerState(params.state);
  if (params.outcome !== "error") {
    return {
      state,
      tripped: false
    };
  }

  const nowMs = params.now.getTime();
  const windowMs = params.config.windowSeconds * 1000;
  const startMs = state.errorWindowStartAt?.getTime() ?? 0;
  const outsideWindow = !state.errorWindowStartAt || nowMs - startMs > windowMs;

  const nextState: CircuitBreakerState = {
    consecutiveErrors: outsideWindow ? 1 : state.consecutiveErrors + 1,
    errorWindowStartAt: outsideWindow ? params.now : state.errorWindowStartAt,
    lastErrorAt: params.now,
    lastErrorMessage: params.errorMessage ?? null
  };

  return {
    state: nextState,
    tripped: nextState.consecutiveErrors >= params.config.maxErrors
  };
}
