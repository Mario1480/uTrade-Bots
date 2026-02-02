# CEX Preflight — Bybit (Spot v5)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://bybit-exchange.github.io/docs/v5/guide

## Base URLs
- Base: https://api.bybit.com

## Auth (private endpoints)
- HMAC SHA256 signature (bybit signature).
- Required headers:
  - X-BAPI-API-KEY
  - X-BAPI-SIGN
  - X-BAPI-TIMESTAMP
  - X-BAPI-RECV-WINDOW
  - (optional) X-BAPI-SIGN-TYPE
- Signature string: `<timestamp><apiKey><recvWindow><queryStringOrBody>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: "BASEQUOTE" (e.g., "BTCUSDT").
- Instruments endpoint returns:
  - priceFilter.tickSize
  - lotSizeFilter.minOrderQty / qtyStep
  - minNotional (if provided)

## Required Endpoints (Spot v5)

### Public
- Symbols / instruments:
  - GET /v5/market/instruments-info?category=spot
- Ticker / mid price:
  - GET /v5/market/tickers?category=spot&symbol=BTCUSDT
- Orderbook (optional):
  - GET /v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=50

### Private
- Balances:
  - GET /v5/account/wallet-balance?accountType=SPOT
- Open orders:
  - GET /v5/order/realtime?category=spot&symbol=BTCUSDT
- Place order:
  - POST /v5/order/create
  - Params: category=spot, symbol, side, orderType, price, qty, timeInForce, orderLinkId
- Cancel order:
  - POST /v5/order/cancel
  - Params: category=spot, symbol, orderId (or orderLinkId)
- Cancel all:
  - POST /v5/order/cancel-all?category=spot&symbol=...
- Trades / fills:
  - GET /v5/execution/list?category=spot&symbol=...

## ClientOrderId Support
- orderLinkId supported and returned.

## Time-in-force / Post-only
- timeInForce supports GTC/IOC/FOK (spot).
- postOnly support: check orderType = "LIMIT_MAKER" or postOnly flag.

## Error Handling
- JSON error payload with retCode/retMsg.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm instruments info fields for tick/step/minNotional
- [ ] Confirm open orders returns orderLinkId
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

