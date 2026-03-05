import {
  MEXC_DEFAULT_RECV_WINDOW_SECONDS,
  MEXC_DEFAULT_REST_BASE_URL,
  MEXC_DEFAULT_RETRY_ATTEMPTS,
  MEXC_DEFAULT_RETRY_BASE_DELAY_MS,
  MEXC_DEFAULT_TIMEOUT_MS
} from "./mexc.constants.js";
import { toMexcError, type MexcApiError } from "./mexc.errors.js";
import { mapMexcError } from "./mexc-error.mapper.js";
import { computeRetryDelayMs, shouldRetryExchangeError } from "../core/retry-policy.js";
import {
  buildParameterString,
  buildPrivateHeaders,
  buildQueryParameterString
} from "./mexc.signing.js";
import type { HttpMethod, MexcAdapterConfig, MexcApiResponse, MexcLogEntry } from "./mexc.types.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export class MexcTimeSync {
  private offsetMs = 0;
  private lastSyncAt = 0;

  constructor(private readonly fetchServerTime: () => Promise<number>) {}

  async syncIfStale(maxAgeMs = 30_000): Promise<void> {
    if (Date.now() - this.lastSyncAt < maxAgeMs) return;
    await this.sync();
  }

  async sync(): Promise<void> {
    const before = Date.now();
    const server = await this.fetchServerTime();
    const after = Date.now();
    const localApprox = Math.floor((before + after) / 2);
    this.offsetMs = server - localApprox;
    this.lastSyncAt = Date.now();
  }

  getTimestampMs(): string {
    return String(Date.now() + this.offsetMs);
  }
}

export type MexcRestClientOptions = Pick<
  MexcAdapterConfig,
  | "apiKey"
  | "apiSecret"
  | "restBaseUrl"
  | "recvWindowSeconds"
  | "timeoutMs"
  | "retryAttempts"
  | "retryBaseDelayMs"
  | "log"
>;

export class MexcRestClient {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly recvWindowSeconds: number;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;

  readonly timeSync: MexcTimeSync;

  constructor(private readonly options: MexcRestClientOptions = {}) {
    this.baseUrl = (options.restBaseUrl ?? MEXC_DEFAULT_REST_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.recvWindowSeconds = options.recvWindowSeconds ?? MEXC_DEFAULT_RECV_WINDOW_SECONDS;
    this.timeoutMs = options.timeoutMs ?? MEXC_DEFAULT_TIMEOUT_MS;
    this.retryAttempts = options.retryAttempts ?? MEXC_DEFAULT_RETRY_ATTEMPTS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? MEXC_DEFAULT_RETRY_BASE_DELAY_MS;

    this.timeSync = new MexcTimeSync(async () => {
      const res = await this.requestPublic<number>("GET", "/api/v1/contract/ping");
      return Number(res);
    });
  }

  private log(entry: Omit<MexcLogEntry, "at">) {
    if (!this.options.log) return;
    this.options.log({
      at: nowIso(),
      ...entry
    });
  }

  private async doRequest<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
    body?: unknown;
    privateAuth: boolean;
  }): Promise<T> {
    const start = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const queryString = buildQueryParameterString(params.query ?? {});
    const url = `${this.baseUrl}${params.endpoint}${queryString ? `?${queryString}` : ""}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (params.privateAuth) {
      if (!this.apiKey || !this.apiSecret) {
        throw toMexcError({
          endpoint: params.endpoint,
          method: params.method,
          message: "Missing MEXC API credentials"
        });
      }

      await this.timeSync.syncIfStale();
      const timestampMs = this.timeSync.getTimestampMs();
      const parameterString = buildParameterString(params.method, {
        query: params.query,
        body: params.body
      });

      Object.assign(
        headers,
        buildPrivateHeaders({
          apiKey: this.apiKey,
          apiSecret: this.apiSecret,
          timestampMs,
          parameterString,
          recvWindowSeconds: this.recvWindowSeconds
        })
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: params.method,
        headers,
        body: params.method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
        signal: controller.signal
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { message: text };
      }

      const obj = asRecord(json);
      const mexcCode = typeof obj.code === "number" ? obj.code : undefined;
      const okByCode = mexcCode === undefined || mexcCode === 0;
      const okBySuccess = obj.success === undefined || obj.success === true;
      const ok = res.ok && okByCode && okBySuccess;

      if (!ok) {
        throw toMexcError({
          endpoint: params.endpoint,
          method: params.method,
          status: res.status,
          mexcCode,
          message: typeof obj.message === "string" ? obj.message : `HTTP ${res.status}`,
          responseBody: json
        });
      }

      const payload = (json as MexcApiResponse<T>).data ?? (json as T);
      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - start,
        status: res.status,
        mexcCode,
        ok: true,
        requestId
      });
      return payload;
    } catch (error) {
      const err = error as MexcApiError;
      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - start,
        status: err?.options?.status,
        mexcCode: err?.options?.mexcCode,
        ok: false,
        message: String(error),
        requestId
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async withRetry<T>(params: {
    operation: string;
    idempotent: boolean;
    fn: () => Promise<T>;
  }): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt < this.retryAttempts) {
      attempt += 1;
      try {
        return await params.fn();
      } catch (error) {
        lastError = error;
        const mapped = mapMexcError(error);
        const retry = shouldRetryExchangeError(mapped.code, {
          attempt,
          maxAttempts: this.retryAttempts,
          operation: params.operation,
          idempotent: params.idempotent
        });
        if (!retry) break;
        const delay = computeRetryDelayMs(attempt, this.retryBaseDelayMs);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async requestPublic<T>(
    method: HttpMethod,
    endpoint: string,
    query?: Record<string, unknown>
  ): Promise<T> {
    return this.withRetry({
      operation: `${method} ${endpoint}`,
      idempotent: method === "GET",
      fn: () => this.doRequest<T>({
        method,
        endpoint,
        query,
        privateAuth: false
      })
    });
  }

  async requestPrivate<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
    body?: unknown;
  }): Promise<T> {
    return this.withRetry({
      operation: `${params.method} ${params.endpoint}`,
      idempotent: params.method === "GET",
      fn: () => this.doRequest<T>({
        method: params.method,
        endpoint: params.endpoint,
        query: params.query,
        body: params.body,
        privateAuth: true
      })
    });
  }
}
