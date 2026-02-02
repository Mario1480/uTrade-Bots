# CEX Preflight — KuCoin (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.kucoin.com/docs-new/introduction?lang=en_US&

## Base URLs
- Base: https://api.kucoin.com

## Auth (private endpoints)
- HMAC SHA256 + Base64 signature.
- Required headers:
  - KC-API-KEY
  - KC-API-SIGN
  - KC-API-TIMESTAMP
  - KC-API-PASSPHRASE (hashed if v2)
  - KC-API-KEY-VERSION (2 if v2)
- Signature string: `<timestamp><method><requestPath><body>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: "BASE-QUOTE" (e.g., "BTC-USDT").
- Symbols endpoint returns:
  - baseIncrement (stepSize)
  - priceIncrement (tickSize)
  - baseMinSize (minQty)
  - minFunds (minNotional)

## Required Endpoints (Spot)

### Public
- Symbols:
  - GET /api/v1/symbols
- Ticker / mid price:
  - GET /api/v1/market/orderbook/level1?symbol=BTC-USDT
- Orderbook (optional):
  - GET /api/v1/market/orderbook/level2_100?symbol=BTC-USDT

### Private
- Balances:
  - GET /api/v1/accounts
- Open orders:
  - GET /api/v1/orders?status=active&symbol=BTC-USDT
- Place order:
  - POST /api/v1/orders
  - Params: symbol, side, type, price, size, timeInForce, clientOid
- Cancel order:
  - DELETE /api/v1/orders/{order_id} or by clientOid
- Cancel all:
  - DELETE /api/v1/orders?symbol=BTC-USDT
- Trades / fills:
  - GET /api/v1/fills?symbol=BTC-USDT

## ClientOrderId Support
- clientOid supported and returned.

## Time-in-force / Post-only
- timeInForce supports GTC/IOC/FOK.
- postOnly via `postOnly=true` (check).

## Error Handling
- JSON error payload with code/msg.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm symbols fields for tick/step/minNotional
- [ ] Confirm open orders returns clientOid
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

