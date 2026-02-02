# CEX Preflight — Gate.io (Spot API v4)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://www.gate.com/docs/developers/apiv4/en/

## Base URLs
- Base: https://api.gateio.ws
- API base: https://api.gateio.ws/api/v4

## Auth (private endpoints)
- HMAC SHA512 signature.
- Required headers:
  - KEY (API key)
  - SIGN (signature)
  - Timestamp (seconds)
- Signature string: `<method>\n<path>\n<query>\n<body>\n<timestamp>`

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: "BASE_QUOTE" (e.g., "BTC_USDT").
- Spot pairs endpoint returns:
  - min_quote_amount (minNotional)
  - min_base_amount (minQty)
  - amount_precision, precision

## Required Endpoints (Spot v4)

### Public
- Symbols / currency pairs:
  - GET /spot/currency_pairs
- Ticker / mid price:
  - GET /spot/tickers?currency_pair=BTC_USDT
- Orderbook (optional):
  - GET /spot/order_book?currency_pair=BTC_USDT&limit=50

### Private
- Balances:
  - GET /spot/accounts
- Open orders:
  - GET /spot/open_orders?currency_pair=BTC_USDT
- Place order:
  - POST /spot/orders
  - Params: currency_pair, side, type, price, amount, time_in_force, text (clientOrderId)
- Cancel order:
  - DELETE /spot/orders/{order_id}
- Cancel all:
  - DELETE /spot/orders?currency_pair=BTC_USDT
- Trades / fills:
  - GET /spot/my_trades?currency_pair=BTC_USDT

## ClientOrderId Support
- `text` field used as client order id, returned in responses.

## Time-in-force / Post-only
- time_in_force supports GTC/IOC/FOK.
- postOnly supported via `time_in_force=PO` (check docs).

## Error Handling
- JSON error payload with label/message.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm currency_pairs fields for tick/step/minNotional
- [ ] Confirm open orders returns `text` (client id)
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

