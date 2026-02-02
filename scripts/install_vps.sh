#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

REPO_URL="https://github.com/Mario1480/Market-Maker.git"
APP_DIR="/opt/market-maker"

read -r -p "Web domain (e.g. test.example.com, leave blank for HTTP only): " WEB_DOMAIN
read -r -p "API domain (e.g. api.test.example.com, leave blank for HTTP only): " API_DOMAIN
read -r -p "Admin email: " ADMIN_EMAIL
read -r -s -p "Admin password: " ADMIN_PASSWORD
echo ""
read -r -p "Workspace name [Main]: " ADMIN_WORKSPACE_NAME
ADMIN_WORKSPACE_NAME="${ADMIN_WORKSPACE_NAME:-Main}"
read -r -p "Invite base URL (e.g. https://test.example.com) [blank to skip]: " INVITE_BASE_URL
read -r -s -p "SMTP password for no-reply@uliquid.vip (leave blank to set later): " SMTP_PASS
echo ""
read -r -p "AI provider (none/openai) [none]: " AI_PROVIDER
AI_PROVIDER="${AI_PROVIDER:-none}"
read -r -p "AI base URL [https://api.openai.com/v1]: " AI_BASE_URL
AI_BASE_URL="${AI_BASE_URL:-https://api.openai.com/v1}"
read -r -s -p "AI API key (leave blank to set later): " AI_API_KEY
echo ""
read -r -p "AI model [gpt-4o-mini]: " AI_MODEL
AI_MODEL="${AI_MODEL:-gpt-4o-mini}"
read -r -p "AI timeout ms [30000]: " AI_TIMEOUT_MS
AI_TIMEOUT_MS="${AI_TIMEOUT_MS:-30000}"
read -r -p "AI cache TTL seconds [300]: " AI_CACHE_TTL_SEC
AI_CACHE_TTL_SEC="${AI_CACHE_TTL_SEC:-300}"
read -r -p "AI rate limit per min [30]: " AI_RATE_LIMIT_PER_MIN
AI_RATE_LIMIT_PER_MIN="${AI_RATE_LIMIT_PER_MIN:-30}"
read -r -p "License key (optional, can set in UI): " LICENSE_KEY
read -r -p "License instance id [hostname]: " LICENSE_INSTANCE_ID
LICENSE_INSTANCE_ID="${LICENSE_INSTANCE_ID:-$(hostname)}"
read -r -s -p "License server secret (optional): " LICENSE_SERVER_SECRET
echo ""

PRIMARY_IP="$(hostname -I | awk '{print $1}')"
WEB_ORIGIN="${WEB_DOMAIN:+https://${WEB_DOMAIN}}"
API_PUBLIC_URL="${API_DOMAIN:+https://${API_DOMAIN}}"
if [[ -z "${WEB_ORIGIN}" ]]; then
  WEB_ORIGIN="http://${PRIMARY_IP}:3000"
fi
if [[ -z "${API_PUBLIC_URL}" ]]; then
  API_PUBLIC_URL="http://${PRIMARY_IP}:8080"
fi
COOKIE_SECURE_VALUE="true"
if [[ -z "${WEB_DOMAIN}" ]]; then
  COOKIE_SECURE_VALUE="false"
fi

echo "==> Installing system dependencies"
apt update -y
apt install -y curl ca-certificates gnupg unzip git ufw

echo "==> Installing Node.js 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh

echo "==> Configuring firewall"
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> Cloning repo to ${APP_DIR}"
mkdir -p "${APP_DIR}"
rm -rf "${APP_DIR}"
git clone "${REPO_URL}" "${APP_DIR}"

echo "==> Writing .env.prod"
cat > "${APP_DIR}/.env.prod" <<EOF
NODE_ENV=production

DATABASE_URL=postgresql://mm:mm@postgres:5432/marketmaker

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_WORKSPACE_NAME=${ADMIN_WORKSPACE_NAME}

NEXT_PUBLIC_API_URL=${API_PUBLIC_URL}
API_BASE_URL=http://api:8080

COOKIE_DOMAIN=${WEB_DOMAIN:+.${WEB_DOMAIN#*.}}
COOKIE_SECURE=${COOKIE_SECURE_VALUE}

CORS_ORIGINS=${WEB_ORIGIN},http://localhost:3000

BITMART_BASE_URL=https://api-cloud.bitmart.com
COINSTORE_BASE_URL=https://api.coinstore.com
PIONEX_BASE_URL=https://api.pionex.com
DEXSCREENER_BASE_URL=https://api.dexscreener.com

SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@uliquid.vip
SMTP_PASS=${SMTP_PASS}
SMTP_FROM="uLiquid <no-reply@uliquid.vip>"
SMTP_SECURE=true
INVITE_BASE_URL=${INVITE_BASE_URL}

# AI (Read-only insights)
AI_PROVIDER=${AI_PROVIDER}
AI_BASE_URL=${AI_BASE_URL}
AI_API_KEY=${AI_API_KEY}
AI_MODEL=${AI_MODEL}
AI_TIMEOUT_MS=${AI_TIMEOUT_MS}
AI_CACHE_TTL_SEC=${AI_CACHE_TTL_SEC}
AI_RATE_LIMIT_PER_MIN=${AI_RATE_LIMIT_PER_MIN}

LICENSE_KEY=${LICENSE_KEY}
LICENSE_INSTANCE_ID=${LICENSE_INSTANCE_ID}
LICENSE_SERVER_URL=https://license-server.uliquid.vip
LICENSE_SERVER_SECRET=${LICENSE_SERVER_SECRET}
LICENSE_VERIFY_INTERVAL_MIN=15
LICENSE_GRACE_MIN=120
APP_VERSION=
EOF

# Optional: keep .env in sync for troubleshooting/dev tooling
cp "${APP_DIR}/.env.prod" "${APP_DIR}/.env"

echo "==> Installing Caddy (optional HTTPS)"
if [[ -n "${WEB_DOMAIN}" && -n "${API_DOMAIN}" ]]; then
  snap install caddy
  snap start --enable caddy.server

  cat > /var/snap/caddy/common/Caddyfile <<EOF
${WEB_DOMAIN} {
  reverse_proxy 127.0.0.1:3000
}

${API_DOMAIN} {
  reverse_proxy 127.0.0.1:8080
}
EOF

  /snap/bin/caddy validate --config /var/snap/caddy/common/Caddyfile
  /snap/bin/caddy adapt --config /var/snap/caddy/common/Caddyfile --adapter caddyfile --pretty > /tmp/caddy.json
  cp /tmp/caddy.json /var/snap/caddy/common/caddy.json
  chmod 644 /var/snap/caddy/common/caddy.json
  snap restart caddy.server
else
  echo "Skipping Caddy setup (domains not provided)."
fi

echo "==> Starting services"
cd "${APP_DIR}"

echo "==> Installing web chart dependency (recharts)"
npm install -w apps/web recharts@^2.13.0

docker compose -f docker-compose.prod.yml up -d --build

echo "==> Enabling Price Support feature flag"
for _i in {1..30}; do
  if docker compose -f docker-compose.prod.yml exec -T postgres psql -U mm -d marketmaker -tAc \
    "select count(*) from \"Workspace\" where name = \$\$${ADMIN_WORKSPACE_NAME}\$\$;" | tr -d " " | grep -q "^[1-9]"; then
    docker compose -f docker-compose.prod.yml exec -T postgres psql -U mm -d marketmaker -c \
      "update \"Workspace\"
       set \"features\" = jsonb_set(coalesce(\"features\", '{}'::jsonb), '{priceSupport}', 'true'::jsonb, true)
       where name = \$\$${ADMIN_WORKSPACE_NAME}\$\$;"
    break
  fi
  sleep 2
done

echo "==> Done"
echo "Web: ${WEB_DOMAIN:+https://${WEB_DOMAIN}}"
echo "API: ${API_DOMAIN:+https://${API_DOMAIN}/health}"
