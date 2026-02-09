-- Enums for SaaS bot/runtime model
CREATE TYPE "BotStatus" AS ENUM ('stopped', 'running', 'error');
CREATE TYPE "FuturesMarginMode" AS ENUM ('isolated', 'cross');

-- User auth profile updates
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Exchange accounts vault (per user)
CREATE TABLE "ExchangeAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "exchange" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "apiKeyEnc" TEXT NOT NULL,
  "apiSecretEnc" TEXT NOT NULL,
  "passphraseEnc" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "ExchangeAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExchangeAccount_userId_exchange_idx" ON "ExchangeAccount"("userId", "exchange");
ALTER TABLE "ExchangeAccount"
  ADD CONSTRAINT "ExchangeAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Bot table updates for user-scoped SaaS flows
ALTER TABLE "Bot" ADD COLUMN "exchangeAccountId" TEXT;
ALTER TABLE "Bot" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Bot" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Bot" ADD COLUMN "status_new" "BotStatus" NOT NULL DEFAULT 'stopped';
UPDATE "Bot"
SET "status_new" = CASE
  WHEN LOWER("status") = 'running' THEN 'running'::"BotStatus"
  WHEN LOWER("status") = 'error' THEN 'error'::"BotStatus"
  ELSE 'stopped'::"BotStatus"
END;
ALTER TABLE "Bot" DROP COLUMN "status";
ALTER TABLE "Bot" RENAME COLUMN "status_new" TO "status";

CREATE INDEX "Bot_userId_status_idx" ON "Bot"("userId", "status");

ALTER TABLE "Bot"
  ADD CONSTRAINT "Bot_exchangeAccountId_fkey"
  FOREIGN KEY ("exchangeAccountId") REFERENCES "ExchangeAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Futures config schema aligned with strategyKey + paramsJson + margin enum
ALTER TABLE "FuturesBotConfig" RENAME COLUMN "strategy" TO "strategyKey";
ALTER TABLE "FuturesBotConfig" ALTER COLUMN "marginMode" DROP DEFAULT;
ALTER TABLE "FuturesBotConfig"
  ALTER COLUMN "marginMode" TYPE "FuturesMarginMode"
  USING (
    CASE
      WHEN LOWER("marginMode") = 'cross' THEN 'cross'::"FuturesMarginMode"
      ELSE 'isolated'::"FuturesMarginMode"
    END
  );
ALTER TABLE "FuturesBotConfig" ALTER COLUMN "marginMode" SET DEFAULT 'isolated'::"FuturesMarginMode";
ALTER TABLE "FuturesBotConfig" ADD COLUMN "paramsJson" JSONB NOT NULL DEFAULT '{}'::jsonb;
