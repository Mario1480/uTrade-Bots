# CEX Integration Playbook — BingX

Preflight: `docs/cex/bingx/preflight.md`

## 1) Goals
- Implement BingX spot adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://open-api.bingx.com
- Auth: HMAC SHA256 (query signature)
  - Header: `X-BX-APIKEY`
  - Query: `timestamp`, `recvWindow`, `signature`
  - Signature = HMAC SHA256 of sorted query string (hex)
- Rate limits:
  - Public IP: 500 req / 10s (symbols endpoint)
  - Private UID: 10 req / sec (openOrders, query, historyOrders)
  - Cancel all: 2 req / sec
- Symbol format: `BASE-QUOTE` (e.g., `BTC-USDT`)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE-QUOTE`
Meta fields: `tickSize`, `stepSize`, `minNotional` (minQty/maxQty deprecated)

### Public
- Symbols: `GET /openApi/spot/v1/common/symbols`
- Ticker/mid: `GET /openApi/spot/v1/ticker/bookTicker`
- Orderbook: `GET /openApi/spot/v1/market/depth`
- Recent trades: `GET /openApi/spot/v1/market/trades`

### Private
- Balances: `GET /openApi/spot/v1/account/balance`
- Open orders: `GET /openApi/spot/v1/trade/openOrders`
- Place order: `POST /openApi/spot/v1/trade/order`
  - `newClientOrderId` supported
  - `timeInForce`: PostOnly/GTC/IOC/FOK
- Cancel order: `POST /openApi/spot/v1/trade/cancel`
- Cancel all: `POST /openApi/spot/v1/trade/cancelOpenOrders`
- Order details: `GET /openApi/spot/v1/trade/query`
- Trades/fills:
  - `GET /openApi/spot/v1/trade/historyOrders` (order history)
  - **No private fills endpoint found** → synthesize pseudo-trades from historyOrders

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
- Open orders response may not include `clientOrderID` (confirm).
- Volume counter uses pseudo-trades derived from order history.
