# CEX Preflight — MEXC (Spot v3)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.mexc.com/api-docs/spot-v3/introduction

## Base URLs
- Base: https://api.mexc.com

## Auth (private endpoints)
- HMAC SHA256 signing with query string.
- Required headers / query:
  - X-MEXC-APIKEY header
  - timestamp (ms)
  - recvWindow (optional)
  - signature (HMAC SHA256 of query string)

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format in API: "BASEQUOTE" (e.g., "BTCUSDT").
- Exchange info returns filters:
  - PRICE_FILTER (tickSize)
  - LOT_SIZE (stepSize, minQty)
  - MIN_NOTIONAL (minNotional)

## Required Endpoints (Spot v3)

### Public
- Symbols / exchange info:
  - GET /api/v3/exchangeInfo
- Ticker / mid price:
  - GET /api/v3/ticker/bookTicker
- Orderbook (optional):
  - GET /api/v3/depth

### Private
- Balances:
  - GET /api/v3/account
- Open orders:
  - GET /api/v3/openOrders?symbol=...
- Place order:
  - POST /api/v3/order
  - Params: symbol, side, type, price, quantity, timeInForce, newClientOrderId
- Cancel order:
  - DELETE /api/v3/order?symbol=...&orderId=... (or origClientOrderId)
- Cancel all:
  - DELETE /api/v3/openOrders?symbol=...
- Trades / fills:
  - GET /api/v3/myTrades?symbol=...

## ClientOrderId Support
- newClientOrderId on order placement.
- Returned as clientOrderId in open orders and trades.

## Time-in-force / Post-only
- timeInForce supports GTC/IOC/FOK.
- postOnly support: check if "LIMIT_MAKER" is supported.

## Error Handling
- JSON error payload with code/msg.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm exchangeInfo filters for tick/step/minNotional
- [ ] Confirm open orders returns clientOrderId
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

