CREATE TABLE "bot_trade_state" (
  "id" TEXT NOT NULL,
  "bot_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "last_prediction_hash" TEXT,
  "last_signal" TEXT,
  "last_signal_ts" TIMESTAMP(3),
  "last_trade_ts" TIMESTAMP(3),
  "daily_trade_count" INTEGER NOT NULL DEFAULT 0,
  "daily_reset_utc" TIMESTAMP(3) NOT NULL,
  "open_side" TEXT,
  "open_qty" DOUBLE PRECISION,
  "open_entry_price" DOUBLE PRECISION,
  "open_ts" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bot_trade_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_trade_state_bot_id_symbol_key"
  ON "bot_trade_state"("bot_id", "symbol");

CREATE INDEX "bot_trade_state_bot_id_idx"
  ON "bot_trade_state"("bot_id");

CREATE INDEX "bot_trade_state_bot_id_daily_reset_utc_idx"
  ON "bot_trade_state"("bot_id", "daily_reset_utc");

ALTER TABLE "bot_trade_state"
  ADD CONSTRAINT "bot_trade_state_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
