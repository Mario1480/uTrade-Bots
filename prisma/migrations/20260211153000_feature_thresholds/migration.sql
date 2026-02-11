-- CreateTable
CREATE TABLE "feature_thresholds" (
  "id" TEXT NOT NULL,
  "exchange" TEXT NOT NULL,
  "account_scope" TEXT NOT NULL DEFAULT 'global',
  "symbol" TEXT NOT NULL,
  "market_type" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "window_from" TIMESTAMP(3) NOT NULL,
  "window_to" TIMESTAMP(3) NOT NULL,
  "n_bars" INTEGER NOT NULL,
  "thresholds_json" JSONB NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" TEXT NOT NULL,

  CONSTRAINT "feature_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_thresholds_exchange_symbol_market_type_timeframe_computed_at_idx"
  ON "feature_thresholds"("exchange", "symbol", "market_type", "timeframe", "computed_at" DESC);
