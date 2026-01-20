# Smoke Test Checklist

Run this after deploy or reboot to confirm core services are healthy.

## 1) Caddy up (HTTPS)
```sh
curl -I https://test.domain
curl -i https://api.domain/health
```

## 2) DB healthy
```sh
docker compose -f docker-compose.prod.yml ps
```

## 3) API ready
```sh
curl -i https://api.domain/ready
```

## 4) Login works
- Open `https://test.domain`
- Log in with a valid account

## 5) Bot list loads
- Dashboard shows bots without errors

## 6) Create bot
- Create a new bot (exchange + pair)
- Save config

## 7) Runner
- Runner ready endpoint:
```sh
curl -i http://localhost:8091/ready
```
- Bot runtime updates in Overview

## 8) Place/cancel orders (dry-run/test env)
- Place a small manual order
- Cancel it

## 9) Notifications test (Telegram)
- Trigger a test ping (or a known alert)

## 10) Kill switch test
- Set `tradingEnabled=false`
- Confirm no orders placed on next tick
