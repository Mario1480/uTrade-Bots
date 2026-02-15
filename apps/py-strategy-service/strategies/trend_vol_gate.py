from __future__ import annotations

from typing import Any

from models import StrategyRunRequest, StrategyRunResponse


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


def _score_bool(value: bool) -> float:
    return 1.0 if value else 0.0


def _fmt_num(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2f}"


def run(request: StrategyRunRequest) -> StrategyRunResponse:
    defaults = {
        "allowedStates": ["trend_up", "trend_down"],
        "minRegimeConf": 55,
        "requireStackAlignment": True,
        "requireSlopeAlignment": True,
        "minAbsD50Pct": 0.12,
        "minAbsD200Pct": 0.20,
        "maxVolZ": 2.5,
        "maxRelVol": 1.8,
        "minVolZ": -1.2,
        "minRelVol": 0.6,
        "minPassScore": 70,
        "allowNeutralSignal": False,
    }
    config = {**defaults, **request.config}

    snapshot = _as_dict(request.featureSnapshot)
    history = _as_dict(snapshot.get("historyContext"))
    reg = _as_dict(history.get("reg"))
    ema = _as_dict(history.get("ema"))
    vol = _as_dict(history.get("vol"))
    risk_flags = _as_dict(snapshot.get("riskFlags"))

    signal = request.context.signal or "neutral"
    state = str(reg.get("state") or "unknown").strip() or "unknown"
    conf = _as_float(reg.get("conf"))
    stack = str(ema.get("stk") or "unknown").strip() or "unknown"
    d50 = _as_float(ema.get("d50"))
    d200 = _as_float(ema.get("d200"))
    sl50 = _as_float(ema.get("sl50"))
    vol_z = _as_float(vol.get("z"))
    rel_vol = _as_float(vol.get("rv"))
    data_gap = risk_flags.get("dataGap") is True

    allowed_states = [str(x).strip() for x in config.get("allowedStates", defaults["allowedStates"]) if isinstance(x, str)]
    min_regime_conf = _as_float(config.get("minRegimeConf"))
    min_regime_conf = min_regime_conf if min_regime_conf is not None else 55.0
    require_stack_alignment = _as_bool(config.get("requireStackAlignment"), True)
    require_slope_alignment = _as_bool(config.get("requireSlopeAlignment"), True)
    min_abs_d50 = _as_float(config.get("minAbsD50Pct"))
    min_abs_d50 = min_abs_d50 if min_abs_d50 is not None else 0.12
    min_abs_d200 = _as_float(config.get("minAbsD200Pct"))
    min_abs_d200 = min_abs_d200 if min_abs_d200 is not None else 0.20
    max_vol_z = _as_float(config.get("maxVolZ"))
    max_vol_z = max_vol_z if max_vol_z is not None else 2.5
    max_rel_vol = _as_float(config.get("maxRelVol"))
    max_rel_vol = max_rel_vol if max_rel_vol is not None else 1.8
    min_vol_z = _as_float(config.get("minVolZ"))
    min_vol_z = min_vol_z if min_vol_z is not None else -1.2
    min_rel_vol = _as_float(config.get("minRelVol"))
    min_rel_vol = min_rel_vol if min_rel_vol is not None else 0.6
    min_pass_score = _as_float(config.get("minPassScore"))
    min_pass_score = min_pass_score if min_pass_score is not None else 70.0
    allow_neutral = _as_bool(config.get("allowNeutralSignal"), False)

    stack_aligned = (signal == "up" and stack == "bull") or (signal == "down" and stack == "bear")
    slope_aligned = (signal == "up" and (sl50 is not None and sl50 >= 0.0)) or (
        signal == "down" and (sl50 is not None and sl50 <= 0.0)
    )
    distance_ok = (
        d50 is not None
        and d200 is not None
        and abs(d50) >= min_abs_d50
        and abs(d200) >= min_abs_d200
    )
    vol_spike_risk = (
        vol_z is not None
        and rel_vol is not None
        and vol_z >= max_vol_z
        and rel_vol >= max_rel_vol
    )
    low_liquidity_risk = (
        (vol_z is not None and vol_z <= min_vol_z)
        or (rel_vol is not None and rel_vol <= min_rel_vol)
    )
    vol_ok = not vol_spike_risk and not low_liquidity_risk and vol_z is not None and rel_vol is not None

    base_score = conf if conf is not None else 0.0
    score = round(
        _clamp(
            0.6 * base_score
            + 20.0 * _score_bool(stack_aligned)
            + 10.0 * _score_bool(slope_aligned)
            + 10.0 * _score_bool(distance_ok)
            + 10.0 * _score_bool(vol_ok),
            0.0,
            100.0,
        )
    )

    allow = True
    reasons: list[str] = []

    if signal == "neutral" and not allow_neutral:
        allow = False
        reasons.append("signal_missing_or_neutral")

    if allow and state not in allowed_states:
        allow = False
        reasons.append("regime_state_not_allowed")

    if allow and (conf is None or conf < min_regime_conf):
        allow = False
        reasons.append("regime_confidence_low")

    if allow and require_stack_alignment and not stack_aligned:
        allow = False
        reasons.append("ema_stack_conflict")

    if allow and require_slope_alignment and not slope_aligned:
        allow = False
        reasons.append("ema_slope_conflict")

    if allow and not distance_ok:
        allow = False
        reasons.append("distance_too_small")

    if allow and vol_spike_risk:
        allow = False
        reasons.append("vol_spike_risk")

    if allow and low_liquidity_risk:
        allow = False
        reasons.append("low_liquidity_risk")

    if allow and score < min_pass_score:
        allow = False
        reasons.append("score_below_threshold")

    if allow:
        reasons.append("trend_vol_gate_pass")

    tags: list[str] = []
    if state == "trend_up":
        tags.append("trend_up")
    if state == "trend_down":
        tags.append("trend_down")
    if state in {"range", "transition"}:
        tags.append("range_bound")
    if vol_z is not None and vol_z >= 1.5:
        tags.append("high_vol")
    if low_liquidity_risk:
        tags.append("low_liquidity")
    if data_gap:
        tags.append("data_gap")

    explanation = (
        f"TrendVolGate {'pass' if allow else 'block'}: state={state}, conf={_fmt_num(conf)}, "
        f"signal={signal}, stack={stack}, z={_fmt_num(vol_z)}, rv={_fmt_num(rel_vol)}."
    )
    explanation = explanation[:220]

    return StrategyRunResponse(
        allow=allow,
        score=score,
        reasonCodes=reasons,
        tags=tags,
        explanation=explanation,
        meta={
            "strategy": "trend_vol_gate",
            "signal": signal,
            "regimeState": state,
            "regimeConfidencePct": conf,
            "emaStack": stack,
            "d50": d50,
            "d200": d200,
            "sl50": sl50,
            "volZ": vol_z,
            "relVol": rel_vol,
            "stackAligned": stack_aligned,
            "slopeAligned": slope_aligned,
            "distanceOk": distance_ok,
            "volSpikeRisk": vol_spike_risk,
            "lowLiquidityRisk": low_liquidity_risk,
            "scoreThreshold": min_pass_score,
            "scoreBase": base_score,
            "dataGap": data_gap,
        },
    )
