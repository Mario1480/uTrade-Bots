import assert from "node:assert/strict";
import test from "node:test";
import { BitgetContractCache, toBitgetContractInfo } from "./bitget.contract-cache.js";
import { normalizeOrderInput } from "./bitget.sizing.js";

const contractRaw = {
  symbol: "BTCUSDT",
  baseCoin: "BTC",
  quoteCoin: "USDT",
  minTradeNum: "0.001",
  maxOrderQty: "100",
  minLever: "1",
  maxLever: "125",
  volumePlace: "3",
  pricePlace: "1",
  priceEndStep: "5",
  sizeMultiplier: "0.001",
  symbolStatus: "normal",
  makerFeeRate: "0.0002",
  takerFeeRate: "0.0006"
};

test("toBitgetContractInfo derives tick/step and status gating", () => {
  const info = toBitgetContractInfo(contractRaw, "USDT-FUTURES");

  assert.equal(info.canonicalSymbol, "BTCUSDT");
  assert.equal(info.mexcSymbol, "BTCUSDT");
  assert.equal(info.tickSize, 0.5);
  assert.equal(info.stepSize, 0.001);
  assert.equal(info.apiAllowed, true);
});

test("bitget contract cache warmup and symbol mapping", async () => {
  const marketApi = {
    async getContracts() {
      return [contractRaw];
    }
  } as any;

  const cache = new BitgetContractCache(marketApi, "USDT-FUTURES", {
    ttlSeconds: 300,
    now: () => 1_000
  });

  await cache.warmup();

  const byCanonical = await cache.getByCanonical("btcusdt");
  assert.ok(byCanonical);
  assert.equal(byCanonical?.mexcSymbol, "BTCUSDT");

  const byBitget = await cache.getByBitget("BTCUSDT");
  assert.equal(byBitget?.canonicalSymbol, "BTCUSDT");

  const mapped = cache.getSymbolRegistry().toMexcSymbol("BTCUSDT");
  assert.equal(mapped, "BTCUSDT");
});

test("normalizeOrderInput rounds and clamps by contract", () => {
  const info = toBitgetContractInfo(contractRaw, "USDT-FUTURES");
  const normalized = normalizeOrderInput({
    contract: info,
    qty: 1.23456,
    price: 123.74,
    type: "limit",
    roundingMode: "down"
  });

  assert.equal(normalized.qty, 1.234);
  assert.equal(normalized.price, 123.5);
});
