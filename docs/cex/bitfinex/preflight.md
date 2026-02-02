# CEX Preflight — Bitfinex (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs (public): https://docs.bitfinex.com/docs/rest-public
- API docs (auth): https://docs.bitfinex.com/docs/rest-auth

## Base URLs
- Base: https://api.bitfinex.com
- API base: https://api.bitfinex.com/v2

## Auth (private endpoints)
- HMAC SHA384 signature.
- Required headers:
  - bfx-apikey
  - bfx-signature
  - bfx-nonce
- Signature string: `/api/<path><nonce><body>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: "tBASEQUOTE" (e.g., "tBTCUSD") for v2.
- Symbols details endpoint returns:
  - price_precision
  - min_order_size
  - max_order_size

## Required Endpoints (Spot)

### Public
- Symbols:
  - GET /v2/tickers?symbols=ALL
  - GET /v2/conf/pub:info:pair
- Ticker / mid price:
  - GET /v2/ticker/tBTCUSD
- Orderbook (optional):
  - GET /v2/book/tBTCUSD/P0?len=50

### Private
- Balances:
  - POST /v2/auth/r/wallets
- Open orders:
  - POST /v2/auth/r/orders
- Place order:
  - POST /v2/auth/w/order/submit
  - Params: type, symbol, price, amount, cid (clientOrderId)
- Cancel order:
  - POST /v2/auth/w/order/cancel
- Cancel all:
  - POST /v2/auth/w/order/cancel/multi (or loop)
- Trades / fills:
  - POST /v2/auth/r/trades/hist

## ClientOrderId Support
- cid supported and returned.

## Time-in-force / Post-only
- Post-only: use `type=LIMIT` + `flags=4096` (post-only) (confirm).
- timeInForce not explicit; Bitfinex uses flags/types.

## Error Handling
- JSON error payload with code/msg.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm symbols fields for precision/min sizes
- [ ] Confirm open orders returns cid
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

