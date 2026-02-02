# CEX Preflight — BingX (Spot v3)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://bingx-api.github.io/docs-v3/#/en/info

## Base URLs
- Base: https://open-api.bingx.com (confirm from docs)

## Auth (private endpoints)
- HMAC SHA256 signing with query string.
- Required headers / query:
  - X-BX-APIKEY header
  - timestamp (ms)
  - recvWindow (optional)
  - signature (HMAC SHA256 of query string)

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format in API: "BASE-QUOTE" (e.g., "BTC-USDT") or "BASEQUOTE" (confirm).
- Exchange info returns:
  - tickSize
  - stepSize / qty precision
  - minQty / minNotional

## Required Endpoints (Spot v3)

### Public
- Symbols / exchange info:
  - GET /openApi/spot/v1/common/symbols (confirm)
- Ticker / mid price:
  - GET /openApi/spot/v1/ticker/bookTicker (confirm)
- Orderbook (optional):
  - GET /openApi/spot/v1/market/depth (confirm)

### Private
- Balances:
  - GET /openApi/spot/v1/account/balance (confirm)
- Open orders:
  - GET /openApi/spot/v1/order/openOrders (confirm)
- Place order:
  - POST /openApi/spot/v1/order
  - Params: symbol, side, type, price, quantity, timeInForce, clientOrderId
- Cancel order:
  - POST /openApi/spot/v1/order/cancel (confirm)
- Cancel all:
  - POST /openApi/spot/v1/order/cancelAll (confirm)
- Trades / fills:
  - GET /openApi/spot/v1/trades (confirm)

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

