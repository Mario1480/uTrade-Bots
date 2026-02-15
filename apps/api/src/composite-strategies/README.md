# Composite Strategy v1

Composite strategies combine Local + AI nodes in a directed graph.

## Model fields

- `nodesJson`: `[{ id, kind: "local"|"ai", refId, configOverrides?, position? }]`
- `edgesJson`: `[{ from, to, rule?, confidenceGte? }]`
- `combineMode`: `pipeline` (v1 execution), `vote` reserved
- `outputPolicy`: `first_non_neutral` | `override_by_confidence` | `local_signal_ai_explain`

## Execution

- Graph is validated and sorted topologically.
- Nodes execute in order and can be skipped by edge rules.
- Local nodes use `runLocalStrategy`.
- AI nodes use quality gate + budget telemetry and call explainer only when allowed.
- Hard v1 circuit breaker: max `1` AI call per composite run.

## API

- `GET /settings/composite-strategies` (enabled list)
- `GET /admin/composite-strategies`
- `GET /admin/composite-strategies/:id`
- `POST /admin/composite-strategies`
- `PUT /admin/composite-strategies/:id`
- `DELETE /admin/composite-strategies/:id`
- `POST /admin/composite-strategies/:id/dry-run`
