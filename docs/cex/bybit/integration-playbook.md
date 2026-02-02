# CEX Integration Playbook — Bybit

Preflight: `docs/cex/bybit/preflight.md`

## 1) Goals
- Implement Bybit spot v5 adapter.
- Preserve clientOrderId (orderLinkId).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.bybit.com
- Auth: HMAC SHA256
  - Headers: X-BAPI-API-KEY, X-BAPI-SIGN, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW
  - Signature: <timestamp><apiKey><recvWindow><queryOrBody>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASEQUOTE (e.g., BTCUSDT)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASEQUOTE` (e.g., BTCUSDT)
Meta fields: priceFilter.tickSize, lotSizeFilter.qtyStep/minOrderQty, minNotional

### Public
- Instruments: `GET /v5/market/instruments-info?category=spot`
- Ticker/mid: `GET /v5/market/tickers?category=spot&symbol=BTCUSDT`
- Orderbook: `GET /v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=50`

### Private
- Balances: `GET /v5/account/wallet-balance?accountType=SPOT`
- Open orders: `GET /v5/order/realtime?category=spot&symbol=...`
- Place order: `POST /v5/order/create` (category, symbol, side, orderType, price, qty, timeInForce, orderLinkId)
- Cancel order: `POST /v5/order/cancel`
- Cancel all: `POST /v5/order/cancel-all?category=spot&symbol=...`
- Trades/fills: `GET /v5/execution/list?category=spot&symbol=...`

## 2) Files to Create / Update
- `packages/exchange/src/bybit/bybit.client.ts`
- `packages/exchange/src/bybit/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. Instruments → symbol meta.
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
- Ensure category=spot in all endpoints.
