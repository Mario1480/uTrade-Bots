# CEX Preflight — XT (Spot)

Status: draft (needs validation against live responses)

## Docs / References
- API docs (spot): https://doc.xt.com/docs/spot/Access%20Description/BasicInformationOfTheInterface
- Signature instructions: https://doc.xt.com/docs/spot/Access%20Description/SignatureInstructions
- Signature generation: https://doc.xt.com/docs/spot/Access%20Description/SignatureGeneration
- Rate limits: https://doc.xt.com/docs/spot/Access%20Description/FrequencyLimitingRules
- Symbols/meta: https://doc.xt.com/docs/spot/Market/GetSymbolInformation
- Ticker: https://doc.xt.com/docs/spot/Market/FullTicker
- Orderbook: https://doc.xt.com/docs/spot/Market/GetDepthData
- Open orders: https://doc.xt.com/docs/spot/Order/QueryOpenOrders
- Cancel open orders: https://doc.xt.com/docs/spot/Order/CancelCurrentPendingOrder
- Submit order: https://doc.xt.com/docs/spot/Order/SubmitOrder
- Cancel order: https://doc.xt.com/docs/trading-third-party/Order/CancelOrder
- Trades (fills): https://doc.xt.com/docs/spot/Trade/QueryTrade
- Balances list: https://doc.xt.com/docs/trading-third-party/Balance/GetListOfCurrencyAssets

## Base URLs
- Base: https://sapi.xt.com citeturn0view0

## Auth (private endpoints)
- HMAC SHA256 signing.
- Required headers (named in docs as `validate-*`): citeturn1view3
  - `validate-algorithms`: `HmacSHA256` (recommended)
  - `validate-appkey`: API key
  - `validate-recvwindow`: recvWindow (ms)
  - `validate-timestamp`: timestamp (ms)
  - `validate-signature`: HMAC SHA256 signature
- Signature string construction: citeturn1view3
  - Build `Y = #method#path#query#body` (query sorted by key; body is raw JSON string if JSON).
  - Build `X` by sorting header keys (`validate-*`) and joining `key=value` with `&`.
  - `original = X + Y`, signature = HMAC SHA256(secret, original).
- Timestamp unit: milliseconds. citeturn1view2turn1view3
- recvWindow: docs say requests older than 5000ms are invalid and >5s not recommended, but examples show 60000; confirm actual limits. citeturn1view2turn1view3
- Note: For requests that do NOT start with `/public`, the request must be signed. citeturn0view0

## Rate Limits
- Per IP and per apiKey limits; 429 on exceed; IP or apiKey may be blocked. citeturn1view1
- Endpoint examples:
  - `/v4/public/symbol`: 10/s/ip citeturn11view1
  - `/v4/public/ticker`: 10/s/ip citeturn11view12
  - `/v4/public/depth`: 10/s/ip citeturn11view11
  - `/v4/open-order`: 10/s/apikey citeturn11view6
  - `/v4/open-order` (cancel): 10/s/apikey citeturn11view9
  - `/v4/order`: 20/s/apikey citeturn11view7
  - `/v4/balances`: 10/s/apikey citeturn11view10

## Symbols / Precision
- Symbol format in examples: lowercase with underscore, e.g. `btc_usdt`. citeturn11view12turn11view11
- Symbols endpoint: `GET /v4/public/symbol`. citeturn11view1
- Meta fields in response:
  - `pricePrecision`, `quantityPrecision`, `baseCurrencyPrecision`, `quoteCurrencyPrecision`. citeturn13view0
  - Filters array includes:
    - `PRICE` filter: `min`, `max`, `tickSize`. citeturn12view0turn13view2
    - `QUANTITY` filter: `min`, `max`, `tickSize`. citeturn12view0turn13view2
    - `QUOTE_QTY` filter: `min` (minNotional rules). citeturn12view0turn13view2
- timeInForces includes `GTX` (post-only). citeturn13view0

## Required Endpoints (Spot)

### Public
- Symbols / exchange info:
  - GET /v4/public/symbol citeturn11view1
- Ticker / mid price:
  - GET /v4/public/ticker citeturn11view12
- Orderbook (optional):
  - GET /v4/public/depth citeturn11view11

### Private
- Balances:
  - GET /v4/balances (list of assets) citeturn11view10
- Open orders:
  - GET /v4/open-order citeturn11view6
- Place order:
  - POST /v4/order citeturn11view7
  - Params: symbol, side, type, timeInForce, bizType, price, quantity, quoteQty, clientOrderId
- Cancel order:
  - DELETE /v4/order/{orderId} citeturn8search2
- Cancel all:
  - DELETE /v4/open-order (JSON body includes bizType, symbol, side) citeturn11view9
- Trades / fills:
  - GET /v4/trade citeturn11view8

**Path prefix note:** docs show private endpoints both as `/v4/...` and `/spot/v4/...` (e.g. balances list uses `/spot/v4/balances`, while order/open-order/trade examples use `/v4/...`). Confirm the correct prefix in live tests before coding. citeturn11view7turn11view6turn11view8turn11view10

## ClientOrderId Support
- `clientOrderId` supported in submit order; returned in open orders. citeturn11view7turn11view6

## Time-in-force / Post-only
- `timeInForce` supports GTC/FOK/IOC/GTX (GTX = post-only). citeturn13view0turn11view7

## Error Handling
- JSON error payload with `rc`/`mc` fields in responses (examples).
- 429 indicates rate limit (gateway/WAF). citeturn1view1

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm symbol format + precision fields
- [ ] Confirm open orders returns clientOrderId or order_id
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior
- [ ] Confirm correct private path prefix (`/v4` vs `/spot/v4`)
