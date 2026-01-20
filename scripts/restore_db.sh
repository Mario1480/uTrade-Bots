#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/backup.sql(.gz)"
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
DB_NAME="${DB_NAME:-marketmaker}"
DB_USER="${DB_USER:-mm}"
BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" stop api runner

if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gunzip -c "${BACKUP_FILE}" | docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1
else
  docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 < "${BACKUP_FILE}"
fi

docker compose -f "${COMPOSE_FILE}" up -d api runner

echo "Restore completed from ${BACKUP_FILE}"
