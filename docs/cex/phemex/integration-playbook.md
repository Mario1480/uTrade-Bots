# CEX Integration Playbook — Phemex

Preflight: `docs/cex/phemex/preflight.md`

## 1) Goals
- Implement Phemex spot adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.phemex.com
- Auth: HMAC SHA256
  - Headers: x-phemex-access-token, x-phemex-request-expiry, x-phemex-request-signature
  - Signature: <method><path><expiry><body>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BTCUSDT (confirm spot symbol prefix)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BTCUSDT` or spot-specific (confirm)
Meta fields: tickSize, lotSize, minQty, minNotional

### Public
- Symbols: `GET /exchange/public/products` (confirm spot)
- Ticker/mid: `GET /md/v2/ticker/24hr`
- Orderbook: `GET /md/v2/orderbook`

### Private
- Balances: `GET /spot/assets`
- Open orders: `GET /spot/orders/active`
- Place order: `POST /spot/orders` (symbol, side, orderType, price, qty, timeInForce, clientOrderId)
- Cancel order: `DELETE /spot/orders/active`
- Cancel all: `DELETE /spot/orders/all`
- Trades/fills: `GET /spot/trades`

## 2) Files to Create / Update
- `packages/exchange/src/phemex/phemex.client.ts`
- `packages/exchange/src/phemex/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. Symbols/meta mapping.
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
- Confirm spot endpoints vs derivatives.
