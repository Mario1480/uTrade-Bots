from __future__ import annotations

import os
import pathlib
import sys
import unittest

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from strategies import ta_backend


class TaBackendTests(unittest.TestCase):
    def test_resolve_backend_defaults_to_auto(self) -> None:
        previous = os.getenv("PY_TA_BACKEND")
        try:
            if "PY_TA_BACKEND" in os.environ:
                del os.environ["PY_TA_BACKEND"]
            self.assertEqual(ta_backend.resolve_backend(), "auto")
            os.environ["PY_TA_BACKEND"] = "invalid"
            self.assertEqual(ta_backend.resolve_backend(), "auto")
        finally:
            if previous is None:
                os.environ.pop("PY_TA_BACKEND", None)
            else:
                os.environ["PY_TA_BACKEND"] = previous

    def test_extract_ohlcv_frame(self) -> None:
        snapshot = {
            "ohlcvSeries": {
                "format": ["ts", "open", "high", "low", "close", "volume"],
                "bars": [
                    ["2026-02-01T00:00:00Z", 100, 101, 99, 100.5, 1000],
                    ["2026-02-01T00:15:00Z", 100.5, 101.5, 100.1, 101.2, 1010],
                ]
                * 20,
            }
        }
        frame, error = ta_backend.extract_ohlcv_frame(snapshot)
        self.assertIsNone(error)
        self.assertIsNotNone(frame)
        assert frame is not None
        self.assertEqual(list(frame.columns), ["ts", "open", "high", "low", "close", "volume"])

    def test_compute_ta_indicators_handles_missing_backend(self) -> None:
        previous = os.getenv("PY_TA_BACKEND")
        try:
            os.environ["PY_TA_BACKEND"] = "talib"
            frame = pd.DataFrame(
                {
                    "open": [100 + i * 0.1 for i in range(80)],
                    "high": [100.3 + i * 0.1 for i in range(80)],
                    "low": [99.8 + i * 0.1 for i in range(80)],
                    "close": [100.1 + i * 0.1 for i in range(80)],
                    "volume": [1000 + i for i in range(80)],
                }
            )
            _values, error = ta_backend.compute_ta_indicators(frame)
            # talib is optional; either works or reports unavailable deterministically
            self.assertIn(error, (None, "ta_backend_unavailable"))
        finally:
            if previous is None:
                os.environ.pop("PY_TA_BACKEND", None)
            else:
                os.environ["PY_TA_BACKEND"] = previous


if __name__ == "__main__":
    unittest.main()
