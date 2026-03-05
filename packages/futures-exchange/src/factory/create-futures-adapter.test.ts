import assert from "node:assert/strict";
import test from "node:test";
import { BitgetFuturesAdapter } from "../bitget/bitget.adapter.js";
import { HyperliquidFuturesAdapter } from "../hyperliquid/hyperliquid.adapter.js";
import { MexcFuturesAdapter } from "../mexc/mexc.adapter.js";
import {
  FuturesAdapterFactoryError,
  createFuturesAdapter
} from "./create-futures-adapter.js";

const credentials = {
  apiKey: "k",
  apiSecret: "s",
  passphrase: "p"
};

test("createFuturesAdapter creates adapter by exchange", async () => {
  const bitget = createFuturesAdapter({ exchange: "bitget", ...credentials });
  assert.equal(bitget instanceof BitgetFuturesAdapter, true);

  const hyper = createFuturesAdapter({ exchange: "hyperliquid", ...credentials });
  assert.equal(hyper instanceof HyperliquidFuturesAdapter, true);

  const mexc = createFuturesAdapter(
    { exchange: "mexc", ...credentials },
    { allowMexcPerp: true }
  );
  assert.equal(mexc instanceof MexcFuturesAdapter, true);

  await Promise.all([
    bitget.close(),
    hyper.close(),
    mexc.close()
  ]);
});

test("createFuturesAdapter enforces exchange policy flags", () => {
  assert.throws(
    () => createFuturesAdapter({ exchange: "paper", ...credentials }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError
      && error.code === "paper_account_requires_market_data_resolution"
  );

  assert.throws(
    () => createFuturesAdapter({ exchange: "mexc", ...credentials }, { allowMexcPerp: false }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError && error.code === "mexc_perp_disabled"
  );

  assert.throws(
    () => createFuturesAdapter({ exchange: "binance", ...credentials }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError && error.code === "binance_market_data_only"
  );
});
