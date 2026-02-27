CREATE TYPE "EffectivePlan" AS ENUM ('FREE', 'PRO');
CREATE TYPE "SubscriptionStatus" AS ENUM ('INACTIVE', 'ACTIVE');
CREATE TYPE "BillingProvider" AS ENUM ('CCPAYMENT');
CREATE TYPE "BillingPackageKind" AS ENUM ('PLAN', 'AI_TOPUP');
CREATE TYPE "BillingOrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');
CREATE TYPE "AiLedgerReason" AS ENUM ('MONTHLY_GRANT', 'TOPUP', 'USAGE_DEBIT', 'ADMIN_ADJUST');

CREATE TABLE "user_subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "effective_plan" "EffectivePlan" NOT NULL DEFAULT 'FREE',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
  "pro_valid_until" TIMESTAMP(3),
  "max_running_bots" INTEGER NOT NULL DEFAULT 1,
  "max_bots_total" INTEGER NOT NULL DEFAULT 2,
  "allowed_exchanges" TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
  "ai_token_balance" BIGINT NOT NULL DEFAULT 0,
  "ai_token_used_lifetime" BIGINT NOT NULL DEFAULT 0,
  "monthly_ai_tokens_included" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_subscriptions_user_id_key" ON "user_subscriptions"("user_id");
CREATE INDEX "user_subscriptions_plan_valid_until_idx" ON "user_subscriptions"("effective_plan", "pro_valid_until");

ALTER TABLE "user_subscriptions"
  ADD CONSTRAINT "user_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_packages" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" "BillingPackageKind" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "price_cents" INTEGER NOT NULL DEFAULT 0,
  "billing_months" INTEGER NOT NULL DEFAULT 1,
  "plan" "EffectivePlan" DEFAULT 'PRO',
  "max_running_bots" INTEGER,
  "max_bots_total" INTEGER,
  "allowed_exchanges" TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
  "monthly_ai_tokens" BIGINT NOT NULL DEFAULT 0,
  "topup_ai_tokens" BIGINT NOT NULL DEFAULT 0,
  "meta" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_packages_code_key" ON "billing_packages"("code");
CREATE INDEX "billing_packages_kind_active_sort_idx" ON "billing_packages"("kind", "is_active", "sort_order");

CREATE TABLE "billing_orders" (
  "id" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "package_id" TEXT NOT NULL,
  "merchant_order_id" TEXT NOT NULL,
  "status" "BillingOrderStatus" NOT NULL DEFAULT 'PENDING',
  "amount_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "pay_url" TEXT,
  "external_order_id" TEXT,
  "payment_status_raw" TEXT,
  "paid_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "create_payload" JSONB,
  "create_response" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_orders_merchant_order_id_key" ON "billing_orders"("merchant_order_id");
CREATE INDEX "billing_orders_user_created_idx" ON "billing_orders"("user_id", "created_at" DESC);
CREATE INDEX "billing_orders_status_created_idx" ON "billing_orders"("status", "created_at" DESC);

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "billing_packages"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "billing_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "record_id" TEXT NOT NULL,
  "merchant_order_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_webhook_events_record_id_key" ON "billing_webhook_events"("record_id");
CREATE INDEX "billing_webhook_events_merchant_idx" ON "billing_webhook_events"("merchant_order_id");

CREATE TABLE "ai_token_ledger" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "order_id" TEXT,
  "reason" "AiLedgerReason" NOT NULL,
  "delta_tokens" BIGINT NOT NULL,
  "balance_after" BIGINT NOT NULL,
  "meta" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_token_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_token_ledger_user_created_idx" ON "ai_token_ledger"("user_id", "created_at" DESC);
CREATE INDEX "ai_token_ledger_reason_created_idx" ON "ai_token_ledger"("reason", "created_at" DESC);

ALTER TABLE "ai_token_ledger"
  ADD CONSTRAINT "ai_token_ledger_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_token_ledger"
  ADD CONSTRAINT "ai_token_ledger_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_token_ledger"
  ADD CONSTRAINT "ai_token_ledger_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
