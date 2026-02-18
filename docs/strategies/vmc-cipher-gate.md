# VMC Cipher Gate (Python Local Strategy)

## Zweck

`vmc_cipher_gate` nutzt `featureSnapshot.indicators.vumanchu` als deterministischen Entry-Gate:

- Richtungssignal aus VuManChu (`buy/sell`, optional `buyDiv/sellDiv`)
- Gold-Dot Block für Long (`goldNoBuyLong=true`)
- Freshness über Signal-Age-Bars
- Optionales Blocken bei `dataGap`

## Inputs

- `context.signal` (`up | down | neutral`)
- `featureSnapshot.indicators.vumanchu.waveTrend`
- `featureSnapshot.indicators.vumanchu.signals`
- `featureSnapshot.indicators.vumanchu.signals.ages`
- optional `featureSnapshot.riskFlags.dataGap`

## Default Config

```json
{
  "requireNonNeutralSignal": true,
  "blockOnDataGap": true,
  "maxSignalAgeBars": 4,
  "allowDivSignalAsPrimary": true,
  "minPassScore": 60
}
```

## Hard-Blocks (Reihenfolge)

1. `signal_missing_or_neutral`
2. `vmc_context_missing`
3. `vmc_data_gap`
4. `vmc_gold_dot_no_long`
5. `vmc_directional_signal_missing`
6. `vmc_signal_too_old`
7. `score_below_threshold`

Pass-Reason: `vmc_cipher_gate_pass`
