-- AlterTable
ALTER TABLE "Prediction"
  ADD COLUMN "entryPrice" DOUBLE PRECISION,
  ADD COLUMN "stopLossPrice" DOUBLE PRECISION,
  ADD COLUMN "takeProfitPrice" DOUBLE PRECISION,
  ADD COLUMN "horizonMs" INTEGER,
  ADD COLUMN "outcomeStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "outcomeResult" TEXT,
  ADD COLUMN "outcomeReason" TEXT,
  ADD COLUMN "outcomePnlPct" DOUBLE PRECISION,
  ADD COLUMN "maxFavorablePct" DOUBLE PRECISION,
  ADD COLUMN "maxAdversePct" DOUBLE PRECISION,
  ADD COLUMN "outcomeEvaluatedAt" TIMESTAMP(3),
  ADD COLUMN "outcomeMeta" JSONB;

-- CreateIndex
CREATE INDEX "Prediction_userId_outcomeStatus_createdAt_idx"
  ON "Prediction"("userId", "outcomeStatus", "createdAt");
