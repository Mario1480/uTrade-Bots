# CEX Preflight — XT (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://doc.xt.com/docs/index_overview/overview

## Base URLs
- Base: https://api.xt.com (confirm from docs)

## Auth (private endpoints)
- HMAC SHA256 signing with query string.
- Required headers / query:
  - XT-API-KEY (or equivalent)
  - timestamp (ms)
  - recvWindow (optional)
  - signature (HMAC SHA256 of query string)

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format in API: "BASE_QUOTE" (e.g., "BTC_USDT") or "BASE/QUOTE" (confirm).
- Exchange info / symbols endpoint returns:
  - tickSize
  - stepSize / qty precision
  - minQty / minNotional

## Required Endpoints (Spot)

### Public
- Symbols / exchange info:
  - GET /v4/public/symbol (confirm path)
- Ticker / mid price:
  - GET /v4/public/ticker (confirm)
- Orderbook (optional):
  - GET /v4/public/depth (confirm)

### Private
- Balances:
  - GET /v4/balance (confirm)
- Open orders:
  - GET /v4/order/open (confirm)
- Place order:
  - POST /v4/order (confirm)
  - Params: symbol, side, type, price, quantity, timeInForce, clientOrderId
- Cancel order:
  - POST /v4/order/cancel (confirm)
- Cancel all:
  - POST /v4/order/cancelAll (confirm)
- Trades / fills:
  - GET /v4/trade/history (confirm)

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

