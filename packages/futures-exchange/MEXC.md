# MEXC Futures Adapter

## Required env vars

- `MEXC_API_KEY` (private endpoints / private WS)
- `MEXC_API_SECRET` (private endpoints / private WS)
- `MEXC_REST_BASE_URL` (optional, default `https://api.mexc.com`)
- `MEXC_WS_URL` (optional, default `wss://contract.mexc.com/edge`)

## Notes

- Private REST auth headers: `ApiKey`, `Request-Time`, `Signature`, optional `Recv-Window`.
- Signature string format: `accessKey + timestamp + parameterString` (HMAC-SHA256).
- Private WS login uses:
  - `method: "login"`
  - `param: { apiKey, reqTime, signature }`

## Capabilities / maintenance-safe mode

Some order endpoints are known to be maintenance-prone in MEXC docs.
By default this adapter keeps those capabilities disabled:

- `placeOrder`
- `batchPlaceOrder`
- `cancelOrder`
- `cancelWithExternal`
- `cancelAll`
- `planOrders`
- `stopOrders`

You can enable them explicitly via adapter config `capabilities`.

## Security recommendations

- Never log API keys, signatures, or raw secret material.
- Use key permissions scoped only to required actions.
- Use exchange IP whitelist for API keys whenever possible.
