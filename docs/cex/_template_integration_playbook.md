# CEX Integration Playbook — TEMPLATE

Use this template to create per‑CEX integration playbooks.
Copy to: docs/cex/<cex>/integration-playbook.md

---

## 0) Inputs (from Preflight)
- Preflight file: `docs/cex/<cex>/preflight.md`
- Ensure all required fields are filled before coding.

## 1) Goals
- Implement public + private endpoints per exchange adapter requirements.
- Preserve clientOrderId.
- Enforce precision normalization and minNotional.
- Avoid auth headers on public endpoints.

## 2) Files to Create / Update
- `packages/exchange/src/<cex>/<cex>.client.ts`
- `packages/exchange/src/<cex>/index.ts`
- `packages/exchange/src/index.ts` (registry)
- `apps/api/src/index.ts` (symbols endpoint / manual trading)
- `apps/runner/src` (factory usage)

## 3) Implementation Steps
1. Implement REST client (auth NONE vs SIGNED).
2. Implement symbol list + meta mapping (tick/step/minNotional).
3. Implement balances, openOrders (clientOrderId required).
4. Implement place/cancel/cancelAll with normalization.
5. Implement getMyTrades (fills).
6. Wire registry + API endpoint.
7. Smoke test end‑to‑end.

## 4) Smoke Test Checklist
- [ ] public symbols list
- [ ] public mid (no auth)
- [ ] balances (signed)
- [ ] place limit post‑only + cancel
- [ ] openOrders shows clientOrderId
- [ ] manual order endpoint works
- [ ] getMyTrades returns fills

## 5) Notes / Risks
- Record any exchange‑specific quirks here.

