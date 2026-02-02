# CEX Preflight — OKX (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.okx.com/docs-v5/en/#overview

## Base URLs
- Base: https://www.okx.com
- API base: https://www.okx.com/api/v5

## Auth (private endpoints)
- HMAC SHA256 + Base64 signature.
- Required headers:
  - OK-ACCESS-KEY
  - OK-ACCESS-SIGN
  - OK-ACCESS-TIMESTAMP
  - OK-ACCESS-PASSPHRASE
- Signature string: `<timestamp><method><requestPath><body>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Instrument ID format: "BASE-QUOTE" (e.g., "BTC-USDT").
- Instruments endpoint returns:
  - tickSz
  - lotSz / minSz
  - minSz / minNotional (check)

## Required Endpoints (Spot)

### Public
- Symbols / instruments:
  - GET /api/v5/public/instruments?instType=SPOT
- Ticker / mid price:
  - GET /api/v5/market/ticker?instId=BTC-USDT
- Orderbook (optional):
  - GET /api/v5/market/books?instId=BTC-USDT&sz=50

### Private
- Balances:
  - GET /api/v5/account/balance
- Open orders:
  - GET /api/v5/trade/orders-pending?instType=SPOT&instId=BTC-USDT
- Place order:
  - POST /api/v5/trade/order
  - Params: instId, tdMode=cash, side, ordType, px, sz, clOrdId
- Cancel order:
  - POST /api/v5/trade/cancel-order
  - Params: instId, ordId (or clOrdId)
- Cancel all:
  - POST /api/v5/trade/cancel-batch (loop if needed)
- Trades / fills:
  - GET /api/v5/trade/fills?instType=SPOT&instId=BTC-USDT

## ClientOrderId Support
- clOrdId supported and returned in open orders/trades.

## Time-in-force / Post-only
- ordType supports:
  - limit, market, post_only (check)
  - timeInForce may be implicit for spot

## Error Handling
- JSON payload with code/msg.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm instruments fields for tick/lot/minNotional
- [ ] Confirm open orders returns clOrdId
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

