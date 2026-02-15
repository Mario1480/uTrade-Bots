ALTER TABLE "local_strategy_definitions"
ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'ts',
ADD COLUMN "remote_strategy_type" TEXT,
ADD COLUMN "fallback_strategy_type" TEXT,
ADD COLUMN "timeout_ms" INTEGER;

CREATE INDEX "local_strategy_engine_enabled_updated_idx"
ON "local_strategy_definitions" ("engine", "is_enabled", "updated_at" DESC);
