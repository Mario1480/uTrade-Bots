import {
  InvalidStepError,
  InvalidTickError,
  LeverageOutOfRangeError,
  QtyOutOfRangeError
} from "./errors.js";
import type { ContractInfo } from "./metadata.js";

export type RoundingMode = "down" | "up" | "nearest";

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: Error };

function countDecimals(value: number): number {
  const text = String(value).toLowerCase();
  if (text.includes("e-")) {
    const [, exp] = text.split("e-");
    const expValue = Number(exp);
    return Number.isFinite(expValue) ? expValue : 0;
  }

  const dot = text.indexOf(".");
  if (dot < 0) return 0;
  return text.length - dot - 1;
}

function normalizeFloat(value: number, increment: number): number {
  const decimals = Math.max(countDecimals(increment), 0);
  return Number(value.toFixed(Math.min(12, decimals + 2)));
}

function isValidIncrement(increment: number): boolean {
  return Number.isFinite(increment) && increment > 0;
}

function align(value: number, increment: number, mode: RoundingMode): number {
  if (!isValidIncrement(increment)) return value;
  const ratio = value / increment;

  if (mode === "down") return Math.floor(ratio) * increment;
  if (mode === "up") return Math.ceil(ratio) * increment;
  return Math.round(ratio) * increment;
}

function isAligned(value: number, increment: number): boolean {
  if (!isValidIncrement(increment)) return false;
  const ratio = value / increment;
  const nearest = Math.round(ratio);
  return Math.abs(ratio - nearest) <= 1e-9;
}

export function deriveTickSize(contract: ContractInfo): number | null {
  if (isValidIncrement(contract.tickSize ?? NaN)) return contract.tickSize;
  if (isValidIncrement(contract.priceUnit ?? NaN)) return contract.priceUnit;
  if (contract.priceScale !== null && contract.priceScale >= 0) {
    return 1 / 10 ** contract.priceScale;
  }
  return null;
}

export function deriveStepSize(contract: ContractInfo): number | null {
  if (isValidIncrement(contract.stepSize ?? NaN)) return contract.stepSize;
  if (isValidIncrement(contract.volUnit ?? NaN)) return contract.volUnit;
  if (contract.volScale !== null && contract.volScale >= 0) {
    return 1 / 10 ** contract.volScale;
  }
  return null;
}

export function roundPriceToTick(price: number, tickSize: number, mode: RoundingMode = "nearest"): number {
  if (!isValidIncrement(tickSize)) return price;
  return normalizeFloat(align(price, tickSize, mode), tickSize);
}

export function roundQtyToStep(qty: number, stepSize: number, mode: RoundingMode = "down"): number {
  if (!isValidIncrement(stepSize)) return qty;
  return normalizeFloat(align(qty, stepSize, mode), stepSize);
}

export function clampQty(qty: number, minVol: number | null, maxVol: number | null): number {
  let value = qty;
  if (minVol !== null) value = Math.max(value, minVol);
  if (maxVol !== null) value = Math.min(value, maxVol);
  return value;
}

export function validatePrice(price: number, tickSize: number, symbol: string): ValidationResult {
  if (!isValidIncrement(tickSize)) {
    return {
      ok: false,
      error: new InvalidTickError(symbol, `Missing tick size for ${symbol}`)
    };
  }

  if (price <= 0 || !Number.isFinite(price)) {
    return {
      ok: false,
      error: new InvalidTickError(symbol, `Invalid price ${price} for ${symbol}`)
    };
  }

  if (!isAligned(price, tickSize)) {
    return {
      ok: false,
      error: new InvalidTickError(symbol, `Price ${price} not aligned to tickSize ${tickSize}`)
    };
  }

  return { ok: true };
}

export function validateQty(
  qty: number,
  stepSize: number,
  minVol: number | null,
  maxVol: number | null,
  symbol: string
): ValidationResult {
  if (!isValidIncrement(stepSize)) {
    return {
      ok: false,
      error: new InvalidStepError(symbol, `Missing step size for ${symbol}`)
    };
  }

  if (qty <= 0 || !Number.isFinite(qty)) {
    return {
      ok: false,
      error: new QtyOutOfRangeError(symbol, `Quantity ${qty} is invalid for ${symbol}`)
    };
  }

  if (!isAligned(qty, stepSize)) {
    return {
      ok: false,
      error: new InvalidStepError(symbol, `Quantity ${qty} not aligned to stepSize ${stepSize}`)
    };
  }

  if (minVol !== null && qty < minVol) {
    return {
      ok: false,
      error: new QtyOutOfRangeError(symbol, `Quantity ${qty} below minVol ${minVol}`)
    };
  }

  if (maxVol !== null && qty > maxVol) {
    return {
      ok: false,
      error: new QtyOutOfRangeError(symbol, `Quantity ${qty} above maxVol ${maxVol}`)
    };
  }

  return { ok: true };
}

export function notionalFromQty(qty: number, markPrice: number, contract: ContractInfo): number {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) return 0;
  const contractSize = contract.contractSize && contract.contractSize > 0 ? contract.contractSize : 1;
  return qty * markPrice * contractSize;
}

export function qtyFromNotionalUsd(notionalUsd: number, markPrice: number, contract: ContractInfo): number {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) return 0;
  const contractSize = contract.contractSize && contract.contractSize > 0 ? contract.contractSize : 1;
  return notionalUsd / (markPrice * contractSize);
}

export function marginRequired(notionalUsd: number, leverage: number): number {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return Number.POSITIVE_INFINITY;
  return notionalUsd / leverage;
}

export function enforceLeverageBounds(leverage: number, contract: ContractInfo): number {
  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new LeverageOutOfRangeError(contract.canonicalSymbol, `Leverage ${leverage} is invalid`);
  }

  if (contract.minLeverage !== null && leverage < contract.minLeverage) {
    throw new LeverageOutOfRangeError(
      contract.canonicalSymbol,
      `Leverage ${leverage} below minLeverage ${contract.minLeverage}`
    );
  }

  if (contract.maxLeverage !== null && leverage > contract.maxLeverage) {
    throw new LeverageOutOfRangeError(
      contract.canonicalSymbol,
      `Leverage ${leverage} above maxLeverage ${contract.maxLeverage}`
    );
  }

  return leverage;
}

export function qtyFromRisk(
  riskUsd: number,
  stopDistancePct: number,
  markPrice: number,
  contract: ContractInfo
): number {
  if (!Number.isFinite(riskUsd) || riskUsd <= 0) return 0;
  if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) return 0;

  const stopFraction = stopDistancePct / 100;
  if (stopFraction <= 0) return 0;

  const notional = riskUsd / stopFraction;
  return qtyFromNotionalUsd(notional, markPrice, contract);
}
