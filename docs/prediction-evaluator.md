# Prediction Evaluator v1

Der Evaluator berechnet nach Ablauf des jeweiligen Prediction-Horizonts automatisiert:

- `realizedReturnPct` (close-to-close, richtungsbezogen nach Signal)
- `hit` (Long/Short Richtungs-Treffer)
- `absError` und `sqError` (gegen `expectedMovePct`)
- Kalibrierungs-Bins (Confidence vs. tatsächliche Trefferquote)

## Scheduler

Der Job läuft in `apps/api/src/index.ts` als `runPredictionPerformanceEvalCycle()`.

Konfiguration über ENV:

- `PREDICTION_EVALUATOR_ENABLED` (default: `1`)
- `PREDICTION_EVALUATOR_POLL_SECONDS` (default: `300`)
- `PREDICTION_EVALUATOR_BATCH_SIZE` (default: `100`)
- `PREDICTION_EVALUATOR_SAFETY_LAG_SECONDS` (default: `120`)

## Datenablage

Die Evaluationsdaten werden in `prediction.outcomeMeta` geschrieben:

- `realizedReturnPct`
- `realizedEvaluatedAt`
- `realizedStartClose`
- `realizedEndClose`
- `realizedStartBucketMs`
- `realizedEndBucketMs`
- `predictedMovePct`
- `evaluatorVersion`
- `errorMetrics` (`hit`, `absError`, `sqError`)

Zusätzlich wird `outcomeEvaluatedAt` gesetzt (falls noch nicht gesetzt).

## API

### `GET /api/predictions/metrics`

Query:

- `timeframe` oder `tf` (`5m|15m|1h|4h|1d`, optional)
- `symbol` (optional)
- `from`/`to` (ISO datetime, optional)
- `bins` (`2..20`, default `10`)

Response:

- `evaluatedCount`
- `hitRate`
- `mae`
- `mse`
- `calibrationBins[]` mit:
  - `binFrom`
  - `binTo`
  - `avgConf`
  - `accuracy`
  - `n`

## UI

Auf `/predictions` werden genutzt:

- Top-KPIs: Directional Hit Rate, MAE, MSE
- Calibration-Tabelle (nicht-leere Bins)
- Detail-Panel je Prediction:
  - Evaluated ja/nein
  - Realized Return
  - Hit/Miss
  - Abs Error / Sq Error
