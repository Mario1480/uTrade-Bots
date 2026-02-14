-- CreateTable
CREATE TABLE "ai_trace_logs" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "symbol" TEXT,
    "market_type" TEXT,
    "timeframe" TEXT,
    "prompt_template_id" TEXT,
    "prompt_template_name" TEXT,
    "system_message" TEXT,
    "user_payload" JSONB,
    "raw_response" TEXT,
    "parsed_response" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "rate_limited" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_trace_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_trace_logs_created_at_idx" ON "ai_trace_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_trace_logs_scope_created_at_idx" ON "ai_trace_logs"("scope", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_trace_logs_symbol_timeframe_created_at_idx" ON "ai_trace_logs"("symbol", "timeframe", "created_at" DESC);
