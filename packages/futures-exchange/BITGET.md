# Bitget Futures Adapter

## Required env vars

- `BITGET_API_KEY` (private REST + private WS)
- `BITGET_API_SECRET` (private REST + private WS)
- `BITGET_API_PASSPHRASE` (private REST + private WS)
- `BITGET_PRODUCT_TYPE` (optional, default `USDT-FUTURES`)
- `BITGET_MARGIN_COIN` (optional, default `USDT`)

## REST signing

Headers used for private endpoints:

- `ACCESS-KEY`
- `ACCESS-SIGN`
- `ACCESS-TIMESTAMP`
- `ACCESS-PASSPHRASE`
- `Content-Type: application/json`

Prehash format:

`timestamp + METHOD + requestPath + (?queryString if present) + body`

Signature:

`base64(HMAC_SHA256(secretKey, prehash))`

## WebSocket

- Public URL: `wss://ws.bitget.com/v2/ws/public`
- Private URL: `wss://ws.bitget.com/v2/ws/private`
- Keepalive: send `ping` every 30s
- Private login sign format:
  - `base64(HMAC_SHA256(secretKey, timestamp + "GET" + "/user/verify"))`

## Reliability note

Private WS streams can lose messages. This adapter reconciles with REST after reconnect:

- pending orders
- open positions
- recent fills

## Smoke test

Run:

`npm -w @mm/futures-exchange run smoke:bitget`
