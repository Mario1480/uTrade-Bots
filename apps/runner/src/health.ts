type RunnerState = {
  startedAt: number;
  lastTickAt: number;
  botStatus: "INIT" | "RUNNING" | "PAUSED" | "STOPPED" | "ERROR";
  lastErrorReason: string | null;
  botsRunning: number;
  botsErrored: number;
};

const state: RunnerState = {
  startedAt: Date.now(),
  lastTickAt: 0,
  botStatus: "INIT",
  lastErrorReason: null,
  botsRunning: 0,
  botsErrored: 0
};

export function noteTick() {
  state.lastTickAt = Date.now();
}

export function setBotStatus(status: RunnerState["botStatus"], reason?: string | null) {
  state.botStatus = status;
  if (status === "ERROR") {
    state.lastErrorReason = reason ?? state.lastErrorReason ?? "unknown";
  }
  if (status === "RUNNING") {
    state.lastErrorReason = null;
  }
}

export function setRunnerCounts(botsRunning: number, botsErrored: number) {
  state.botsRunning = botsRunning;
  state.botsErrored = botsErrored;
}

export function getRunnerHealth() {
  return {
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    botStatus: state.botStatus,
    lastErrorReason: state.lastErrorReason,
    botsRunning: state.botsRunning,
    botsErrored: state.botsErrored
  };
}
