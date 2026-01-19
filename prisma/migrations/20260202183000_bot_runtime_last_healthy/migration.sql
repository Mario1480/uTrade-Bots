-- Add lastHealthyAt timestamp for runner health tracking
ALTER TABLE "BotRuntime" ADD COLUMN "lastHealthyAt" TIMESTAMP(3);
