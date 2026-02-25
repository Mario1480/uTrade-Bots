-- AlterTable
ALTER TABLE "ai_trace_logs"
ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "ai_trace_logs_user_id_created_at_idx"
ON "ai_trace_logs"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "ai_trace_logs"
ADD CONSTRAINT "ai_trace_logs_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
