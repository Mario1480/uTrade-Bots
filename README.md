# uTrade Futures

Multi-tenant Futures Trading Platform mit:
- Web App (Next.js)
- API (Express + Prisma)
- Runner Worker (Bot-Orchestrierung)
- PostgreSQL + Redis
- Bitget Futures Integration
- AI-Predictions + Trading-Desk Prefill
- Telegram Notifications für handelbare Signale

## Architektur

Browser -> Web (3000)
Browser -> API (4000 dev / 8080 prod)
Runner -> API/DB/Redis
API/Runner -> Postgres + Redis + Exchange APIs

## Schnellstart lokal (Docker)

1. `.env` anlegen:
```bash
cp .env.example .env
```

2. Stack starten:
```bash
docker compose -f docker-compose.dev.yml up -d --build
```

3. Erreichbarkeit prüfen:
```bash
curl -i http://localhost:4000/health
open http://localhost:3000
```

4. Account erstellen:
- Web: `http://localhost:3000/register`

## Production Deploy (VPS)

Voraussetzungen:
- Ubuntu 22.04+
- DNS auf VPS-IP
- Ports `22`, `80`, `443` offen

### Option A: Installer Script (empfohlen)

```bash
curl -fsSL https://raw.githubusercontent.com/Mario1480/uTrade-Bots/main/scripts/install_vps.sh -o /tmp/install_vps.sh
chmod +x /tmp/install_vps.sh
sudo /tmp/install_vps.sh
```

Das Script:
- installiert Docker + Firewall + optional Caddy
- klont Repo nach `/opt/utrade-bots` (Default)
- schreibt `.env.prod`
- startet `docker-compose.prod.yml`

### Option B: manuell

Siehe `docs/PRODUCTION_DEPLOY.md`.

## Wichtige ENV-Variablen

Core:
- `DATABASE_URL`
- `NEXT_PUBLIC_API_URL`
- `API_BASE_URL`
- `PANEL_BASE_URL` (optional, für Telegram Deep-Link direkt in den Manual Trading Desk)
- `CORS_ORIGINS`
- `SECRET_MASTER_KEY` (Pflicht für Secret-Verschlüsselung)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Trading:
- `BITGET_REST_BASE_URL`
- `BITGET_PRODUCT_TYPE`
- `BITGET_MARGIN_COIN`

Queue/Runner:
- `ORCHESTRATION_MODE=queue`
- `REDIS_URL`
- `WORKER_CONCURRENCY`

AI Predictions:
- `AI_PROVIDER` (`none` oder `openai`)
- `AI_API_KEY`
- `AI_MODEL`
- `FEATURE_THRESHOLDS_CALIBRATION_ENABLED`
- `FEATURE_THRESHOLDS_SYMBOLS`
- `FEATURE_THRESHOLDS_TIMEFRAMES`
- `FEATURE_THRESHOLDS_WINSORIZE_PCT`
- Refresh Scheduler v1:
  - `PREDICTION_REFRESH_ENABLED`
  - `PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE`
  - `PREDICTION_REFRESH_AI_COOLDOWN_SECONDS`
  - `PREDICTION_REFRESH_5M_SECONDS`
  - `PREDICTION_REFRESH_15M_SECONDS`
  - `PREDICTION_REFRESH_1H_SECONDS`
  - `PREDICTION_REFRESH_4H_SECONDS`
  - `PREDICTION_REFRESH_1D_SECONDS`
  - Details: `docs/prediction-refresh-scheduler.md`
- Evaluator v1:
  - `PREDICTION_EVALUATOR_ENABLED`
  - `PREDICTION_EVALUATOR_POLL_SECONDS`
  - `PREDICTION_EVALUATOR_BATCH_SIZE`
  - `PREDICTION_EVALUATOR_SAFETY_LAG_SECONDS`
  - Details: `docs/prediction-evaluator.md`
- Bot Entry Gating (Prediction filter only, no auto-trading):
  - `PREDICTION_GATE_FAIL_OPEN` (`false` default)
  - Gate-Config liegt je Bot in `futuresConfig.paramsJson.gating`

Economic Calendar (FMP) + News Blackout:
- `FMP_API_KEY` (optional ENV fallback; preferred via Admin-UI)
- `FMP_BASE_URL` (optional, default `https://financialmodelingprep.com`)
- `ECON_CALENDAR_REFRESH_ENABLED` (`1` default)
- `ECON_CALENDAR_REFRESH_INTERVAL_MINUTES` (default `15`)
- `ECON_REDIS_EVENTS_TTL_SEC`
- `ECON_REDIS_NEXT_TTL_SEC`
- `ECON_REDIS_BLACKOUT_TTL_SEC`

Prediction Indicator Pack v1 (backend, deterministic from OHLCV):
- RSI(14), MACD(12/26/9), Bollinger(20/2), ADX(14), ATR(14)/close
- VWAP:
  - intraday (`5m`,`15m`,`1h`,`4h`) = `session_utc` VWAP (UTC day reset)
  - `1d` = `rolling_20` VWAP
- Session VWAP cache:
  - `VWAP_SESSION_CACHE_TTL_MS` (default `120000`)
  - `VWAP_SESSION_GAP_THRESHOLD` (default `0.03`)

License:
- `LICENSE_ENFORCEMENT` (`on`/`off`)
- `LICENSE_STUB_ENABLED`
- `LICENSE_SERVER_URL`

Telegram:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- alternativ in der UI: `/settings/notifications`

SMTP:
- alternativ per Admin-UI: `/admin` -> SMTP

## Nützliche URLs

- Web: `http://localhost:3000`
- API Health (dev): `http://localhost:4000/health`
- API Health (prod): `http://<api-domain>/health`
- Manual Trading Desk: `/trade`
- Predictions: `/predictions`
- Economic Calendar: `/calendar`
- Prediction metrics API: `/api/predictions/metrics?bins=10`
- Thresholds API (latest): `/api/thresholds/latest?exchange=bitget&symbol=BTCUSDT&marketType=perp&tf=15m`
- Economic Calendar API:
  - `GET /economic-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&impact=high&currency=USD`
  - `GET /economic-calendar/next?currency=USD&impact=high`
  - `GET /economic-calendar/config`
  - `PUT /economic-calendar/config` (superadmin)
- Telegram Settings: `/settings/notifications`
- Admin Backend: `/admin` (Superadmin)
- Global OpenAI Key (encrypted DB): `/admin/api-keys`
- Global FMP Key (encrypted DB): `/admin/api-keys`

## Manual Trading Desk Chart

Der Trading-Desk verwendet aktuell `lightweight-charts` (Node/TS, ohne native Abhängigkeiten):
- Candlestick-Chart im Manual Trading Desk
- Datenquelle: `GET /api/market/candles`
- Polling-Refresh für neue Kerzen (MVP)

Damit die Kerzen erscheinen, muss die API erreichbar sein (`/api/market/candles`) und ein gültiger Exchange-Account gewählt sein.

## Bot Prediction Gate (Entry Filter)

Der Runner nutzt optional ein Prediction-Gate für **Entry-Intents** (`intent.type === "open"`):

- Gate blockiert oder erlaubt Entries auf Basis von `predictions_state`
- Gate skaliert optional die Positionsgröße (`sizeMultiplier`)
- Strategien bleiben führend; es gibt **kein** Auto-Trading nur durch Predictions

Beispiel `paramsJson` für Trend-Bot:

```json
{
  "gating": {
    "enabled": true,
    "timeframe": "15m",
    "minConfidence": 70,
    "allowSignals": ["up"],
    "blockTags": ["news_risk", "low_liquidity"],
    "maxAgeSec": 900,
    "sizeMultiplier": {
      "base": 1.0,
      "highConfidenceThreshold": 80,
      "highConfidenceMultiplier": 1.2,
      "highVolMultiplier": 0.7,
      "min": 0.1,
      "max": 2.0
    }
  }
}
```

Beispiel `paramsJson` für Mean-Reversion-Bot:

```json
{
  "gating": {
    "enabled": true,
    "timeframe": "5m",
    "minConfidence": 60,
    "allowSignals": ["up", "down"],
    "blockTags": ["breakout_risk", "news_risk"],
    "maxAgeSec": 600,
    "sizeMultiplier": {
      "base": 0.9,
      "highConfidenceThreshold": 85,
      "highConfidenceMultiplier": 1.1,
      "highVolMultiplier": 0.6
    },
    "failOpenOnError": false
  }
}
```

## Betrieb / Logs

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=200 api
docker compose -f docker-compose.prod.yml logs -f --tail=200 web
docker compose -f docker-compose.prod.yml logs -f --tail=200 runner
```

## Update / Re-Deploy

```bash
cd /opt/utrade-bots
./scripts/deploy_prod.sh
```

Optional (ohne `git pull`):

```bash
cd /opt/utrade-bots
./scripts/deploy_prod.sh --no-pull
```

## Troubleshooting

Login/NetworkError:
- `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`, API Health prüfen

Prisma/Migrations:
- API-Logs prüfen (`migrate deploy` läuft beim API-Start)

Trading/Bitget:
- Exchange Account in UI prüfen (`/settings`)
- Passphrase für Bitget ist erforderlich
