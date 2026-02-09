ALTER TABLE "BotRuntime"
  ADD COLUMN "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "errorWindowStartAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorMessage" TEXT;

CREATE TABLE "RiskEvent" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiskEvent_botId_createdAt_idx" ON "RiskEvent"("botId", "createdAt");
CREATE INDEX "RiskEvent_type_createdAt_idx" ON "RiskEvent"("type", "createdAt");

ALTER TABLE "RiskEvent"
  ADD CONSTRAINT "RiskEvent_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "Bot"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
