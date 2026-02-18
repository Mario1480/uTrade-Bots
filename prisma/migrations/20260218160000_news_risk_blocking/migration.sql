ALTER TABLE "economic_calendar_config"
  ADD COLUMN IF NOT EXISTS "enforce_news_risk_block" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "local_strategy_definitions"
  ADD COLUMN IF NOT EXISTS "news_risk_mode" TEXT NOT NULL DEFAULT 'off';

ALTER TABLE "composite_strategies"
  ADD COLUMN IF NOT EXISTS "news_risk_mode" TEXT NOT NULL DEFAULT 'off';
