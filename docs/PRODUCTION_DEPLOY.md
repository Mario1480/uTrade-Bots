# Production Deploy (Docker Compose)

## Prereqs
- Docker + Docker Compose installed
- `.env.prod` configured on the server

## Build + Start

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

## Verify

```sh
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=200 api
docker compose -f docker-compose.prod.yml logs -f --tail=200 runner
```

AI proxy (Salad/Ollama via OpenAI-compatible endpoint):
```sh
docker compose -f docker-compose.prod.yml ps salad-proxy
docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://salad-proxy:8088/health
```
Admin settings for Salad/Ollama:
- Provider: `ollama`
- Base URL: `http://salad-proxy:8088/v1`
- Model: `qwen3:8b`
- API key: `salad_cloud_user_...`

Optional cost-saving control (manual):
- In `/admin/api-keys` configure `Salad Runtime Control` target:
  - `Organization`, `Project`, `Container`
- Then use `Start container` / `Stop container` directly in Admin during test windows.

Health checks:
```sh
curl -i http://localhost:8080/health
curl -i http://localhost:8080/ready
curl -i http://localhost:8091/health
curl -i http://localhost:8091/ready
```

## Restart / Rebuild

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

## Notes
- Postgres uses a named volume (`pgdata`), so data persists across restarts.
- API runs `prisma migrate deploy` on startup.
- `docker-compose.prod.yml` uses `.env.prod` (no dev mounts).
