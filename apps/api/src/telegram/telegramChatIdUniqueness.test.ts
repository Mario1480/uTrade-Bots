import test from "node:test";
import assert from "node:assert/strict";
import {
  TELEGRAM_CHAT_ID_IN_USE_ERROR,
  findTelegramChatIdConflict,
  isPrismaUniqueConstraintError,
  normalizeTelegramChatId
} from "./chatIdUniqueness.js";

test("normalizeTelegramChatId trims and nulls empty values", () => {
  assert.equal(normalizeTelegramChatId(null), null);
  assert.equal(normalizeTelegramChatId(undefined), null);
  assert.equal(normalizeTelegramChatId("   "), null);
  assert.equal(normalizeTelegramChatId("  12345  "), "12345");
});

test("findTelegramChatIdConflict returns null for free chat id", async () => {
  const conflict = await findTelegramChatIdConflict({
    chatId: "1001",
    currentUserId: "u_1",
    deps: {
      findUserByChatId: async () => null,
      getGlobalChatId: async () => "2002"
    }
  });
  assert.equal(conflict, null);
});

test("findTelegramChatIdConflict flags user conflict when another user already uses id", async () => {
  const conflict = await findTelegramChatIdConflict({
    chatId: "1001",
    currentUserId: "u_1",
    deps: {
      findUserByChatId: async () => ({ id: "u_2" }),
      getGlobalChatId: async () => null
    }
  });
  assert.equal(conflict, "user");
});

test("findTelegramChatIdConflict ignores same-user ownership", async () => {
  const seenCalls: Array<{ chatId: string; excludingUserId: string | null }> = [];
  const conflict = await findTelegramChatIdConflict({
    chatId: "1001",
    currentUserId: "u_1",
    deps: {
      findUserByChatId: async (input) => {
        seenCalls.push(input);
        return null;
      },
      getGlobalChatId: async () => null
    }
  });
  assert.equal(conflict, null);
  assert.deepEqual(seenCalls, [{ chatId: "1001", excludingUserId: "u_1" }]);
});

test("findTelegramChatIdConflict flags global conflict", async () => {
  const conflict = await findTelegramChatIdConflict({
    chatId: "1001",
    currentUserId: "u_1",
    deps: {
      findUserByChatId: async () => null,
      getGlobalChatId: async () => " 1001 "
    }
  });
  assert.equal(conflict, "global");
});

test("findTelegramChatIdConflict can skip global check", async () => {
  const conflict = await findTelegramChatIdConflict({
    chatId: "1001",
    includeGlobal: false,
    deps: {
      findUserByChatId: async () => null,
      getGlobalChatId: async () => "1001"
    }
  });
  assert.equal(conflict, null);
});

test("isPrismaUniqueConstraintError identifies P2002", () => {
  assert.equal(isPrismaUniqueConstraintError({ code: "P2002" }), true);
  assert.equal(isPrismaUniqueConstraintError({ code: "P2025" }), false);
  assert.equal(isPrismaUniqueConstraintError(null), false);
});

test("TELEGRAM_CHAT_ID_IN_USE_ERROR shape remains stable", () => {
  assert.deepEqual(TELEGRAM_CHAT_ID_IN_USE_ERROR, {
    error: "telegram_chat_id_in_use",
    message: "Telegram chat ID is already in use.",
    details: "Already used by another user or global telegram config."
  });
});
