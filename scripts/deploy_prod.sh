#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SKIP_PULL="0"

for arg in "$@"; do
  case "${arg}" in
    --no-pull)
      SKIP_PULL="1"
      ;;
    *)
      echo "Unknown argument: ${arg}"
      echo "Usage: $0 [--no-pull]"
      exit 1
      ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}"
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing compose file: ${COMPOSE_FILE}"
  exit 1
fi

echo "==> Repo: ${ROOT_DIR}"
echo "==> Env: ${ENV_FILE}"
echo "==> Compose: ${COMPOSE_FILE}"

if [[ "${SKIP_PULL}" != "1" ]]; then
  echo "==> git pull"
  git pull --ff-only
else
  echo "==> Skipping git pull (--no-pull)"
fi

echo "==> Deploying containers"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans

echo "==> Service status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "==> Done"
