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

echo "==> Installing system dependencies"
apt update -y
apt install -y curl ca-certificates gnupg unzip git ufw

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

NEXT_PUBLIC_API_URL=${API_DOMAIN:+https://${API_DOMAIN}}
API_BASE_URL=http://api:8080

COOKIE_DOMAIN=${WEB_DOMAIN:+.${WEB_DOMAIN#*.}}
COOKIE_SECURE=true

CORS_ORIGINS=${WEB_DOMAIN:+https://${WEB_DOMAIN}},http://localhost:3000

BITMART_BASE_URL=https://api-cloud.bitmart.com

SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@uliquid.vip
SMTP_PASS=${SMTP_PASS}
SMTP_FROM="uLiquid <no-reply@uliquid.vip>"
SMTP_SECURE=true
INVITE_BASE_URL=${INVITE_BASE_URL}
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
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Done"
echo "Web: ${WEB_DOMAIN:+https://${WEB_DOMAIN}}"
echo "API: ${API_DOMAIN:+https://${API_DOMAIN}/health}"
 