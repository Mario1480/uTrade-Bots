# CEX Integration Checklist

Diese Checkliste wird **für jede neue CEX** einmal vollständig durchgegangen,
bevor sie als „einsatzbereit“ gilt.

---

## 1. Architektur & Registry

- [ ] Neues Verzeichnis angelegt: `packages/exchange/src/<cex>/`
- [ ] `<cex>.client.ts` vorhanden
- [ ] `index.ts` exportiert Client korrekt
- [ ] Exchange in Registry / Factory registriert
- [ ] Config Loader unterstützt `<cex>` (API Key / Secret / Memo)

---

## 2. Public Endpoints (ohne Auth!)

**WICHTIG:** Keine API-Key Header bei Public Calls

- [ ] `listSymbols()` / `getSymbols()` implementiert
- [ ] Symbol Meta korrekt:
  - [ ] tickSize
  - [ ] stepSize
  - [ ] minQty
  - [ ] minNotional
- [ ] Mid-Price / Orderbook abrufbar
- [ ] Kein `X-API-KEY` / `X-BM-KEY` bei Public Calls
- [ ] Keine 403 bei Symbol- oder Preisabfragen

---

## 3. Private Endpoints (Auth korrekt)

- [ ] Auth-Modus korrekt gewählt:
  - [ ] SIGNED (HMAC + timestamp) falls erforderlich
  - [ ] recvWindow / nonce korrekt
- [ ] `getBalances()` funktioniert
  - [ ] Free Base Asset korrekt
  - [ ] Free Quote Asset korrekt
- [ ] `getOpenOrders(symbol)` funktioniert
  - [ ] clientOrderId enthalten
  - [ ] side / price / qty korrekt
- [ ] Secrets werden **nicht** geloggt

---

## 4. Order Handling

- [ ] `placeOrder()`:
  - [ ] LIMIT Orders
  - [ ] Post-Only unterstützt (oder sauber emuliert)
  - [ ] MARKET Orders nur wenn bewusst genutzt
- [ ] clientOrderId wird **exakt** zurückgegeben
- [ ] clientOrderId Prefix:
  - [ ] `mm-` für Market Making
  - [ ] `vol<timestamp>` für Volume
- [ ] `cancelOrder()` funktioniert
- [ ] `cancelAll(symbol)` funktioniert

---

## 5. Precision & Normalisierung

- [ ] Preise werden auf tickSize normalisiert
- [ ] Mengen werden auf stepSize normalisiert
- [ ] minQty wird eingehalten
- [ ] minNotional (price * qty) wird eingehalten
- [ ] Keine Order Rejects wegen Precision

---

## 6. Trades / Fills (kritisch!)

- [ ] `getMyTrades()` implementiert
- [ ] Nutzt bevorzugt time-based Pagination (startTime / endTime)
- [ ] Liefert:
  - [ ] tradeId (unique)
  - [ ] clientOrderId (falls verfügbar)
  - [ ] orderId
  - [ ] price
  - [ ] qty
  - [ ] notional
  - [ ] timestamp (ms)
- [ ] SIGNED Auth bei Trades Endpoint
- [ ] Fill-basierter Volume Counter funktioniert
- [ ] Keine Doppelzählung (BotFillSeen greift)

---

## 7. Runner Integration

- [ ] Runner kann Exchange instanziieren
- [ ] Runtime zeigt:
  - [ ] mid
  - [ ] bid / ask
  - [ ] balances
  - [ ] openOrders
- [ ] MM Orders erscheinen als `openOrdersMm`
- [ ] Volume Orders erscheinen als `openOrdersVol`
- [ ] tradedNotionalToday steigt **nur bei echten Fills**

---

## 8. Web UI Checks

- [ ] Symbol auswählbar beim Bot Create
- [ ] Bot lässt sich starten
- [ ] Runtime aktualisiert sich
- [ ] Orderbook Preview funktioniert (kein Exchange Call nötig)
- [ ] Alerts funktionieren (Error / Risk)

---

## 9. Stability / Safety

- [ ] Rate-Limit Handling (429 / 5xx Retry oder Backoff)
- [ ] Keine unhandled promise rejections
- [ ] Fehler werden verständlich geloggt
- [ ] Runner crasht nicht bei Exchange Errors

---

## 10. Finaler Smoke Test (Pflicht)

- [ ] Bot erstellen (neue CEX)
- [ ] MM starten → Orders erscheinen
- [ ] Volume starten → Orders erscheinen
- [ ] Mindestens 1 echter Fill
- [ ] tradedNotionalToday steigt korrekt
- [ ] Runner Neustart → Counter bleibt korrekt
- [ ] cancelAll funktioniert sauber

---

## Ergebnis

- [ ] CEX ist **PRODUCTION-READY**
- [ ] CEX ist **EXPERIMENTAL** (nur intern)
- [ ] CEX ist **BLOCKED** (nicht freigeben)

Notizen: