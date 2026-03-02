# AI Prediction Explainer

## Purpose
- Generate grounded explanations for baseline predictions.
- Enforce strict JSON schema and safe fallback.
- Never depend on AI output for trading execution.

## Environment Variables
- `AI_PROVIDER` (`openai` default, `ollama`, `off`/`disabled` to disable AI)
- `AI_BASE_URL` (OpenAI: `https://api.openai.com/v1`, Ollama: `http://localhost:11434/v1`)
- `AI_API_KEY` (required for OpenAI; for Ollama a dummy key like `ollama` is supported)
- `AI_MODEL` (OpenAI default: `gpt-4o-mini`, Ollama default: `qwen3:8b`)
- `AI_SIGNAL_ENGINE` (`legacy` default, `agent_v1` enables tool-calling agent loop)
- `AI_SIGNAL_ENGINE_OLLAMA` (optional, default auto-agent; set `legacy` only for forced compatibility mode)
- `AI_TIMEOUT_MS` (default: `15000`)
- `AI_EXPLAINER_TIMEOUT_MS` (optional override for prediction explainer calls)
- `AI_EXPLAINER_MAX_TOKENS` (default: `650` for prediction explainer calls)
- `AI_EXPLAINER_RETRY_MAX_TOKENS` (default: max(`AI_EXPLAINER_MAX_TOKENS` + 350, 1.5x))
- `AI_GPT5_EXPLAINER_MAX_TOKENS` (default: `3200` for `gpt-5*` explainer calls)
- `AI_GPT5_EXPLAINER_RETRY_MAX_TOKENS` (default: max(`AI_GPT5_EXPLAINER_MAX_TOKENS` + 800, 1.5x))
- `AI_GPT5_EXPLAINER_MAX_ATTEMPTS` (default: `3` for `gpt-5*`, before fallback model is used)
- `AI_GPT5_EXPLAINER_FINAL_MAX_TOKENS` (default: 1.6x retry budget, used on final `gpt-5*` attempt)
- `AI_OLLAMA_4H_MIN_EXPLANATION_CHARS` (default: `200`)
- `AI_OLLAMA_4H_MIN_EXPLANATION_SENTENCES` (default: `8`)
- `AI_PROMPT_OHLCV_MAX_BARS` (default: `500`, min `20`, max `500`) - hard cap for stored OHLCV bars
- `AI_CACHE_TTL_SEC` (default: `300`)
- `AI_RATE_LIMIT_PER_MIN` (default: `60`)
- `AI_AGENT_MAX_TOOL_ITERATIONS` (default: `3`)
- `AI_TOOL_TIMEOUT_MS` (default: `8000`)
- `AI_TOOL_CACHE_TTL_MS` (default: `3000`)
- `AI_TOOL_RATE_LIMIT_PER_MIN` (default: `120`)

## Signal Agent v1 (Tool Calling + Structured Output)
- Uses OpenAI-compatible `POST /chat/completions` transport for both OpenAI and Ollama.
- Orchestrator loop:
  - call model with tools + JSON schema
  - execute requested tools in backend
  - append tool results as `tool` messages
  - repeat until final schema-valid response or iteration cap
- Built-in tools:
  - `get_ohlcv`
  - `get_indicators`
  - `get_ticker`
  - `get_orderbook`
- Signal schema (internal):
  - `decision`: `long | short | no_trade`
  - `entry`, `stop_loss`, `take_profit`
  - `confidence` (`0..1`)
  - `reason`
- Final output is mapped back to the existing external prediction contract (`up/down/neutral`).
- Structured schema is runtime-profile aware (`explanation` required, min length adjustable by provider/timeframe profile).

## Ollama Runtime Hints (Prompt-Fit)
- Single prompt templates are kept; provider/timeframe hints are appended at runtime.
- For `ollama + 4h`, explanation quality target is long-form (8-12 sentences) with a fixed narrative order:
  - trend -> momentum -> structure -> liquidity/FVG -> volume -> volatility -> uncertainty -> conclusion
- If explanation quality is below threshold, one targeted correction pass is triggered:
  - keep all fields unchanged
  - expand only `explanation`
  - return strict JSON only

## 4h Market Analysis Neutral-Only
- If `marketAnalysisUpdateEnabled=true` and timeframe is `4h`, prediction normalization enforces:
  - `aiPrediction.signal = neutral`
  - `aiPrediction.confidence = 0`
  - `aiPrediction.expectedMovePct = 0`
- This keeps analysis mode informational and avoids directional trade output.

## Local Ollama Quickstart
```bash
ollama pull qwen3:8b
```

```env
AI_PROVIDER=ollama
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3:8b
AI_API_KEY=ollama
AI_SIGNAL_ENGINE=agent_v1
# optional hard override if needed:
# AI_SIGNAL_ENGINE_OLLAMA=legacy
```

## Salad Cloud Ollama via Nginx Proxy (Dev + Prod)
Run a local OpenAI-compatible proxy that rewrites auth + path to Salad:

```bash
docker compose -f docker-compose.dev.yml up -d salad-proxy
curl http://localhost:8088/health
```

Production uses the same proxy config inside `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://salad-proxy:8088/health
```

Admin values for uTrade:
- `aiProvider`: `ollama`
- `aiBaseUrl`: `http://salad-proxy:8088/v1`
- `aiModel`: `qwen3:8b`
- `aiApiKey`: `salad_cloud_user_...`

Important:
- Do not use `http://localhost:8088/v1` in Admin when API runs in Docker.
- Use container DNS `salad-proxy` for API-container-to-proxy traffic.

## Safety Guarantees
- Output validation uses zod with strict constraints:
  - explanation max 1000 chars
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
- `vumanchu` (VuManChu Cipher B core):
  - WaveTrend (`wt1/wt2/wtVwap`, cross/OB/OS state)
  - confirmed WT/RSI/Stoch divergences (regular + optional hidden)
  - core strategy markers (`buy/sell`, `buyDiv/sellDiv`, `goldNoBuyLong`) + signal ages
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
