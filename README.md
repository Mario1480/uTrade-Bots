# uLiquid Market-Maker

Webbasierter Crypto Market-Maker mit Market-Making‑Strategien, Volume‑Bot, Multi‑CEX‑Support, Metrics/Charts und optionalen Add‑Ons (z.B. DEX‑Price‑Feed, AI‑Insights).

---

## Features (Kurz)

- Market Making (Spread, Levels, Inventory Skew, Jitter)
- Volume Bot (fill‑basiert, echte Trades)
- Multi‑CEX Architektur (Bitmart, Coinstore, Pionex, P2B, MEXC)
- Web UI (Next.js App Router)
- API (Node.js + Express + Prisma)
- Runner Service (Trading Loops)
- Metrics & Charts (BotMetric Time‑Series)
- AI Insights (Read‑Only, lizenziert)
- DEX Price Feed (Read‑Only, lizenziert)
- PostgreSQL, Docker, HTTPS via Caddy
- User / Login / Workspace / License Management

---

## Architektur Überblick

Browser → Caddy → Web (3000)
                   API (8080)
                   Runner
                   Postgres

---

## Voraussetzungen

- Ubuntu 22.04 LTS VPS
- Docker & Docker Compose
- Domain + DNS:
  - `marketmaker.example.com` → VPS IP
  - `api.marketmaker.example.com` → VPS IP
- Offene Ports: 80/tcp, 443/tcp, 22/tcp

---

## Installation (VPS – empfohlen)

### Option A) Schnellinstallation via Script

Das Script richtet Docker, Node 20, Caddy (optional), `.env.prod` und die Container ein.

```bash
curl -fsSL https://raw.githubusercontent.com/Mario1480/Market-Maker/main/scripts/install_vps.sh -o /tmp/install_vps.sh
chmod +x /tmp/install_vps.sh
sudo /tmp/install_vps.sh
```

Der Installer fragt u.a.:
- Web/API Domain
- Admin Email/Password
- SMTP Passwort
- License Key (optional)
- AI Provider + Key (optional)

Danach laufen Web + API + Runner automatisch. Logs:

```bash
docker compose -f /opt/market-maker/docker-compose.prod.yml ps
docker compose -f /opt/market-maker/docker-compose.prod.yml logs -f --tail=200 api
docker compose -f /opt/market-maker/docker-compose.prod.yml logs -f --tail=200 web
docker compose -f /opt/market-maker/docker-compose.prod.yml logs -f --tail=200 runner
```

### Option B) Manuelle Installation (Schritt für Schritt)

### 1) Docker installieren

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Neue Shell öffnen oder neu einloggen.

### 2) Projekt deployen

```bash
sudo mkdir -p /opt/market-maker
sudo chown -R $USER:$USER /opt/market-maker
cd /opt/market-maker
git clone <REPO_URL> .
```

### 3) .env.prod anlegen

```bash
nano .env.prod
```

Minimal (Beispiel):

```
NODE_ENV=production

DATABASE_URL=postgresql://mm:mm@postgres:5432/marketmaker

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=CHANGE_ME
ADMIN_WORKSPACE_NAME=Main

NEXT_PUBLIC_API_URL=https://api.marketmaker.example.com
API_BASE_URL=http://api:8080

COOKIE_DOMAIN=.example.com
COOKIE_SECURE=true

CORS_ORIGINS=https://marketmaker.example.com,http://localhost:3000

BITMART_BASE_URL=https://api-cloud.bitmart.com
COINSTORE_BASE_URL=https://api.coinstore.com
PIONEX_BASE_URL=https://api.pionex.com

SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=no-reply@example.com
SMTP_PASS=CHANGE_ME
SMTP_FROM="uLiquid <no-reply@example.com>"
SMTP_SECURE=true
INVITE_BASE_URL=https://marketmaker.example.com

# AI (Read-only insights)
AI_PROVIDER=none
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=30000
AI_CACHE_TTL_SEC=300
AI_RATE_LIMIT_PER_MIN=30
```

### 4) Caddy (HTTPS) installieren

```bash
sudo snap install caddy
sudo snap start --enable caddy.server
sudo nano /var/snap/caddy/common/Caddyfile
```

Beispiel:

```
marketmaker.example.com {
  reverse_proxy 127.0.0.1:3000
}

api.marketmaker.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Aktivieren:

```bash
sudo caddy adapt \
  --config /var/snap/caddy/common/Caddyfile \
  --adapter caddyfile \
  --pretty > /var/snap/caddy/common/caddy.json

sudo snap restart caddy.server
```

### 5) Container bauen und starten

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### 6) Migrationen ausführen

```bash
docker compose -f docker-compose.prod.yml exec -T api sh -lc "npx prisma migrate deploy"
```

### 7) Status & Logs

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=200 api
docker compose -f docker-compose.prod.yml logs -f --tail=200 web
docker compose -f docker-compose.prod.yml logs -f --tail=200 runner
```

---

## Zugriff

- Web UI: `https://marketmaker.example.com`
- API Health: `https://api.marketmaker.example.com/health`
- Admin User wird beim ersten Start automatisch angelegt

---

## Updates / Re-Deploy

```bash
cd /opt/market-maker
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec -T api sh -lc "npx prisma migrate deploy"
```

## Deinstallation (optional)

```bash
cd /opt/market-maker
docker compose -f docker-compose.prod.yml down -v
sudo rm -rf /opt/market-maker
```

---

## Add‑Ons & Lizenzen

Einige Features sind lizenziert (z.B. DEX Price Feed, AI Insights).
- Wenn ein Add‑On deaktiviert ist, werden UI‑Elemente ausgeblendet.
- Runner/Trading bleibt unverändert.

---

## Häufige Fehler

**Login → NetworkError / CORS**
- Prüfe `NEXT_PUBLIC_API_URL` und `CORS_ORIGINS`
- `docker compose -f docker-compose.prod.yml build --no-cache web`

**Prisma Fehler: Spalte existiert nicht**
- Migrationen ausführen:
  ```bash
  docker compose -f docker-compose.prod.yml exec -T api sh -lc "npx prisma migrate deploy"
  ```

**Runner startet nicht**
- Fehlende Exchange‑ENV prüfen (z.B. `BITMART_BASE_URL`)

---

## Dev vs Production

- **Development**: `docker-compose.dev.yml`, Hot Reload
- **Production**: `docker-compose.prod.yml`, `next build`
