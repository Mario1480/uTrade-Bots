-- CreateTable
CREATE TABLE "predictions_state" (
  "id" TEXT NOT NULL,
  "exchange" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "market_type" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "ts_updated" TIMESTAMP(3) NOT NULL,
  "ts_predicted_for" TIMESTAMP(3) NOT NULL,
  "signal" TEXT NOT NULL,
  "expected_move_pct" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL,
  "tags" JSONB NOT NULL,
  "explanation" TEXT,
  "key_drivers" JSONB NOT NULL,
  "features_snapshot" JSONB NOT NULL,
  "model_version" TEXT NOT NULL,
  "last_ai_explained_at" TIMESTAMP(3),
  "last_change_hash" TEXT,
  "last_change_reason" TEXT,
  "auto_schedule_enabled" BOOLEAN NOT NULL DEFAULT true,
  "auto_schedule_paused" BOOLEAN NOT NULL DEFAULT false,
  "direction_preference" TEXT,
  "confidence_target_pct" DOUBLE PRECISION,
  "leverage" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "predictions_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions_events" (
  "id" TEXT NOT NULL,
  "state_id" TEXT NOT NULL,
  "ts_created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "change_type" TEXT NOT NULL,
  "prev_snapshot" JSONB,
  "new_snapshot" JSONB,
  "delta" JSONB,
  "horizon_eval_ref" TEXT,
  "model_version" TEXT NOT NULL,
  "reason" TEXT,

  CONSTRAINT "predictions_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "predictions_state_exchange_account_id_symbol_market_type_timeframe_key"
  ON "predictions_state"("exchange", "account_id", "symbol", "market_type", "timeframe");

-- CreateIndex
CREATE INDEX "predictions_state_exchange_account_id_timeframe_ts_updated_idx"
  ON "predictions_state"("exchange", "account_id", "timeframe", "ts_updated" DESC);

-- CreateIndex
CREATE INDEX "predictions_state_symbol_timeframe_ts_updated_idx"
  ON "predictions_state"("symbol", "timeframe", "ts_updated" DESC);

-- CreateIndex
CREATE INDEX "predictions_state_user_id_updated_at_idx"
  ON "predictions_state"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "predictions_events_state_id_ts_created_idx"
  ON "predictions_events"("state_id", "ts_created" DESC);

-- AddForeignKey
ALTER TABLE "predictions_events"
  ADD CONSTRAINT "predictions_events_state_id_fkey"
  FOREIGN KEY ("state_id") REFERENCES "predictions_state"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
