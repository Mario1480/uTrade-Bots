export class BitgetApiError extends Error {
  constructor(
    message: string,
    public readonly options: {
      endpoint: string;
      method: string;
      status?: number;
      code?: string;
      responseBody?: unknown;
    }
  ) {
    super(message);
    this.name = "BitgetApiError";
  }
}

export class BitgetAuthError extends BitgetApiError {
  constructor(message: string, options: ConstructorParameters<typeof BitgetApiError>[1]) {
    super(message, options);
    this.name = "BitgetAuthError";
  }
}

export class BitgetRateLimitError extends BitgetApiError {
  constructor(message: string, options: ConstructorParameters<typeof BitgetApiError>[1]) {
    super(message, options);
    this.name = "BitgetRateLimitError";
  }
}

export class BitgetMaintenanceError extends BitgetApiError {
  constructor(message: string, options: ConstructorParameters<typeof BitgetApiError>[1]) {
    super(message, options);
    this.name = "BitgetMaintenanceError";
  }
}

export class BitgetInvalidParamsError extends BitgetApiError {
  constructor(message: string, options: ConstructorParameters<typeof BitgetApiError>[1]) {
    super(message, options);
    this.name = "BitgetInvalidParamsError";
  }
}

export class BitgetSymbolStatusError extends BitgetApiError {
  constructor(message: string, options: ConstructorParameters<typeof BitgetApiError>[1]) {
    super(message, options);
    this.name = "BitgetSymbolStatusError";
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function toBitgetError(params: {
  endpoint: string;
  method: string;
  status?: number;
  code?: string;
  message?: string;
  responseBody?: unknown;
}): BitgetApiError {
  const code = String(params.code ?? params.status ?? "");
  const message = params.message ?? "Bitget request failed";
  const normalized = normalize(message);

  if (code === "40001" || code === "40002" || code === "40003" || code === "401") {
    return new BitgetAuthError(message, params);
  }

  if (code === "429" || code === "40015" || normalized.includes("too many")) {
    return new BitgetRateLimitError(message, params);
  }

  if (code === "500" || code === "50000" || normalized.includes("maintenance")) {
    return new BitgetMaintenanceError(message, params);
  }

  if (normalized.includes("symbol status") || normalized.includes("restrictedapi")) {
    return new BitgetSymbolStatusError(message, params);
  }

  if (code.startsWith("4") || normalized.includes("param") || normalized.includes("invalid")) {
    return new BitgetInvalidParamsError(message, params);
  }

  return new BitgetApiError(message, params);
}
