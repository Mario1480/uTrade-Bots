export const DEFAULT_SALAD_API_BASE_URL = "https://api.salad.com/api/public";

export type SaladRuntimeState =
  | "running"
  | "stopped"
  | "starting"
  | "stopping"
  | "error"
  | "unknown";

export type SaladRuntimeConfig = {
  apiBaseUrl: string;
  organization: string;
  project: string;
  container: string;
};

type SaladRuntimeSettingsLike = {
  aiProfiles?: {
    ollama?: {
      saladRuntime?: {
        apiBaseUrl?: string | null;
        organization?: string | null;
        project?: string | null;
        container?: string | null;
      } | null;
    } | null;
  } | null;
} | null | undefined;

type SaladRuntimeAction = "status" | "start" | "stop";

export type SaladRuntimeResult = {
  ok: boolean;
  action: SaladRuntimeAction;
  state: SaladRuntimeState;
  checkedAt: string;
  latencyMs: number;
  message: string;
  httpStatus?: number;
  errorCode?: "auth_failed" | "not_found" | "rate_limited" | "upstream_error" | "request_failed";
  rawStatus?: string | null;
};

function toTrimmedString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeApiBaseUrl(value: unknown): string {
  const raw = toTrimmedString(value, 500);
  if (!raw) return DEFAULT_SALAD_API_BASE_URL;
  return stripTrailingSlash(raw);
}

function parseStatusValue(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const containerValue =
    record.container && typeof record.container === "object" && !Array.isArray(record.container)
      ? (record.container as Record<string, unknown>)
      : null;
  const dataValue =
    record.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : null;
  const currentStateValue =
    record.current_state && typeof record.current_state === "object" && !Array.isArray(record.current_state)
      ? (record.current_state as Record<string, unknown>)
      : record.currentState && typeof record.currentState === "object" && !Array.isArray(record.currentState)
        ? (record.currentState as Record<string, unknown>)
        : null;
  const candidates: unknown[] = [
    record.status,
    record.state,
    record.containerStatus,
    record.instanceStatus,
    containerValue?.status,
    containerValue?.state,
    currentStateValue?.status,
    currentStateValue?.state,
    dataValue?.status,
    dataValue?.state
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }

  const counts =
    currentStateValue?.instance_status_counts
    && typeof currentStateValue.instance_status_counts === "object"
    && !Array.isArray(currentStateValue.instance_status_counts)
      ? (currentStateValue.instance_status_counts as Record<string, unknown>)
      : null;
  if (counts) {
    const running = Number(counts.running_count ?? 0);
    const stopping = Number(counts.stopping_count ?? 0);
    const creating = Number(counts.creating_count ?? 0);
    const allocating = Number(counts.allocating_count ?? 0);
    if (Number.isFinite(running) && running > 0) return "running";
    if (Number.isFinite(stopping) && stopping > 0) return "stopping";
    if ((Number.isFinite(creating) && creating > 0) || (Number.isFinite(allocating) && allocating > 0)) {
      return "starting";
    }
    if (
      Number.isFinite(running)
      && Number.isFinite(stopping)
      && Number.isFinite(creating)
      && Number.isFinite(allocating)
      && running <= 0
      && stopping <= 0
      && creating <= 0
      && allocating <= 0
    ) {
      return "stopped";
    }
  }
  return null;
}

function mapStatusToRuntimeState(rawStatus: string | null, action: SaladRuntimeAction): SaladRuntimeState {
  const normalized = String(rawStatus ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    if (action === "start") return "starting";
    if (action === "stop") return "stopping";
    return "unknown";
  }
  if (
    normalized.includes("running")
    || normalized.includes("ready")
    || normalized.includes("active")
    || normalized === "started"
  ) {
    return "running";
  }
  if (normalized.includes("stopping") || normalized.includes("terminating")) {
    return "stopping";
  }
  if (normalized.includes("starting") || normalized.includes("provision") || normalized.includes("pending")) {
    return "starting";
  }
  if (normalized.includes("stopped") || normalized.includes("inactive")) {
    return "stopped";
  }
  if (normalized.includes("error") || normalized.includes("failed")) {
    return "error";
  }
  if (action === "start") return "starting";
  if (action === "stop") return "stopping";
  return "unknown";
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string" && error.trim()) return error.trim().slice(0, 1000);
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const errorRecord = error as Record<string, unknown>;
      const nested =
        (typeof errorRecord.message === "string" && errorRecord.message.trim())
        || (typeof errorRecord.detail === "string" && errorRecord.detail.trim())
        || (typeof errorRecord.code === "string" && errorRecord.code.trim())
        || "";
      if (nested) return nested.slice(0, 1000);
    }
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 1000);
    const detail = record.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 1000);
  }
  return fallback;
}

function errorCodeFromStatus(status: number): SaladRuntimeResult["errorCode"] {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_error";
  return "request_failed";
}

async function callSalad(params: {
  action: SaladRuntimeAction;
  method: "GET" | "POST";
  path: string;
  config: SaladRuntimeConfig;
  apiKey: string;
  timeoutMs?: number;
}): Promise<SaladRuntimeResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, params.timeoutMs ?? 15_000));
  try {
    const url = `${stripTrailingSlash(params.config.apiBaseUrl)}${params.path}`;
    const response = await fetch(url, {
      method: params.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Salad-Api-Key": params.apiKey
      },
      signal: controller.signal
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const rawStatus = parseStatusValue(payload);
    const state = mapStatusToRuntimeState(rawStatus, params.action);
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        action: params.action,
        state,
        checkedAt,
        latencyMs,
        httpStatus: response.status,
        errorCode: errorCodeFromStatus(response.status),
        message: extractErrorMessage(payload, `salad_http_${response.status}`),
        rawStatus
      };
    }

    const defaultMessage =
      params.action === "status"
        ? "Container status fetched."
        : params.action === "start"
          ? "Start requested."
          : "Stop requested.";
    return {
      ok: true,
      action: params.action,
      state,
      checkedAt,
      latencyMs,
      message: extractErrorMessage(payload, defaultMessage),
      httpStatus: response.status,
      rawStatus
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      action: params.action,
      state: "unknown",
      checkedAt,
      latencyMs: Date.now() - startedAt,
      errorCode: "request_failed",
      message: isAbort ? "salad_request_timeout" : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveSaladRuntimeConfig(settings: SaladRuntimeSettingsLike): {
  config: SaladRuntimeConfig;
  isConfigured: boolean;
  missingFields: Array<"organization" | "project" | "container">;
} {
  const runtime = settings?.aiProfiles?.ollama?.saladRuntime ?? null;
  const config: SaladRuntimeConfig = {
    apiBaseUrl: normalizeApiBaseUrl(runtime?.apiBaseUrl),
    organization: toTrimmedString(runtime?.organization, 191) ?? "",
    project: toTrimmedString(runtime?.project, 191) ?? "",
    container: toTrimmedString(runtime?.container, 191) ?? ""
  };
  const missingFields: Array<"organization" | "project" | "container"> = [];
  if (!config.organization) missingFields.push("organization");
  if (!config.project) missingFields.push("project");
  if (!config.container) missingFields.push("container");
  return {
    config,
    isConfigured: missingFields.length === 0,
    missingFields
  };
}

function runtimePath(config: SaladRuntimeConfig): string {
  return `/organizations/${encodeURIComponent(config.organization)}/projects/${encodeURIComponent(config.project)}/containers/${encodeURIComponent(config.container)}`;
}

export async function getSaladRuntimeStatus(
  config: SaladRuntimeConfig,
  apiKey: string
): Promise<SaladRuntimeResult> {
  return callSalad({
    action: "status",
    method: "GET",
    path: runtimePath(config),
    config,
    apiKey
  });
}

export async function startSaladContainer(
  config: SaladRuntimeConfig,
  apiKey: string
): Promise<SaladRuntimeResult> {
  return callSalad({
    action: "start",
    method: "POST",
    path: `${runtimePath(config)}/start`,
    config,
    apiKey
  });
}

export async function stopSaladContainer(
  config: SaladRuntimeConfig,
  apiKey: string
): Promise<SaladRuntimeResult> {
  return callSalad({
    action: "stop",
    method: "POST",
    path: `${runtimePath(config)}/stop`,
    config,
    apiKey
  });
}
