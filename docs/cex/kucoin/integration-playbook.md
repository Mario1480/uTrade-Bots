# CEX Integration Playbook — KuCoin

Preflight: `docs/cex/kucoin/preflight.md`

## 1) Goals
- Implement KuCoin spot adapter.
- Preserve clientOrderId (clientOid).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://api.kucoin.com
- Auth: HMAC SHA256 + Base64
  - Headers: KC-API-KEY, KC-API-SIGN, KC-API-TIMESTAMP, KC-API-PASSPHRASE, KC-API-KEY-VERSION
  - Signature: <timestamp><method><requestPath><body>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASE-QUOTE (e.g., BTC-USDT)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE-QUOTE` (e.g., BTC-USDT)
Meta fields: baseIncrement, priceIncrement, baseMinSize, minFunds

### Public
- Symbols: `GET /api/v1/symbols`
- Ticker/mid: `GET /api/v1/market/orderbook/level1?symbol=...`
- Orderbook: `GET /api/v1/market/orderbook/level2_100?symbol=...`

### Private
- Balances: `GET /api/v1/accounts`
- Open orders: `GET /api/v1/orders?status=active&symbol=...`
- Place order: `POST /api/v1/orders` (symbol, side, type, price, size, timeInForce, clientOid)
- Cancel order: `DELETE /api/v1/orders/{order_id}` (or by clientOid)
- Cancel all: `DELETE /api/v1/orders?symbol=...`
- Trades/fills: `GET /api/v1/fills?symbol=...`

## 2) Files to Create / Update
- `packages/exchange/src/kucoin/kucoin.client.ts`
- `packages/exchange/src/kucoin/index.ts`
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
- Ensure v2 passphrase hashing if required.
