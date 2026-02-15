-- CreateTable
CREATE TABLE "market_context_snapshots" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "market_type" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "ts_from" TIMESTAMP(3) NOT NULL,
    "ts_to" TIMESTAMP(3) NOT NULL,
    "context_version" TEXT NOT NULL,
    "context_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_context_snapshots_exchange_symbol_market_type_timeframe_key" ON "market_context_snapshots"("exchange", "symbol", "market_type", "timeframe");

-- CreateIndex
CREATE INDEX "market_ctx_scope_hash_idx" ON "market_context_snapshots"("exchange", "symbol", "market_type", "timeframe", "context_hash");

-- CreateIndex
CREATE INDEX "market_ctx_scope_ts_to_desc_idx" ON "market_context_snapshots"("exchange", "symbol", "market_type", "timeframe", "ts_to" DESC);
