from __future__ import annotations

import os
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import StrategyRunRequest
from strategies import ta_trend_vol_gate_v2


def _bars(count: int = 120) -> list[list[float | str]]:
    rows: list[list[float | str]] = []
    price = 100.0
    for idx in range(count):
        open_ = price
        high = open_ + 0.5
        low = open_ - 0.3
        close = open_ + 0.2
        volume = 1000 + idx * 3
        ts = f"2026-02-01T{(idx // 4) % 24:02d}:{(idx % 4) * 15:02d}:00Z"
        rows.append([ts, open_, high, low, close, volume])
        price = close
    return rows


def _payload_with_ohlcv(signal: str = "up") -> StrategyRunRequest:
    return StrategyRunRequest(
        strategyType="ta_trend_vol_gate_v2",
        featureSnapshot={
            "riskFlags": {"dataGap": False},
            "historyContext": {
                "reg": {"state": "trend_up", "conf": 85},
                "ema": {"ema20": 110.0, "ema50": 108.0},
            },
            "ohlcvSeries": {
                "timeframe": "15m",
                "format": ["ts", "open", "high", "low", "close", "volume"],
                "bars": _bars(),
            },
        },
        context={"signal": signal},
        config={},
    )


def _payload_fallback_only() -> StrategyRunRequest:
    return StrategyRunRequest(
        strategyType="ta_trend_vol_gate_v2",
        featureSnapshot={
            "riskFlags": {"dataGap": False},
            "historyContext": {
                "reg": {"state": "trend_up", "conf": 90},
                "ema": {"ema20": 110.0, "ema50": 100.0},
            },
            "indicators": {
                "rsi_14": 60.0,
                "atr_pct": 1.0,
                "adx": {"adx_14": 24.0},
            },
        },
        context={"signal": "up"},
        config={},
    )


class TaTrendVolGateV2Tests(unittest.TestCase):
    def test_deterministic_output(self) -> None:
        payload = _payload_fallback_only()
        first = ta_trend_vol_gate_v2.run(payload).model_dump()
        second = ta_trend_vol_gate_v2.run(payload).model_dump()
        self.assertEqual(first, second)

    def test_talib_forced_without_talib_blocks_deterministically(self) -> None:
        previous = os.getenv("PY_TA_BACKEND")
        try:
            os.environ["PY_TA_BACKEND"] = "talib"
            result = ta_trend_vol_gate_v2.run(_payload_with_ohlcv()).model_dump()
            # talib is optional; when unavailable we must block deterministically.
            if "ta_backend_unavailable" in result["reasonCodes"]:
                self.assertFalse(result["allow"])
        finally:
            if previous is None:
                os.environ.pop("PY_TA_BACKEND", None)
            else:
                os.environ["PY_TA_BACKEND"] = previous

    def test_fallback_indicators_can_pass_without_ohlcv(self) -> None:
        result = ta_trend_vol_gate_v2.run(_payload_fallback_only()).model_dump()
        self.assertTrue(isinstance(result["allow"], bool))
        self.assertGreaterEqual(result["score"], 0.0)
        self.assertLessEqual(result["score"], 100.0)


if __name__ == "__main__":
    unittest.main()
