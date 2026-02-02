# CEX Preflight — Binance (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api

## Base URLs
- Base: https://api.binance.com

## Auth (private endpoints)
- HMAC SHA256 signature with query string.
- Required headers / query:
  - X-MBX-APIKEY header
  - timestamp (ms)
  - recvWindow (optional)
  - signature (HMAC SHA256 of query string)

## Rate Limits
- Weights per endpoint; shared limits.
- 429 handling required.

## Symbols / Precision
- Symbol format: "BASEQUOTE" (e.g., "BTCUSDT").
- Exchange info filters:
  - PRICE_FILTER (tickSize)
  - LOT_SIZE (stepSize, minQty)
  - MIN_NOTIONAL (minNotional)

## Required Endpoints (Spot)

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
- newClientOrderId supported and returned.

## Time-in-force / Post-only
- timeInForce supports GTC/IOC/FOK.
- postOnly: use type=LIMIT_MAKER (maker only).

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

