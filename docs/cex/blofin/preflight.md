# CEX Preflight — BloFin (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://docs.blofin.com/index.html#overview

## Base URLs
- Base: https://openapi.blofin.com (confirm from docs)

## Auth (private endpoints)
- HMAC SHA256 signature.
- Required headers:
  - BF-ACCESS-KEY (or equivalent)
  - BF-ACCESS-SIGN
  - BF-ACCESS-TIMESTAMP
  - BF-ACCESS-PASSPHRASE
- Signature string: `<timestamp><method><requestPath><body>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: "BASE-QUOTE" or "BASEQUOTE" (confirm).
- Instruments endpoint returns:
  - tickSize
  - lotSize / qty step
  - minQty / minNotional

## Required Endpoints (Spot)

### Public
- Symbols / instruments:
  - GET /api/v1/spot/symbols (confirm)
- Ticker / mid price:
  - GET /api/v1/spot/ticker (confirm)
- Orderbook (optional):
  - GET /api/v1/spot/orderbook (confirm)

### Private
- Balances:
  - GET /api/v1/spot/account/balances (confirm)
- Open orders:
  - GET /api/v1/spot/orders/open (confirm)
- Place order:
  - POST /api/v1/spot/order
  - Params: symbol, side, type, price, quantity, timeInForce, clientOrderId
- Cancel order:
  - POST /api/v1/spot/order/cancel
- Cancel all:
  - POST /api/v1/spot/order/cancelAll (confirm)
- Trades / fills:
  - GET /api/v1/spot/trades (confirm)

## ClientOrderId Support
- Verify if clientOrderId is supported and returned.

## Time-in-force / Post-only
- Verify support for:
  - postOnly (maker only)
  - timeInForce values (GTC/IOC/FOK)

## Error Handling
- JSON error payload with code/msg.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm symbol format + precision fields
- [ ] Confirm open orders returns clientOrderId or order_id
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

