#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import backtrader as bt
import numpy as np
import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate vectorbt top candidates with backtrader episodic replay.")
    parser.add_argument("--dataset", required=True, help="Path to csv/parquet dataset from build_from_predictions.py")
    parser.add_argument("--vectorbt-report", required=True, help="Path to report.json from run_vectorbt.py")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--min-trades", type=int, default=30)
    parser.add_argument("--max-drawdown-pct", type=float, default=25.0)
    parser.add_argument("--min-win-rate-pct", type=float, default=35.0)
    parser.add_argument("--min-adx", type=float, default=18.0)
    parser.add_argument("--max-atr-pct", type=float, default=2.0)
    parser.add_argument("--rsi-long-min", type=float, default=52.0)
    parser.add_argument("--rsi-short-max", type=float, default=48.0)
    parser.add_argument("--require-ema-alignment", choices=["true", "false"], default="true")
    parser.add_argument("--artifact-dir", default=None)
    return parser.parse_args()


def to_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def load_dataset(path: str) -> pd.DataFrame:
    source = Path(path)
    if not source.exists():
        raise SystemExit(f"Dataset not found: {source}")

    if source.suffix.lower() == ".parquet":
        frame = pd.read_parquet(source)
    elif source.suffix.lower() == ".csv":
        frame = pd.read_csv(source)
    else:
        raise SystemExit("Unsupported dataset format. Use parquet or csv.")

    if "ohlcv_series_json" not in frame.columns:
        raise SystemExit("Dataset missing ohlcv_series_json column. Rebuild dataset with updated builder.")

    return frame.reset_index(drop=True)


def load_vectorbt_candidates(report_path: str, top_k: int) -> tuple[str, list[dict[str, Any]]]:
    report_file = Path(report_path)
    if not report_file.exists():
        raise SystemExit(f"Vectorbt report not found: {report_file}")

    payload = json.loads(report_file.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("Vectorbt report must be a JSON object.")

    strategy_type = str(payload.get("strategyType") or "trend_vol_gate")
    candidates_raw = payload.get("topCandidates")
    if not isinstance(candidates_raw, list) or not candidates_raw:
        raise SystemExit("Vectorbt report missing topCandidates.")

    candidates: list[dict[str, Any]] = []
    for entry in candidates_raw[: max(1, top_k)]:
        if not isinstance(entry, dict):
            continue
        params = entry.get("params")
        if not isinstance(params, dict) or not params:
            continue
        candidates.append(
            {
                "rank": int(entry.get("rank") or len(candidates) + 1),
                "objective": to_float(entry.get("objective")) or 0.0,
                "params": params,
            }
        )

    if not candidates:
        raise SystemExit("No valid candidates found in vectorbt report.")

    return strategy_type, candidates


def parse_ohlcv_payload(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except Exception:
            return None
        if isinstance(parsed, dict):
            return parsed
        return None
    if isinstance(value, dict):
        return value
    return None


def bars_to_dataframe(ohlcv_payload: dict[str, Any]) -> pd.DataFrame | None:
    bars = ohlcv_payload.get("bars")
    fmt = ohlcv_payload.get("format")
    if not isinstance(bars, list) or not isinstance(fmt, list) or len(fmt) < 6:
        return None

    keys = [str(item) for item in fmt[:6]]
    rows: list[dict[str, Any]] = []

    for item in bars:
        if not isinstance(item, list) or len(item) < 6:
            continue
        row_map = {keys[idx]: item[idx] for idx in range(6)}
        open_ = to_float(row_map.get("open"))
        high = to_float(row_map.get("high"))
        low = to_float(row_map.get("low"))
        close = to_float(row_map.get("close"))
        volume = to_float(row_map.get("volume"))
        if None in {open_, high, low, close, volume}:
            continue
        rows.append(
            {
                "datetime": pd.to_datetime(row_map.get("ts"), utc=True, errors="coerce"),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
        )

    if len(rows) < 35:
        return None

    frame = pd.DataFrame(rows).dropna(subset=["datetime"])
    if frame.empty:
        return None

    frame = frame.sort_values("datetime").drop_duplicates(subset=["datetime"], keep="last")
    frame = frame.set_index("datetime")
    return frame


def gate_row_by_params(row: pd.Series, params: dict[str, Any]) -> bool:
    signal = str(row.get("signal") or "neutral")
    state = str(row.get("reg_state") or "unknown")
    conf = to_float(row.get("reg_conf"))
    stack = str(row.get("ema_stk") or "unknown")
    d50 = to_float(row.get("ema_d50"))
    d200 = to_float(row.get("ema_d200"))
    sl50 = to_float(row.get("ema_sl50"))
    vol_z = to_float(row.get("vol_z"))
    rel_vol = to_float(row.get("vol_rv"))

    min_regime_conf = to_float(params.get("minRegimeConf")) or 55.0
    min_abs_d50 = to_float(params.get("minAbsD50Pct")) or 0.12
    min_abs_d200 = to_float(params.get("minAbsD200Pct")) or 0.20
    max_vol_z = to_float(params.get("maxVolZ")) or 2.5
    max_rel_vol = to_float(params.get("maxRelVol")) or 1.8
    min_vol_z = to_float(params.get("minVolZ")) or -1.2
    min_rel_vol = to_float(params.get("minRelVol")) or 0.6
    min_pass_score = to_float(params.get("minPassScore")) or 70.0

    if signal not in {"up", "down"}:
        return False
    if state not in {"trend_up", "trend_down"}:
        return False
    if conf is None or conf < min_regime_conf:
        return False

    stack_aligned = (signal == "up" and stack == "bull") or (signal == "down" and stack == "bear")
    slope_aligned = (signal == "up" and sl50 is not None and sl50 >= 0.0) or (signal == "down" and sl50 is not None and sl50 <= 0.0)
    distance_ok = d50 is not None and d200 is not None and abs(d50) >= min_abs_d50 and abs(d200) >= min_abs_d200

    vol_spike = vol_z is not None and rel_vol is not None and vol_z >= max_vol_z and rel_vol >= max_rel_vol
    low_liquidity = (vol_z is not None and vol_z <= min_vol_z) or (rel_vol is not None and rel_vol <= min_rel_vol)
    vol_ok = not vol_spike and not low_liquidity and vol_z is not None and rel_vol is not None

    score = max(
        0.0,
        min(
            100.0,
            0.6 * conf
            + 20.0 * (1.0 if stack_aligned else 0.0)
            + 10.0 * (1.0 if slope_aligned else 0.0)
            + 10.0 * (1.0 if distance_ok else 0.0)
            + 10.0 * (1.0 if vol_ok else 0.0),
        ),
    )

    allow = stack_aligned and slope_aligned and distance_ok and (not vol_spike) and (not low_liquidity) and score >= min_pass_score
    return allow


class EpisodeValidationStrategy(bt.Strategy):
    params = (
        ("direction", "up"),
        ("min_adx", 18.0),
        ("max_atr_pct", 2.0),
        ("rsi_long_min", 52.0),
        ("rsi_short_max", 48.0),
        ("require_ema_alignment", True),
    )

    def __init__(self) -> None:
        self.rsi = bt.indicators.RSI(self.data.close, period=14)
        self.adx = bt.indicators.ADX(self.data, period=14)
        self.atr = bt.indicators.ATR(self.data, period=14)
        self.ema_fast = bt.indicators.EMA(self.data.close, period=20)
        self.ema_slow = bt.indicators.EMA(self.data.close, period=50)
        self.entry_price: float | None = None
        self.exit_price: float | None = None
        self.allow_trade = False
        self.validation_result: dict[str, Any] = {
            "allowTrade": False,
            "pnlPct": None,
            "adx": None,
            "rsi": None,
            "atrPct": None,
            "emaFast": None,
            "emaSlow": None,
        }

    def next(self) -> None:
        total = self.data.buflen()
        pos = len(self)
        if total < 35:
            return

        if pos == total - 1:
            close = float(self.data.close[0]) if np.isfinite(self.data.close[0]) else np.nan
            adx = float(self.adx[0]) if np.isfinite(self.adx[0]) else np.nan
            rsi = float(self.rsi[0]) if np.isfinite(self.rsi[0]) else np.nan
            atr = float(self.atr[0]) if np.isfinite(self.atr[0]) else np.nan
            ema_fast = float(self.ema_fast[0]) if np.isfinite(self.ema_fast[0]) else np.nan
            ema_slow = float(self.ema_slow[0]) if np.isfinite(self.ema_slow[0]) else np.nan
            atr_pct = (atr / close) * 100.0 if np.isfinite(atr) and np.isfinite(close) and close > 0 else np.nan

            direction = str(self.p.direction)
            rsi_ok = (direction == "up" and np.isfinite(rsi) and rsi >= float(self.p.rsi_long_min)) or (
                direction == "down" and np.isfinite(rsi) and rsi <= float(self.p.rsi_short_max)
            )
            adx_ok = np.isfinite(adx) and adx >= float(self.p.min_adx)
            atr_ok = np.isfinite(atr_pct) and atr_pct <= float(self.p.max_atr_pct)
            ema_ok = (direction == "up" and np.isfinite(ema_fast) and np.isfinite(ema_slow) and ema_fast >= ema_slow) or (
                direction == "down" and np.isfinite(ema_fast) and np.isfinite(ema_slow) and ema_fast <= ema_slow
            )

            allow_trade = adx_ok and atr_ok and rsi_ok and (ema_ok or not bool(self.p.require_ema_alignment))
            self.allow_trade = bool(allow_trade)
            self.entry_price = close if self.allow_trade and np.isfinite(close) else None

            self.validation_result.update(
                {
                    "allowTrade": self.allow_trade,
                    "adx": float(adx) if np.isfinite(adx) else None,
                    "rsi": float(rsi) if np.isfinite(rsi) else None,
                    "atrPct": float(atr_pct) if np.isfinite(atr_pct) else None,
                    "emaFast": float(ema_fast) if np.isfinite(ema_fast) else None,
                    "emaSlow": float(ema_slow) if np.isfinite(ema_slow) else None,
                }
            )

        if pos == total and self.allow_trade and self.exit_price is None:
            close = float(self.data.close[0]) if np.isfinite(self.data.close[0]) else np.nan
            self.exit_price = close if np.isfinite(close) else None

    def stop(self) -> None:
        if self.allow_trade and self.entry_price is not None and self.exit_price is not None and self.entry_price > 0:
            direction = 1.0 if str(self.p.direction) == "up" else -1.0
            pnl_pct = direction * ((self.exit_price - self.entry_price) / self.entry_price) * 100.0
            self.validation_result["pnlPct"] = float(pnl_pct)


def run_episode(frame: pd.DataFrame, signal: str, args: argparse.Namespace) -> dict[str, Any]:
    feed = bt.feeds.PandasData(dataname=frame)
    cerebro = bt.Cerebro(stdstats=False)
    cerebro.adddata(feed)
    cerebro.addstrategy(
        EpisodeValidationStrategy,
        direction=signal,
        min_adx=args.min_adx,
        max_atr_pct=args.max_atr_pct,
        rsi_long_min=args.rsi_long_min,
        rsi_short_max=args.rsi_short_max,
        require_ema_alignment=(args.require_ema_alignment == "true"),
    )

    try:
        runs = cerebro.run(runonce=True, preload=True)
    except Exception as error:
        return {
            "allowTrade": False,
            "pnlPct": None,
            "error": str(error),
        }

    if not runs:
        return {
            "allowTrade": False,
            "pnlPct": None,
            "error": "no_strategy_result",
        }

    strategy = runs[0]
    return strategy.validation_result


def compute_max_drawdown_pct(returns_pct: list[float]) -> float:
    if not returns_pct:
        return 0.0
    equity = np.cumprod(1.0 + (np.asarray(returns_pct, dtype=float) / 100.0))
    peaks = np.maximum.accumulate(equity)
    dd = np.where(peaks > 0, (equity / peaks) - 1.0, 0.0)
    return float(abs(np.min(dd)) * 100.0)


def evaluate_candidate(frame: pd.DataFrame, candidate: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    params = candidate["params"]
    trade_returns: list[float] = []
    skipped_rows = 0
    error_rows = 0
    eligible_rows = 0

    for _idx, row in frame.iterrows():
        if not gate_row_by_params(row, params):
            continue

        eligible_rows += 1
        signal = str(row.get("signal") or "neutral")
        if signal not in {"up", "down"}:
            skipped_rows += 1
            continue

        ohlcv_payload = parse_ohlcv_payload(row.get("ohlcv_series_json"))
        if not isinstance(ohlcv_payload, dict):
            skipped_rows += 1
            continue

        bars_frame = bars_to_dataframe(ohlcv_payload)
        if bars_frame is None or bars_frame.empty:
            skipped_rows += 1
            continue

        result = run_episode(bars_frame, signal, args)
        if result.get("error"):
            error_rows += 1
            continue

        if result.get("allowTrade") is True:
            pnl = to_float(result.get("pnlPct"))
            if pnl is not None:
                trade_returns.append(pnl)
        else:
            skipped_rows += 1

    trades = len(trade_returns)
    wins = len([x for x in trade_returns if x > 0])
    win_rate = float((wins / trades) * 100.0) if trades > 0 else 0.0
    expectancy = float(np.mean(trade_returns)) if trades > 0 else 0.0
    total_return = float((np.prod(1.0 + (np.asarray(trade_returns, dtype=float) / 100.0)) - 1.0) * 100.0) if trades > 0 else 0.0
    max_dd = compute_max_drawdown_pct(trade_returns)

    fail_reasons: list[str] = []
    if trades < args.min_trades:
        fail_reasons.append("min_trades_not_met")
    if max_dd > args.max_drawdown_pct:
        fail_reasons.append("max_drawdown_exceeded")
    if win_rate < args.min_win_rate_pct:
        fail_reasons.append("min_win_rate_not_met")

    passed = len(fail_reasons) == 0

    return {
        "rank": candidate["rank"],
        "objectiveFromVectorbt": candidate["objective"],
        "params": params,
        "metrics": {
            "eligibleRows": eligible_rows,
            "trades": trades,
            "wins": wins,
            "skippedRows": skipped_rows,
            "errorRows": error_rows,
            "winRatePct": round(win_rate, 4),
            "expectancyPct": round(expectancy, 4),
            "totalReturnPct": round(total_return, 4),
            "maxDrawdownPct": round(max_dd, 4),
        },
        "pass": passed,
        "failReasons": fail_reasons,
    }


def main() -> None:
    args = parse_args()
    frame = load_dataset(args.dataset)
    strategy_type, candidates = load_vectorbt_candidates(args.vectorbt_report, args.top_k)

    evaluated = [evaluate_candidate(frame, candidate, args) for candidate in candidates]
    passed = [item for item in evaluated if item["pass"] is True]

    best_passed = None
    if passed:
        passed.sort(key=lambda item: float(item["metrics"]["expectancyPct"]), reverse=True)
        best_passed = passed[0]

    report = {
        "strategyType": strategy_type,
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "source": {
            "dataset": str(Path(args.dataset).resolve()),
            "vectorbtReport": str(Path(args.vectorbt_report).resolve()),
        },
        "constraints": {
            "minTrades": args.min_trades,
            "maxDrawdownPct": args.max_drawdown_pct,
            "minWinRatePct": args.min_win_rate_pct,
            "minAdx": args.min_adx,
            "maxAtrPct": args.max_atr_pct,
            "rsiLongMin": args.rsi_long_min,
            "rsiShortMax": args.rsi_short_max,
            "requireEmaAlignment": args.require_ema_alignment == "true",
        },
        "summary": {
            "evaluatedCandidates": len(evaluated),
            "passedCandidates": len(passed),
            "pass": len(passed) > 0,
        },
        "bestPassedCandidate": best_passed,
        "candidates": evaluated,
    }

    vectorbt_report_path = Path(args.vectorbt_report).resolve()
    artifact_dir = Path(args.artifact_dir).resolve() if args.artifact_dir else vectorbt_report_path.parent
    artifact_dir.mkdir(parents=True, exist_ok=True)
    out_path = artifact_dir / "backtrader_report.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("backtrader_validation_complete")
    print(f"report={out_path}")
    print(f"evaluated={len(evaluated)}")
    print(f"passed={len(passed)}")


if __name__ == "__main__":
    main()
