import assert from "node:assert/strict";
import test from "node:test";
import type { ContractInfo } from "@mm/futures-core";
import { FuturesEngine, isGlobalTradingEnabled } from "./engine.js";

const btcContract: ContractInfo = {
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

function createExchangeMock(options: {
  contract?: ContractInfo | null;
  apiAllowed?: boolean;
} = {}) {
  return {
    placeOrderCalls: 0,
    cancelOrderCalls: 0,
    leverageCalls: 0,
    lastPlaceOrder: null as unknown,
    contract: options.contract ?? (options.apiAllowed === false ? { ...btcContract, apiAllowed: false } : btcContract),
    toCanonicalSymbol(symbol: string) {
      return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    },
    toExchangeSymbol() {
      return "BTC_USDT";
    },
    async getContractInfo() {
      return this.contract;
    },
    async getAccountState() {
      return { equity: 0 };
    },
    async getPositions() {
      return [];
    },
    async setLeverage() {
      this.leverageCalls += 1;
      return;
    },
    async placeOrder(req: unknown) {
      this.placeOrderCalls += 1;
      this.lastPlaceOrder = req;
      return { orderId: "1" };
    },
    async cancelOrder() {
      this.cancelOrderCalls += 1;
      return;
    }
  };
}

test("isGlobalTradingEnabled defaults to true", () => {
  assert.equal(isGlobalTradingEnabled(undefined, "production"), true);
  assert.equal(isGlobalTradingEnabled(undefined, "development"), true);
  assert.equal(isGlobalTradingEnabled("false", "production"), false);
  assert.equal(isGlobalTradingEnabled("off", "production"), false);
});

test("engine blocks trading when kill switch is disabled and emits risk event", async () => {
  const ex = createExchangeMock();
  const events: unknown[] = [];
  const engine = new FuturesEngine(ex, {
    isTradingEnabled: () => false,
    emitRiskEvent: (event) => {
      events.push(event);
    }
  });

  const result = await engine.execute({ type: "open", symbol: "BTCUSDT", side: "long", order: { qty: 1 } }, { botId: "bot-1" });

  assert.deepEqual(result, { status: "blocked", reason: "kill_switch" });
  assert.equal(ex.placeOrderCalls, 0);
  assert.equal(ex.cancelOrderCalls, 0);
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).type, "KILL_SWITCH_BLOCK");
  assert.equal((events[0] as any).botId, "bot-1");
});

test("engine validates apiAllowed and blocks before placeOrder", async () => {
  const ex = createExchangeMock({ apiAllowed: false });
  const events: unknown[] = [];
  const engine = new FuturesEngine(ex, {
    emitRiskEvent: (event) => {
      events.push(event);
    }
  });

  const result = await engine.execute({ type: "open", symbol: "BTCUSDT", side: "long", order: { qty: 1 } });

  assert.deepEqual(result, { status: "blocked", reason: "trading_not_allowed" });
  assert.equal(ex.placeOrderCalls, 0);
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).type, "TRADING_NOT_ALLOWED");
});

test("engine rounds size and price before placeOrder", async () => {
  const ex = createExchangeMock();
  const engine = new FuturesEngine(ex);

  const result = await engine.execute({
    type: "open",
    symbol: "BTC_USDT",
    side: "long",
    order: {
      type: "limit",
      qty: 1.23456,
      price: 123.4567
    }
  });

  assert.equal(result.status, "accepted");
  assert.equal(ex.placeOrderCalls, 1);
  assert.deepEqual(ex.lastPlaceOrder, {
    symbol: "BTC_USDT",
    side: "buy",
    type: "limit",
    qty: 1.234,
    price: 123.45,
    reduceOnly: undefined
  });
});

test("engine computes qty from desiredNotionalUsd", async () => {
  const ex = createExchangeMock();
  const engine = new FuturesEngine(ex);

  const result = await engine.execute({
    type: "open",
    symbol: "BTCUSDT",
    side: "short",
    order: {
      type: "market",
      desiredNotionalUsd: 1000,
      markPrice: 100
    }
  });

  assert.equal(result.status, "accepted");
  assert.equal(ex.placeOrderCalls, 1);
  assert.deepEqual(ex.lastPlaceOrder, {
    symbol: "BTC_USDT",
    side: "sell",
    type: "market",
    qty: 10,
    price: undefined,
    reduceOnly: undefined
  });
});

test("engine executes none intent as noop", async () => {
  const ex = createExchangeMock();
  const engine = new FuturesEngine(ex, {
    isTradingEnabled: () => false
  });

  const result = await engine.execute({ type: "none" });
  assert.deepEqual(result, { status: "noop" });
  assert.equal(ex.placeOrderCalls, 0);
  assert.equal(ex.cancelOrderCalls, 0);
});
