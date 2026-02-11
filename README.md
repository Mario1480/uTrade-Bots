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
- Thresholds API (latest): `/api/thresholds/latest?exchange=bitget&symbol=BTCUSDT&marketType=perp&tf=15m`
- Telegram Settings: `/settings/notifications`
- Admin Backend: `/admin` (Superadmin)
- Global OpenAI Key (encrypted DB): `/admin/api-keys`

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
