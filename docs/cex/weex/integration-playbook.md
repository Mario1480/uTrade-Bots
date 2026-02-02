# CEX Integration Playbook — WEEX

Preflight: `docs/cex/weex/preflight.md`

## 1) Goals
- Implement WEEX spot adapter per preflight.
- Preserve clientOrderId (mm-/vol- prefixes).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.weex.com (confirm)
- Auth: HMAC + timestamp + recvWindow (confirm exact scheme)
- Rate limits: confirm weights (public/private)
- Symbol format: BASE_QUOTE or BASE-QUOTE (confirm)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE_QUOTE` or `BASE-QUOTE` (confirm)
Meta fields: tickSize, stepSize, minQty, minNotional (from symbols endpoint)

### Public
- Symbols: `GET /api/spot/v1/symbols` (confirm)
- Ticker/mid: `GET /api/spot/v1/ticker` (confirm)
- Orderbook: `GET /api/spot/v1/depth` (confirm)

### Private
- Balances: `GET/POST /api/spot/v1/account` (confirm)
- Open orders: `GET/POST /api/spot/v1/openOrders` (confirm)
- Place order: `POST /api/spot/v1/order` (symbol, side, type, price, qty, timeInForce, clientOrderId)
- Cancel order: `POST /api/spot/v1/cancelOrder` (confirm)
- Cancel all: `POST /api/spot/v1/cancelAll` (confirm)
- Trades/fills: `GET/POST /api/spot/v1/myTrades` (confirm)

## 2) Files to Create / Update
- `packages/exchange/src/weex/weex.client.ts`
- `packages/exchange/src/weex/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts` (symbols endpoint)
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
- Confirm exact base URL + signing details.
