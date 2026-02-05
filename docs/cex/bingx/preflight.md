# CEX Preflight — BingX (Spot v3)

Status: draft (no private fills endpoint; historyOrders used as workaround)

## Docs / References
- Spot trading symbols: https://bingx-api.github.io/docs-v3/#/en/Spot/Market%20Data/Spot%20trading%20symbols
- Signature authentication: https://bingx-api.github.io/docs-v3/#/en/Quick%20Start/Signature%20Authentication
- Symbol price ticker: https://bingx-api.github.io/docs-v3/#/en/Spot/Market%20Data/Symbol%20Price%20Ticker

## Base URLs
- Base (PROD): https://open-api.bingx.com
- Base (VST): https://open-api-vst.bingx.com

## Auth (private endpoints)
- HMAC SHA256 signing with query string.
- Required headers / query:
  - `X-BX-APIKEY` header
  - `timestamp` (ms)
  - `recvWindow` (ms) — docs list as required (confirm for each endpoint)
  - `signature` (HMAC SHA256 of the sorted query string)
- Signing details (from doc example):
  - Sort params by key.
  - Build `paramsStr` as `k=v&...` and append `timestamp`.
  - Signature = HMAC_SHA256(secret, paramsStr), hex.
  - Request URL: `?{urlParamsStr}&signature={sig}`
  - Example request uses `X-BX-APIKEY` even for public symbols (confirm if required for public).

## Rate Limits
- IP rate limit: 500 requests / 10 seconds (symbols endpoint).
- 429 handling required.

## Symbols / Precision
- Symbol format in API: "BASE-QUOTE" (e.g., `BTC-USDT`).
- Symbols endpoint: `GET /openApi/spot/v1/common/symbols`
  - Fields: `tickSize`, `stepSize`, `minNotional`, `maxNotional`, `maxMarketNotional`, `status`, `apiStateBuy`, `apiStateSell`, `timeOnline`, `offTime`, `maintainTime`, `displayName`.
  - `minQty`/`maxQty` are deprecated; calculate via notional / price.

## Required Endpoints (Spot v3)

### Public
- Symbols / exchange info:
  - GET /openApi/spot/v1/common/symbols
- Ticker / mid price:
  - GET /openApi/spot/v1/ticker/bookTicker
  - Params: symbol (required)
  - Response: bidPrice/bidVolume, askPrice/askVolume
- Orderbook (optional):
  - GET /openApi/spot/v1/market/depth
  - Params: symbol (required), limit (default 20, max 1000)
  - Response: bids/asks arrays [price, qty], ts (ms)
- Recent trades (public):
  - GET /openApi/spot/v1/market/trades
  - Params: symbol (required), limit (default 100, max 500)

### Private
- Balances:
  - GET /openApi/spot/v1/account/balance
  - Params: recvWindow (optional), timestamp (required)
  - Response: balances[] with { asset, free, locked }
- Open orders:
  - GET /openApi/spot/v1/trade/openOrders
  - Params: symbol (optional), recvWindow, timestamp
  - Response: orders[] with orderId, price, origQty, executedQty, cummulativeQuoteQty, status, type, side, time, updateTime
- Query order details:
  - GET /openApi/spot/v1/trade/query
  - Params: symbol (required), orderId or clientOrderID, recvWindow, timestamp
  - Response includes executedQty, avgPrice, fee, feeAsset, status, time, updateTime
- Place order:
  - POST /openApi/spot/v1/trade/order
  - Params:
    - symbol (e.g. BTC-USDT)
    - side: BUY/SELL
    - type: MARKET/LIMIT/TAKE_STOP_LIMIT/TAKE_STOP_MARKET/TRIGGER_LIMIT/TRIGGER_MARKET
    - stopPrice (required for stop/trigger types)
    - quantity or quoteOrderQty (quantity takes priority)
    - price (required for LIMIT types)
    - newClientOrderId (1–40 chars, letters/numbers/_)
    - timeInForce: PostOnly/GTC/IOC/FOK
    - recvWindow (ms)
    - timestamp (ms)
  - Notes:
    - Market BUY requires quoteOrderQty; Market SELL requires quantity.
    - For copy-trading spot traders, SELL may require a different endpoint.
- Cancel order:
  - POST /openApi/spot/v1/trade/cancel
  - Params: symbol, orderId or clientOrderID, cancelRestrictions (optional), recvWindow, timestamp
- Cancel all:
  - POST /openApi/spot/v1/trade/cancelOpenOrders
  - Params: symbol (optional), recvWindow, timestamp
  - Response: order fields (same shape as cancel order)
- Trades / fills:
  - Order history (NOT fills):
    - GET /openApi/spot/v1/trade/historyOrders
    - Params: symbol, orderId (>=), startTime, endTime, pageIndex, pageSize (<=100), status, type, recvWindow, timestamp
    - Pagination: pageIndex/pageSize with cap pageIndex*pageSize <= 10,000
  - **No private fills/myTrades endpoint found.**
    - Workaround: use historyOrders to synthesize pseudo-trades (volume counter is approximate).

## ClientOrderId Support
- newClientOrderId supported on place order.
- Open orders response example does not show clientOrderID (confirm if available).

## Time-in-force / Post-only
- TBD (confirm post-only + TIF values)

## Error Handling
- JSON error payload with code/msg (confirm exact fields).
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [ ] Confirm auth signing with live test request
- [ ] Confirm symbol format + precision fields
- [ ] Confirm open orders returns clientOrderId or order_id
- [ ] Confirm order placement parameters & response
- [ ] Confirm trade history includes order_id + timestamp
- [ ] Confirm rate limits + ban behavior
