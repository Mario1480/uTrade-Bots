import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOrderBookPayload,
  normalizeTickerPayload,
  normalizeTradesPayload,
  normalizeSymbolInput
} from "./trading.js";

test("normalizeSymbolInput strips separators", () => {
  assert.equal(normalizeSymbolInput("btc_usdt"), "BTCUSDT");
  assert.equal(normalizeSymbolInput("BTC-USDT"), "BTCUSDT");
});

test("normalizeOrderBookPayload parses levels", () => {
  const book = normalizeOrderBookPayload({
    bids: [["100", "2"]],
    asks: [["101", "3"]],
    ts: "123"
  });

  assert.equal(book.bids.length, 1);
  assert.equal(book.asks.length, 1);
  assert.equal(book.bids[0].price, 100);
  assert.equal(book.asks[0].qty, 3);
  assert.equal(book.ts, 123);
});

test("normalizeTickerPayload extracts numeric fields", () => {
  const ticker = normalizeTickerPayload({
    instId: "BTCUSDT",
    lastPr: "101.5",
    markPrice: "101.2",
    bidPr: "101.4",
    askPr: "101.6",
    ts: "99"
  });

  assert.equal(ticker.symbol, "BTCUSDT");
  assert.equal(ticker.last, 101.5);
  assert.equal(ticker.mark, 101.2);
  assert.equal(ticker.bid, 101.4);
  assert.equal(ticker.ask, 101.6);
  assert.equal(ticker.ts, 99);
});

test("normalizeTradesPayload handles array payload", () => {
  const trades = normalizeTradesPayload([
    [1710000000000, "100", "0.5", "buy"],
    { symbol: "BTCUSDT", price: "101", size: "0.4", side: "sell", ts: "1710000001000" }
  ]);

  assert.equal(trades.length, 2);
  assert.equal(trades[0].price, 100);
  assert.equal(trades[0].side, "buy");
  assert.equal(trades[1].symbol, "BTCUSDT");
  assert.equal(trades[1].qty, 0.4);
});
