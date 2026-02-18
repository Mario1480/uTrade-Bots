export type BotBusyAction = "start" | "stop" | "delete" | "" | null | undefined;

export function getBotStartStopUi(
  status: string,
  busy: BotBusyAction,
  labels: {
    start: string;
    starting: string;
    stop: string;
    stopping: string;
  }
) {
  const busyAny = Boolean(busy);
  return {
    startClassName: "btn btnStart",
    stopClassName: "btn btnStop",
    startDisabled: busyAny || status === "running",
    stopDisabled: busyAny || status === "stopped",
    startLabel: busy === "start" ? labels.starting : labels.start,
    stopLabel: busy === "stop" ? labels.stopping : labels.stop
  };
}

