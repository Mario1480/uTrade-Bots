import assert from "node:assert/strict";
import test from "node:test";
import { ContractCache, SymbolRegistry, type ContractInfo } from "./metadata.js";

const sampleContracts: ContractInfo[] = [
  {
    canonicalSymbol: "BTCUSDT",
    mexcSymbol: "BTC_USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    apiAllowed: true,
    priceScale: 2,
    volScale: 3,
    priceUnit: 0.01,
    volUnit: 0.001,
    tickSize: 0.01,
    stepSize: 0.001,
    minVol: 0.001,
    maxVol: 100,
    minLeverage: 1,
    maxLeverage: 125,
    contractSize: 1,
    makerFeeRate: null,
    takerFeeRate: null,
    updatedAt: new Date().toISOString()
  },
  {
    canonicalSymbol: "ETHUSDT",
    mexcSymbol: "ETH_USDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    apiAllowed: true,
    priceScale: 2,
    volScale: 3,
    priceUnit: 0.01,
    volUnit: 0.001,
    tickSize: 0.01,
    stepSize: 0.001,
    minVol: 0.001,
    maxVol: 200,
    minLeverage: 1,
    maxLeverage: 100,
    contractSize: 1,
    makerFeeRate: null,
    takerFeeRate: null,
    updatedAt: new Date().toISOString()
  }
];

test("symbol registry maps canonical <-> mexc", () => {
  const registry = new SymbolRegistry(
    sampleContracts.map((contract) => ({
      canonicalSymbol: contract.canonicalSymbol,
      mexcSymbol: contract.mexcSymbol,
      baseAsset: contract.baseAsset,
      quoteAsset: contract.quoteAsset
    }))
  );

  assert.equal(registry.toMexcSymbol("BTCUSDT"), "BTC_USDT");
  assert.equal(registry.toMexcSymbol("btc_usdt"), "BTC_USDT");
  assert.equal(registry.toCanonicalSymbol("BTC_USDT"), "BTCUSDT");
  assert.equal(registry.toCanonicalSymbol("btcusdt"), "BTCUSDT");
  assert.equal(registry.toCanonicalSymbol("UNKNOWN"), null);
});

test("contract cache warmup + miss fetch + ttl refresh", async () => {
  let now = 1_000;
  let loadCount = 0;

  const cache = new ContractCache({
    ttlSeconds: 1,
    now: () => now,
    loader: async () => {
      loadCount += 1;
      return sampleContracts;
    }
  });

  await cache.warmup();
  assert.equal(loadCount, 1);

  const btc = await cache.getByCanonical("BTCUSDT");
  assert.ok(btc);
  assert.equal(btc?.mexcSymbol, "BTC_USDT");

  now += 2_000;
  const eth = await cache.getByCanonical("ETHUSDT");
  assert.ok(eth);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(loadCount >= 2);

  const fromMexc = await cache.getByMexc("BTC_USDT");
  assert.equal(fromMexc?.canonicalSymbol, "BTCUSDT");
});
