Perfekt 👍
Hier ist eine README-Version mit klarer Struktur, inkl. Quick Start, Dev vs Production, Architektur, Troubleshooting – so, dass du sie 1:1 ins GitHub-README.md übernehmen kannst.

⸻

uLiquid Market-Maker

Webbasierter Crypto Market-Maker mit Market-Making-Strategien, Volume-Bot, Multi-CEX-Support und SaaS-Vorbereitung.

⸻

Features
	•	Market Making (Bids/Asks, Spread, Skew, Jitter)
	•	Volume Bot (fill-basiert, echte Trades)
	•	Multi-CEX Architektur (Bitmart integriert)
	•	Web UI (Next.js)
	•	API (Node.js + Prisma + PostgreSQL)
	•	Runner Service (Trading Loop)
	•	Docker-basiert (lokal & VPS)
	•	HTTPS via Caddy
	•	SaaS-ready (User, Login, Lizenz vorbereitbar)

⸻

Architektur Überblick

┌─────────────┐      HTTPS       ┌─────────────┐
│   Browser   │ ───────────────▶ │   Caddy     │
└─────────────┘                  └──────┬──────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                │                        │                        │
        ┌───────▼───────┐       ┌────────▼────────┐       ┌───────▼───────┐
        │   Web (3000)  │       │   API (8080)     │       │ Runner (Bot)  │
        │ Next.js       │       │ Express + Prisma │       │ Trading Loops │
        └───────────────┘       └────────┬────────┘       └───────────────┘
                                         │
                                 ┌───────▼───────┐
                                 │ PostgreSQL    │
                                 └───────────────┘


⸻

Quick Start (VPS, empfohlen)

Voraussetzungen
	•	Ubuntu 22.04 LTS
	•	Docker + Docker Compose
	•	Domain + DNS:
	•	test.uliquid.vip → VPS IP
	•	api.test.uliquid.vip → VPS IP
	•	Ports offen: 80, 443

⸻

1️⃣ Docker installieren

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

➡️ Neu einloggen oder neue Shell öffnen.

⸻

2️⃣ Projekt deployen

sudo mkdir -p /opt/market-maker
sudo chown -R $USER:$USER /opt/market-maker
cd /opt/market-maker
git clone <REPO_URL> .


⸻

3️⃣ Environment erstellen

nano .env

NODE_ENV=development

# Database
DATABASE_URL=postgresql://mm:mm@postgres:5432/marketmaker

# Admin Seed
ADMIN_EMAIL=admin@uliquid.vip
ADMIN_PASSWORD=CHANGE_ME
ADMIN_WORKSPACE_NAME=Main

# API URLs
NEXT_PUBLIC_API_URL=https://api.test.uliquid.vip
API_BASE_URL=http://api:8080

# Cookies / Auth
COOKIE_DOMAIN=.uliquid.vip
COOKIE_SECURE=true

# CORS
CORS_ORIGINS=https://test.uliquid.vip,http://localhost:3000

# Exchange
BITMART_BASE_URL=https://api-cloud.bitmart.com


⸻

4️⃣ Caddy (HTTPS) installieren

sudo snap install caddy
sudo snap start --enable caddy.server

Caddyfile:

sudo nano /var/snap/caddy/common/Caddyfile

test.uliquid.vip {
  reverse_proxy 127.0.0.1:3000
}

api.test.uliquid.vip {
  reverse_proxy 127.0.0.1:8080
}

Aktivieren:

sudo caddy adapt --config /var/snap/caddy/common/Caddyfile \
  --adapter caddyfile \
  --pretty > /var/snap/caddy/common/caddy.json

sudo snap restart caddy.server

Test:

curl -I https://test.uliquid.vip
curl -i https://api.test.uliquid.vip/health


⸻

5️⃣ Container starten

docker compose -f docker-compose.dev.yml up -d --build

Status:

docker compose -f docker-compose.dev.yml ps


⸻

Zugriff
	•	Web UI
👉 https://test.uliquid.vip
	•	API Health
👉 https://api.test.uliquid.vip/health
	•	Login
	•	User wird beim ersten Start automatisch geseedet
	•	Login mit ADMIN_EMAIL / ADMIN_PASSWORD

⸻

Dev vs Production

Development (aktuell)
	•	docker-compose.dev.yml
	•	next dev
	•	Hot Reload
	•	Runner startet Loops live

Production (später)
	•	docker-compose.yml
	•	next build && next start
	•	Runner als stabiler Service
	•	Lizenz-Check aktiv

⸻

Wichtige Hinweise

⚠️ NEXT_PUBLIC_API_URL
	•	Darf nicht localhost sein, wenn über HTTPS/Domain gearbeitet wird
	•	Browser → https://api.test.uliquid.vip
	•	Container intern → http://api:8080

⸻

Troubleshooting

❌ Login → NetworkError

Ursache:
	•	CORS oder falsche API URL

Check:

curl -i https://api.test.uliquid.vip/health

Fix:
	•	.env prüfen
	•	docker-compose.dev.yml darf .env nicht überschreiben
	•	Web neu bauen:

docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml build --no-cache web
docker compose -f docker-compose.dev.yml up -d


⸻

❌ Runner startet nicht

Fehler:

Missing env: BITMART_BASE_URL

Fix:

BITMART_BASE_URL=https://api-cloud.bitmart.com

Dann:

docker compose -f docker-compose.dev.yml up -d runner


⸻

❌ HTTPS geht nicht

snap services | grep caddy
sudo snap logs caddy.server -n 100
sudo ss -ltnp | egrep ':80|:443'


⸻

Nächste Schritte (Roadmap)
	•	✅ Login / User / Workspace
	•	🔜 Lizenzserver (Key + Heartbeat)
	•	🔜 Multi-Bot pro User
	•	🔜 Multi-CEX (Slave-Exchanges)
	•	🔜 Production Compose
	•	🔜 Monitoring / Metrics
	•	🔜 SaaS Billing Integration

⸻

Wenn du willst, mache ich dir als Nächstes:
	•	🔑 LICENSE.md + Lizenz-Architektur
	•	🧩 SaaS Deployment Flow (User → VPS → Key)
	•	📦 Production docker-compose.yml
	•	🧪 Smoke-Test Checklist nach Deploy

Sag einfach 👍