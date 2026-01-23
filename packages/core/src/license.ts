export type LicenseStatus = "ACTIVE" | "EXPIRED" | "SUSPENDED";

export type LicenseVerifyResponse = {
  status: LicenseStatus;
  validUntil: string | null;
  limits: {
    includedBots: number;
    addOnBots: number;
    includedCex: number;
    addOnCex: number;
  };
  features: {
    priceSupport: boolean;
    priceFollow: boolean;
    aiRecommendations: boolean;
  };
  overrides: {
    manual: boolean;
    unlimited: boolean;
    note?: string;
  };
};

export type LicenseErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_SIGNATURE"
  | "NOT_FOUND"
  | "INSTANCE_MISMATCH"
  | "SERVER_ERROR"
  | "NETWORK_ERROR";

export type LicenseError = {
  code: LicenseErrorCode;
  status?: number;
  message?: string;
};

export type LicenseLimits = {
  maxBots: number;
  maxCex: number;
  unlimited: boolean;
};

export type LicenseEnforcementInput = {
  response: LicenseVerifyResponse;
  botCount: number;
  cexCount: number;
  usePriceSupport: boolean;
  usePriceFollow: boolean;
  useAiRecommendations: boolean;
};

export type LicenseEnforcementResult = {
  allowed: boolean;
  reason?: string;
  limits: LicenseLimits;
  status: LicenseStatus;
  validUntil: string | null;
  features: LicenseVerifyResponse["features"];
};

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signLicenseBody(body: string, secret: string): Promise<string> {
  const webCrypto = (globalThis as any).crypto;
  if (webCrypto?.subtle) {
    const enc = new TextEncoder();
    const key = await webCrypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await webCrypto.subtle.sign("HMAC", key, enc.encode(body));
    return toHex(signature);
  }

  const { createHmac } = await import("crypto");
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function mapLicenseErrorFromStatus(status: number): LicenseErrorCode {
  if (status === 400) return "INVALID_REQUEST";
  if (status === 401) return "INVALID_SIGNATURE";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "INSTANCE_MISMATCH";
  if (status >= 500) return "SERVER_ERROR";
  return "NETWORK_ERROR";
}

export function computeEffectiveLimits(response: LicenseVerifyResponse): LicenseLimits {
  const maxBots = response.limits.includedBots + response.limits.addOnBots;
  const maxCex = response.limits.includedCex + response.limits.addOnCex;
  return {
    maxBots,
    maxCex,
    unlimited: Boolean(response.overrides?.unlimited)
  };
}

export function isLicenseActive(response: LicenseVerifyResponse): boolean {
  return response.status === "ACTIVE";
}

export function shouldAllowGrace(params: {
  lastOkAt: number;
  now: number;
  graceMin: number;
  errorCode: LicenseErrorCode;
}): boolean {
  if (params.lastOkAt <= 0) return false;
  if (params.errorCode !== "NETWORK_ERROR" && params.errorCode !== "SERVER_ERROR") return false;
  const graceMs = params.graceMin * 60_000;
  return params.now - params.lastOkAt < graceMs;
}

export function enforceLicense(params: LicenseEnforcementInput): LicenseEnforcementResult {
  const { response } = params;
  const limits = computeEffectiveLimits(response);

  if (!isLicenseActive(response)) {
    return {
      allowed: false,
      reason: `LICENSE_${response.status}`,
      limits,
      status: response.status,
      validUntil: response.validUntil,
      features: response.features
    };
  }

  if (!limits.unlimited) {
    if (params.botCount > limits.maxBots) {
      return {
        allowed: false,
        reason: "LICENSE_BOT_LIMIT",
        limits,
        status: response.status,
        validUntil: response.validUntil,
        features: response.features
      };
    }
    if (params.cexCount > limits.maxCex) {
      return {
        allowed: false,
        reason: "LICENSE_CEX_LIMIT",
        limits,
        status: response.status,
        validUntil: response.validUntil,
        features: response.features
      };
    }
  }

  if (params.usePriceSupport && !response.features.priceSupport) {
    return {
      allowed: false,
      reason: "LICENSE_FEATURE_PRICE_SUPPORT",
      limits,
      status: response.status,
      validUntil: response.validUntil,
      features: response.features
    };
  }

  if (params.usePriceFollow && !response.features.priceFollow) {
    return {
      allowed: false,
      reason: "LICENSE_FEATURE_PRICE_FOLLOW",
      limits,
      status: response.status,
      validUntil: response.validUntil,
      features: response.features
    };
  }

  if (params.useAiRecommendations && !response.features.aiRecommendations) {
    return {
      allowed: false,
      reason: "LICENSE_FEATURE_AI",
      limits,
      status: response.status,
      validUntil: response.validUntil,
      features: response.features
    };
  }

  return {
    allowed: true,
    limits,
    status: response.status,
    validUntil: response.validUntil,
    features: response.features
  };
}
