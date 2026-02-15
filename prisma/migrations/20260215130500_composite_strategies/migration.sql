CREATE TABLE "composite_strategies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" TEXT NOT NULL,
  "nodes_json" JSONB NOT NULL,
  "edges_json" JSONB NOT NULL,
  "combine_mode" TEXT NOT NULL DEFAULT 'pipeline',
  "output_policy" TEXT NOT NULL DEFAULT 'local_signal_ai_explain',
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "composite_strategies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "composite_strategy_enabled_updated_idx"
ON "composite_strategies" ("is_enabled", "updated_at" DESC);

CREATE INDEX "composite_strategy_name_updated_idx"
ON "composite_strategies" ("name", "updated_at" DESC);
