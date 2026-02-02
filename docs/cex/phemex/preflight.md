# CEX Preflight — Phemex (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://phemex-docs.github.io/#overview

## Base URLs
- Base: https://api.phemex.com

## Auth (private endpoints)
- HMAC SHA256 signature.
- Required headers:
  - x-phemex-access-token (API key)
  - x-phemex-request-expiry
  - x-phemex-request-signature
- Signature string typically: `<method><path><expiry><body>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format in API: e.g., "sBTCUSDT" or "BTCUSDT" (spot differs; confirm).
- Exchange info endpoint returns:
  - tickSize
  - lotSize / qty precision
  - minQty / minNotional

## Required Endpoints (Spot)

### Public
- Symbols / exchange info:
  - GET /exchange/public/products (confirm for spot)
- Ticker / mid price:
  - GET /md/v2/ticker/24hr (confirm)
- Orderbook (optional):
  - GET /md/v2/orderbook (confirm)

### Private
- Balances:
  - GET /spot/assets (confirm)
- Open orders:
  - GET /spot/orders/active (confirm)
- Place order:
  - POST /spot/orders (confirm)
  - Params: symbol, side, orderType, price, qty, timeInForce, clientOrderId
- Cancel order:
  - DELETE /spot/orders/active (confirm)
- Cancel all:
  - DELETE /spot/orders/all (confirm)
- Trades / fills:
  - GET /spot/trades (confirm)

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

