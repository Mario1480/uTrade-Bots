# CEX Preflight — P2B (P2PB2B)

Status: draft (needs validation against live responses)

## Docs / References
- API docs hub: https://p2pb2b.zendesk.com/hc/en-us/sections/10222008005405-API
- API spec (GitHub): https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md

## Base URLs
- Base: https://api.p2pb2b.io

## Auth (private endpoints)
- Headers:
  - X-TXC-APIKEY: <apiKey>
  - X-TXC-PAYLOAD: base64(jsonPayload)
  - X-TXC-SIGNATURE: HMAC_SHA512(secret, base64Payload)
- Payload fields (JSON):
  - request: "<path>" (e.g., "/api/v2/account/balances")
  - nonce: <number> (ms or monotonic)
  - plus endpoint-specific params

Notes:
- HMAC uses secret key.
- Payload is base64-encoded JSON string.

## Rate Limits
- Public: ~10 requests/sec (per IP, per docs)
- Private: ~10 requests/sec (per account)
- 429 on limit; may require backoff.

## Symbols / Precision
- Symbol format in API: "BASE_QUOTE" (e.g., "BTC_USDT")
- Canonical format in app: "BASE/QUOTE"
- Precision / limits:
  - Markets endpoint returns:
    - "min_amount", "min_price", "min_total"
    - "amount_precision", "price_precision"

## Required Endpoints (Spot)

### Public
- Symbols / markets:
  - GET /api/v2/public/markets
  - Use to build symbol list + meta (tick/step/minNotional).
- Ticker / mid price:
  - GET /api/v2/public/ticker?market=BASE_QUOTE
  - Use bid/ask or last.
- Orderbook (optional):
  - GET /api/v2/public/book?market=BASE_QUOTE&side=buy|sell&offset=0&limit=50

### Private
- Balances:
  - POST /api/v2/account/balances
- Open orders:
  - POST /api/v2/orders
  - Params: market, offset, limit (docs)
- Place order:
  - POST /api/v2/order/new
  - Params: market, side, amount, price, type=limit|market, time_in_force (if supported)
- Cancel order:
  - POST /api/v2/order/cancel
  - Params: order_id
- Cancel all:
  - POST /api/v2/order/cancel
  - Params: market (if supported) or loop open orders
- Trades / fills:
  - POST /api/v2/account/trades
  - Params: market, offset, limit, (optional) date range

## ClientOrderId Support
- Check if order placement supports clientOrderId.
  - If not, we must map to exchange order_id on response.

## Time-in-force / Post-only
- Verify support for:
  - postOnly (maker only)
  - time_in_force values (GTC/IOC/FOK)
  - If unsupported, enforce maker behavior via price placement rules.

## Error Handling
- Non-200 responses include JSON error payload.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm markets response fields for tick/step/minNotional
- [ ] Confirm open orders returns clientOrderId or order_id
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

