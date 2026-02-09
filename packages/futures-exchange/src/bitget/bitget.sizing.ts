import type { ContractInfo } from "@mm/futures-core";
import {
  clampQty,
  deriveStepSize,
  deriveTickSize,
  roundPriceToTick,
  roundQtyToStep,
  validatePrice,
  validateQty
} from "@mm/futures-core";

export type NormalizeOrderInput = {
  contract: ContractInfo;
  qty: number;
  price?: number;
  type: "market" | "limit";
  roundingMode?: "down" | "up" | "nearest";
};

export type NormalizeOrderOutput = {
  qty: number;
  price?: number;
};

export function normalizeOrderInput(input: NormalizeOrderInput): NormalizeOrderOutput {
  const mode = input.roundingMode ?? "down";

  const stepSize = deriveStepSize(input.contract);
  if (!stepSize) {
    throw new Error(`Missing stepSize for ${input.contract.canonicalSymbol}`);
  }

  let qty = roundQtyToStep(input.qty, stepSize, mode);
  qty = clampQty(qty, input.contract.minVol, input.contract.maxVol);

  const qtyValidation = validateQty(
    qty,
    stepSize,
    input.contract.minVol,
    input.contract.maxVol,
    input.contract.canonicalSymbol
  );
  if (!qtyValidation.ok) throw qtyValidation.error;

  if (input.type === "market") {
    return { qty };
  }

  if (input.price === undefined) {
    throw new Error(`Limit order requires price for ${input.contract.canonicalSymbol}`);
  }

  const tickSize = deriveTickSize(input.contract);
  if (!tickSize) {
    throw new Error(`Missing tickSize for ${input.contract.canonicalSymbol}`);
  }

  const price = roundPriceToTick(input.price, tickSize, mode);
  const priceValidation = validatePrice(price, tickSize, input.contract.canonicalSymbol);
  if (!priceValidation.ok) throw priceValidation.error;

  return {
    qty,
    price
  };
}
