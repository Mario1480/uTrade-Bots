# Local Strategies v1

Deterministic local strategies can be registered and executed through `apps/api/src/local-strategies/registry.ts`.

## Registry API

- `registerLocalStrategy(type, handler, defaultConfig, uiSchema)`
- `listRegisteredLocalStrategies()`
- `getRegisteredLocalStrategy(type)`
- `runLocalStrategy(strategyId, featureSnapshot, ctx)`

## Built-in strategies

- `regime_gate`: uses `historyContext.reg` + `historyContext.ema.stk`.
- `signal_filter`: blocks based on tags / volatility / range state.
- `trend_vol_gate` (python): deterministic trend + volatility gate based on `historyContext.reg/ema/vol`.
- `smart_money_concept` (python): deterministic SMC gate based on structure + premium/discount zones.

Strategy docs:

- `docs/strategies/trend-vol-gate.md`
- `docs/strategies/smart-money-concept.md`

## Runner behavior

- Loads strategy definition by DB `id`.
- Supports `engine: "ts" | "python"` per strategy definition.
- For `ts`, merges persisted `configJson` over strategy default config.
- For `python`, calls the sidecar (`PY_STRATEGY_URL`) with timeout/auth and fail-open TS fallback (`fallbackStrategyType`) when available.
- Python runner includes an in-memory circuit breaker (window + thresholds + cooldown) via:
  - `PY_STRATEGY_CB_WINDOW_MS`
  - `PY_STRATEGY_CB_MAX_FAILURES`
  - `PY_STRATEGY_CB_MAX_TIMEOUTS`
  - `PY_STRATEGY_CB_COOLDOWN_MS`
- Optional `shadowMode=true` runs python for calibration, logs `pythonDecision`, but enforces fallback/default effective decision only.
- Returns deterministic result with:
  - `allow`, `score`, `reasonCodes`, `tags`, `explanation`
  - `configHash` and `snapshotHash` for idempotency checks.
- Sanitizes all output values (`NaN`/`Infinity` are converted to `null`).
