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

## Runner behavior

- Loads strategy definition by DB `id`.
- Merges persisted `configJson` over strategy default config.
- Returns deterministic result with:
  - `allow`, `score`, `reasonCodes`, `tags`, `explanation`
  - `configHash` and `snapshotHash` for idempotency checks.
- Sanitizes all output values (`NaN`/`Infinity` are converted to `null`).
