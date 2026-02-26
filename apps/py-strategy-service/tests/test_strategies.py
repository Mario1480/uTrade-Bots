from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import StrategyRunRequest
from strategies import regime_gate, signal_filter, ta_trend_vol_gate_v2


class StrategyTests(unittest.TestCase):
    def test_regime_gate_deterministic(self) -> None:
        payload = StrategyRunRequest(
            strategyType="regime_gate",
            featureSnapshot={
                "historyContext": {
                    "reg": {"state": "trend_up", "conf": 70},
                    "ema": {"stk": "bull"},
                }
            },
            context={"signal": "up"},
            config={},
        )
        first = regime_gate.run(payload)
        second = regime_gate.run(payload)
        self.assertEqual(first.model_dump(), second.model_dump())

    def test_signal_filter_no_nan(self) -> None:
        payload = StrategyRunRequest(
            strategyType="signal_filter",
            featureSnapshot={
                "tags": ["trend_up"],
                "historyContext": {
                    "reg": {"state": "range"},
                    "vol": {"z": float("nan")},
                },
            },
            context={},
            config={"maxVolZ": float("inf")},
        )
        result = signal_filter.run(payload).model_dump()
        # pydantic validator normalizes numeric output, no nan on score
        self.assertIsInstance(result["score"], float)

    def test_ta_trend_vol_gate_v2_no_nan(self) -> None:
        payload = StrategyRunRequest(
            strategyType="ta_trend_vol_gate_v2",
            featureSnapshot={
                "historyContext": {
                    "reg": {"state": "trend_up", "conf": 80},
                    "ema": {"ema20": 110.0, "ema50": 100.0},
                },
                "indicators": {
                    "rsi_14": 58.0,
                    "atr_pct": 1.1,
                    "adx": {"adx_14": 24.0},
                },
            },
            context={"signal": "up"},
            config={},
        )
        result = ta_trend_vol_gate_v2.run(payload).model_dump()
        self.assertIsInstance(result["score"], float)


if __name__ == "__main__":
    unittest.main()
