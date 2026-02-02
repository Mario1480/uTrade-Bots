# CEX Integration Playbook — MEXC

Preflight: `docs/cex/mexc/preflight.md`

## 1) Goals
- Implement MEXC spot adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.mexc.com
- Auth: HMAC SHA256 (query signature)
  - Header: X-MEXC-APIKEY
  - Query: timestamp, recvWindow?, signature
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASEQUOTE (e.g., BTCUSDT)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASEQUOTE` (e.g., BTCUSDT)
Meta fields (from exchangeInfo):
- PRICE_FILTER.tickSize
- LOT_SIZE.stepSize, minQty
- MIN_NOTIONAL.minNotional

### Public
- Symbols: `GET /api/v3/exchangeInfo`
- Ticker/mid: `GET /api/v3/ticker/bookTicker`
- Orderbook: `GET /api/v3/depth`

### Private
- Balances: `GET /api/v3/account`
- Open orders: `GET /api/v3/openOrders?symbol=...`
- Place order: `POST /api/v3/order` (symbol, side, type, price, quantity, timeInForce, newClientOrderId)
- Cancel order: `DELETE /api/v3/order` (orderId or origClientOrderId)
- Cancel all: `DELETE /api/v3/openOrders?symbol=...`
- Trades/fills: `GET /api/v3/myTrades?symbol=...`

## 2) Files to Create / Update
- `packages/exchange/src/mexc/mexc.client.ts`
- `packages/exchange/src/mexc/index.ts`
- `packages/exchange/src/index.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. ExchangeInfo → symbol meta.
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
- Symbol format is BASEQUOTE.
