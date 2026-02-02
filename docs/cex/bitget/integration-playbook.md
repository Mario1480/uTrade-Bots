# CEX Integration Playbook — Bitget

Preflight: `docs/cex/bitget/preflight.md`

## 1) Goals
- Implement Bitget spot adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.bitget.com
- Auth: HMAC SHA256 + Base64
  - Headers: ACCESS-KEY, ACCESS-SIGN, ACCESS-TIMESTAMP, ACCESS-PASSPHRASE
  - Signature: <timestamp><method><requestPath><body>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASEQUOTE (confirm)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASEQUOTE` (confirm)
Meta fields: priceScale/pricePrecision, quantityScale/basePrecision, minTradeAmount/minTradeUSDT

### Public
- Symbols: `GET /api/spot/v1/public/products`
- Ticker/mid: `GET /api/spot/v1/market/ticker?symbol=...`
- Orderbook: `GET /api/spot/v1/market/depth?symbol=...&limit=50`

### Private
- Balances: `GET /api/spot/v1/account/assets`
- Open orders: `GET /api/spot/v1/trade/open-orders?symbol=...`
- Place order: `POST /api/spot/v1/trade/orders` (symbol, side, orderType, price, quantity, timeInForce, clientOrderId)
- Cancel order: `POST /api/spot/v1/trade/cancel-order`
- Cancel all: `POST /api/spot/v1/trade/cancel-batch`
- Trades/fills: `GET /api/spot/v1/trade/fills?symbol=...`

## 2) Files to Create / Update
- `packages/exchange/src/bitget/bitget.client.ts`
- `packages/exchange/src/bitget/index.ts`
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
- Confirm symbol format.
