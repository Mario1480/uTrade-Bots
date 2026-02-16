#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd
from sqlalchemy import create_engine, text


@dataclass
class QueryScope:
    symbol: str | None
    timeframe: str | None
    market_type: str | None
    ts_from: str | None
    ts_to: str | None
    limit: int | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a research dataset from Prediction rows (evaluated outcomes only)."
    )
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres URL. Defaults to DATABASE_URL.")
    parser.add_argument("--symbol", default=None, help="Optional symbol filter, e.g. BTCUSDT.")
    parser.add_argument("--timeframe", default=None, help="Optional timeframe filter, e.g. 15m.")
    parser.add_argument("--market-type", default="perp", help="Optional marketType filter. Use empty string to disable.")
    parser.add_argument("--from", dest="ts_from", default=None, help="Inclusive ISO timestamp lower bound for tsCreated.")
    parser.add_argument("--to", dest="ts_to", default=None, help="Inclusive ISO timestamp upper bound for tsCreated.")
    parser.add_argument("--limit", type=int, default=None, help="Optional max rows after filtering.")
    parser.add_argument(
        "--out-dir",
        default="apps/quant-research/data",
        help="Output directory for parquet/csv datasets.",
    )
    parser.add_argument("--out-name", default="predictions_dataset", help="Output file prefix.")
    parser.add_argument("--train-ratio", type=float, default=0.6)
    parser.add_argument("--valid-ratio", type=float, default=0.2)
    parser.add_argument("--min-rows", type=int, default=200)
    return parser.parse_args()


def normalize_database_url(raw: str) -> str:
    value = raw.strip()
    if value.startswith("postgresql://"):
        value = "postgresql+psycopg://" + value[len("postgresql://") :]
    if value.startswith("postgres://"):
        value = "postgresql+psycopg://" + value[len("postgres://") :]

    parsed = urlsplit(value)
    if parsed.scheme != "postgresql+psycopg":
        return value

    query_pairs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() != "schema"]
    normalized_query = urlencode(query_pairs)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, normalized_query, parsed.fragment))


def as_record(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def deep_get(obj: dict[str, Any], path: list[str], default: Any = None) -> Any:
    cur: Any = obj
    for segment in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(segment)
    return default if cur is None else cur


def to_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def normalize_signal(value: Any) -> str:
    if value in ("up", "down", "neutral"):
        return str(value)
    return "neutral"


def build_sql(scope: QueryScope) -> tuple[str, dict[str, Any]]:
    clauses = ['"outcomePnlPct" IS NOT NULL']
    params: dict[str, Any] = {}

    if scope.symbol:
        clauses.append('symbol = :symbol')
        params["symbol"] = scope.symbol
    if scope.timeframe:
        clauses.append('timeframe = :timeframe')
        params["timeframe"] = scope.timeframe
    if scope.market_type:
        clauses.append('"marketType" = :market_type')
        params["market_type"] = scope.market_type
    if scope.ts_from:
        clauses.append('"tsCreated" >= :ts_from')
        params["ts_from"] = scope.ts_from
    if scope.ts_to:
        clauses.append('"tsCreated" <= :ts_to')
        params["ts_to"] = scope.ts_to

    where_sql = " AND ".join(clauses)
    limit_sql = ""
    if scope.limit and scope.limit > 0:
        limit_sql = " LIMIT :limit"
        params["limit"] = scope.limit

    sql = f'''
SELECT
  id,
  symbol,
  timeframe,
  "marketType",
  "tsCreated",
  "featuresSnapshot",
  "outcomeStatus",
  "outcomeResult",
  "outcomePnlPct"
FROM "Prediction"
WHERE {where_sql}
ORDER BY "tsCreated" ASC{limit_sql}
'''
    return sql, params


def assign_splits(frame: pd.DataFrame, train_ratio: float, valid_ratio: float) -> pd.Series:
    n_rows = len(frame)
    train_end = int(n_rows * train_ratio)
    valid_end = int(n_rows * (train_ratio + valid_ratio))
    out = pd.Series(index=frame.index, dtype="string")
    out.iloc[:train_end] = "train"
    out.iloc[train_end:valid_end] = "valid"
    out.iloc[valid_end:] = "test"
    return out


def extract_row(row: dict[str, Any]) -> dict[str, Any]:
    features = as_record(row.get("featuresSnapshot"))
    history = as_record(features.get("historyContext"))
    reg = as_record(history.get("reg"))
    ema = as_record(history.get("ema"))
    vol = as_record(history.get("vol"))
    risk = as_record(features.get("riskFlags"))
    local_prediction = as_record(features.get("localPrediction"))

    outcome_pnl_pct = to_float(row.get("outcomePnlPct"))

    return {
        "prediction_id": row.get("id"),
        "ts_created": row.get("tsCreated"),
        "symbol": row.get("symbol"),
        "timeframe": row.get("timeframe"),
        "market_type": row.get("marketType"),
        "outcome_status": row.get("outcomeStatus"),
        "outcome_result": row.get("outcomeResult"),
        "outcome_pnl_pct": outcome_pnl_pct,
        "target_win": bool(outcome_pnl_pct is not None and outcome_pnl_pct > 0),
        "signal": normalize_signal(local_prediction.get("signal")),
        "reg_state": str(deep_get(reg, ["state"], "unknown") or "unknown"),
        "reg_conf": to_float(deep_get(reg, ["conf"])),
        "ema_stk": str(deep_get(ema, ["stk"], "unknown") or "unknown"),
        "ema_d50": to_float(deep_get(ema, ["d50"])),
        "ema_d200": to_float(deep_get(ema, ["d200"])),
        "ema_sl50": to_float(deep_get(ema, ["sl50"])),
        "vol_z": to_float(deep_get(vol, ["z"])),
        "vol_rv": to_float(deep_get(vol, ["rv"])),
        "risk_data_gap": deep_get(risk, ["dataGap"], False) is True,
    }


def main() -> None:
    args = parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL missing. Pass --database-url or set DATABASE_URL.")

    if args.train_ratio <= 0 or args.valid_ratio <= 0 or args.train_ratio + args.valid_ratio >= 1:
        raise SystemExit("Invalid split ratios. Require train_ratio > 0, valid_ratio > 0 and train+valid < 1.")

    market_type = args.market_type.strip() if isinstance(args.market_type, str) else None
    if market_type == "":
        market_type = None

    scope = QueryScope(
        symbol=args.symbol,
        timeframe=args.timeframe,
        market_type=market_type,
        ts_from=args.ts_from,
        ts_to=args.ts_to,
        limit=args.limit,
    )

    sql, params = build_sql(scope)
    engine = create_engine(normalize_database_url(args.database_url))

    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()

    extracted = [extract_row(dict(row)) for row in rows]
    frame = pd.DataFrame(extracted)
    if frame.empty:
        raise SystemExit("No rows found with current filters.")

    frame = frame.sort_values("ts_created").reset_index(drop=True)
    frame["split"] = assign_splits(frame, args.train_ratio, args.valid_ratio)

    if len(frame) < args.min_rows:
        raise SystemExit(f"Insufficient rows ({len(frame)}). Need at least {args.min_rows}.")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = pd.Timestamp.utcnow().strftime("%Y%m%d-%H%M%S")
    csv_path = out_dir / f"{args.out_name}_{stamp}.csv"
    parquet_path = out_dir / f"{args.out_name}_{stamp}.parquet"

    parquet_written = False
    try:
        frame.to_parquet(parquet_path, index=False)
        parquet_written = True
    except Exception:
        parquet_written = False

    frame.to_csv(csv_path, index=False)

    split_counts = frame["split"].value_counts(dropna=False).to_dict()

    print("dataset_built")
    print(f"rows={len(frame)}")
    print(f"symbols={sorted(frame['symbol'].dropna().unique().tolist())}")
    print(f"timeframes={sorted(frame['timeframe'].dropna().unique().tolist())}")
    print(f"splits={split_counts}")
    print(f"parquet={parquet_path if parquet_written else 'not_written (install pyarrow for parquet support)'}")
    print(f"csv={csv_path}")


if __name__ == "__main__":
    main()
