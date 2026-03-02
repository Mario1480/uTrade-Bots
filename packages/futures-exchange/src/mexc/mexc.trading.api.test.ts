import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMexcCapabilities, MexcTradingApi } from "./mexc.trading.api.js";
import { MexcMaintenanceError } from "./mexc.errors.js";

const ORIGINAL_ORDER_WRITE = process.env.MEXC_ORDER_WRITE_ENABLED;
const ORIGINAL_ADVANCED = process.env.MEXC_ADVANCED_ORDERS_ENABLED;

test("createDefaultMexcCapabilities respects runtime flags", () => {
  process.env.MEXC_ORDER_WRITE_ENABLED = "0";
  process.env.MEXC_ADVANCED_ORDERS_ENABLED = "1";
  const disabled = createDefaultMexcCapabilities();
  assert.equal(disabled.placeOrder, false);
  assert.equal(disabled.cancelOrder, false);
  assert.equal(disabled.planOrders, false);

  process.env.MEXC_ORDER_WRITE_ENABLED = "1";
  process.env.MEXC_ADVANCED_ORDERS_ENABLED = "0";
  const basic = createDefaultMexcCapabilities();
  assert.equal(basic.placeOrder, true);
  assert.equal(basic.cancelOrder, true);
  assert.equal(basic.planOrders, false);

  process.env.MEXC_ORDER_WRITE_ENABLED = "1";
  process.env.MEXC_ADVANCED_ORDERS_ENABLED = "1";
  const advanced = createDefaultMexcCapabilities();
  assert.equal(advanced.placeOrder, true);
  assert.equal(advanced.cancelOrder, true);
  assert.equal(advanced.planOrders, true);
  assert.equal(advanced.stopOrders, true);

  if (ORIGINAL_ORDER_WRITE === undefined) {
    delete process.env.MEXC_ORDER_WRITE_ENABLED;
  } else {
    process.env.MEXC_ORDER_WRITE_ENABLED = ORIGINAL_ORDER_WRITE;
  }
  if (ORIGINAL_ADVANCED === undefined) {
    delete process.env.MEXC_ADVANCED_ORDERS_ENABLED;
  } else {
    process.env.MEXC_ADVANCED_ORDERS_ENABLED = ORIGINAL_ADVANCED;
  }
});

test("MexcTradingApi blocks submitOrder when order writes are disabled", async () => {
  const api = new MexcTradingApi(
    {
      requestPrivate: async () => ({})
    } as any,
    {
      placeOrder: false,
      batchPlaceOrder: false,
      cancelOrder: false,
      cancelWithExternal: false,
      cancelAll: false,
      stopOrders: false,
      planOrders: false,
      positionModeChange: true,
      leverageChange: true,
      privateWs: true
    }
  );

  assert.throws(
    () => api.submitOrder({
        symbol: "BTC_USDT",
        vol: 1,
        side: 1,
        type: 1
      }),
    (error: unknown) => {
      assert.ok(error instanceof MexcMaintenanceError);
      assert.match(String((error as Error).message), /capability 'placeOrder' is disabled/i);
      return true;
    }
  );
});
