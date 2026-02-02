# CEX Integration Playbook — Gate.io

Preflight: `docs/cex/gateio/preflight.md`

## 1) Goals
- Implement Gate.io spot v4 adapter.
- Preserve clientOrderId (text).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.gateio.ws/api/v4
- Auth: HMAC SHA512
  - Headers: KEY, SIGN, Timestamp
  - Signature: <method>\n<path>\n<query>\n<body>\n<timestamp>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASE_QUOTE (e.g., BTC_USDT)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE_QUOTE` (e.g., BTC_USDT)
Meta fields: min_quote_amount, min_base_amount, amount_precision, precision

### Public
- Symbols: `GET /spot/currency_pairs`
- Ticker/mid: `GET /spot/tickers?currency_pair=...`
- Orderbook: `GET /spot/order_book?currency_pair=...&limit=50`

### Private
- Balances: `GET /spot/accounts`
- Open orders: `GET /spot/open_orders?currency_pair=...`
- Place order: `POST /spot/orders` (currency_pair, side, type, price, amount, time_in_force, text)
- Cancel order: `DELETE /spot/orders/{order_id}`
- Cancel all: `DELETE /spot/orders?currency_pair=...`
- Trades/fills: `GET /spot/my_trades?currency_pair=...`

## 2) Files to Create / Update
- `packages/exchange/src/gateio/gateio.client.ts`
- `packages/exchange/src/gateio/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. Currency pairs → meta mapping.
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
- Use time_in_force for postOnly if supported.
