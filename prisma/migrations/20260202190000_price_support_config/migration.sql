-- Add workspace feature flags
ALTER TABLE "Workspace" ADD COLUMN "features" JSONB;
UPDATE "Workspace" SET "features" = '{}' WHERE "features" IS NULL;
ALTER TABLE "Workspace" ALTER COLUMN "features" SET DEFAULT '{}'::jsonb;
ALTER TABLE "Workspace" ALTER COLUMN "features" SET NOT NULL;

-- Price support config per bot
CREATE TABLE "BotPriceSupportConfig" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "floorPrice" DOUBLE PRECISION,
  "budgetUsdt" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "spentUsdt" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxOrderUsdt" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "cooldownMs" INTEGER NOT NULL DEFAULT 2000,
  "mode" TEXT NOT NULL DEFAULT 'PASSIVE',
  "lastActionAt" BIGINT NOT NULL DEFAULT 0,
  "stoppedReason" TEXT,
  "notifiedBudgetExhaustedAt" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "BotPriceSupportConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotPriceSupportConfig_botId_key" ON "BotPriceSupportConfig"("botId");
ALTER TABLE "BotPriceSupportConfig"
  ADD CONSTRAINT "BotPriceSupportConfig_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
