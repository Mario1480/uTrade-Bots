# CEX Integration Playbook — CoinEx

Preflight: `docs/cex/coinex/preflight.md`

## 1) Goals
- Implement CoinEx spot v2 adapter.
- Preserve clientOrderId (client_id if supported).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.coinex.com
- Auth: HMAC SHA256
  - Headers: X-COINEX-KEY, X-COINEX-SIGN, X-COINEX-TIMESTAMP
  - Signature: sorted params + timestamp (confirm exact scheme)
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASEQUOTE (confirm)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASEQUOTE` (confirm)
Meta fields: price/amount precision, min amount, min notional

### Public
- Symbols: `GET /v2/spot/market`
- Ticker/mid: `GET /v2/spot/ticker?market=...`
- Orderbook: `GET /v2/spot/order_book?market=...&limit=50`

### Private
- Balances: `GET /v2/spot/balance`
- Open orders: `GET /v2/spot/pending_order?market=...`
- Place order: `POST /v2/spot/order` (market, side, amount, price, type, client_id)
- Cancel order: `POST /v2/spot/cancel_order`
- Cancel all: `POST /v2/spot/cancel_all`
- Trades/fills: `GET /v2/spot/user_trades?market=...`

## 2) Files to Create / Update
- `packages/exchange/src/coinex/coinex.client.ts`
- `packages/exchange/src/coinex/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. Markets → meta mapping.
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
- Confirm symbol format.
