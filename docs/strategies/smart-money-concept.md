# Smart Money Concept (Python Local Strategy)

## Zweck

`smart_money_concept` ist eine deterministische Local-Strategie (Python Sidecar) mit Fokus auf:

- Marktstruktur (BOS/CHoCH Direction)
- Trend-Bias (bullish/bearish)
- Premium/Discount/Equilibrium-Zonen

Die Strategie arbeitet bewusst fail-closed bei fehlendem SMC-Kontext oder `dataGap`.

## Verwendete Inputs

Aus `context`:

- `signal` (`up | down | neutral`)

Aus `featureSnapshot`:

- `advancedIndicators.smartMoneyConcepts`
  - `internal.trend`, `internal.lastEvent`
  - `swing.trend`, `swing.lastEvent`
  - `zones.discount*`, `zones.equilibrium*`, `zones.premium*`
  - `orderBlocks.*.bullishCount/bearishCount`
  - `fairValueGaps.bullishCount/bearishCount`
  - `dataGap`
- `historyContext.lastBars.ohlc` (close/time for zone + event-age)
- optional `riskFlags.dataGap`

## Default Config (Balanced)

```json
{
  "requireNonNeutralSignal": true,
  "blockOnDataGap": true,
  "requireTrendAlignment": true,
  "requireStructureAlignment": true,
  "requireZoneAlignment": true,
  "allowEquilibriumZone": true,
  "maxEventAgeBars": 120,
  "minPassScore": 65
}
```

## Entscheidungslogik

Hard-Blocks (fixe Reihenfolge):

1. `signal_missing_or_neutral`
2. `smc_context_missing`
3. `smc_data_gap`
4. `smc_trend_conflict`
5. `smc_structure_conflict`
6. `smc_zone_not_favorable`
7. `score_below_threshold`

Pass-Reason:

- `smc_structure_zone_pass`

## Score

`score` ist `0..100` (integer, clamp):

- Trend alignment: `40%`
- Structure alignment: `35%`
- Zone alignment: `25%`
- Bonus `+0..10` aus OB/FVG Alignment (kein Hard-Block)

## Tags

- Richtung: `smc_up` / `smc_down`
- Zone: `zone_discount` / `zone_equilibrium` / `zone_premium`
- Trend: `smc_bullish` / `smc_bearish`
- Risiko: `data_gap`

## Meta

Die Strategie liefert diagnostische Felder für:

- Trend-Quelle und Alignment
- Struktur-Event inkl. Event-Age in Bars
- Zone-Bucket und Favorability
- Score-Komponenten + Bonus
- OB/FVG Counts und Alignment
- DataGap-Status

## Empfohlener Rollout (Shadow -> Enforce)

1. Start mit `shadowMode=true` und TS-Fallback `signal_filter`.
2. Divergenz zwischen `pythonDecision` und `effectiveDecision` beobachten.
3. Reason-Code-Verteilung kalibrieren.
4. Schrittweise auf `shadowMode=false` umstellen.

## API Payload Templates

### 1) Local Strategy anlegen

`POST /admin/local-strategies`

```json
{
  "strategyType": "smart_money_concept",
  "engine": "python",
  "shadowMode": true,
  "remoteStrategyType": "smart_money_concept",
  "fallbackStrategyType": "signal_filter",
  "timeoutMs": 1200,
  "name": "SMC Gate (Shadow)",
  "description": "SMC structure + zones gate in shadow mode.",
  "version": "1.0.0",
  "configJson": {
    "requireNonNeutralSignal": true,
    "blockOnDataGap": true,
    "requireTrendAlignment": true,
    "requireStructureAlignment": true,
    "requireZoneAlignment": true,
    "allowEquilibriumZone": true,
    "maxEventAgeBars": 120,
    "minPassScore": 65
  },
  "isEnabled": true
}
```

### 2) Composite Strategy anlegen (Local Signal + AI Explain)

`POST /admin/composite-strategies`

```json
{
  "name": "SMC + AI Explain",
  "description": "Local SMC gate controls signal, AI adds explanation.",
  "version": "1.0.0",
  "nodesJson": [
    { "id": "n1", "kind": "local", "refId": "<smc_local_strategy_id>" },
    { "id": "n2", "kind": "ai", "refId": "<ai_prompt_template_id>" }
  ],
  "edgesJson": [
    { "from": "n1", "to": "n2", "rule": "if_signal_not_neutral" }
  ],
  "combineMode": "pipeline",
  "outputPolicy": "local_signal_ai_explain",
  "isEnabled": true
}
```

### 3) Composite Dry-Run

`POST /admin/composite-strategies/:id/dry-run`

```json
{
  "predictionId": "<prediction_id>"
}
```
