import { logger } from "../logger.js";

export type PythonStrategySignal = "up" | "down" | "neutral";

export type PythonStrategyRunContext = {
  signal?: PythonStrategySignal;
  exchange?: string;
  accountId?: string;
  symbol?: string;
  marketType?: string;
  timeframe?: string;
  nowTs?: string;
  [key: string]: unknown;
};

export type PythonStrategyRunResponse = {
  allow: boolean;
  score: number;
  reasonCodes: string[];
  tags: string[];
  explanation: string;
  meta: Record<string, unknown>;
};

export type PythonStrategyListItem = {
  type: string;
  name: string;
  version: string;
  defaultConfig: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
};

export type PythonStrategyRunParams = {
  strategyType: string;
  strategyVersion?: string;
  config: Record<string, unknown>;
  featureSnapshot: Record<string, unknown>;
  context: PythonStrategyRunContext;
  trace?: {
    runId?: string;
    source?: string;
  };
  timeoutMs?: number;
};

export class PythonStrategyClientError extends Error {
  code: string;
  status: number | null;

  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const normalized = sanitizeUnknown(entry);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === undefined) return undefined;
  return value;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 50) break;
  }
  return out;
}

function normalizeRunResponse(input: unknown): PythonStrategyRunResponse {
  const row = asRecord(input);
  if (!row) {
    throw new PythonStrategyClientError("python strategy response is not an object", "invalid_response_shape");
  }
  const score = toFiniteNumber(row.score);
  return {
    allow: row.allow !== false,
    score: Math.max(0, Math.min(100, score ?? 0)),
    reasonCodes: normalizeStringArray(row.reasonCodes),
    tags: normalizeStringArray(row.tags).map((entry) => entry.toLowerCase()),
    explanation:
      typeof row.explanation === "string" && row.explanation.trim()
        ? row.explanation.trim()
        : (row.allow !== false ? "Python strategy passed." : "Python strategy blocked."),
    meta: (sanitizeUnknown(asRecord(row.meta) ?? {}) ?? {}) as Record<string, unknown>
  };
}

function resolveBaseUrl(): string {
  const raw = String(process.env.PY_STRATEGY_URL ?? "http://localhost:9000").trim();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function resolveEnabled(): boolean {
  return String(process.env.PY_STRATEGY_ENABLED ?? "false").trim().toLowerCase() === "true";
}

function resolveAuthToken(): string {
  return String(process.env.PY_STRATEGY_AUTH_TOKEN ?? "").trim();
}

function resolveDefaultTimeoutMs(): number {
  const parsed = Number(process.env.PY_STRATEGY_TIMEOUT_MS ?? 1200);
  if (!Number.isFinite(parsed)) return 1200;
  return Math.max(200, Math.min(10_000, Math.trunc(parsed)));
}

async function requestJson(
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const baseUrl = resolveBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  const token = resolveAuthToken();
  if (token) headers.set("x-py-strategy-token", token);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new PythonStrategyClientError(
          `python strategy returned invalid JSON for ${path}`,
          "invalid_json",
          response.status
        );
      }
    }
    if (!response.ok) {
      const detail = asRecord(parsed);
      const message =
        typeof detail?.error === "string" ? detail.error :
          typeof detail?.message === "string" ? detail.message :
            `python strategy HTTP ${response.status}`;
      throw new PythonStrategyClientError(message, "http_error", response.status);
    }
    return parsed;
  } catch (error) {
    if (error instanceof PythonStrategyClientError) throw error;
    if ((error as any)?.name === "AbortError") {
      throw new PythonStrategyClientError("python strategy request timed out", "timeout");
    }
    throw new PythonStrategyClientError(String(error), "network_error");
  } finally {
    clearTimeout(timer);
  }
}

export async function getPythonStrategyHealth(timeoutMs = resolveDefaultTimeoutMs()): Promise<{
  status: string;
  version: string;
}> {
  const json = await requestJson("/health", { method: "GET" }, timeoutMs);
  const row = asRecord(json);
  return {
    status: typeof row?.status === "string" ? row.status : "unknown",
    version: typeof row?.version === "string" ? row.version : "unknown"
  };
}

export async function listPythonStrategies(timeoutMs = resolveDefaultTimeoutMs()): Promise<PythonStrategyListItem[]> {
  const json = await requestJson("/v1/strategies", { method: "GET" }, timeoutMs);
  const row = asRecord(json);
  const items = Array.isArray(row?.items) ? row.items : [];
  return items
    .map((entry) => {
      const parsed = asRecord(entry);
      if (!parsed) return null;
      const type = typeof parsed.type === "string" ? parsed.type.trim() : "";
      if (!type) return null;
      return {
        type,
        name: typeof parsed.name === "string" ? parsed.name.trim() || type : type,
        version: typeof parsed.version === "string" ? parsed.version.trim() || "1.0.0" : "1.0.0",
        defaultConfig: (sanitizeUnknown(asRecord(parsed.defaultConfig) ?? {}) ?? {}) as Record<string, unknown>,
        uiSchema: (sanitizeUnknown(asRecord(parsed.uiSchema) ?? {}) ?? {}) as Record<string, unknown>
      };
    })
    .filter((entry): entry is PythonStrategyListItem => Boolean(entry));
}

export async function runPythonStrategy(params: PythonStrategyRunParams): Promise<PythonStrategyRunResponse> {
  if (!resolveEnabled()) {
    throw new PythonStrategyClientError("python strategies are disabled", "disabled");
  }

  const timeoutMs = Math.max(200, Math.min(10_000, Math.trunc(params.timeoutMs ?? resolveDefaultTimeoutMs())));
  const trace = {
    runId:
      typeof params.trace?.runId === "string" && params.trace.runId.trim()
        ? params.trace.runId.trim()
        : `${Date.now()}`,
    source:
      typeof params.trace?.source === "string" && params.trace.source.trim()
        ? params.trace.source.trim()
        : "api_local_strategy"
  };

  const payload = {
    strategyType: params.strategyType.trim(),
    strategyVersion:
      typeof params.strategyVersion === "string" && params.strategyVersion.trim()
        ? params.strategyVersion.trim()
        : undefined,
    config: (sanitizeUnknown(params.config ?? {}) ?? {}) as Record<string, unknown>,
    featureSnapshot: (sanitizeUnknown(params.featureSnapshot ?? {}) ?? {}) as Record<string, unknown>,
    context: (sanitizeUnknown(params.context ?? {}) ?? {}) as Record<string, unknown>,
    trace
  };

  const startedAt = Date.now();
  const json = await requestJson(
    "/v1/strategies/run",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    timeoutMs
  );
  const normalized = normalizeRunResponse(json);
  const runtimeMs = Date.now() - startedAt;
  normalized.meta = {
    ...normalized.meta,
    engine: "python",
    runtimeMs,
    timeoutMs
  };
  logger.info("local_strategy_python_call", {
    strategyType: payload.strategyType,
    runtimeMs,
    timeoutMs
  });
  return normalized;
}
