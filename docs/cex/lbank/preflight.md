# CEX Preflight — LBank (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.lbank.com/docs/#introduction

## Base URLs
- Base: https://api.lbank.info (confirm from docs)

## Auth (private endpoints)
- Typically HMAC SHA256 signature.
- Required params (check docs):
  - api_key
  - timestamp
  - sign (HMAC over sorted params)

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format in API: "BASE_QUOTE" (e.g., "btc_usdt").
- Exchange info / symbols endpoint returns:
  - price precision
  - amount precision
  - minQty / minNotional

## Required Endpoints (Spot)

### Public
- Symbols / exchange info:
  - GET /v2/currencyPairs.do or /v2/ticker/24hr.do (confirm)
- Ticker / mid price:
  - GET /v2/ticker/24hr.do (confirm)
- Orderbook (optional):
  - GET /v2/depth.do (confirm)

### Private
- Balances:
  - POST /v2/user_info.do (confirm)
- Open orders:
  - POST /v2/orders_info.do or /v2/openOrders.do (confirm)
- Place order:
  - POST /v2/create_order.do (confirm)
  - Params: symbol, type, price, amount, (clientId?)
- Cancel order:
  - POST /v2/cancel_order.do (confirm)
- Cancel all:
  - POST /v2/cancel_all.do (confirm)
- Trades / fills:
  - POST /v2/orders_info.do or /v2/transaction_history.do (confirm)

## ClientOrderId Support
- Verify if custom client id is supported.

## Time-in-force / Post-only
- Verify support for postOnly or maker-only (if any).
- LBank may only support GTC for spot; confirm.

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

