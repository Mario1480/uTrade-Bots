from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import StrategyRunRequest
from strategies import vmc_divergence_reversal


def _payload(
    *,
    signal: str = "up",
    wt_bull: bool = True,
    wt_bear: bool = False,
    wt_bull_hidden: bool = False,
    wt_bear_hidden: bool = False,
    wt_bull_age: int | None = 1,
    wt_bear_age: int | None = None,
    rsi_bull: bool = False,
    rsi_bear: bool = False,
    stoch_bull: bool = False,
    stoch_bear: bool = False,
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
        strategyType="vmc_divergence_reversal",
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
                        "goldNoBuyLong": gold_no_buy
                    },
                    "divergences": {
                        "wt": {
                            "bullish": wt_bull,
                            "bearish": wt_bear,
                            "bullishHidden": wt_bull_hidden,
                            "bearishHidden": wt_bear_hidden,
                            "bullishAdd": False,
                            "bearishAdd": False,
                            "lastBullishAgeBars": wt_bull_age,
                            "lastBearishAgeBars": wt_bear_age,
                        },
                        "rsi": {
                            "bullish": rsi_bull,
                            "bearish": rsi_bear,
                            "bullishHidden": False,
                            "bearishHidden": False,
                            "lastBullishAgeBars": wt_bull_age,
                            "lastBearishAgeBars": wt_bear_age,
                        },
                        "stoch": {
                            "bullish": stoch_bull,
                            "bearish": stoch_bear,
                            "bullishHidden": False,
                            "bearishHidden": False,
                            "lastBullishAgeBars": wt_bull_age,
                            "lastBearishAgeBars": wt_bear_age,
                        },
                    },
                }
            },
        },
        context={"signal": signal},
        config=config or {},
    )


class VmcDivergenceReversalTests(unittest.TestCase):
    def test_bullish_pass(self) -> None:
        result = vmc_divergence_reversal.run(_payload()).model_dump()
        self.assertTrue(result["allow"])
        self.assertIn("vmc_divergence_reversal_pass", result["reasonCodes"])

    def test_missing_divergence_blocks(self) -> None:
        result = vmc_divergence_reversal.run(
            _payload(wt_bull=False, rsi_bull=False, stoch_bull=False)
        ).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vmc_divergence_missing"])

    def test_gold_dot_blocks_long(self) -> None:
        result = vmc_divergence_reversal.run(_payload(gold_no_buy=True)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vmc_gold_dot_no_long"])

    def test_data_gap_blocks(self) -> None:
        result = vmc_divergence_reversal.run(_payload(vmc_data_gap=True)).model_dump()
        self.assertFalse(result["allow"])
        self.assertEqual(result["reasonCodes"], ["vmc_data_gap"])

    def test_hidden_div_can_pass_when_enabled(self) -> None:
        result = vmc_divergence_reversal.run(
            _payload(
                wt_bull=False,
                wt_bull_hidden=True,
                config={"requireRegularDiv": False, "allowHiddenDiv": True},
            )
        ).model_dump()
        self.assertTrue(result["allow"])
        self.assertIn("vmc_divergence_reversal_pass", result["reasonCodes"])

    def test_deterministic_output(self) -> None:
        payload = _payload()
        first = vmc_divergence_reversal.run(payload).model_dump()
        second = vmc_divergence_reversal.run(payload).model_dump()
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
