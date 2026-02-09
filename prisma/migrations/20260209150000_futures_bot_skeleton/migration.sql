-- Add optional bot owner relation to existing User model
ALTER TABLE "Bot" ADD COLUMN "userId" TEXT;

-- Minimal 1:1 Futures bot runtime configuration
CREATE TABLE "FuturesBotConfig" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "strategy" TEXT NOT NULL DEFAULT 'dummy',
  "marginMode" TEXT NOT NULL DEFAULT 'isolated',
  "leverage" INTEGER NOT NULL DEFAULT 1,
  "tickMs" INTEGER NOT NULL DEFAULT 1000,
  "testnet" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FuturesBotConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FuturesBotConfig_botId_key" ON "FuturesBotConfig"("botId");

ALTER TABLE "Bot"
  ADD CONSTRAINT "Bot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FuturesBotConfig"
  ADD CONSTRAINT "FuturesBotConfig_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "Bot"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
