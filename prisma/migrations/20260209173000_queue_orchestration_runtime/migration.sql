ALTER TABLE "BotRuntime"
  ADD COLUMN "workerId" TEXT,
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "lastTickAt" TIMESTAMP(3),
  ADD COLUMN "stateJson" JSONB,
  ADD COLUMN "lastError" TEXT;
