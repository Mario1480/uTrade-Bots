# Prediction Detail API

## Endpoint
- `GET /api/predictions/:id`
- Optional query:
  - `events=1` include latest change events (when `:id` is a `predictions_state` id)
  - `eventsLimit=<1..100>` default `20`

## Auth & Access
- Authentication required.
- Returns:
1. `200` when prediction exists and belongs to the authenticated user scope.
2. `404` when prediction does not exist.
3. `403` when prediction exists but user has no access.

## Response DTO (stable contract)
```json
{
  "id": "cmf...",
  "exchange": "bitget",
  "accountId": "acc_...",
  "symbol": "BTCUSDT",
  "marketType": "perp",
  "timeframe": "15m",
  "tsCreated": "2026-02-11T12:00:00.000Z",
  "tsPredictedFor": "2026-02-11T12:00:00.000Z",
  "prediction": {
    "signal": "up",
    "expectedMovePct": 1.24,
    "confidence": 72.1
  },
  "tags": ["trend_up", "high_vol"],
  "explanation": "Grounded explanation...",
  "keyDrivers": [{ "name": "rsi", "value": 62.4 }],
  "featureSnapshot": {
    "indicators": {
      "rsi_14": 62.4,
      "macd": { "line": 0.12, "signal": 0.09, "hist": 0.03 },
      "bb": { "upper": 0, "mid": 0, "lower": 0, "width_pct": 1.4, "pos": 0.62 },
      "vwap": { "value": 70234.1, "dist_pct": 0.42, "mode": "session_utc", "sessionStartUtcMs": 1739232000000 },
      "adx": { "adx_14": 23.4, "plus_di_14": 25.1, "minus_di_14": 18.2 }
    }
  },
  "modelVersion": "baseline-v1 + openai-explain-v1",
  "realized": {
    "realizedReturnPct": null,
    "evaluatedAt": null,
    "errorMetrics": null
  }
}
```

## Normalization guarantees
- `tags` are allowlisted and capped to max 5.
- `keyDrivers` are capped to max 5.
- `confidence` is normalized to `0..100`.
- `explanation` is capped to max 400 chars.
- `featureSnapshot.indicators` is normalized and numeric-safe (`null` for invalid values).

## Notes
- For compatibility with the current web client, the response still includes legacy top-level fields (for example `signal`, `confidence`, `expectedMovePct`, `predictionId`).
- Contract validation is done server-side with zod before returning `200`.
- `:id` can be either:
  - legacy history row (`Prediction.id`)
  - state row (`predictions_state.id`)
