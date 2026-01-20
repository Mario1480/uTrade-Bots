#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/market-maker/backups}"
DB_NAME="${DB_NAME:-marketmaker}"
DB_USER="${DB_USER:-mm}"

mkdir -p "${BACKUP_DIR}"

ts="$(date +"%Y%m%d_%H%M")"
outfile="${BACKUP_DIR}/mm_${ts}.sql.gz"

docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" | gzip > "${outfile}"

find "${BACKUP_DIR}" -type f -name "mm_*.sql.gz" -mtime +14 -print -delete

echo "Backup written to ${outfile}"
