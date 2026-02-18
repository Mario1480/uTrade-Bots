# VMC Divergence Reversal (Python Local Strategy)

## Zweck

`vmc_divergence_reversal` fokussiert auf bestätigte VuManChu-Divergenz-Reversals:

- Regular Divergence (default Pflicht)
- Optional Hidden Divergence
- Cross-Alignment (`crossUp/crossDown`)
- Extremzonen-Filter (`oversold/overbought`)
- Gold-Dot Block für Long

## Inputs

- `context.signal` (`up | down | neutral`)
- `featureSnapshot.indicators.vumanchu.divergences`
- `featureSnapshot.indicators.vumanchu.waveTrend`
- `featureSnapshot.indicators.vumanchu.signals.goldNoBuyLong`
- optional `featureSnapshot.riskFlags.dataGap`

## Default Config

```json
{
  "requireNonNeutralSignal": true,
  "blockOnDataGap": true,
  "requireRegularDiv": true,
  "allowHiddenDiv": false,
  "requireCrossAlignment": true,
  "requireExtremeZone": true,
  "maxDivergenceAgeBars": 8,
  "minPassScore": 65
}
```

## Hard-Blocks (Reihenfolge)

1. `signal_missing_or_neutral`
2. `vmc_context_missing`
3. `vmc_data_gap`
4. `vmc_gold_dot_no_long`
5. `vmc_divergence_missing`
6. `vmc_divergence_stale`
7. `vmc_cross_conflict`
8. `vmc_zone_not_extreme`
9. `score_below_threshold`

Pass-Reason: `vmc_divergence_reversal_pass`
