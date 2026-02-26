from __future__ import annotations

from typing import Any

from models import StrategyRunRequest, StrategyRunResponse
from strategies.ta_backend import compute_ta_indicators, extract_ohlcv_frame


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _fmt_num(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2f}"


def _fallback_indicator(snapshot: dict[str, Any]) -> dict[str, float | None]:
    indicators = _as_dict(snapshot.get("indicators"))
    adx_obj = _as_dict(indicators.get("adx"))
    history = _as_dict(snapshot.get("historyContext"))
    ema_ctx = _as_dict(history.get("ema"))

    return {
        "rsi": _as_float(indicators.get("rsi_14")),
        "adx": _as_float(adx_obj.get("adx_14")),
        "atr_pct": _as_float(indicators.get("atr_pct")),
        "ema_fast": _as_float(ema_ctx.get("ema20")),
        "ema_slow": _as_float(ema_ctx.get("ema50")),
    }


def run(request: StrategyRunRequest) -> StrategyRunResponse:
    defaults = {
        "allowedStates": ["trend_up", "trend_down"],
        "minRegimeConf": 50,
        "minAdx": 18,
        "maxAtrPct": 2.0,
        "rsiLongMin": 52,
        "rsiShortMax": 48,
        "requireEmaAlignment": True,
        "minPassScore": 65,
        "allowNeutralSignal": False,
    }
    config = {**defaults, **request.config}

    signal = request.context.signal or "neutral"
    snapshot = _as_dict(request.featureSnapshot)
    history = _as_dict(snapshot.get("historyContext"))
    reg = _as_dict(history.get("reg"))
    risk_flags = _as_dict(snapshot.get("riskFlags"))

    state = str(reg.get("state") or "unknown").strip() or "unknown"
    conf = _as_float(reg.get("conf"))
    data_gap = risk_flags.get("dataGap") is True

    allowed_states = [str(x).strip() for x in config.get("allowedStates", defaults["allowedStates"]) if isinstance(x, str)]
    min_reg_conf = _as_float(config.get("minRegimeConf"))
    min_reg_conf = min_reg_conf if min_reg_conf is not None else defaults["minRegimeConf"]
    min_adx = _as_float(config.get("minAdx"))
    min_adx = min_adx if min_adx is not None else defaults["minAdx"]
    max_atr_pct = _as_float(config.get("maxAtrPct"))
    max_atr_pct = max_atr_pct if max_atr_pct is not None else defaults["maxAtrPct"]
    rsi_long_min = _as_float(config.get("rsiLongMin"))
    rsi_long_min = rsi_long_min if rsi_long_min is not None else defaults["rsiLongMin"]
    rsi_short_max = _as_float(config.get("rsiShortMax"))
    rsi_short_max = rsi_short_max if rsi_short_max is not None else defaults["rsiShortMax"]
    require_ema_alignment = _as_bool(config.get("requireEmaAlignment"), True)
    min_pass_score = _as_float(config.get("minPassScore"))
    min_pass_score = min_pass_score if min_pass_score is not None else defaults["minPassScore"]
    allow_neutral = _as_bool(config.get("allowNeutralSignal"), False)

    frame, frame_error = extract_ohlcv_frame(snapshot)
    ta_values: dict[str, Any] = {}
    ta_error: str | None = None
    indicator_source = "fallback"

    if frame is not None:
        ta_values, ta_error = compute_ta_indicators(frame)
        if ta_error is None:
            indicator_source = "ohlcv"

    if ta_error is not None or frame is None:
        fallback = _fallback_indicator(snapshot)
        ta_values = {
            **ta_values,
            **fallback,
        }
        if ta_error is None:
            ta_error = frame_error

    rsi = _as_float(ta_values.get("rsi"))
    adx = _as_float(ta_values.get("adx"))
    atr_pct = _as_float(ta_values.get("atr_pct"))
    ema_fast = _as_float(ta_values.get("ema_fast"))
    ema_slow = _as_float(ta_values.get("ema_slow"))

    ema_aligned = (
        (signal == "up" and ema_fast is not None and ema_slow is not None and ema_fast >= ema_slow)
        or (signal == "down" and ema_fast is not None and ema_slow is not None and ema_fast <= ema_slow)
    )

    rsi_aligned = (
        (signal == "up" and rsi is not None and rsi >= rsi_long_min)
        or (signal == "down" and rsi is not None and rsi <= rsi_short_max)
    )

    adx_ok = adx is not None and adx >= min_adx
    atr_ok = atr_pct is not None and atr_pct <= max_atr_pct

    score = round(
        _clamp(
            0.4 * (conf if conf is not None else 0.0)
            + 20.0 * (1.0 if adx_ok else 0.0)
            + 15.0 * (1.0 if rsi_aligned else 0.0)
            + 15.0 * (1.0 if atr_ok else 0.0)
            + 10.0 * (1.0 if ema_aligned else 0.0),
            0.0,
            100.0,
        )
    )

    allow = True
    reason_codes: list[str] = []

    if signal == "neutral" and not allow_neutral:
        allow = False
        reason_codes.append("signal_missing_or_neutral")

    if allow and state not in allowed_states:
        allow = False
        reason_codes.append("regime_state_not_allowed")

    if allow and (conf is None or conf < min_reg_conf):
        allow = False
        reason_codes.append("regime_confidence_low")

    if allow and ta_error == "ta_backend_unavailable":
        allow = False
        reason_codes.append("ta_backend_unavailable")

    if allow and (adx is None or rsi is None or atr_pct is None):
        allow = False
        reason_codes.append("ta_input_missing")

    if allow and not adx_ok:
        allow = False
        reason_codes.append("adx_too_low")

    if allow and not atr_ok:
        allow = False
        reason_codes.append("atr_too_high")

    if allow and not rsi_aligned:
        allow = False
        reason_codes.append("rsi_not_aligned")

    if allow and require_ema_alignment and not ema_aligned:
        allow = False
        reason_codes.append("ema_not_aligned")

    if allow and score < min_pass_score:
        allow = False
        reason_codes.append("score_below_threshold")

    if allow:
        reason_codes.append("ta_trend_vol_gate_v2_pass")

    tags: list[str] = []
    if state == "trend_up":
        tags.append("trend_up")
    if state == "trend_down":
        tags.append("trend_down")
    if data_gap:
        tags.append("data_gap")
    if atr_pct is not None and atr_pct >= 1.5:
        tags.append("high_vol")

    explanation = (
        f"TA TrendVol v2 {'pass' if allow else 'block'}: state={state}, conf={_fmt_num(conf)}, "
        f"adx={_fmt_num(adx)}, rsi={_fmt_num(rsi)}, atr%={_fmt_num(atr_pct)}, src={indicator_source}."
    )
    explanation = explanation[:220]

    return StrategyRunResponse(
        allow=allow,
        score=score,
        reasonCodes=reason_codes,
        tags=tags,
        explanation=explanation,
        meta={
            "strategy": "ta_trend_vol_gate_v2",
            "signal": signal,
            "regimeState": state,
            "regimeConfidencePct": conf,
            "indicatorSource": indicator_source,
            "taBackend": ta_values.get("backend"),
            "taError": ta_error,
            "rsi": rsi,
            "adx": adx,
            "atrPct": atr_pct,
            "emaFast": ema_fast,
            "emaSlow": ema_slow,
            "emaAligned": ema_aligned,
            "rsiAligned": rsi_aligned,
            "adxOk": adx_ok,
            "atrOk": atr_ok,
            "scoreThreshold": min_pass_score,
            "dataGap": data_gap,
        },
    )
