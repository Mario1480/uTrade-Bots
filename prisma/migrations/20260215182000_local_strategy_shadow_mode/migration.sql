ALTER TABLE "local_strategy_definitions"
ADD COLUMN "shadow_mode" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "local_strategy_engine_shadow_enabled_updated_idx"
ON "local_strategy_definitions" ("engine", "shadow_mode", "is_enabled", "updated_at" DESC);
