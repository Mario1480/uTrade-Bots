# CEX Integration Playbook — P2B

Preflight: `docs/cex/p2b/preflight.md`

## 1) Goals
- Implement P2B adapter with full public/private support.
- Preserve clientOrderId (mm-/vol- prefixes).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.p2pb2b.io
- Auth: HMAC SHA512
  - Headers: X-TXC-APIKEY, X-TXC-PAYLOAD (base64 JSON), X-TXC-SIGNATURE
  - Payload: { request, nonce, ...params }
- Rate limits: ~10 req/s (public & private)
- Symbol format: BASE_QUOTE (e.g., BTC_USDT)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE_QUOTE` (e.g., BTC_USDT)
Meta fields: `min_amount`, `min_price`, `min_total`, `amount_precision`, `price_precision`

### Public
- Symbols: `GET /api/v2/public/markets`
- Ticker/mid: `GET /api/v2/public/ticker?market=BASE_QUOTE`
- Orderbook: `GET /api/v2/public/book?market=BASE_QUOTE&side=buy|sell&offset=0&limit=50`

### Private
- Balances: `POST /api/v2/account/balances`
- Open orders: `POST /api/v2/orders` (market, offset, limit)
- Place order: `POST /api/v2/order/new` (market, side, amount, price, type, time_in_force)
- Cancel order: `POST /api/v2/order/cancel` (order_id)
- Cancel all: `POST /api/v2/order/cancel` (market if supported) or loop openOrders
- Trades/fills: `POST /api/v2/account/trades` (market, offset, limit)

## 2) Files to Create / Update
- `packages/exchange/src/p2b/p2b.client.ts`
- `packages/exchange/src/p2b/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts` (symbols endpoint)
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. Symbols/meta from `/api/v2/public/markets`.
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
- Confirm clientOrderId support.
