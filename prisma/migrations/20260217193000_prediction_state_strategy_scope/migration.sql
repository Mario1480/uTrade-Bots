ALTER TABLE "predictions_state"
  ADD COLUMN "strategy_kind" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "strategy_id" TEXT NOT NULL DEFAULT 'legacy';

UPDATE "predictions_state"
SET
  "strategy_kind" = CASE
    WHEN COALESCE("features_snapshot"->'strategyRef'->>'kind', '') IN ('ai', 'local', 'composite')
      THEN "features_snapshot"->'strategyRef'->>'kind'
    WHEN NULLIF("features_snapshot"->>'compositeStrategyId', '') IS NOT NULL THEN 'composite'
    WHEN NULLIF("features_snapshot"->>'localStrategyId', '') IS NOT NULL THEN 'local'
    WHEN NULLIF("features_snapshot"->>'aiPromptTemplateId', '') IS NOT NULL THEN 'ai'
    ELSE 'legacy'
  END,
  "strategy_id" = CASE
    WHEN COALESCE("features_snapshot"->'strategyRef'->>'kind', '') IN ('ai', 'local', 'composite')
      THEN COALESCE(
        NULLIF("features_snapshot"->'strategyRef'->>'id', ''),
        NULLIF("features_snapshot"->>'compositeStrategyId', ''),
        NULLIF("features_snapshot"->>'localStrategyId', ''),
        NULLIF("features_snapshot"->>'aiPromptTemplateId', ''),
        CASE
          WHEN "features_snapshot"->'strategyRef'->>'kind' = 'ai' THEN 'default'
          ELSE 'legacy'
        END
      )
    WHEN NULLIF("features_snapshot"->>'compositeStrategyId', '') IS NOT NULL
      THEN NULLIF("features_snapshot"->>'compositeStrategyId', '')
    WHEN NULLIF("features_snapshot"->>'localStrategyId', '') IS NOT NULL
      THEN NULLIF("features_snapshot"->>'localStrategyId', '')
    WHEN NULLIF("features_snapshot"->>'aiPromptTemplateId', '') IS NOT NULL
      THEN NULLIF("features_snapshot"->>'aiPromptTemplateId', '')
    ELSE 'legacy'
  END;

DROP INDEX IF EXISTS "predictions_state_exchange_account_id_symbol_market_type_timeframe_signal_mode_key";

CREATE UNIQUE INDEX "predictions_state_exchange_account_id_symbol_market_type_timeframe_signal_mode_strategy_key"
  ON "predictions_state"(
    "exchange",
    "account_id",
    "symbol",
    "market_type",
    "timeframe",
    "signal_mode",
    "strategy_kind",
    "strategy_id"
  );
