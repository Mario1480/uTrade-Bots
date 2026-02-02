# CEX Integration Playbook — BingX

Preflight: `docs/cex/bingx/preflight.md`

## 1) Goals
- Implement BingX spot adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://open-api.bingx.com (confirm)
- Auth: HMAC SHA256 (query signature)
  - Header: X-BX-APIKEY
  - Query: timestamp, recvWindow?, signature
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASE-QUOTE or BASEQUOTE (confirm)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE-QUOTE` or `BASEQUOTE` (confirm)
Meta fields: tickSize, stepSize, minQty, minNotional

### Public
- Symbols: `GET /openApi/spot/v1/common/symbols` (confirm)
- Ticker/mid: `GET /openApi/spot/v1/ticker/bookTicker` (confirm)
- Orderbook: `GET /openApi/spot/v1/market/depth`

### Private
- Balances: `GET /openApi/spot/v1/account/balance`
- Open orders: `GET /openApi/spot/v1/order/openOrders`
- Place order: `POST /openApi/spot/v1/order` (symbol, side, type, price, quantity, timeInForce, clientOrderId)
- Cancel order: `POST /openApi/spot/v1/order/cancel`
- Cancel all: `POST /openApi/spot/v1/order/cancelAll`
- Trades/fills: `GET /openApi/spot/v1/trades`

## 2) Files to Create / Update
- `packages/exchange/src/bingx/bingx.client.ts`
- `packages/exchange/src/bingx/index.ts`
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
- Confirm symbol format and paths.
