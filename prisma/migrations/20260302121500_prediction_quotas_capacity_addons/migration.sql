ALTER TYPE "BillingPackageKind" ADD VALUE IF NOT EXISTS 'ENTITLEMENT_TOPUP';

ALTER TABLE "user_subscriptions"
  ADD COLUMN "max_running_predictions_ai" INTEGER,
  ADD COLUMN "max_predictions_ai_total" INTEGER,
  ADD COLUMN "max_running_predictions_composite" INTEGER,
  ADD COLUMN "max_predictions_composite_total" INTEGER;

ALTER TABLE "billing_packages"
  ADD COLUMN "max_running_predictions_ai" INTEGER,
  ADD COLUMN "max_predictions_ai_total" INTEGER,
  ADD COLUMN "max_running_predictions_composite" INTEGER,
  ADD COLUMN "max_predictions_composite_total" INTEGER,
  ADD COLUMN "topup_running_bots" INTEGER,
  ADD COLUMN "topup_bots_total" INTEGER,
  ADD COLUMN "topup_running_predictions_ai" INTEGER,
  ADD COLUMN "topup_predictions_ai_total" INTEGER,
  ADD COLUMN "topup_running_predictions_composite" INTEGER,
  ADD COLUMN "topup_predictions_composite_total" INTEGER;

CREATE TABLE "subscription_capacity_grants" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "order_id" TEXT,
  "plan_scope" "EffectivePlan",
  "delta_running_bots" INTEGER NOT NULL DEFAULT 0,
  "delta_bots_total" INTEGER NOT NULL DEFAULT 0,
  "delta_running_predictions_ai" INTEGER NOT NULL DEFAULT 0,
  "delta_predictions_ai_total" INTEGER NOT NULL DEFAULT 0,
  "delta_running_predictions_composite" INTEGER NOT NULL DEFAULT 0,
  "delta_predictions_composite_total" INTEGER NOT NULL DEFAULT 0,
  "valid_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_capacity_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscription_capacity_grants_user_valid_idx" ON "subscription_capacity_grants"("user_id", "valid_until");
CREATE INDEX "subscription_capacity_grants_subscription_idx" ON "subscription_capacity_grants"("subscription_id");
CREATE INDEX "subscription_capacity_grants_order_idx" ON "subscription_capacity_grants"("order_id");

ALTER TABLE "subscription_capacity_grants"
  ADD CONSTRAINT "subscription_capacity_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_capacity_grants"
  ADD CONSTRAINT "subscription_capacity_grants_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subscription_capacity_grants"
  ADD CONSTRAINT "subscription_capacity_grants_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
