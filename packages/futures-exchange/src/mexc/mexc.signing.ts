import crypto from "node:crypto";
import {
  MEXC_DEFAULT_RECV_WINDOW_SECONDS,
  MEXC_MAX_RECV_WINDOW_SECONDS
} from "./mexc.constants.js";
import type { HttpMethod } from "./mexc.types.js";

function sortEntries(params: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

export function buildQueryParameterString(params: Record<string, unknown>): string {
  return sortEntries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

export function buildPostParameterString(body: unknown): string {
  if (body === undefined || body === null) return "{}";
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

export function buildParameterString(method: HttpMethod, payload: {
  query?: Record<string, unknown>;
  body?: unknown;
}): string {
  if (method === "POST") return buildPostParameterString(payload.body);
  return buildQueryParameterString(payload.query ?? {});
}

export function signMexcRequest(params: {
  accessKey: string;
  secretKey: string;
  timestampMs: string;
  parameterString: string;
}): string {
  const source = `${params.accessKey}${params.timestampMs}${params.parameterString}`;
  return crypto.createHmac("sha256", params.secretKey).update(source).digest("hex");
}

function clampRecvWindow(seconds: number | undefined): string {
  const raw = Number(seconds ?? MEXC_DEFAULT_RECV_WINDOW_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return String(MEXC_DEFAULT_RECV_WINDOW_SECONDS);
  if (raw > MEXC_MAX_RECV_WINDOW_SECONDS) return String(MEXC_MAX_RECV_WINDOW_SECONDS);
  return String(Math.floor(raw));
}

export function buildPrivateHeaders(params: {
  apiKey: string;
  apiSecret: string;
  timestampMs: string;
  parameterString: string;
  recvWindowSeconds?: number;
}): Record<string, string> {
  const signature = signMexcRequest({
    accessKey: params.apiKey,
    secretKey: params.apiSecret,
    timestampMs: params.timestampMs,
    parameterString: params.parameterString
  });

  return {
    ApiKey: params.apiKey,
    "Request-Time": params.timestampMs,
    Signature: signature,
    "Recv-Window": clampRecvWindow(params.recvWindowSeconds)
  };
}

export function buildWsSignature(params: {
  apiKey: string;
  apiSecret: string;
  timestampMs: string;
}): string {
  return signMexcRequest({
    accessKey: params.apiKey,
    secretKey: params.apiSecret,
    timestampMs: params.timestampMs,
    parameterString: ""
  });
}
