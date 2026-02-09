import assert from "node:assert/strict";
import test from "node:test";
import type { ContractInfo } from "./metadata.js";
import {
  clampQty,
  deriveStepSize,
  deriveTickSize,
  enforceLeverageBounds,
  marginRequired,
  notionalFromQty,
  qtyFromNotionalUsd,
  qtyFromRisk,
  roundPriceToTick,
  roundQtyToStep,
  validatePrice,
  validateQty
} from "./sizing.js";

const contract: ContractInfo = {
  canonicalSymbol: "BTCUSDT",
  mexcSymbol: "BTC_USDT",
  apiAllowed: true,
  priceScale: 2,
  volScale: 3,
  priceUnit: 0.01,
  volUnit: 0.001,
  tickSize: null,
  stepSize: null,
  minVol: 0.001,
  maxVol: 100,
  minLeverage: 1,
  maxLeverage: 125,
  contractSize: 1,
  makerFeeRate: null,
  takerFeeRate: null,
  updatedAt: new Date().toISOString()
};

test("derive tick/step from units and scales", () => {
  assert.equal(deriveTickSize(contract), 0.01);
  assert.equal(deriveStepSize(contract), 0.001);
});

test("rounding + clamp + validation", () => {
  const price = roundPriceToTick(123.4567, 0.01, "down");
  assert.equal(price, 123.45);

  const qty = roundQtyToStep(1.23456, 0.001, "down");
  assert.equal(qty, 1.234);

  assert.equal(clampQty(0.0001, 0.001, 10), 0.001);
  assert.equal(clampQty(15, 0.001, 10), 10);

  assert.equal(validatePrice(123.45, 0.01, "BTCUSDT").ok, true);
  assert.equal(validatePrice(123.456, 0.01, "BTCUSDT").ok, false);

  assert.equal(validateQty(1.234, 0.001, 0.001, 10, "BTCUSDT").ok, true);
  assert.equal(validateQty(1.2345, 0.001, 0.001, 10, "BTCUSDT").ok, false);
});

test("sizing math for notional/leverage/risk", () => {
  const qty = qtyFromNotionalUsd(1000, 100, contract);
  assert.equal(qty, 10);

  const notional = notionalFromQty(10, 100, contract);
  assert.equal(notional, 1000);

  assert.equal(marginRequired(1000, 10), 100);
  assert.equal(qtyFromRisk(50, 1, 100, contract), 50);

  assert.equal(enforceLeverageBounds(10, contract), 10);
  assert.throws(() => enforceLeverageBounds(200, contract));
});
