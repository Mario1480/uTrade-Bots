# CEX Integration Playbook — Bitfinex

Preflight: `docs/cex/bitfinex/preflight.md`

## 1) Goals
- Implement Bitfinex spot v2 adapter.
- Preserve clientOrderId (cid).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.bitfinex.com/v2
- Auth: HMAC SHA384
  - Headers: bfx-apikey, bfx-signature, bfx-nonce
  - Signature: /api/<path><nonce><body>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: tBASEQUOTE (e.g., tBTCUSD)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `tBASEQUOTE` (e.g., tBTCUSD)
Meta fields: price_precision, min_order_size, max_order_size

### Public
- Symbols/meta: `GET /v2/conf/pub:info:pair`
- Ticker/mid: `GET /v2/ticker/tBTCUSD`
- Orderbook: `GET /v2/book/tBTCUSD/P0?len=50`

### Private
- Balances: `POST /v2/auth/r/wallets`
- Open orders: `POST /v2/auth/r/orders`
- Place order: `POST /v2/auth/w/order/submit` (symbol, type, price, amount, cid)
- Cancel order: `POST /v2/auth/w/order/cancel`
- Cancel all: `POST /v2/auth/w/order/cancel/multi` (or loop)
- Trades/fills: `POST /v2/auth/r/trades/hist`

## 2) Files to Create / Update
- `packages/exchange/src/bitfinex/bitfinex.client.ts`
- `packages/exchange/src/bitfinex/index.ts`
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
- Bitfinex uses flags for post‑only; confirm behavior.
