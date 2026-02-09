# AI Prediction Explainer

## Purpose
- Generate grounded explanations for baseline predictions.
- Enforce strict JSON schema and safe fallback.
- Never depend on AI output for trading execution.

## Environment Variables
- `AI_PROVIDER` (`openai` default, `off`/`disabled` to disable AI)
- `AI_API_KEY` (required for OpenAI calls)
- `AI_MODEL` (default: `gpt-4o-mini`)
- `AI_TIMEOUT_MS` (default: `8000`)
- `AI_CACHE_TTL_SEC` (default: `300`)
- `AI_RATE_LIMIT_PER_MIN` (default: `60`)

## Safety Guarantees
- Output validation uses zod with strict constraints:
  - explanation max 400 chars
  - tags max 5, allowlist-only
  - keyDrivers max 5, keys must exist in `featureSnapshot`
  - disclaimer must be `"grounded_features_only"`
- On timeout, invalid JSON, schema mismatch, or rate-limit:
  - deterministic fallback text is used
  - no hard failure in prediction generation
- Logging includes:
  - `ai_call_ms`
  - `ai_cache_hit`
  - `ai_validation_failed`
  - `ai_fallback_used`
  - `ai_model`

