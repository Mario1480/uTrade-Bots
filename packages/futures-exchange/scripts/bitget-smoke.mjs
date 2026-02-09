#!/usr/bin/env node
import process from "node:process";

import { BitgetFuturesAdapter } from "../dist/bitget/bitget.adapter.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const symbol = process.env.BITGET_SMOKE_SYMBOL || "BTCUSDT";
const productType = process.env.BITGET_PRODUCT_TYPE || "USDT-FUTURES";

const adapter = new BitgetFuturesAdapter({
  apiKey: process.env.BITGET_API_KEY,
  apiSecret: process.env.BITGET_API_SECRET,
  apiPassphrase: process.env.BITGET_API_PASSPHRASE,
  productType,
  marginCoin: process.env.BITGET_MARGIN_COIN || "USDT",
  log: (entry) => {
    if (entry.ok) return;
    console.error(`[bitget] ${entry.method} ${entry.endpoint} failed: ${entry.message || "unknown"}`);
  }
});

let tickerCount = 0;
let depthCount = 0;

const stopTicker = adapter.onTicker(() => {
  tickerCount += 1;
});
const stopDepth = adapter.onDepth(() => {
  depthCount += 1;
});

try {
  const contract = await adapter.getContractInfo(symbol);
  console.log("contract:", contract ? {
    canonical: contract.canonicalSymbol,
    exchange: contract.mexcSymbol,
    status: (contract).symbolStatus,
    apiAllowed: contract.apiAllowed,
    tickSize: contract.tickSize,
    stepSize: contract.stepSize
  } : null);

  await adapter.subscribeTicker(symbol);
  await adapter.subscribeDepth(symbol);

  console.log("waiting 8s for ws public messages...");
  await sleep(8000);
  console.log(`ws counts: ticker=${tickerCount}, depth=${depthCount}`);

  if (process.env.BITGET_API_KEY && process.env.BITGET_API_SECRET && process.env.BITGET_API_PASSPHRASE) {
    const state = await adapter.getAccountState();
    console.log("private account state:", state);
  } else {
    console.log("private endpoints skipped (missing BITGET_API_KEY/BITGET_API_SECRET/BITGET_API_PASSPHRASE)");
  }
} finally {
  stopTicker();
  stopDepth();
  await adapter.close();
}
