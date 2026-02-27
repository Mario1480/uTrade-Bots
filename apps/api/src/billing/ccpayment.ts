import crypto from "node:crypto";

const DEFAULT_BASE_URL = "https://ccpayment.com";

export function getCcpayBaseUrl(): string {
  return (process.env.CCPAY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

export function getCcpayAppId(): string {
  return (process.env.CCPAY_APP_ID ?? "").trim();
}

export function getCcpayAppSecret(): string {
  return (process.env.CCPAY_APP_SECRET ?? "").trim();
}

export function isCcpayConfigured(): boolean {
  return Boolean(getCcpayAppId() && getCcpayAppSecret());
}

export function makeCcpayHeaders(bodyJsonString: string): Record<string, string> {
  const appId = getCcpayAppId();
  const appSecret = getCcpayAppSecret();
  if (!appId || !appSecret) {
    throw new Error("ccpay_not_configured");
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = crypto
    .createHmac("sha256", appSecret)
    .update(`${appId}${timestamp}${bodyJsonString}`)
    .digest("hex");

  return {
    Appid: appId,
    Timestamp: timestamp,
    Sign: sign,
    "Content-Type": "application/json"
  };
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  key: string
): string {
  if (typeof (headers as Headers).get === "function") {
    return ((headers as Headers).get(key) ?? "").trim();
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const direct = record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()];
  if (Array.isArray(direct)) return String(direct[0] ?? "").trim();
  return String(direct ?? "").trim();
}

export function verifyCcpayWebhook(
  rawBody: string,
  headers: Headers | Record<string, string | string[] | undefined>
): boolean {
  const appId = getCcpayAppId();
  const appSecret = getCcpayAppSecret();
  if (!appId || !appSecret) return false;

  const headerAppId = readHeader(headers, "Appid") || readHeader(headers, "appid");
  const timestamp = readHeader(headers, "Timestamp") || readHeader(headers, "timestamp");
  const signature = readHeader(headers, "Sign") || readHeader(headers, "sign");
  if (!headerAppId || !timestamp || !signature) return false;
  if (headerAppId !== appId) return false;

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(`${appId}${timestamp}${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const signatureBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export function formatUsdCents(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}
