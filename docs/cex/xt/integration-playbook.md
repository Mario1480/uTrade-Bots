# CEX Integration Playbook — XT

Preflight: `docs/cex/xt/preflight.md`

## 1) Goals
- Implement XT spot adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.xt.com (confirm)
- Auth: HMAC SHA256 (query signature) (confirm)
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASE_QUOTE or BASE/QUOTE (confirm)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE_QUOTE` or `BASE/QUOTE` (confirm)
Meta fields: tickSize, stepSize, minQty, minNotional

### Public
- Symbols: `GET /v4/public/symbol` (confirm)
- Ticker/mid: `GET /v4/public/ticker` (confirm)
- Orderbook: `GET /v4/public/depth` (confirm)

### Private
- Balances: `GET /v4/balance` (confirm)
- Open orders: `GET /v4/order/open` (confirm)
- Place order: `POST /v4/order` (symbol, side, type, price, quantity, timeInForce, clientOrderId)
- Cancel order: `POST /v4/order/cancel`
- Cancel all: `POST /v4/order/cancelAll`
- Trades/fills: `GET /v4/trade/history`

## 2) Files to Create / Update
- `packages/exchange/src/xt/xt.client.ts`
- `packages/exchange/src/xt/index.ts`
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
- Confirm exact endpoint paths.
