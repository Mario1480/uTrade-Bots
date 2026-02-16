# Quant Research (Phase 1)

This app is the offline research/backtesting workspace for local strategy tuning.

## Scope

- Build training datasets from `Prediction` rows (`featuresSnapshot` + outcomes)
- Run parameter sweeps with `vectorbt`
- Publish optimized `configJson` back to a local strategy via Admin API

Live execution stays inside:

- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/api`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/py-strategy-service`

## Install

```bash
cd /Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/quant-research
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# optional parquet support:
pip install pyarrow
```

## 1) Build dataset

```bash
python src/dataset/build_from_predictions.py \
  --database-url "$DATABASE_URL" \
  --symbol BTCUSDT \
  --timeframe 15m \
  --market-type perp \
  --min-rows 300
```

Output:

- csv in `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/quant-research/data`
- parquet only when `pyarrow` is available in your env
- split column with `train | valid | test`

## 2) Run vectorbt sweep

```bash
python src/backtest/run_vectorbt.py \
  --dataset data/predictions_dataset_YYYYMMDD-HHMMSS.csv \
  --min-trades 30 \
  --max-drawdown-pct 25
```

Output artifact folder:

- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/quant-research/artifacts/trend_vol_gate/<stamp>/config.json`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/quant-research/artifacts/trend_vol_gate/<stamp>/report.json`

## 3) Publish selected params

```bash
python src/publish/publish_local_strategy.py \
  --strategy-id <LOCAL_STRATEGY_ID> \
  --config-file artifacts/trend_vol_gate/<stamp>/config.json \
  --api-url http://localhost:3001 \
  --auth-token "$ADMIN_API_TOKEN" \
  --skip-remote-check true \
  --dry-run
```

Then remove `--dry-run` to apply.

## Environment variables

- `DATABASE_URL`: used by dataset builder
  - accepts Prisma-style URLs (`postgresql://...?...schema=public`) and normalizes for SQLAlchemy/psycopg
- `ADMIN_API_URL`: default API base URL for publish script
- `ADMIN_API_TOKEN`: optional bearer token for admin endpoint
- `ADMIN_SESSION_COOKIE`: optional cookie header (for session auth)

## Notes

- `TA-Lib` and `backtrader` are intentionally not included in phase 1.
- Start with `shadowMode=true` when publishing new configs.
- Promote to enforce only after stable shadow metrics.
