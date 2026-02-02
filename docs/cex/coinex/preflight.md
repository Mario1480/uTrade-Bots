# CEX Preflight — CoinEx (Spot v2)

Status: draft (needs validation against live responses)

## Docs / References
- API docs: https://docs.coinex.com/api/v2/

## Base URLs
- Base: https://api.coinex.com

## Auth (private endpoints)
- HMAC SHA256 signature.
- Required headers (v2):
  - X-COINEX-KEY
  - X-COINEX-SIGN
  - X-COINEX-TIMESTAMP (ms)
- Signature string: sorted query/body + timestamp (confirm exact spec).

## Rate Limits
- Per IP / per account limits (weights).
- 429 handling required.

## Symbols / Precision
- Symbol format: "BASEQUOTE" (e.g., "BTCUSDT") or "BASE/QUOTE" (confirm).
- Market endpoint should return:
  - min amount / min notional
  - price/amount precision

## Required Endpoints (Spot v2)

### Public
- Symbols / markets:
  - GET /v2/spot/market
- Ticker / mid price:
  - GET /v2/spot/ticker?market=BTCUSDT
- Orderbook (optional):
  - GET /v2/spot/order_book?market=BTCUSDT&limit=50

### Private
- Balances:
  - GET /v2/spot/balance
- Open orders:
  - GET /v2/spot/pending_order?market=BTCUSDT
- Place order:
  - POST /v2/spot/order
  - Params: market, side, amount, price, type, client_id (if supported)
- Cancel order:
  - POST /v2/spot/cancel_order
- Cancel all:
  - POST /v2/spot/cancel_all
- Trades / fills:
  - GET /v2/spot/user_trades?market=BTCUSDT

## ClientOrderId Support
- Verify if custom client_id is supported and returned.

## Time-in-force / Post-only
- Verify support for postOnly / timeInForce.

## Error Handling
- JSON error payload with code/message.
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm symbol format + precision fields
- [ ] Confirm open orders returns client_id or order_id
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior

