CREATE TABLE "license_entitlements" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "plan" TEXT NOT NULL DEFAULT 'pro',
  "allowed_strategy_kinds" TEXT[] NOT NULL DEFAULT ARRAY['local','ai','composite']::TEXT[],
  "allowed_strategy_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "max_composite_nodes" INTEGER NOT NULL DEFAULT 12,
  "ai_allowed_models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ai_monthly_budget_usd" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "license_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "license_entitlements_workspace_id_key"
ON "license_entitlements" ("workspace_id");

CREATE INDEX "license_entitlements_plan_idx"
ON "license_entitlements" ("plan");

ALTER TABLE "license_entitlements"
ADD CONSTRAINT "license_entitlements_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
