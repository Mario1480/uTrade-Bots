-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "botId" TEXT,
    "symbol" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "tsCreated" TIMESTAMP(3) NOT NULL,
    "signal" TEXT NOT NULL,
    "expectedMovePct" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "featuresSnapshot" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prediction_symbol_timeframe_tsCreated_idx" ON "Prediction"("symbol", "timeframe", "tsCreated");

-- CreateIndex
CREATE INDEX "Prediction_userId_createdAt_idx" ON "Prediction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Prediction_botId_createdAt_idx" ON "Prediction"("botId", "createdAt");

