# CEX Integration Playbook — LBank

Preflight: `docs/cex/lbank/preflight.md`

## 1) Goals
- Implement LBank spot adapter.
- Preserve clientOrderId (if supported).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.lbank.info (confirm)
- Auth: HMAC SHA256 (sorted params + sign)
  - Params: api_key, timestamp, sign
- Rate limits: confirm weights (429 on exceed)
- Symbol format: lowercase base_quote (e.g., btc_usdt)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `base_quote` (e.g., btc_usdt)
Meta fields: price precision, amount precision, minQty, minNotional

### Public
- Symbols: `GET /v2/currencyPairs.do` (confirm)
- Ticker/mid: `GET /v2/ticker/24hr.do`
- Orderbook: `GET /v2/depth.do`

### Private
- Balances: `POST /v2/user_info.do`
- Open orders: `POST /v2/openOrders.do` or `POST /v2/orders_info.do` (confirm)
- Place order: `POST /v2/create_order.do` (symbol, type, price, amount, clientId?)
- Cancel order: `POST /v2/cancel_order.do`
- Cancel all: `POST /v2/cancel_all.do`
- Trades/fills: `POST /v2/transaction_history.do` or `POST /v2/orders_info.do` (confirm)

## 2) Files to Create / Update
- `packages/exchange/src/lbank/lbank.client.ts`
- `packages/exchange/src/lbank/index.ts`
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
- Verify clientOrderId support.
