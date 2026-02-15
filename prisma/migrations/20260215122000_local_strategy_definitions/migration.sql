CREATE TABLE "local_strategy_definitions" (
  "id" TEXT NOT NULL,
  "strategy_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" TEXT NOT NULL,
  "input_schema" JSONB,
  "config_json" JSONB NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "local_strategy_definitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "local_strategy_type_enabled_updated_idx"
ON "local_strategy_definitions" ("strategy_type", "is_enabled", "updated_at" DESC);

CREATE INDEX "local_strategy_enabled_updated_idx"
ON "local_strategy_definitions" ("is_enabled", "updated_at" DESC);
