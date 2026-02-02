# CEX Preflight — WEEX (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.weex.com/api-doc/spot/introduction/APIBriefIntroduction

## Base URLs
- Base: https://api.weex.com (confirm from docs)

## Auth (private endpoints)
- Confirm signature scheme (usually HMAC + timestamp + recvWindow).
- Required headers / query:
  - API key header
  - Signature header or query param
  - Timestamp (ms)
- Record exact canonical string format from docs.

## Rate Limits
- Per IP / per account limits (confirm weights).
- 429 handling required.

## Symbols / Precision
- Symbol format in API (likely "BASE_QUOTE" or "BASE-QUOTE").
- Markets endpoint should return:
  - tickSize
  - stepSize / quantity precision
  - minQty / minNotional

## Required Endpoints (Spot)

### Public
- Symbols / markets:
  - GET /api/spot/v1/symbols (confirm exact path)
- Ticker / mid price:
  - GET /api/spot/v1/ticker (confirm)
- Orderbook (optional):
  - GET /api/spot/v1/depth (confirm)

### Private
- Balances:
  - GET/POST /api/spot/v1/account (confirm)
- Open orders:
  - GET/POST /api/spot/v1/openOrders (confirm)
- Place order:
  - POST /api/spot/v1/order (confirm)
  - Params: symbol, side, type, price, qty, timeInForce, clientOrderId
- Cancel order:
  - POST /api/spot/v1/cancelOrder (confirm)
- Cancel all:
  - POST /api/spot/v1/cancelAll (confirm)
- Trades / fills:
  - GET/POST /api/spot/v1/myTrades (confirm)

## ClientOrderId Support
- Verify if clientOrderId is supported and returned in open orders / trades.

## Time-in-force / Post-only
- Verify support for:
  - postOnly (maker only)
  - timeInForce values (GTC/IOC/FOK)

## Error Handling
- Confirm error payload shape (code/message).
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm markets response fields for tick/step/minNotional
- [ ] Confirm open orders returns clientOrderId or order_id
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

