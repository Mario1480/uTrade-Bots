# ADR 0001: CCXT Default + Native Override for CEX Spot

Date: 2026-03-04
Status: Accepted

## Context
- We want faster onboarding for new CEX integrations.
- Existing production flows (especially Bitget spot and all futures/perp flows) are stable and must not regress.
- Spot features in Manual Trading Desk and Paper market-data linkage need a common backend selector without endpoint contract changes.

## Decision
- Use CCXT as default onboarding layer for new CEX spot integrations.
- Keep native adapters as first-class override path for exchanges/features where custom behavior is required.
- Keep futures/perp on native adapters for now; CCXT perp remains future work.
- Add runtime selection and kill switches:
  - `CEX_SPOT_DEFAULT_BACKEND=native|ccxt` (default: `native`)
  - `CEX_SPOT_BACKEND_OVERRIDES=exchange:backend,...`
  - `CEX_SPOT_WRITE_ENABLED=0|1`
  - `CEX_SPOT_WRITE_OVERRIDES=exchange:0|1,...`

## Scope (v1)
- Manual Trading Spot API routing uses `createSpotClient(...)` factory.
- Paper Spot market-data reads use the same factory.
- No REST endpoint breaking changes.
- Bots/Runner behavior is unchanged.

## Consequences
- New CEX spot integrations can start with CCXT and ship faster.
- Existing Bitget-native path remains available and can be forced per exchange.
- Write paths can be disabled globally or per exchange without deploy.
- Operational logs include backend selection and fallback metadata.

## Rollout
1. Stage A: native default, CCXT shadow/read-only checks.
2. Stage B: CCXT read-only live for selected exchange.
3. Stage C: CCXT write pilot with per-exchange write override.
4. Stage D: CCXT default for newly added CEX.
