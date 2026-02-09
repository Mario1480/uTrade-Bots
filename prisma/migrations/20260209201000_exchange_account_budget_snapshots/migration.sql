ALTER TABLE "ExchangeAccount"
  ADD COLUMN "spotBudgetTotal" DOUBLE PRECISION,
  ADD COLUMN "spotBudgetAvailable" DOUBLE PRECISION,
  ADD COLUMN "futuresBudgetEquity" DOUBLE PRECISION,
  ADD COLUMN "futuresBudgetAvailableMargin" DOUBLE PRECISION;
