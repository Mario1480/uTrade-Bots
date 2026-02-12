-- CreateTable
CREATE TABLE "indicator_settings" (
  "id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "exchange" TEXT,
  "account_id" TEXT,
  "symbol" TEXT,
  "timeframe" TEXT,
  "config_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "indicator_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "indicator_settings_scope_type_exchange_account_id_symbol_timeframe_key"
  ON "indicator_settings"("scope_type", "exchange", "account_id", "symbol", "timeframe");

-- CreateIndex
CREATE INDEX "indicator_settings_scope_type_idx" ON "indicator_settings"("scope_type");

-- CreateIndex
CREATE INDEX "indicator_settings_exchange_account_id_symbol_timeframe_idx"
  ON "indicator_settings"("exchange", "account_id", "symbol", "timeframe");
