ALTER TABLE "predictions_state"
ADD COLUMN "ai_gate_last_decision_hash" TEXT,
ADD COLUMN "ai_gate_last_explained_prediction_hash" TEXT,
ADD COLUMN "ai_gate_last_explained_history_hash" TEXT,
ADD COLUMN "ai_gate_last_reason_codes" JSONB,
ADD COLUMN "ai_gate_last_priority" TEXT,
ADD COLUMN "ai_gate_window_started_at" TIMESTAMP(3),
ADD COLUMN "ai_gate_calls_last_hour" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ai_gate_high_priority_calls_last_hour" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "pred_state_ai_gate_window_idx"
ON "predictions_state" ("ai_gate_window_started_at");
