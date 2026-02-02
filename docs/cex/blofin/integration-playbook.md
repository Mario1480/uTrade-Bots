# CEX Integration Playbook — BloFin

Preflight: `docs/cex/blofin/preflight.md`

## 1) Goals
- Implement BloFin spot adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://openapi.blofin.com (confirm)
- Auth: HMAC SHA256
  - Headers: BF-ACCESS-KEY, BF-ACCESS-SIGN, BF-ACCESS-TIMESTAMP, BF-ACCESS-PASSPHRASE
  - Signature: <timestamp><method><requestPath><body>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASE-QUOTE or BASEQUOTE (confirm)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE-QUOTE` or `BASEQUOTE` (confirm)
Meta fields: tickSize, stepSize, minQty, minNotional

### Public
- Symbols: `GET /api/v1/spot/symbols` (confirm)
- Ticker/mid: `GET /api/v1/spot/ticker` (confirm)
- Orderbook: `GET /api/v1/spot/orderbook`

### Private
- Balances: `GET /api/v1/spot/account/balances`
- Open orders: `GET /api/v1/spot/orders/open`
- Place order: `POST /api/v1/spot/order` (symbol, side, type, price, quantity, timeInForce, clientOrderId)
- Cancel order: `POST /api/v1/spot/order/cancel`
- Cancel all: `POST /api/v1/spot/order/cancelAll`
- Trades/fills: `GET /api/v1/spot/trades`

## 2) Files to Create / Update
- `packages/exchange/src/blofin/blofin.client.ts`
- `packages/exchange/src/blofin/index.ts`
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
- Confirm base URL and endpoints.
