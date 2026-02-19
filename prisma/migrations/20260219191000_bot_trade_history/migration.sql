CREATE TABLE "bot_trade_history" (
  "id" TEXT NOT NULL,
  "bot_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "exchange_account_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "market_type" TEXT NOT NULL DEFAULT 'perp',
  "side" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "entry_ts" TIMESTAMP(3) NOT NULL,
  "entry_price" DOUBLE PRECISION NOT NULL,
  "entry_qty" DOUBLE PRECISION NOT NULL,
  "entry_notional_usd" DOUBLE PRECISION NOT NULL,
  "tp_price" DOUBLE PRECISION,
  "sl_price" DOUBLE PRECISION,
  "exit_ts" TIMESTAMP(3),
  "exit_price" DOUBLE PRECISION,
  "exit_notional_usd" DOUBLE PRECISION,
  "realized_pnl_usd" DOUBLE PRECISION,
  "realized_pnl_pct" DOUBLE PRECISION,
  "outcome" TEXT,
  "exit_reason" TEXT,
  "entry_order_id" TEXT,
  "exit_order_id" TEXT,
  "prediction_state_id" TEXT,
  "prediction_hash" TEXT,
  "prediction_signal" TEXT,
  "prediction_confidence" DOUBLE PRECISION,
  "prediction_tags_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bot_trade_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bot_trade_history_bot_id_entry_ts_idx"
  ON "bot_trade_history"("bot_id", "entry_ts" DESC);

CREATE INDEX "bot_trade_history_bot_id_status_idx"
  ON "bot_trade_history"("bot_id", "status");

CREATE INDEX "bot_trade_history_user_id_entry_ts_idx"
  ON "bot_trade_history"("user_id", "entry_ts" DESC);

CREATE INDEX "bot_trade_history_bot_id_symbol_status_idx"
  ON "bot_trade_history"("bot_id", "symbol", "status");

ALTER TABLE "bot_trade_history"
  ADD CONSTRAINT "bot_trade_history_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
