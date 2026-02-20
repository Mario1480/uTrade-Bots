CREATE TABLE "dashboard_performance_snapshots" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "bucket_ts" TIMESTAMP(3) NOT NULL,
  "total_equity" DOUBLE PRECISION NOT NULL,
  "total_available_margin" DOUBLE PRECISION NOT NULL,
  "total_today_pnl" DOUBLE PRECISION NOT NULL,
  "included_accounts" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dashboard_performance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dashboard_performance_snapshots_user_id_bucket_ts_key"
  ON "dashboard_performance_snapshots"("user_id", "bucket_ts");

CREATE INDEX "dashboard_perf_user_bucket_desc_idx"
  ON "dashboard_performance_snapshots"("user_id", "bucket_ts" DESC);

ALTER TABLE "dashboard_performance_snapshots"
  ADD CONSTRAINT "dashboard_performance_snapshots_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
