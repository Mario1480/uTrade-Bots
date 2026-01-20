# Logging

## Docker log rotation
Compose services use the `json-file` driver with rotation:
```
max-size: 10m
max-file: 5
```

This prevents logs from growing without bound on disk.

## Follow logs

```sh
docker compose -f docker-compose.dev.yml logs -f --tail=200 api
docker compose -f docker-compose.dev.yml logs -f --tail=200 runner
docker compose -f docker-compose.dev.yml logs -f --tail=200 web
```

## Notes
- API logs are JSON lines for easier ingestion.
- Runner logs are JSON via pino.
