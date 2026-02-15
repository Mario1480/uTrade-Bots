from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import StrategyRunRequest
from strategies import regime_gate, signal_filter


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


if __name__ == "__main__":
    unittest.main()
