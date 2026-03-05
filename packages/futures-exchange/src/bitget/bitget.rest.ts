import {
  BITGET_DEFAULT_REST_BASE_URL,
  BITGET_DEFAULT_RETRY_ATTEMPTS,
  BITGET_DEFAULT_RETRY_BASE_DELAY_MS,
  BITGET_DEFAULT_TIMEOUT_MS,
  BITGET_SUCCESS_CODE
} from "./bitget.constants.js";
import { BitgetApiError, toBitgetError } from "./bitget.errors.js";
import { mapBitgetError } from "./bitget-error.mapper.js";
import { buildQueryString, buildRestHeaders, stableStringify } from "./bitget.signing.js";
import { computeRetryDelayMs, shouldRetryExchangeError } from "../core/retry-policy.js";
import type { BitgetAdapterConfig, BitgetApiResponse, BitgetLogEntry, HttpMethod } from "./bitget.types.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

export type BitgetRestClientOptions = Pick<
  BitgetAdapterConfig,
  | "apiKey"
  | "apiSecret"
  | "apiPassphrase"
  | "restBaseUrl"
  | "timeoutMs"
  | "retryAttempts"
  | "retryBaseDelayMs"
  | "log"
>;

export class BitgetRestClient {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly apiPassphrase?: string;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;

  constructor(private readonly options: BitgetRestClientOptions = {}) {
    this.baseUrl = (options.restBaseUrl ?? BITGET_DEFAULT_REST_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.apiPassphrase = options.apiPassphrase;
    this.timeoutMs = options.timeoutMs ?? BITGET_DEFAULT_TIMEOUT_MS;
    this.retryAttempts = options.retryAttempts ?? BITGET_DEFAULT_RETRY_ATTEMPTS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? BITGET_DEFAULT_RETRY_BASE_DELAY_MS;
  }

  private log(entry: Omit<BitgetLogEntry, "at">): void {
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
    const startedAt = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const queryString = buildQueryString(params.query);
    const url = `${this.baseUrl}${params.endpoint}${queryString ? `?${queryString}` : ""}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (params.privateAuth) {
      if (!this.apiKey || !this.apiSecret || !this.apiPassphrase) {
        throw toBitgetError({
          endpoint: params.endpoint,
          method: params.method,
          message: "Missing Bitget credentials"
        });
      }

      const timestamp = String(Date.now());
      Object.assign(
        headers,
        buildRestHeaders({
          apiKey: this.apiKey,
          apiSecret: this.apiSecret,
          apiPassphrase: this.apiPassphrase,
          timestamp,
          method: params.method,
          path: params.endpoint,
          query: params.query,
          body: params.body
        })
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: params.method,
        headers,
        body: params.method === "POST" ? stableStringify(params.body) : undefined,
        signal: controller.signal
      });

      const text = await res.text();
      const payload = text ? (JSON.parse(text) as BitgetApiResponse<T>) : ({} as BitgetApiResponse<T>);
      const ok = res.ok && String(payload.code ?? "") === BITGET_SUCCESS_CODE;

      if (!ok) {
        throw toBitgetError({
          endpoint: params.endpoint,
          method: params.method,
          status: res.status,
          code: String(payload.code ?? res.status),
          message: payload.msg || `HTTP ${res.status}`,
          responseBody: payload
        });
      }

      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - startedAt,
        status: res.status,
        code: String(payload.code ?? BITGET_SUCCESS_CODE),
        ok: true,
        requestId
      });

      return payload.data;
    } catch (error) {
      const bitgetError = error as BitgetApiError;
      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - startedAt,
        status: bitgetError?.options?.status,
        code: bitgetError?.options?.code,
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
        const mapped = mapBitgetError(error);
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
