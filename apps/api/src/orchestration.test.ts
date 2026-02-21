import assert from "node:assert/strict";
import test from "node:test";
import { enqueueBotRun, enqueueBotRunInQueue } from "./orchestration.js";

type FakeJob = {
  getState: () => Promise<string>;
  remove: () => Promise<void>;
};

type FakeQueue = {
  getJob: (jobId: string) => Promise<FakeJob | null>;
  add: (...args: unknown[]) => Promise<unknown>;
};

test("enqueueBotRunInQueue enqueues new job", async () => {
  let addCalls = 0;
  const queue: FakeQueue = {
    getJob: async () => null,
    add: async () => {
      addCalls += 1;
      return {};
    }
  };

  const result = await enqueueBotRunInQueue(queue as any, "bot_1");
  assert.equal(result.jobId, "bot-bot_1");
  assert.equal(result.queued, true);
  assert.equal(addCalls, 1);
});

test("enqueueBotRunInQueue treats active/waiting existing job as already queued", async () => {
  let addCalls = 0;
  const queue: FakeQueue = {
    getJob: async () => ({
      getState: async () => "active",
      remove: async () => {}
    }),
    add: async () => {
      addCalls += 1;
      return {};
    }
  };

  const result = await enqueueBotRunInQueue(queue as any, "bot_2");
  assert.equal(result.queued, false);
  assert.equal(addCalls, 0);
});

test("enqueueBotRunInQueue removes terminal existing job and requeues", async () => {
  let addCalls = 0;
  let removeCalls = 0;
  const queue: FakeQueue = {
    getJob: async () => ({
      getState: async () => "completed",
      remove: async () => {
        removeCalls += 1;
      }
    }),
    add: async () => {
      addCalls += 1;
      return {};
    }
  };

  const result = await enqueueBotRunInQueue(queue as any, "bot_3");
  assert.equal(result.queued, true);
  assert.equal(removeCalls, 1);
  assert.equal(addCalls, 1);
});

test("enqueueBotRunInQueue treats duplicate add error as already queued", async () => {
  const queue: FakeQueue = {
    getJob: async () => null,
    add: async () => {
      throw new Error("JobId already exists");
    }
  };

  const result = await enqueueBotRunInQueue(queue as any, "bot_4");
  assert.equal(result.queued, false);
});

test("enqueueBotRun in poll mode returns not queued", async () => {
  const originalMode = process.env.ORCHESTRATION_MODE;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.ORCHESTRATION_MODE = "poll";
  process.env.NODE_ENV = "development";
  try {
    const result = await enqueueBotRun("bot_5");
    assert.equal(result.jobId, "bot-bot_5");
    assert.equal(result.queued, false);
  } finally {
    process.env.ORCHESTRATION_MODE = originalMode;
    process.env.NODE_ENV = originalNodeEnv;
  }
});
