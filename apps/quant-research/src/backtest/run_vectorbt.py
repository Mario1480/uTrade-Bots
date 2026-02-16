#!/usr/bin/env python3
from __future__ import annotations

import argparse
import itertools
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import vectorbt as vbt


DEFAULT_GRID: dict[str, list[float]] = {
    "minRegimeConf": [50, 55, 60],
    "minAbsD50Pct": [0.10, 0.12],
    "minAbsD200Pct": [0.18, 0.20],
    "maxVolZ": [2.3, 2.5],
    "maxRelVol": [1.7, 1.9],
    "minVolZ": [-1.3, -1.1],
    "minRelVol": [0.55, 0.65],
    "minPassScore": [65, 70, 75],
}


@dataclass
class EvalResult:
    params: dict[str, float]
    train: dict[str, float]
    valid: dict[str, float]
    test: dict[str, float]
    objective: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run vectorbt-based parameter sweep for trend_vol_gate.")
    parser.add_argument("--dataset", required=True, help="Path to parquet/csv dataset produced by build_from_predictions.py")
    parser.add_argument("--strategy-type", default="trend_vol_gate")
    parser.add_argument("--min-trades", type=int, default=30)
    parser.add_argument("--max-drawdown-pct", type=float, default=25.0)
    parser.add_argument("--artifact-root", default="apps/quant-research/artifacts/trend_vol_gate")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument(
        "--allow-unconstrained-fallback",
        choices=["true", "false"],
        default="true",
        help="If no candidate passes constraints, pick best unconstrained candidate.",
    )
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

    required = {
        "split",
        "signal",
        "reg_state",
        "reg_conf",
        "ema_stk",
        "ema_d50",
        "ema_d200",
        "ema_sl50",
        "vol_z",
        "vol_rv",
        "outcome_pnl_pct",
    }
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise SystemExit(f"Dataset missing required columns: {missing}")

    frame = frame.copy()
    split_series = frame["split"].astype(str)
    frame = frame.loc[split_series.isin(["train", "valid", "test"])].copy()
    frame.loc[:, "split"] = frame["split"].astype(str)
    if frame.empty:
        raise SystemExit("Dataset has no train/valid/test rows.")

    for col in ["reg_conf", "ema_d50", "ema_d200", "ema_sl50", "vol_z", "vol_rv", "outcome_pnl_pct"]:
        frame.loc[:, col] = frame[col].apply(to_float)

    frame.loc[:, "signal"] = frame["signal"].fillna("neutral").astype(str)
    frame.loc[:, "reg_state"] = frame["reg_state"].fillna("unknown").astype(str)
    frame.loc[:, "ema_stk"] = frame["ema_stk"].fillna("unknown").astype(str)
    return frame.reset_index(drop=True)


def strategy_gate(frame: pd.DataFrame, params: dict[str, float]) -> tuple[np.ndarray, np.ndarray]:
    signal = frame["signal"].to_numpy()
    state = frame["reg_state"].to_numpy()
    conf = frame["reg_conf"].to_numpy(dtype=float)
    stack = frame["ema_stk"].to_numpy()
    d50 = frame["ema_d50"].to_numpy(dtype=float)
    d200 = frame["ema_d200"].to_numpy(dtype=float)
    sl50 = frame["ema_sl50"].to_numpy(dtype=float)
    vol_z = frame["vol_z"].to_numpy(dtype=float)
    rel_vol = frame["vol_rv"].to_numpy(dtype=float)

    allowed_states = np.isin(state, ["trend_up", "trend_down"])
    signal_ok = np.isin(signal, ["up", "down"])
    conf_ok = np.isfinite(conf) & (conf >= params["minRegimeConf"])

    stack_aligned = ((signal == "up") & (stack == "bull")) | ((signal == "down") & (stack == "bear"))
    slope_aligned = ((signal == "up") & np.isfinite(sl50) & (sl50 >= 0.0)) | (
        (signal == "down") & np.isfinite(sl50) & (sl50 <= 0.0)
    )
    distance_ok = np.isfinite(d50) & np.isfinite(d200) & (np.abs(d50) >= params["minAbsD50Pct"]) & (
        np.abs(d200) >= params["minAbsD200Pct"]
    )

    vol_spike = np.isfinite(vol_z) & np.isfinite(rel_vol) & (vol_z >= params["maxVolZ"]) & (rel_vol >= params["maxRelVol"])
    low_liquidity = (np.isfinite(vol_z) & (vol_z <= params["minVolZ"])) | (
        np.isfinite(rel_vol) & (rel_vol <= params["minRelVol"])
    )
    vol_ok = (~vol_spike) & (~low_liquidity) & np.isfinite(vol_z) & np.isfinite(rel_vol)

    score = np.clip(
        0.6 * np.where(np.isfinite(conf), conf, 0.0)
        + 20.0 * stack_aligned.astype(float)
        + 10.0 * slope_aligned.astype(float)
        + 10.0 * distance_ok.astype(float)
        + 10.0 * vol_ok.astype(float),
        0.0,
        100.0,
    )

    allow = signal_ok & allowed_states & conf_ok & stack_aligned & slope_aligned & distance_ok & (~vol_spike) & (~low_liquidity)
    allow = allow & (score >= params["minPassScore"])
    return allow, score


def split_metrics(frame: pd.DataFrame, allow: np.ndarray) -> dict[str, float]:
    returns = np.where(allow, frame["outcome_pnl_pct"].fillna(0.0).to_numpy(dtype=float) / 100.0, 0.0)
    trades = int(allow.sum())

    if returns.size == 0:
        return {
            "trades": 0.0,
            "win_rate": 0.0,
            "expectancy_pct": 0.0,
            "total_return_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe": 0.0,
        }

    equity = np.cumprod(1.0 + returns)
    running_peak = np.maximum.accumulate(equity)
    drawdown = np.where(running_peak > 0, equity / running_peak - 1.0, 0.0)

    non_zero = returns[returns != 0.0]
    wins = non_zero[non_zero > 0]

    expectancy = float(non_zero.mean() * 100.0) if non_zero.size else 0.0
    win_rate = float((wins.size / non_zero.size) * 100.0) if non_zero.size else 0.0
    total_return = float((equity[-1] - 1.0) * 100.0)
    max_dd = float(abs(drawdown.min()) * 100.0)

    std = float(returns.std(ddof=0))
    sharpe = float((returns.mean() / std) * np.sqrt(252.0)) if std > 0 else 0.0

    return {
        "trades": float(trades),
        "win_rate": win_rate,
        "expectancy_pct": expectancy,
        "total_return_pct": total_return,
        "max_drawdown_pct": max_dd,
        "sharpe": sharpe,
    }


def evaluate_candidate(frame: pd.DataFrame, params: dict[str, float]) -> EvalResult:
    allow_all, _ = strategy_gate(frame, params)

    train_mask = frame["split"] == "train"
    valid_mask = frame["split"] == "valid"
    test_mask = frame["split"] == "test"

    train_metrics = split_metrics(frame.loc[train_mask], allow_all[train_mask.to_numpy()])
    valid_metrics = split_metrics(frame.loc[valid_mask], allow_all[valid_mask.to_numpy()])
    test_metrics = split_metrics(frame.loc[test_mask], allow_all[test_mask.to_numpy()])

    objective = (0.7 * valid_metrics["expectancy_pct"]) + (0.3 * test_metrics["expectancy_pct"])

    return EvalResult(
        params=params,
        train=train_metrics,
        valid=valid_metrics,
        test=test_metrics,
        objective=objective,
    )


def candidate_is_valid(result: EvalResult, min_trades: int, max_drawdown_pct: float) -> bool:
    valid_trades = result.valid["trades"] >= min_trades
    test_trades = result.test["trades"] >= min_trades
    valid_dd = result.valid["max_drawdown_pct"] <= max_drawdown_pct
    test_dd = result.test["max_drawdown_pct"] <= max_drawdown_pct
    return bool(valid_trades and test_trades and valid_dd and test_dd)


def get_grid() -> list[dict[str, float]]:
    keys = list(DEFAULT_GRID.keys())
    values = [DEFAULT_GRID[key] for key in keys]
    combinations: list[dict[str, float]] = []
    for combo in itertools.product(*values):
        combinations.append({key: float(value) for key, value in zip(keys, combo)})
    return combinations


def with_vectorbt_summary(frame: pd.DataFrame, params: dict[str, float]) -> dict[str, float]:
    allow, _ = strategy_gate(frame, params)
    strategy_returns = np.where(allow, frame["outcome_pnl_pct"].fillna(0.0).to_numpy(dtype=float) / 100.0, 0.0)

    close = pd.Series(100.0 * np.cumprod(1.0 + strategy_returns), name="equity")
    portfolio = vbt.Portfolio.from_holding(close, init_cash=10_000.0, freq="1D")

    return {
        "total_return_pct": float(portfolio.total_return() * 100.0),
        "max_drawdown_pct": float(portfolio.max_drawdown() * 100.0),
        "sharpe_ratio": float(portfolio.sharpe_ratio()),
        "calmar_ratio": float(portfolio.calmar_ratio()),
    }


def main() -> None:
    args = parse_args()
    frame = load_dataset(args.dataset)

    grid = get_grid()
    all_results: list[EvalResult] = []
    constrained_results: list[EvalResult] = []
    fallback_enabled = args.allow_unconstrained_fallback == "true"

    for params in grid:
        result = evaluate_candidate(frame, params)
        all_results.append(result)
        if candidate_is_valid(result, args.min_trades, args.max_drawdown_pct):
            constrained_results.append(result)

    if not all_results:
        raise SystemExit("No candidates were evaluated.")

    selected_pool = constrained_results
    constraints_relaxed = False
    if not selected_pool:
        if not fallback_enabled:
            raise SystemExit("No candidate passed constraints. Loosen min-trades or max-drawdown-pct.")
        selected_pool = all_results
        constraints_relaxed = True

    selected_pool.sort(key=lambda row: row.objective, reverse=True)
    best = selected_pool[0]

    top = selected_pool[: max(1, args.top_k)]

    stamp = pd.Timestamp.utcnow().strftime("%Y%m%d-%H%M%S")
    artifact_dir = Path(args.artifact_root) / stamp
    artifact_dir.mkdir(parents=True, exist_ok=True)

    selected_params = {
        "allowedStates": ["trend_up", "trend_down"],
        "requireStackAlignment": True,
        "requireSlopeAlignment": True,
        "allowNeutralSignal": False,
        **best.params,
    }

    config_payload = {
        "strategyType": args.strategy_type,
        "strategyVersion": f"{stamp}",
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "gridSize": len(grid),
        "selectedParams": selected_params,
        "constraints": {
            "minTrades": args.min_trades,
            "maxDrawdownPct": args.max_drawdown_pct,
            "relaxed": constraints_relaxed,
        },
        "dataset": {
            "path": str(Path(args.dataset).resolve()),
            "rows": int(len(frame)),
            "splitCounts": frame["split"].value_counts(dropna=False).to_dict(),
        },
    }

    report_payload = {
        "strategyType": args.strategy_type,
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "objective": "0.7 * valid_expectancy_pct + 0.3 * test_expectancy_pct",
        "best": {
            "params": best.params,
            "objective": best.objective,
            "train": best.train,
            "valid": best.valid,
            "test": best.test,
            "vectorbt": with_vectorbt_summary(frame, best.params),
        },
        "topCandidates": [
            {
                "rank": idx + 1,
                "params": item.params,
                "objective": item.objective,
                "train": item.train,
                "valid": item.valid,
                "test": item.test,
            }
            for idx, item in enumerate(top)
        ],
    }

    config_path = artifact_dir / "config.json"
    report_path = artifact_dir / "report.json"

    config_path.write_text(json.dumps(config_payload, indent=2), encoding="utf-8")
    report_path.write_text(json.dumps(report_payload, indent=2), encoding="utf-8")

    print("backtest_complete")
    print(f"artifact_dir={artifact_dir}")
    print(f"config={config_path}")
    print(f"report={report_path}")
    print(f"best_objective={best.objective:.4f}")
    print(f"best_params={json.dumps(best.params)}")
    print(f"constraints_relaxed={constraints_relaxed}")


if __name__ == "__main__":
    main()
