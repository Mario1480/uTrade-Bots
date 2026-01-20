type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  const entry = {
    level,
    msg,
    time: Date.now(),
    ...(meta ?? {})
  };
  // JSON line for log collectors / Docker logs
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta)
};
