CREATE TABLE "exchange_account_risk_profiles" (
  "id" TEXT NOT NULL,
  "exchange_account_id" TEXT NOT NULL,
  "daily_loss_warn_pct" DOUBLE PRECISION NOT NULL,
  "daily_loss_warn_usd" DOUBLE PRECISION NOT NULL,
  "daily_loss_critical_pct" DOUBLE PRECISION NOT NULL,
  "daily_loss_critical_usd" DOUBLE PRECISION NOT NULL,
  "margin_warn_pct" DOUBLE PRECISION NOT NULL,
  "margin_warn_usd" DOUBLE PRECISION NOT NULL,
  "margin_critical_pct" DOUBLE PRECISION NOT NULL,
  "margin_critical_usd" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "exchange_account_risk_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_account_risk_profiles_exchange_account_id_key"
  ON "exchange_account_risk_profiles"("exchange_account_id");

ALTER TABLE "exchange_account_risk_profiles"
  ADD CONSTRAINT "exchange_account_risk_profiles_exchange_account_id_fkey"
  FOREIGN KEY ("exchange_account_id") REFERENCES "ExchangeAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
