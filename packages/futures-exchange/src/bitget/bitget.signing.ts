import crypto from "node:crypto";
import type { HttpMethod } from "./bitget.types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (!isObject(value) && !Array.isArray(value)) return JSON.stringify(value);

  const encode = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((item) => encode(item));
    if (isObject(input)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input).sort()) {
        const val = input[key];
        if (val === undefined) continue;
        out[key] = encode(val);
      }
      return out;
    }
    return input;
  };

  return JSON.stringify(encode(value));
}

export function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export function buildPrehash(params: {
  timestamp: string;
  method: HttpMethod;
  path: string;
  queryString?: string;
  bodyString?: string;
}): string {
  const queryPart = params.queryString ? `?${params.queryString}` : "";
  const bodyPart = params.bodyString ?? "";
  return `${params.timestamp}${params.method.toUpperCase()}${params.path}${queryPart}${bodyPart}`;
}

export function signRequest(params: {
  timestamp: string;
  method: HttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  secretKey: string;
}): string {
  const queryString = buildQueryString(params.query);
  const bodyString = params.method === "POST" ? stableStringify(params.body) : "";
  const prehash = buildPrehash({
    timestamp: params.timestamp,
    method: params.method,
    path: params.path,
    queryString,
    bodyString
  });

  return crypto.createHmac("sha256", params.secretKey).update(prehash).digest("base64");
}

export function buildWsLoginSignature(params: {
  timestamp: string;
  secretKey: string;
}): string {
  const prehash = `${params.timestamp}GET/user/verify`;
  return crypto.createHmac("sha256", params.secretKey).update(prehash).digest("base64");
}

export function buildRestHeaders(params: {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  timestamp: string;
  method: HttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}): Record<string, string> {
  const signature = signRequest({
    timestamp: params.timestamp,
    method: params.method,
    path: params.path,
    query: params.query,
    body: params.body,
    secretKey: params.apiSecret
  });

  return {
    "ACCESS-KEY": params.apiKey,
    "ACCESS-SIGN": signature,
    "ACCESS-TIMESTAMP": params.timestamp,
    "ACCESS-PASSPHRASE": params.apiPassphrase,
    "Content-Type": "application/json"
  };
}
