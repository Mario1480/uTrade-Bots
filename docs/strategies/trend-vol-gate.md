# Trend+Vol Gate (Python Local Strategy)

## Zweck

`trend_vol_gate` ist eine deterministische Local-Strategie (Python Sidecar), die Signale nur dann durchlässt, wenn:

- Regime und Confidence passen
- EMA-Stack und Slope zum Signal passen
- Preisabstand zu EMA50/EMA200 ausreichend ist
- kein Volatilitäts-/Liquidity-Risiko aktiv ist

Empfohlener Start: `shadowMode=true` mit TS-Fallback (`signal_filter`), danach schrittweise auf Enforce umstellen.

## Verwendete Inputs

Aus `context`:

- `signal` (`up | down | neutral`)

Aus `featureSnapshot`:

- `historyContext.reg.state`
- `historyContext.reg.conf`
- `historyContext.ema.stk`
- `historyContext.ema.d50`
- `historyContext.ema.d200`
- `historyContext.ema.sl50`
- `historyContext.vol.z`
- `historyContext.vol.rv`
- optional `riskFlags.dataGap`

## Default Config

```json
{
  "allowedStates": ["trend_up", "trend_down"],
  "minRegimeConf": 55,
  "requireStackAlignment": true,
  "requireSlopeAlignment": true,
  "minAbsD50Pct": 0.12,
  "minAbsD200Pct": 0.20,
  "maxVolZ": 2.5,
  "maxRelVol": 1.8,
  "minVolZ": -1.2,
  "minRelVol": 0.6,
  "minPassScore": 70,
  "allowNeutralSignal": false
}
```

## Entscheidungslogik (Reihenfolge)

Hard-Blocks:

1. `signal_missing_or_neutral`
2. `regime_state_not_allowed`
3. `regime_confidence_low`
4. `ema_stack_conflict`
5. `ema_slope_conflict`
6. `distance_too_small`
7. `vol_spike_risk`
8. `low_liquidity_risk`
9. `score_below_threshold`

Wenn alle Checks passen, wird `trend_vol_gate_pass` gesetzt.

## Score

`score` ist `0..100` (integer):

- Basis: `0.6 * reg.conf`
- +20 wenn Stack aligned
- +10 wenn Slope aligned
- +10 wenn Distanzfilter ok
- +10 wenn Vol/Liquidity ok

Danach Clamp auf `0..100`.

## Tags

- `trend_up` oder `trend_down` aus Regime
- `range_bound` bei `range/transition`
- `high_vol` wenn `z >= 1.5`
- `low_liquidity` bei Liquidity-Block
- `data_gap` wenn `riskFlags.dataGap=true`

## Output

Die Strategie liefert:

- `allow` (boolean)
- `score` (0..100)
- `reasonCodes` (deterministisch)
- `tags`
- `explanation` (kurz, faktenbasiert)
- `meta` (diagnostische Felder wie `stackAligned`, `distanceOk`, `volSpikeRisk`)

Null-Safety:

- Kein `NaN`/`Infinity` im Output
- Fehlende numerische Inputs werden defensiv behandelt

## Admin Setup (empfohlen)

Für den Start in `/admin/strategies/local`:

- `engine = python`
- `strategyType = trend_vol_gate`
- `remoteStrategyType = trend_vol_gate`
- `fallbackStrategyType = signal_filter`
- `shadowMode = true`
- `timeoutMs = 1200`

Danach Kalibrierung über `pythonDecision` vs. `effectiveDecision`.

## Umstellung auf Enforce (empfohlener Ablauf)

### Phase A: Shadow-Kalibrierung (3 Tage)

Scope:

- `BTCUSDT` auf `15m` und `1h`
- `shadowMode = true`

Monitoring:

- Anteil `pythonDecision.allow=true`
- Divergenz zwischen `pythonDecision` und `effectiveDecision`
- Häufigste `reasonCodes` (z. B. `ema_stack_conflict`, `vol_spike_risk`)
- Circuit-Breaker- und Timeout-Ereignisse (`cb_open`, `timeout`)

Ziel:

- stabile Laufzeit ohne häufige Sidecar-Ausfälle
- nachvollziehbare, wiederkehrende Decision-Pattern

### Phase B: Teil-Enforce (2 Tage)

Umstellung:

- Nur `BTCUSDT 15m` auf `shadowMode = false`
- `BTCUSDT 1h` bleibt weiter in Shadow

Monitoring:

- Fehlerrate nach Enforce
- Veränderung der Signal-Qualität gegenüber Shadow-Phase
- Fallback-Nutzung (sollte deutlich sinken)

### Phase C: Voll-Enforce

Umstellung:

- `BTCUSDT 15m` und `1h` auf `shadowMode = false`
- Danach schrittweise weitere Symbole/TF freischalten

## Enforce-Checkliste

Vor dem Umschalten auf `shadowMode=false`:

- `PY_STRATEGY_ENABLED=true`
- Python-Registry zeigt `trend_vol_gate`
- Timeouts selten und Circuit Breaker nicht dauerhaft offen
- Strategie-Config final bestätigt (insb. `minRegimeConf`, `minPassScore`, Vol-Grenzen)
- TS-Fallback bleibt gesetzt (`fallbackStrategyType=signal_filter`) für Safe Recovery

## Rollback-Plan

Wenn nach Enforce Instabilität oder unerwartete Decisions auftreten:

1. Sofort `shadowMode=true` setzen
2. `reasonCodes`/`meta` aus betroffenen Runs prüfen
3. Config enger stellen (z. B. `minPassScore` hoch, `maxVolZ` runter)
4. Erneut mindestens 24h Shadow beobachten, dann neuer Enforce-Versuch
