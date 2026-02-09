# Manual Trading Desk (Bitget-ready)

## Overview
The manual desk is available at:

- `http://localhost:3000/trade`

It uses:

- REST API endpoints under `apps/api/src/index.ts` (`/api/*`)
- WebSocket proxy endpoints from API:
  - `/ws/market?exchangeAccountId=<id>&symbol=<canonicalSymbol>`
  - `/ws/user?exchangeAccountId=<id>`

The browser never connects directly to Bitget websockets.

## Required Environment
Set these (example values):

- `NEXT_PUBLIC_API_URL=http://localhost:4000`
- `SECRET_MASTER_KEY=<32-byte key / hex / base64>`
- `BITGET_PRODUCT_TYPE=USDT-FUTURES`
- `BITGET_MARGIN_COIN=USDT`

For ExchangeAccount credentials (stored encrypted at rest):

- `exchange=bitget`
- `apiKey`
- `apiSecret`
- `passphrase`

## Run Locally
From repo root:

```bash
npm run db:up
npm run db:generate
npm run dev:api
npm run dev:web
```

Open:

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/health`

## API Surface (normalized)
- `GET /api/symbols`
- `GET /api/account/summary`
- `GET /api/positions?symbol=`
- `GET /api/orders/open?symbol=`
- `POST /api/orders`
- `POST /api/orders/cancel`
- `POST /api/orders/cancel-all?symbol=`
- `POST /api/positions/close`
- `GET /api/trading/settings`
- `POST /api/trading/settings`

All routes require auth session cookie (`mm_session`).

## Notes
- Internal canonical symbol format is `BTCUSDT`.
- Adapter boundary is implemented in API via `apps/api/src/trading.ts` using `BitgetFuturesAdapter`.
- API keys remain server-side and are decrypted only in memory during API/WS calls.
