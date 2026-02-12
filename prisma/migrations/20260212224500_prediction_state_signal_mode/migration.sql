ALTER TABLE "predictions_state"
  ADD COLUMN "signal_mode" TEXT NOT NULL DEFAULT 'both';

UPDATE "predictions_state"
SET "signal_mode" = CASE
  WHEN "features_snapshot"->>'signalMode' = 'local_only' THEN 'local_only'
  WHEN "features_snapshot"->>'signalMode' = 'ai_only' THEN 'ai_only'
  WHEN "features_snapshot"->>'signalMode' = 'both' THEN 'both'
  WHEN "features_snapshot"->>'signalMode' = 'local' THEN 'local_only'
  WHEN "features_snapshot"->>'signalMode' = 'ai' THEN 'ai_only'
  ELSE 'both'
END;

DROP INDEX IF EXISTS "predictions_state_exchange_account_id_symbol_market_type_timeframe_key";

CREATE UNIQUE INDEX "predictions_state_exchange_account_id_symbol_market_type_timeframe_signal_mode_key"
  ON "predictions_state"("exchange", "account_id", "symbol", "market_type", "timeframe", "signal_mode");
