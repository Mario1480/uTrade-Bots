-- Remove stale pre-strategy unique index that can survive due identifier truncation.
DO $$
DECLARE
  idx RECORD;
BEGIN
  FOR idx IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS index_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'predictions_state'
      AND i.indisunique
      AND pg_get_indexdef(i.indexrelid) LIKE '%(exchange, account_id, symbol, market_type, timeframe, signal_mode)%'
      AND pg_get_indexdef(i.indexrelid) NOT LIKE '%strategy_kind%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', idx.schema_name, idx.index_name);
  END LOOP;
END $$;

-- Ensure the strategy-scoped unique index exists.
CREATE UNIQUE INDEX IF NOT EXISTS "predictions_state_exchange_account_id_symbol_market_type_timeframe_signal_mode_strategy_key"
  ON "predictions_state" (
    "exchange",
    "account_id",
    "symbol",
    "market_type",
    "timeframe",
    "signal_mode",
    "strategy_kind",
    "strategy_id"
  );
