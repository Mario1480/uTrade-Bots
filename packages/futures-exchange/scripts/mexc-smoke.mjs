#!/usr/bin/env node
import process from 'node:process';

import { MexcFuturesAdapter } from '../dist/mexc/mexc.adapter.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const symbol = process.env.MEXC_SMOKE_SYMBOL || 'BTC_USDT';

const adapter = new MexcFuturesAdapter({
  apiKey: process.env.MEXC_API_KEY,
  apiSecret: process.env.MEXC_API_SECRET,
  log: (entry) => {
    if (entry.ok) return;
    console.error(`[mexc] ${entry.method} ${entry.endpoint} failed: ${entry.message || 'unknown'}`);
  }
});

let tickerCount = 0;
let depthCount = 0;

const stopTicker = adapter.onTicker((payload) => {
  if (payload.channel === 'push.ticker' || payload.channel === 'push.tickers') tickerCount += 1;
});
const stopDepth = adapter.onDepth((payload) => {
  if (payload.channel === 'push.depth') depthCount += 1;
});

try {
  const ping = await adapter.marketApi.ping();
  console.log('ping:', ping);

  const info = await adapter.getContractInfo(symbol);
  if (!info) {
    console.warn(`contract not found for ${symbol}`);
  } else {
    console.log(
      `contract ${info.mexcSymbol} (${info.canonicalSymbol}): apiAllowed=${info.apiAllowed} minVol=${info.minVol} maxVol=${info.maxVol}`
    );
  }

  await adapter.subscribeTicker(symbol);
  await adapter.subscribeDepth(symbol);

  console.log('waiting 8s for ws public messages...');
  await sleep(8000);
  console.log(`ws counts: ticker=${tickerCount}, depth=${depthCount}`);

  if (process.env.MEXC_API_KEY && process.env.MEXC_API_SECRET) {
    const mode = await adapter.accountApi.getPositionMode();
    console.log('private endpoint ok, positionMode:', mode?.positionMode ?? null);
  } else {
    console.log('private endpoint skipped (MEXC_API_KEY/MEXC_API_SECRET missing)');
  }
} finally {
  stopTicker();
  stopDepth();
  await adapter.close();
}
