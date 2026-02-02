# CEX Preflight — Bitget (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.bitget.com/api-doc/common/intro

## Base URLs
- Base: https://api.bitget.com

## Auth (private endpoints)
- HMAC SHA256 + Base64 signature.
- Required headers:
  - ACCESS-KEY
  - ACCESS-SIGN
  - ACCESS-TIMESTAMP
  - ACCESS-PASSPHRASE
- Signature string: `<timestamp><method><requestPath><body>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: "BASEQUOTE" (e.g., "BTCUSDT") or "BASE/QUOTE" (confirm).
- Symbols endpoint returns:
  - priceScale / pricePrecision
  - quantityScale / basePrecision
  - minTradeAmount / minTradeUSDT

## Required Endpoints (Spot)

### Public
- Symbols / products:
  - GET /api/spot/v1/public/products (confirm)
- Ticker / mid price:
  - GET /api/spot/v1/market/ticker?symbol=BTCUSDT
- Orderbook (optional):
  - GET /api/spot/v1/market/depth?symbol=BTCUSDT&limit=50

### Private
- Balances:
  - GET /api/spot/v1/account/assets (confirm)
- Open orders:
  - GET /api/spot/v1/trade/open-orders?symbol=BTCUSDT
- Place order:
  - POST /api/spot/v1/trade/orders
  - Params: symbol, side, orderType, price, quantity, timeInForce, clientOrderId
- Cancel order:
  - POST /api/spot/v1/trade/cancel-order
- Cancel all:
  - POST /api/spot/v1/trade/cancel-batch (or cancelAll if available)
- Trades / fills:
  - GET /api/spot/v1/trade/fills?symbol=BTCUSDT

## ClientOrderId Support
- clientOrderId supported and returned (confirm field name).

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

