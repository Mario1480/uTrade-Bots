-- CreateTable
CREATE TABLE "user_ai_prompt_templates" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "indicator_keys" TEXT[] NOT NULL,
  "ohlcv_bars" INTEGER NOT NULL DEFAULT 100,
  "timeframes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "run_timeframe" TEXT,
  "timeframe" TEXT,
  "direction_preference" TEXT NOT NULL DEFAULT 'either',
  "confidence_target_pct" DOUBLE PRECISION NOT NULL DEFAULT 60,
  "sl_tp_source" TEXT NOT NULL DEFAULT 'local',
  "news_risk_mode" TEXT NOT NULL DEFAULT 'off',
  "market_analysis_update_enabled" BOOLEAN NOT NULL DEFAULT false,
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_ai_prompt_templates_user_updated_idx"
  ON "user_ai_prompt_templates"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "user_ai_prompt_templates_user_public_idx"
  ON "user_ai_prompt_templates"("user_id", "is_public");

-- AddForeignKey
ALTER TABLE "user_ai_prompt_templates"
  ADD CONSTRAINT "user_ai_prompt_templates_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
