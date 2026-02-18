from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import StrategyRunRequest
from strategies import vmc_cipher_gate


def _payload(
    *,
    signal: str = "up",
    buy: bool = True,
    sell: bool = False,
    buy_div: bool = True,
    sell_div: bool = False,
    buy_age: int | None = 1,
    sell_age: int | None = None,
    buy_div_age: int | None = 1,
    sell_div_age: int | None = None,
    cross_up: bool = True,
    cross_down: bool = False,
    oversold: bool = True,
    overbought: bool = False,
    gold_no_buy: bool = False,
    vmc_data_gap: bool = False,
    risk_data_gap: bool = False,
    config: dict | None = None,
) -> StrategyRunRequest:
    return StrategyRunRequest(
        strategyType="vmc_cipher_gate",
        featureSnapshot={
            "riskFlags": {"dataGap": risk_data_gap},
            "indicators": {
                "vumanchu": {
                    "dataGap": vmc_data_gap,
                    "waveTrend": {
                        "crossUp": cross_up,
                        "crossDown": cross_down,
                        "oversold": oversold,
                        "overbought": overbought,
                    },
                    "signals": {
                        "buy": buy,
                        "sell": sell,
                        "buyDiv": buy_div,
                        "sellDiv": sell_div,
                        "goldNoBuyLong": gold_no_buy,
                        "ages": {
                            "buy": buy_age,
                            "sell": sell_age,
                            "buyDiv": buy_div_age,
                            "sellDiv": sell_div_age,
                        },
                    },
                }
            },
        },
        context={"signal": signal},
        config=config or {},
    )


class VmcCipherGateTests(unittest.TestCase):
    def test_bullish_pass(self) -> None:
        result = vmc_cipher_gate.run(_payload()).model_dump()
        self.assertTrue(result["allow"])
        self.assertIn("vmc_cipher_gate_pass", result["reasonCodes"])
        self.assertIn("vmc_up", result["tags"])

    def test_neutral_blocks(self) -> None:
        result = vmc_cipher_gate.run(_payload(signal="neutral")).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["signal_missing_or_neutral"])

    def test_missing_context_blocks(self) -> None:
        payload = StrategyRunRequest(
            strategyType="vmc_cipher_gate",
            featureSnapshot={},
            context={"signal": "up"},
            config={},
        )
        result = vmc_cipher_gate.run(payload).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vmc_context_missing"])

    def test_gold_dot_blocks_long(self) -> None:
        result = vmc_cipher_gate.run(_payload(gold_no_buy=True)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vmc_gold_dot_no_long"])

    def test_data_gap_blocks(self) -> None:
        result = vmc_cipher_gate.run(_payload(vmc_data_gap=True)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vmc_data_gap"])

    def test_stale_signal_blocks(self) -> None:
        result = vmc_cipher_gate.run(_payload(buy_age=8, buy_div_age=8)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vmc_signal_too_old"])

    def test_deterministic_output(self) -> None:
        payload = _payload()
        first = vmc_cipher_gate.run(payload).model_dump()
        second = vmc_cipher_gate.run(payload).model_dump()
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
