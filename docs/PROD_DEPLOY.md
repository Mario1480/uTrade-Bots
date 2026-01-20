# Production Deploy (Docker Compose)

## Prereqs
- Docker + Docker Compose installed
- `.env` configured on the server

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
