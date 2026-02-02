# CEX Integration Playbook — HTX

Preflight: `docs/cex/htx/preflight.md`

## 1) Goals
- Implement HTX spot adapter.
- Preserve clientOrderId (client-order-id).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.huobi.pro or https://api.htx.com (confirm)
- Auth: HMAC SHA256
  - Query params: AccessKeyId, SignatureMethod=HmacSHA256, SignatureVersion=2, Timestamp, Signature
  - Signature: canonical sorted query + method/path
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: lowercase basequote (e.g., btcusdt)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: lowercase basequote (e.g., btcusdt)
Meta fields: price-precision, amount-precision, min-order-amt, min-order-value

### Public
- Symbols: `GET /v1/common/symbols`
- Ticker/mid: `GET /market/detail/merged?symbol=btcusdt`
- Orderbook: `GET /market/depth?symbol=btcusdt&type=step0`

### Private
- Balances: `GET /v1/account/accounts` + `GET /v1/account/accounts/{id}/balance`
- Open orders: `GET /v1/order/openOrders`
- Place order: `POST /v1/order/orders/place` (account-id, symbol, type, amount, price, client-order-id)
- Cancel order: `POST /v1/order/orders/{order-id}/submitcancel`
- Cancel all: `POST /v1/order/orders/batchCancelOpenOrders`
- Trades/fills: `GET /v1/order/matchresults` (or order-specific matchresults)

## 2) Files to Create / Update
- `packages/exchange/src/htx/htx.client.ts`
- `packages/exchange/src/htx/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. Symbols → meta mapping.
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
- Confirm HTX base URL and signing scheme.
