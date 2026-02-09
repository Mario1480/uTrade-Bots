export class FuturesValidationError extends Error {
  constructor(message: string, public readonly symbol: string) {
    super(message);
    this.name = "FuturesValidationError";
  }
}

export class TradingNotAllowedError extends FuturesValidationError {
  constructor(symbol: string, message = `Trading is not allowed for ${symbol}`) {
    super(message, symbol);
    this.name = "TradingNotAllowedError";
  }
}

export class SymbolUnknownError extends FuturesValidationError {
  constructor(symbol: string, message = `Unknown symbol: ${symbol}`) {
    super(message, symbol);
    this.name = "SymbolUnknownError";
  }
}

export class InvalidTickError extends FuturesValidationError {
  constructor(symbol: string, message = `Invalid tick size for ${symbol}`) {
    super(message, symbol);
    this.name = "InvalidTickError";
  }
}

export class InvalidStepError extends FuturesValidationError {
  constructor(symbol: string, message = `Invalid step size for ${symbol}`) {
    super(message, symbol);
    this.name = "InvalidStepError";
  }
}

export class QtyOutOfRangeError extends FuturesValidationError {
  constructor(symbol: string, message = `Quantity out of range for ${symbol}`) {
    super(message, symbol);
    this.name = "QtyOutOfRangeError";
  }
}

export class LeverageOutOfRangeError extends FuturesValidationError {
  constructor(symbol: string, message = `Leverage out of range for ${symbol}`) {
    super(message, symbol);
    this.name = "LeverageOutOfRangeError";
  }
}
