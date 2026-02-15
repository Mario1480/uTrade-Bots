from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import StrategyRunRequest
from strategies import trend_vol_gate


def _payload(
    *,
    signal: str = "up",
    state: str = "trend_up",
    conf: float | None = 78.0,
    stack: str = "bull",
    d50: float | None = 0.55,
    d200: float | None = 1.2,
    sl50: float | None = 0.08,
    vol_z: float | None = 0.9,
    rel_vol: float | None = 1.1,
    data_gap: bool = False,
    config: dict | None = None,
) -> StrategyRunRequest:
    return StrategyRunRequest(
        strategyType="trend_vol_gate",
        featureSnapshot={
            "riskFlags": {"dataGap": data_gap},
            "historyContext": {
                "reg": {"state": state, "conf": conf},
                "ema": {"stk": stack, "d50": d50, "d200": d200, "sl50": sl50},
                "vol": {"z": vol_z, "rv": rel_vol},
            },
        },
        context={"signal": signal},
        config=config or {},
    )


class TrendVolGateTests(unittest.TestCase):
    def test_bullish_pass(self) -> None:
        result = trend_vol_gate.run(_payload()).model_dump()
        self.assertTrue(result["allow"])
        self.assertIn("trend_vol_gate_pass", result["reasonCodes"])
        self.assertIn("trend_up", result["tags"])

    def test_stack_conflict_blocks(self) -> None:
        result = trend_vol_gate.run(_payload(signal="up", stack="bear")).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["ema_stack_conflict"])

    def test_regime_low_confidence_blocks(self) -> None:
        result = trend_vol_gate.run(_payload(conf=30.0)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["regime_confidence_low"])

    def test_vol_spike_blocks(self) -> None:
        result = trend_vol_gate.run(_payload(vol_z=3.2, rel_vol=2.2)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vol_spike_risk"])

    def test_low_liquidity_blocks(self) -> None:
        result = trend_vol_gate.run(_payload(vol_z=-1.4, rel_vol=0.9)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["low_liquidity_risk"])
        self.assertIn("low_liquidity", result["tags"])

    def test_missing_values_no_crash_and_finite_score(self) -> None:
        result = trend_vol_gate.run(
            _payload(conf=None, d50=None, d200=None, sl50=None, vol_z=None, rel_vol=None)
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertIsInstance(result["score"], float)
        self.assertGreaterEqual(result["score"], 0.0)
        self.assertLessEqual(result["score"], 100.0)

    def test_deterministic_output(self) -> None:
        payload = _payload(data_gap=True)
        first = trend_vol_gate.run(payload).model_dump()
        second = trend_vol_gate.run(payload).model_dump()
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
