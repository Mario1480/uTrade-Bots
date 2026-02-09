ALTER TABLE "ExchangeAccount"
  ADD COLUMN "pnlTodayUsd" DOUBLE PRECISION,
  ADD COLUMN "lastSyncErrorAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncErrorMessage" TEXT;
