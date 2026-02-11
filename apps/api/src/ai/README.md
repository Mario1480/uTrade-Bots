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
  - keyDrivers max 5, key paths must exist in `featureSnapshot`
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

## Indicator Pack v1
Predictions enrich `featureSnapshot.indicators` with deterministic OHLCV-based values:
- `rsi_14` (period 14)
- `macd` (`12/26/9`: line/signal/hist)
- `bb` (`20/2`: upper/mid/lower + `width_pct` + `pos`)
- `vwap`:
  - intraday timeframes (`5m`,`15m`,`1h`,`4h`): `session_utc` VWAP reset daily at **UTC 00:00**
  - daily (`1d`): `rolling_20` VWAP
- `adx` (`14`: `adx_14`, `plus_di_14`, `minus_di_14`)
- `atr_pct` (ATR(14) / close)

If candle history is insufficient, indicators are set to `null` and `featureSnapshot.riskFlags.dataGap=true`.

Session VWAP runtime tuning:
- `VWAP_SESSION_CACHE_TTL_MS` (default `120000`)
- `VWAP_SESSION_GAP_THRESHOLD` (default `0.03`)
