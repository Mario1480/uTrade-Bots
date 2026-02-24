-- Enforce unique Telegram chat IDs per user and clean existing conflicts deterministically.

-- 1) Normalize user chat IDs (trim whitespace, empty -> NULL).
UPDATE "User"
SET "telegramChatId" = NULL
WHERE "telegramChatId" IS NOT NULL
  AND btrim("telegramChatId") = '';

UPDATE "User"
SET "telegramChatId" = btrim("telegramChatId")
WHERE "telegramChatId" IS NOT NULL
  AND "telegramChatId" <> btrim("telegramChatId");

-- 2) Normalize global chat ID (trim whitespace, empty -> NULL).
UPDATE "AlertConfig"
SET "telegramChatId" = NULL
WHERE "key" = 'default'
  AND "telegramChatId" IS NOT NULL
  AND btrim("telegramChatId") = '';

UPDATE "AlertConfig"
SET "telegramChatId" = btrim("telegramChatId")
WHERE "key" = 'default'
  AND "telegramChatId" IS NOT NULL
  AND "telegramChatId" <> btrim("telegramChatId");

-- 3) Global wins: clear user IDs that collide with global default chat ID.
UPDATE "User" u
SET "telegramChatId" = NULL
FROM "AlertConfig" a
WHERE a."key" = 'default'
  AND a."telegramChatId" IS NOT NULL
  AND u."telegramChatId" = a."telegramChatId";

-- 4) Deduplicate users: oldest createdAt wins, ties broken by id.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "telegramChatId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "User"
  WHERE "telegramChatId" IS NOT NULL
)
UPDATE "User" u
SET "telegramChatId" = NULL
FROM ranked r
WHERE u.id = r.id
  AND r.rn > 1;

-- 5) Add DB-level unique index for user chat IDs.
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");
