# Prediction Refresh Scheduler v1

This implementation introduces a state/history split for predictions:

- `predictions_state`: latest view per `(exchange, account, symbol, marketType, timeframe)`
- `predictions_events`: sparse change log (signal flips, regime changes, confidence jumps)
- legacy `Prediction` rows remain as history snapshots (now mainly on significant changes)

## Runtime behavior

- Scheduler still runs on `PREDICTION_AUTO_POLL_SECONDS` interval.
- For each active state template:
  - refresh when due by timeframe-specific refresh interval
  - optionally refresh early when trigger probe detects regime/trend changes
- AI explainer is gated:
  - only on significant changes
  - only when signal/confidence/tags changed materially
  - cooldown applies between AI calls

## New environment variables

- `PREDICTION_REFRESH_ENABLED` (default: `1`)
- `PREDICTION_REFRESH_SCAN_LIMIT` (default: `PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT`)
- `PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE` (default: `PREDICTION_AUTO_MAX_RUNS_PER_CYCLE`)
- `PREDICTION_REFRESH_TRIGGER_MIN_AGE_SECONDS` (default: `120`)
- `PREDICTION_REFRESH_TRIGGER_PROBE_LIMIT` (default: `25`)
- `PREDICTION_REFRESH_AI_COOLDOWN_SECONDS` (default: `300`)
- `PREDICTION_REFRESH_5M_SECONDS` (default: `180`)
- `PREDICTION_REFRESH_15M_SECONDS` (default: `300`)
- `PREDICTION_REFRESH_1H_SECONDS` (default: `600`)
- `PREDICTION_REFRESH_4H_SECONDS` (default: `1800`)
- `PREDICTION_REFRESH_1D_SECONDS` (default: `10800`)

## API changes

- `GET /api/predictions` now defaults to state view (`mode=state`)
- `GET /api/predictions?mode=history` keeps old historical behavior
- `GET /api/predictions/state?...` returns one latest state row
- `GET /api/predictions/events?stateId=...&limit=...` returns change events
- `GET /api/predictions/:id?events=1&eventsLimit=20` supports state IDs and can include events

