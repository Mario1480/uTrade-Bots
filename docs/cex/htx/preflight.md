# CEX Preflight — HTX (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.htx.com/en-us/opend/newApiPages/

## Base URLs
- Base: https://api.huobi.pro (HTX legacy) or https://api.htx.com (confirm)

## Auth (private endpoints)
- HMAC SHA256 signature.
- Required headers / query:
  - AccessKeyId
  - SignatureMethod=HmacSHA256
  - SignatureVersion=2
  - Timestamp (UTC)
  - Signature (HMAC base64)
- Signature string: canonical query sorted + request method/path.

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: lowercase "basequote" (e.g., "btcusdt") for some endpoints.
- Symbols endpoint returns:
  - price-precision
  - amount-precision
  - min-order-amt
  - min-order-value

## Required Endpoints (Spot)

### Public
- Symbols:
  - GET /v1/common/symbols
- Ticker / mid price:
  - GET /market/detail/merged?symbol=btcusdt
- Orderbook (optional):
  - GET /market/depth?symbol=btcusdt&type=step0

### Private
- Balances:
  - GET /v1/account/accounts
  - GET /v1/account/accounts/{id}/balance
- Open orders:
  - GET /v1/order/openOrders (confirm)
- Place order:
  - POST /v1/order/orders/place
  - Params: account-id, symbol, type, amount, price, source, client-order-id
- Cancel order:
  - POST /v1/order/orders/{order-id}/submitcancel
- Cancel all:
  - POST /v1/order/orders/batchCancelOpenOrders (confirm)
- Trades / fills:
  - GET /v1/order/orders/{order-id}/matchresults or /v1/order/matchresults

## ClientOrderId Support
- client-order-id supported in placement; returned in queries.

## Time-in-force / Post-only
- Verify support for:
  - maker-only (postOnly) using order type "buy-limit-maker" (if supported)
  - timeInForce (GTC/IOC) via order type (check docs)

## Error Handling
- JSON error payload with code/message.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm base URL for HTX
- [ ] Confirm auth signing with live test request
- [ ] Confirm symbol format + precision fields
- [ ] Confirm open orders returns client-order-id
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

