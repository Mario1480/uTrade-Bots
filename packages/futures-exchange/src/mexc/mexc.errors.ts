export class MexcApiError extends Error {
  constructor(
    message: string,
    public readonly options: {
      endpoint: string;
      method: string;
      status?: number;
      mexcCode?: number;
      responseBody?: unknown;
    }
  ) {
    super(message);
    this.name = "MexcApiError";
  }
}

export class MexcAuthError extends MexcApiError {
  constructor(message: string, options: ConstructorParameters<typeof MexcApiError>[1]) {
    super(message, options);
    this.name = "MexcAuthError";
  }
}

export class MexcRateLimitError extends MexcApiError {
  constructor(message: string, options: ConstructorParameters<typeof MexcApiError>[1]) {
    super(message, options);
    this.name = "MexcRateLimitError";
  }
}

export class MexcMaintenanceError extends MexcApiError {
  constructor(message: string, options: ConstructorParameters<typeof MexcApiError>[1]) {
    super(message, options);
    this.name = "MexcMaintenanceError";
  }
}

export class MexcInvalidParamsError extends MexcApiError {
  constructor(message: string, options: ConstructorParameters<typeof MexcApiError>[1]) {
    super(message, options);
    this.name = "MexcInvalidParamsError";
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isAuthCode(code?: number): boolean {
  return code === 401 || code === 403 || code === 700003 || code === 700005;
}

function isRateLimitCode(code?: number): boolean {
  return code === 429 || code === 510 || code === 200004;
}

function isInvalidParamsCode(code?: number): boolean {
  return code === 1 || code === 400 || code === 602;
}

function isMaintenanceCode(code?: number): boolean {
  return code === 503 || code === 3001 || code === 3002;
}

export function toMexcError(params: {
  endpoint: string;
  method: string;
  status?: number;
  mexcCode?: number;
  message?: string;
  responseBody?: unknown;
}): MexcApiError {
  const normalizedMessage = normalize(params.message);
  const code = params.mexcCode ?? params.status;

  if (isAuthCode(code) || normalizedMessage.includes("signature") || normalizedMessage.includes("apikey")) {
    return new MexcAuthError(params.message ?? "MEXC auth error", params);
  }

  if (isRateLimitCode(code) || normalizedMessage.includes("rate limit")) {
    return new MexcRateLimitError(params.message ?? "MEXC rate limit", params);
  }

  if (isMaintenanceCode(code) || normalizedMessage.includes("maintenance")) {
    return new MexcMaintenanceError(params.message ?? "MEXC endpoint under maintenance", params);
  }

  if (isInvalidParamsCode(code) || normalizedMessage.includes("param")) {
    return new MexcInvalidParamsError(params.message ?? "MEXC invalid params", params);
  }

  return new MexcApiError(params.message ?? "MEXC request failed", params);
}
