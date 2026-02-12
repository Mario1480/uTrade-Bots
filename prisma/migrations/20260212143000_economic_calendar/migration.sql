-- CreateTable
CREATE TABLE "economic_calendar_config" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "impact_min" TEXT NOT NULL DEFAULT 'high',
  "currencies" TEXT,
  "pre_minutes" INTEGER NOT NULL DEFAULT 30,
  "post_minutes" INTEGER NOT NULL DEFAULT 30,
  "provider" TEXT NOT NULL DEFAULT 'fmp',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "economic_calendar_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "economic_events" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL,
  "country" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "impact" TEXT NOT NULL,
  "forecast" DOUBLE PRECISION,
  "previous" DOUBLE PRECISION,
  "actual" DOUBLE PRECISION,
  "source" TEXT NOT NULL DEFAULT 'fmp',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "economic_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "economic_events_source_source_id_key" ON "economic_events"("source", "source_id");

-- CreateIndex
CREATE INDEX "economic_events_ts_idx" ON "economic_events"("ts");

-- CreateIndex
CREATE INDEX "economic_events_currency_ts_idx" ON "economic_events"("currency", "ts");
