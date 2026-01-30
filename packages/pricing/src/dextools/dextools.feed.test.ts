import test from "node:test";
import assert from "node:assert/strict";
import { DextoolsPriceFeed } from "./dextools.feed.js";

test("DextoolsPriceFeed caches within TTL", async () => {
  let calls = 0;
  const feed = new DextoolsPriceFeed({
    cacheTtlMs: 1000,
    staleAfterMs: 2000,
    client: {
      async getTokenPrice() {
        calls += 1;
        return { price: 1.23, ts: Date.now(), raw: {} };
      }
    } as any
  });

  const a = await feed.getPrice("ethereum", "0xabc");
  const b = await feed.getPrice("ethereum", "0xabc");
  assert.equal(a.mid, 1.23);
  assert.equal(b.mid, 1.23);
  assert.equal(calls, 1);
});

test("DextoolsPriceFeed marks stale after TTL", async () => {
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const feed = new DextoolsPriceFeed({
      cacheTtlMs: 10,
      staleAfterMs: 50,
      client: {
        async getTokenPrice() {
          return { price: 2, ts: Date.now(), raw: {} };
        }
      } as any
    });
    await feed.getPrice("ethereum", "0xdef");
    now += 20;
    const res = await feed.getPrice("ethereum", "0xdef");
    assert.equal(res.status, "STALE");
  } finally {
    Date.now = realNow;
  }
});

test("DextoolsPriceFeed uses circuit breaker after failures", async () => {
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  let calls = 0;
  try {
    const feed = new DextoolsPriceFeed({
      failureThreshold: 2,
      cooldownMs: 100,
      client: {
        async getTokenPrice() {
          calls += 1;
          if (calls <= 2) {
            throw new Error("429 Too Many Requests");
          }
          return { price: 3, ts: Date.now(), raw: {} };
        }
      } as any
    });

    const r1 = await feed.getPrice("ethereum", "0xaaa");
    const r2 = await feed.getPrice("ethereum", "0xaaa");
    assert.equal(r1.status, "DOWN");
    assert.equal(r2.status, "DOWN");

    now += 50;
    const r3 = await feed.getPrice("ethereum", "0xaaa");
    assert.equal(r3.status, "DOWN");

    now += 100;
    const r4 = await feed.getPrice("ethereum", "0xaaa");
    assert.equal(r4.status, "OK");
    assert.equal(r4.mid, 3);
  } finally {
    Date.now = realNow;
  }
});
