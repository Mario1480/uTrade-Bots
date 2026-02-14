# AI Prediction Explainer

## Purpose
- Generate grounded explanations for baseline predictions.
- Enforce strict JSON schema and safe fallback.
- Never depend on AI output for trading execution.

## Environment Variables
- `AI_PROVIDER` (`openai` default, `off`/`disabled` to disable AI)
- `AI_API_KEY` (required for OpenAI calls)
- `AI_MODEL` (default: `gpt-4o-mini`)
- `AI_TIMEOUT_MS` (default: `15000`)
- `AI_EXPLAINER_TIMEOUT_MS` (optional override for prediction explainer calls)
- `AI_EXPLAINER_MAX_TOKENS` (default: `650` for prediction explainer calls)
- `AI_EXPLAINER_RETRY_MAX_TOKENS` (default: max(`AI_EXPLAINER_MAX_TOKENS` + 350, 1.5x))
- `AI_PROMPT_OHLCV_MAX_BARS` (default: `500`, min `20`, max `500`) - hard cap for stored OHLCV bars
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

## Indicator Pack v2
Predictions enrich `featureSnapshot.indicators` with deterministic OHLCV-based values:
- `rsi_14` (period 14)
- `macd` (`12/26/9`: line/signal/hist)
- `bb` (`20/2`: upper/mid/lower + `width_pct` + `pos`)
- `stochrsi` (`14/14/3/3`: `%K`, `%D`, `value`)
- `volume` (`lookback=100`: `vol_z`, `rel_vol`, `vol_ema_fast`, `vol_ema_slow`, `vol_trend`)
- `fvg` (3-candle imbalance summary):
  - open bullish / bearish counts
  - nearest bullish / bearish gap (zone + distance + age)
  - last created / last filled gap metadata
- `vwap`:
  - intraday timeframes (`5m`,`15m`,`1h`,`4h`): `session_utc` VWAP reset daily at **UTC 00:00**
  - daily (`1d`): `rolling_20` VWAP
- `adx` (`14`: `adx_14`, `plus_di_14`, `minus_di_14`)
- `atr_pct` (ATR(14) / close)
- `ohlcvSeries` (compact raw bar sequence used for AI reasoning):
  - `timeframe`
  - `format`: `["ts","open","high","low","close","volume"]`
  - `bars`: tuple rows with latest N candles (stored up to `AI_PROMPT_OHLCV_MAX_BARS`)
  - prompt runtime trims bars by prompt setting `ohlcvBars` (default `100`)

If candle history is insufficient, indicators are set to `null` and `featureSnapshot.riskFlags.dataGap=true`.

Session VWAP runtime tuning:
- `VWAP_SESSION_CACHE_TTL_MS` (default `120000`)
- `VWAP_SESSION_GAP_THRESHOLD` (default `0.03`)

FVG runtime tuning:
- `FVG_LOOKBACK_BARS` (default `300`)
- `FVG_FILL_RULE` (`overlap` default, optional `mid_touch`)

## Advanced Indicators Feature Pack v1
Predictions also include `featureSnapshot.advancedIndicators` (deterministic Node/TS port):
- `emas`: EMA(5/13/50/200/800), stack flags, distance/slope percentages
- `cloud`: EMA50 cloud (`stddev(close,100)/4`) with `price_pos`
- `levels`: daily OHLC + classic floor pivots (`pp/r1..s3`) + `m0..m5`, previous week/month highs/lows
- `ranges`: ADR(14), AWR(4), AMR(6), RD(15), RW(13) with high/low/50% bands and distance %
  - default mode mirrors Pine defaults (`DO/WO/MO=false`): Hi/Lo-anchored bands
  - optional open-anchor mode is supported internally
- `sessions`: static UTC sessions (London/NY/Tokyo/HK/Sydney/Frankfurt/EU Brinks/US Brinks)
- `sessions`: DST-aware UTC sessions aligned with TradersReality rules:
  - UK DST: last Sunday March -> last Sunday October (London/EU Brinks/Frankfurt)
  - US DST: second Sunday March -> first Sunday November (New York/US Brinks)
  - Sydney DST: first Sunday October -> first Sunday April
- `pvsra`: vector candle tier/color + transition patterns
- `smartMoneyConcepts`: structure + liquidity context inspired by LuxAlgo SMC logic:
  - internal/swing `BOS` / `CHoCH` state and break counts
  - equal highs/lows (`eqh` / `eql`) events
  - internal/swing order-block stacks and latest active block
  - FVG stack (bullish/bearish active counts + last threshold)
  - premium / discount / equilibrium zone levels

If history is too short for long EMAs (especially EMA800), fields are returned null-safe and
`featureSnapshot.advancedIndicators.dataGap=true`.
