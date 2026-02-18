from __future__ import annotations

import math
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import StrategyRunRequest
from strategies import smart_money_concept


def _last_bars() -> dict:
    start = 1_770_000_000
    return {
        "n": 4,
        "ohlc": [
            {"t": start + 0, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.2, "v": 10},
            {"t": start + 300, "o": 100.2, "h": 101.3, "l": 99.8, "c": 100.6, "v": 12},
            {"t": start + 600, "o": 100.6, "h": 101.6, "l": 100.0, "c": 101.1, "v": 13},
            {"t": start + 900, "o": 101.1, "h": 101.9, "l": 100.7, "c": 101.4, "v": 11},
        ],
    }


def _smc_snapshot(
    *,
    trend: str = "bullish",
    direction: str = "bullish",
    event_type: str = "bos",
    event_ts_ms: int = 1_770_000_900_000,
    zone: str = "discount",
    data_gap: bool = False,
    ob_bull: int = 2,
    ob_bear: int = 1,
    fvg_bull: int = 2,
    fvg_bear: int = 1,
) -> dict:
    zones = {
        "trailingTop": 104.0,
        "trailingBottom": 96.0,
        "premiumTop": 104.0,
        "premiumBottom": 102.0,
        "equilibriumTop": 102.0,
        "equilibriumBottom": 100.0,
        "discountTop": 100.0,
        "discountBottom": 96.0,
    }
    if zone == "equilibrium":
        zones["equilibriumTop"] = 102.0
        zones["equilibriumBottom"] = 100.0
    elif zone == "premium":
        zones["premiumTop"] = 102.0
        zones["premiumBottom"] = 100.8
        zones["equilibriumTop"] = 100.7
        zones["equilibriumBottom"] = 99.8
        zones["discountTop"] = 99.7
        zones["discountBottom"] = 97.0
    elif zone == "unknown":
        zones["premiumTop"] = 110.0
        zones["premiumBottom"] = 108.0
        zones["equilibriumTop"] = 107.0
        zones["equilibriumBottom"] = 106.0
        zones["discountTop"] = 105.0
        zones["discountBottom"] = 104.0

    return {
        "internal": {
            "trend": trend,
            "lastEvent": {
                "type": event_type,
                "direction": direction,
                "level": 100.0,
                "ts": event_ts_ms,
            },
            "bullishBreaks": 2,
            "bearishBreaks": 1,
        },
        "swing": {
            "trend": trend,
            "lastEvent": {
                "type": event_type,
                "direction": direction,
                "level": 99.5,
                "ts": event_ts_ms,
            },
            "bullishBreaks": 2,
            "bearishBreaks": 1,
        },
        "equalLevels": {
            "eqh": {"detected": False, "level": None, "ts": None, "deltaPct": None},
            "eql": {"detected": False, "level": None, "ts": None, "deltaPct": None},
        },
        "orderBlocks": {
            "internal": {
                "bullishCount": ob_bull,
                "bearishCount": ob_bear,
                "latestBullish": None,
                "latestBearish": None,
            },
            "swing": {
                "bullishCount": 0,
                "bearishCount": 0,
                "latestBullish": None,
                "latestBearish": None,
            },
        },
        "fairValueGaps": {
            "bullishCount": fvg_bull,
            "bearishCount": fvg_bear,
            "latestBullish": None,
            "latestBearish": None,
            "autoThresholdPct": 0.05,
        },
        "zones": zones,
        "dataGap": data_gap,
    }


def _payload(
    *,
    signal: str = "up",
    smc: dict | None = None,
    risk_data_gap: bool = False,
    config: dict | None = None,
    close_override: float | None = None,
) -> StrategyRunRequest:
    bars = _last_bars()
    if close_override is not None:
        bars["ohlc"][-1]["c"] = close_override
    snapshot = {
        "historyContext": {
            "lastBars": bars,
        },
        "riskFlags": {"dataGap": risk_data_gap},
        "advancedIndicators": {},
    }
    if smc is not None:
        snapshot["advancedIndicators"]["smartMoneyConcepts"] = smc
    return StrategyRunRequest(
        strategyType="smart_money_concept",
        featureSnapshot=snapshot,
        context={"signal": signal},
        config=config or {},
    )


def _assert_finite_numbers(value: object) -> None:
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        assert math.isfinite(float(value))
        return
    if isinstance(value, list):
        for item in value:
            _assert_finite_numbers(item)
        return
    if isinstance(value, dict):
        for nested in value.values():
            _assert_finite_numbers(nested)


class SmartMoneyConceptTests(unittest.TestCase):
    def test_bullish_pass(self) -> None:
        result = smart_money_concept.run(
            _payload(signal="up", smc=_smc_snapshot(zone="equilibrium"), close_override=101.4)
        ).model_dump()
        self.assertTrue(result["allow"])
        self.assertIn("smc_structure_zone_pass", result["reasonCodes"])
        self.assertIn("smc_up", result["tags"])
        self.assertIn("zone_equilibrium", result["tags"])
        self.assertIn("smc_bullish", result["tags"])

    def test_bearish_pass(self) -> None:
        result = smart_money_concept.run(
            _payload(
                signal="down",
                smc=_smc_snapshot(
                    trend="bearish",
                    direction="bearish",
                    zone="premium",
                    ob_bull=1,
                    ob_bear=3,
                    fvg_bull=1,
                    fvg_bear=2,
                ),
                close_override=101.2,
            )
        ).model_dump()
        self.assertTrue(result["allow"])
        self.assertIn("smc_structure_zone_pass", result["reasonCodes"])
        self.assertIn("smc_down", result["tags"])
        self.assertIn("zone_premium", result["tags"])
        self.assertIn("smc_bearish", result["tags"])

    def test_neutral_signal_blocks(self) -> None:
        result = smart_money_concept.run(
            _payload(signal="neutral", smc=_smc_snapshot())
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["signal_missing_or_neutral"])

    def test_missing_smc_snapshot_blocks(self) -> None:
        result = smart_money_concept.run(
            _payload(signal="up", smc=None)
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["smc_context_missing"])

    def test_smc_data_gap_blocks(self) -> None:
        result = smart_money_concept.run(
            _payload(signal="up", smc=_smc_snapshot(data_gap=True))
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["smc_data_gap"])
        self.assertIn("data_gap", result["tags"])

    def test_trend_conflict_blocks(self) -> None:
        result = smart_money_concept.run(
            _payload(
                signal="up",
                smc=_smc_snapshot(trend="bearish", direction="bullish", zone="discount"),
                close_override=99.0,
            )
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["smc_trend_conflict"])

    def test_structure_conflict_blocks(self) -> None:
        result = smart_money_concept.run(
            _payload(
                signal="up",
                smc=_smc_snapshot(trend="bullish", direction="bearish", zone="discount"),
                close_override=99.1,
            )
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["smc_structure_conflict"])

    def test_zone_mismatch_blocks(self) -> None:
        result = smart_money_concept.run(
            _payload(
                signal="up",
                smc=_smc_snapshot(trend="bullish", direction="bullish", zone="premium"),
                close_override=101.2,
            )
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["smc_zone_not_favorable"])

    def test_score_below_threshold_blocks(self) -> None:
        result = smart_money_concept.run(
            _payload(
                signal="up",
                smc=_smc_snapshot(trend="bearish", direction="bearish", zone="premium", ob_bull=0, ob_bear=2, fvg_bull=0, fvg_bear=2),
                close_override=101.2,
                config={
                    "requireTrendAlignment": False,
                    "requireStructureAlignment": False,
                    "requireZoneAlignment": False,
                    "minPassScore": 90,
                },
            )
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["score_below_threshold"])

    def test_deterministic_output(self) -> None:
        payload = _payload(signal="up", smc=_smc_snapshot(), close_override=99.2)
        first = smart_money_concept.run(payload).model_dump()
        second = smart_money_concept.run(payload).model_dump()
        self.assertEqual(first, second)

    def test_no_nan_or_infinity(self) -> None:
        weird = _smc_snapshot(
            trend="bullish",
            direction="bullish",
            zone="discount",
            ob_bull=2,
            ob_bear=0,
            fvg_bull=1,
            fvg_bear=0,
        )
        weird["zones"]["discountTop"] = float("nan")
        weird["zones"]["discountBottom"] = float("inf")
        result = smart_money_concept.run(
            _payload(
                signal="up",
                smc=weird,
                config={"requireZoneAlignment": False},
            )
        ).model_dump()
        _assert_finite_numbers(result)


if __name__ == "__main__":
    unittest.main()
