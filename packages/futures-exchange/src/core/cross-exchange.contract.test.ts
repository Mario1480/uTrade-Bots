import assert from "node:assert/strict";
import test from "node:test";
import { toBitgetContractInfo } from "../bitget/bitget.contract-cache.js";
import { BitgetRateLimitError } from "../bitget/bitget.errors.js";
import { mapBitgetError } from "../bitget/bitget-error.mapper.js";
import { toHyperliquidContractInfo } from "../hyperliquid/hyperliquid.contract-cache.js";
import { toMexcContractInfo } from "../mexc/mexc.adapter.js";
import { MexcAuthError } from "../mexc/mexc.errors.js";
import { mapMexcError } from "../mexc/mexc-error.mapper.js";

test("normalization contract produces canonical and exchange symbols across adapters", () => {
  const bitget = toBitgetContractInfo(
    {
      symbol: "BTCUSDT",
      baseCoin: "BTC",
      quoteCoin: "USDT",
      minTradeNum: "0.001",
      maxOrderQty: "200",
      minLever: "1",
      maxLever: "125",
      volumePlace: "3",
      pricePlace: "2",
      sizeMultiplier: "0.001",
      symbolStatus: "normal"
    },
    "USDT-FUTURES"
  );
  assert.equal(bitget.canonicalSymbol, "BTCUSDT");
  assert.equal(bitget.exchangeSymbol, "BTCUSDT");

  const mexc = toMexcContractInfo({
    symbol: "ETH_USDT",
    baseCoin: "ETH",
    quoteCoin: "USDT",
    minVol: "1",
    maxVol: "1000",
    priceUnit: "0.01",
    volUnit: "1",
    contractSize: "0.001",
    apiAllowed: true
  });
  assert.equal(mexc.canonicalSymbol, "ETHUSDT");
  assert.equal(mexc.exchangeSymbol, "ETH_USDT");

  const hyper = toHyperliquidContractInfo({
    index: 1,
    universe: { name: "SOL", szDecimals: 2, maxLeverage: 20 },
    assetCtx: null
  });
  assert.equal(hyper.canonicalSymbol, "SOLUSDT");
  assert.equal(hyper.exchangeSymbol, "SOL-PERP");
});

test("error mapping contract is standardized across bitget and mexc", () => {
  const bitgetRate = mapBitgetError(
    new BitgetRateLimitError("too many requests", {
      endpoint: "/api/v2/mix/order/place-order",
      method: "POST",
      status: 429
    })
  );
  assert.equal(bitgetRate.code, "EX_RATE_LIMIT");
  assert.equal(bitgetRate.retryable, true);

  const mexcAuth = mapMexcError(
    new MexcAuthError("signature invalid", {
      endpoint: "/api/v1/private/order/submit",
      method: "POST",
      status: 401
    })
  );
  assert.equal(mexcAuth.code, "EX_AUTH");
  assert.equal(mexcAuth.retryable, false);
});
