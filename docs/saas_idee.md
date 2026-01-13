Du kannst das ziemlich elegant lösen, ohne dass du gleich eine riesige Billing-Plattform bauen musst. Entscheidend ist: dein Runner läuft auf einem VPS des Users und muss regelmäßig prüfen, ob die Lizenz gültig ist. Das ist im Kern ein License Verification Service + lokales Enforcement.

Hier sind drei gute Designs (von simpel → robust). Für deinen Ansatz “jeder User bekommt eigenen VPS” passt am besten B.

⸻

A) Simpel: Lizenzkey = statischer Token (MVP, schnell)

Wie es funktioniert
	•	Du generierst einen zufälligen Key (z.B. mm_live_...), speicherst ihn in deiner SaaS-DB.
	•	Runner sendet Key an deinen License-Server: POST /license/verify
	•	Server antwortet: active: true/false, plan, expiresAt.
	•	Runner stoppt/pausiert Bots, wenn inaktiv.

Pro
	•	extrem schnell umzusetzen
	•	leicht zu supporten

Contra
	•	Key kann weitergegeben werden (re-sharing)
	•	ohne Device-Bindung schwer zu verhindern

⸻

B) Empfehlenswert: Lizenzkey + Device Bind (VPS “Fingerabdruck”)

Wie es funktioniert
	•	User bekommt Lizenzkey.
	•	Beim ersten Start auf dem VPS:
	1.	Runner erzeugt machineId (stable): z.B. hash aus /etc/machine-id (Linux) + hostname (oder Docker container ID, aber lieber host-level)
	2.	Runner “aktiviert” Lizenz: POST /license/activate { key, machineId }
	3.	License-Server speichert Binding: key → machineId (oder mehrere je Plan)
	•	Danach sendet Runner nur verify:
	•	POST /license/verify { key, machineId, version }
	•	Wenn key woanders genutzt wird → du blockst oder erlaubst X Aktivierungen je Plan.

Pro
	•	verhindert “Key wird 100× geteilt”
	•	passt perfekt zu “1 User = 1 VPS”
	•	simple server logic

Contra
	•	Machine-ID kann bei VPS Migration/Neuinstallation wechseln → du brauchst “Reset binding” im Admin UI

⸻

C) Am robustesten: Signed License Token (Offline Grace)

Wie es funktioniert
	•	Der License-Server gibt bei erfolgreichem Verify ein signiertes Token zurück (JWT oder eigenes Signed Payload), z.B. 24h gültig.
	•	Runner cached dieses Token lokal (license.cache.json)
	•	Wenn dein Server mal down ist: Runner läuft im Grace Period weiter (z.B. 24–72h)
	•	Nach Ablauf: Bot stoppt.

Pro
	•	extrem stabil im echten Betrieb
	•	Server-Ausfall killt nicht sofort Kunden

Contra
	•	etwas mehr Implementierung

⸻

Empfehlung für dich (praktisch & sauber)

👉 B + C kombiniert:
	•	Aktivierung bindet an VPS
	•	Verify gibt signiertes Token für 24h (Grace)
	•	Runner prüft alle 30–60 Minuten

Das ist professionell, aber noch nicht overkill.

⸻

Konkretes API-Design (License Server)

1) Activate (einmalig)

POST /license/activate

Body:

{
  "licenseKey": "mm_live_xxx",
  "machineId": "sha256:abc...",
  "label": "my-vps-1"
}

Response:

{
  "ok": true,
  "activationId": "act_123",
  "expiresAt": "2026-02-01T00:00:00Z",
  "plan": "pro"
}

2) Verify (regelmäßig)

POST /license/verify

Body:

{
  "licenseKey": "mm_live_xxx",
  "machineId": "sha256:abc...",
  "appVersion": "0.3.1"
}

Response:

{
  "active": true,
  "expiresAt": "2026-02-01T00:00:00Z",
  "plan": "pro",
  "graceToken": "<signed-token-valid-24h>"
}

3) Optional: Heartbeat (Monitoring)

POST /license/heartbeat
	•	nimmt runtime info, lastSeen

⸻

Datenmodell (SaaS DB)
	•	License
	•	key
	•	status (active/cancelled)
	•	plan
	•	expiresAt
	•	maxActivations
	•	Activation
	•	licenseKey
	•	machineId
	•	createdAt
	•	lastSeenAt
	•	revokedAt

Optional:
	•	Subscription (wenn du Stripe später einbindest)

⸻

Runner Enforcement (was passiert bei invalid)

Du willst eine klare Regel:
	1.	Wenn verify ok → normal laufen
	2.	Wenn verify fail → PAUSE (nicht STOP), damit kein Chaos
	3.	Grace-Token noch gültig → weiterlaufen, aber warnen
	4.	Grace abgelaufen → pause bots + alert

Wichtig: Der Runner sollte nicht “crashen”, sondern sauber “PAUSED (license)” setzen.

⸻

Webseite / Admin UI (minimal)

Fürs MVP reicht:
	•	Admin: Lizenz erstellen (Plan, Laufzeit, maxActivations)
	•	User: Lizenz sehen + Reset Activation (oder Support macht es)

Später:
	•	Stripe Customer Portal → expiresAt wird durch Webhook aktualisiert

⸻

Sicherheitsdetails (wichtig, aber nicht kompliziert)
	•	License Key niemals im Klartext loggen
	•	machineId als hash speichern
	•	Rate limit auf verify endpoint
	•	Signierte Tokens mit Server Secret (HMAC) oder Public/Private (Ed25519)
	•	GraceToken enthält:
	•	licenseKey hash
	•	machineId hash
	•	exp
	•	plan

⸻

Genau passend zu deinem Setup “VPS pro User”

Dein Runner auf dem VPS prüft:
	•	LICENSE_KEY ENV
	•	LICENSE_SERVER_URL ENV

Beispiel:

LICENSE_KEY=mm_live_xxx
LICENSE_SERVER_URL=https://license.deinedomain.com

Runner:
	•	activate beim ersten Start (wenn keine activation cached)
	•	verify alle 30–60 Min
	•	cached grace token in /data/license.cache.json

⸻

Wenn du willst, mache ich dir daraus ein komplettes MVP-Konzept als Tickets

Sag mir nur:
	•	Willst du den License-Server als separate kleine Node-App (empfohlen)
oder in dein bestehendes apps/api integrieren?

Wenn du “separate” sagst, gebe ich dir direkt:
	•	Ordnerstruktur
	•	Prisma schema
	•	Endpoints
	•	Runner integration (license guard)
	•	Admin UI Minimal (create license / reset activation)