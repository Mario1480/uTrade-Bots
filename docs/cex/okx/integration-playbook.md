# CEX Integration Playbook — OKX

Preflight: `docs/cex/okx/preflight.md`

## 1) Goals
- Implement OKX spot adapter.
- Preserve clientOrderId (clOrdId).
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://www.okx.com/api/v5
- Auth: HMAC SHA256 + Base64
  - Headers: OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP, OK-ACCESS-PASSPHRASE
  - Signature: <timestamp><method><requestPath><body>
- Rate limits: endpoint weights (429 on exceed)
- Symbol format: BASE-QUOTE (e.g., BTC-USDT)

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE-QUOTE` (e.g., BTC-USDT)
Meta fields: tickSz, lotSz/minSz, minNotional (if present)

### Public
- Instruments: `GET /api/v5/public/instruments?instType=SPOT`
- Ticker/mid: `GET /api/v5/market/ticker?instId=BTC-USDT`
- Orderbook: `GET /api/v5/market/books?instId=BTC-USDT&sz=50`

### Private
- Balances: `GET /api/v5/account/balance`
- Open orders: `GET /api/v5/trade/orders-pending?instType=SPOT&instId=...`
- Place order: `POST /api/v5/trade/order` (instId, tdMode=cash, side, ordType, px, sz, clOrdId)
- Cancel order: `POST /api/v5/trade/cancel-order`
- Cancel all: `POST /api/v5/trade/cancel-batch` (loop as needed)
- Trades/fills: `GET /api/v5/trade/fills?instType=SPOT&instId=...`

## 2) Files to Create / Update
- `packages/exchange/src/okx/okx.client.ts`
- `packages/exchange/src/okx/index.ts`
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
- Ensure SPOT instType.
