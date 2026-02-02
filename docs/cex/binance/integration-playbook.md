# CEX Integration Playbook — Binance

Preflight: `docs/cex/binance/preflight.md`

## 1) Goals
- Implement Binance spot adapter.
- Preserve clientOrderId (newClientOrderId).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.binance.com
- Auth: HMAC SHA256
  - Header: X-MBX-APIKEY
  - Query: timestamp, recvWindow?, signature
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASEQUOTE (e.g., BTCUSDT)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASEQUOTE` (e.g., BTCUSDT)
Meta fields: PRICE_FILTER.tickSize, LOT_SIZE.stepSize/minQty, MIN_NOTIONAL.minNotional

### Public
- Symbols: `GET /api/v3/exchangeInfo`
- Ticker/mid: `GET /api/v3/ticker/bookTicker`
- Orderbook: `GET /api/v3/depth`

### Private
- Balances: `GET /api/v3/account`
- Open orders: `GET /api/v3/openOrders?symbol=...`
- Place order: `POST /api/v3/order` (symbol, side, type, price, quantity, timeInForce, newClientOrderId)
- Cancel order: `DELETE /api/v3/order` (orderId or origClientOrderId)
- Cancel all: `DELETE /api/v3/openOrders?symbol=...`
- Trades/fills: `GET /api/v3/myTrades?symbol=...`

## 2) Files to Create / Update
- `packages/exchange/src/binance/binance.client.ts`
- `packages/exchange/src/binance/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. ExchangeInfo → meta mapping.
3. Balances / openOrders / place / cancel.
4. getMyTrades.
5. Wire registry + API.
6. Smoke tests.

## 4) Smoke Test Checklist
- [ ] symbols list
- [ ] mid price
- [ ] balances
- [ ] place/cancel
- [ ] openOrders with clientOrderId
- [ ] manual order
- [ ] getMyTrades

## 5) Notes / Risks
- Use LIMIT_MAKER for post‑only.
