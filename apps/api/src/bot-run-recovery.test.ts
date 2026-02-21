import assert from "node:assert/strict";
import test from "node:test";
import { recoverRunningBotJobs } from "./bot-run-recovery.js";

test("recoverRunningBotJobs processes running bots and tracks queued vs already queued", async () => {
  let whereStatus: string | null = null;
  const db = {
    bot: {
      findMany: async (params: any) => {
        whereStatus = String(params?.where?.status ?? "");
        return [{ id: "bot_a" }, { id: "bot_b" }];
      }
    }
  };

  const calls: string[] = [];
  const result = await recoverRunningBotJobs({
    db,
    enqueueBotRunFn: async (botId: string) => {
      calls.push(botId);
      return { jobId: `bot-${botId}`, queued: botId === "bot_a" };
    }
  });

  assert.equal(whereStatus, "running");
  assert.deepEqual(calls, ["bot_a", "bot_b"]);
  assert.deepEqual(result, {
    scanned: 2,
    enqueued: 1,
    alreadyQueued: 1,
    failed: 0
  });
});

test("recoverRunningBotJobs isolates per-bot enqueue failures", async () => {
  const db = {
    bot: {
      findMany: async () => [{ id: "bot_a" }, { id: "bot_b" }, { id: "bot_c" }]
    }
  };

  const warnings: Array<Record<string, unknown>> = [];
  const result = await recoverRunningBotJobs({
    db,
    enqueueBotRunFn: async (botId: string) => {
      if (botId === "bot_b") throw new Error("redis timeout");
      if (botId === "bot_c") throw new Error("queue unavailable");
      return { jobId: `bot-${botId}`, queued: true };
    },
    logger: {
      info: () => {},
      warn: (_message, meta) => {
        warnings.push(meta ?? {});
      }
    }
  });

  assert.deepEqual(result, {
    scanned: 3,
    enqueued: 1,
    alreadyQueued: 0,
    failed: 2
  });
  assert.equal(warnings.length, 2);
});
