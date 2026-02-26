from __future__ import annotations

import os
from typing import Any

import numpy as np
import pandas as pd

try:
    import pandas_ta as pta  # type: ignore
except Exception:
    pta = None

try:
    import talib  # type: ignore
except Exception:
    talib = None


TA_BACKENDS = {"auto", "talib", "pandas_ta"}


def resolve_backend() -> str:
    raw = str(os.getenv("PY_TA_BACKEND", "auto")).strip().lower()
    if raw in TA_BACKENDS:
        return raw
    return "auto"


def _to_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def _row_from_tuple(row: list[Any], fmt: list[str]) -> dict[str, Any] | None:
    if len(row) < 6:
        return None

    lookup: dict[str, Any] = {}
    for idx, key in enumerate(fmt):
        if idx >= len(row):
            break
        lookup[str(key)] = row[idx]

    ts = lookup.get("ts")
    open_ = _to_float(lookup.get("open"))
    high = _to_float(lookup.get("high"))
    low = _to_float(lookup.get("low"))
    close = _to_float(lookup.get("close"))
    volume = _to_float(lookup.get("volume"))

    if open_ is None or high is None or low is None or close is None or volume is None:
        return None

    return {
        "ts": ts,
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }


def extract_ohlcv_frame(feature_snapshot: dict[str, Any]) -> tuple[pd.DataFrame | None, str | None]:
    ohlcv = feature_snapshot.get("ohlcvSeries")
    if not isinstance(ohlcv, dict):
        return None, "ta_input_missing"

    bars = ohlcv.get("bars")
    if not isinstance(bars, list) or len(bars) < 35:
        return None, "ta_input_missing"

    fmt_raw = ohlcv.get("format")
    fmt = ["ts", "open", "high", "low", "close", "volume"]
    if isinstance(fmt_raw, list) and len(fmt_raw) >= 6 and all(isinstance(item, str) for item in fmt_raw):
        fmt = [str(item) for item in fmt_raw]

    rows: list[dict[str, Any]] = []
    for raw in bars:
        if isinstance(raw, dict):
            open_ = _to_float(raw.get("open"))
            high = _to_float(raw.get("high"))
            low = _to_float(raw.get("low"))
            close = _to_float(raw.get("close"))
            volume = _to_float(raw.get("volume"))
            if open_ is None or high is None or low is None or close is None or volume is None:
                continue
            rows.append(
                {
                    "ts": raw.get("ts"),
                    "open": open_,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": volume,
                }
            )
            continue

        if isinstance(raw, list):
            parsed = _row_from_tuple(raw, fmt)
            if parsed:
                rows.append(parsed)

    if len(rows) < 35:
        return None, "ta_input_missing"

    frame = pd.DataFrame(rows)
    if frame.empty:
        return None, "ta_input_missing"

    frame = frame.copy()
    if "ts" in frame.columns:
        frame["ts"] = pd.to_datetime(frame["ts"], utc=True, errors="coerce")
        frame = frame.sort_values("ts")

    for col in ["open", "high", "low", "close", "volume"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")

    frame = frame.dropna(subset=["open", "high", "low", "close", "volume"]).reset_index(drop=True)
    if len(frame) < 35:
        return None, "ta_input_missing"

    return frame, None


def _compute_with_talib(frame: pd.DataFrame) -> dict[str, float | None]:
    highs = frame["high"].to_numpy(dtype=float)
    lows = frame["low"].to_numpy(dtype=float)
    closes = frame["close"].to_numpy(dtype=float)

    rsi = talib.RSI(closes, timeperiod=14)
    adx = talib.ADX(highs, lows, closes, timeperiod=14)
    atr = talib.ATR(highs, lows, closes, timeperiod=14)
    ema_fast = talib.EMA(closes, timeperiod=20)
    ema_slow = talib.EMA(closes, timeperiod=50)

    last_close = closes[-1] if closes.size else np.nan
    atr_last = atr[-1] if atr.size else np.nan
    atr_pct = (atr_last / last_close) * 100.0 if np.isfinite(last_close) and last_close > 0 and np.isfinite(atr_last) else np.nan

    return {
        "rsi": float(rsi[-1]) if rsi.size and np.isfinite(rsi[-1]) else None,
        "adx": float(adx[-1]) if adx.size and np.isfinite(adx[-1]) else None,
        "atr_pct": float(atr_pct) if np.isfinite(atr_pct) else None,
        "ema_fast": float(ema_fast[-1]) if ema_fast.size and np.isfinite(ema_fast[-1]) else None,
        "ema_slow": float(ema_slow[-1]) if ema_slow.size and np.isfinite(ema_slow[-1]) else None,
    }


def _compute_with_pandas_ta(frame: pd.DataFrame) -> dict[str, float | None]:
    local = frame.copy()
    local["rsi_14"] = pta.rsi(local["close"], length=14)
    local["adx_14"] = pta.adx(local["high"], local["low"], local["close"], length=14)["ADX_14"]
    local["atr_14"] = pta.atr(local["high"], local["low"], local["close"], length=14)
    local["ema_fast_20"] = pta.ema(local["close"], length=20)
    local["ema_slow_50"] = pta.ema(local["close"], length=50)

    tail = local.iloc[-1]
    close = _to_float(tail.get("close"))
    atr = _to_float(tail.get("atr_14"))
    atr_pct = ((atr / close) * 100.0) if atr is not None and close is not None and close > 0 else None

    return {
        "rsi": _to_float(tail.get("rsi_14")),
        "adx": _to_float(tail.get("adx_14")),
        "atr_pct": atr_pct,
        "ema_fast": _to_float(tail.get("ema_fast_20")),
        "ema_slow": _to_float(tail.get("ema_slow_50")),
    }


def compute_ta_indicators(frame: pd.DataFrame) -> tuple[dict[str, Any], str | None]:
    backend = resolve_backend()

    if backend == "talib":
        if talib is None:
            return {"backend": backend}, "ta_backend_unavailable"
        return {"backend": backend, **_compute_with_talib(frame)}, None

    if backend == "pandas_ta":
        if pta is None:
            return {"backend": backend}, "ta_backend_unavailable"
        return {"backend": backend, **_compute_with_pandas_ta(frame)}, None

    if talib is not None:
        return {"backend": "talib", **_compute_with_talib(frame)}, None
    if pta is not None:
        return {"backend": "pandas_ta", **_compute_with_pandas_ta(frame)}, None

    return {"backend": "auto"}, "ta_backend_unavailable"
