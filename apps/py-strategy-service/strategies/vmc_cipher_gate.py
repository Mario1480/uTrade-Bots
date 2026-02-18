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


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _safe_age(value: Any) -> int | None:
    parsed = _as_float(value)
    if parsed is None:
        return None
    return max(0, int(parsed))


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def run(request: StrategyRunRequest) -> StrategyRunResponse:
    defaults = {
        "requireNonNeutralSignal": True,
        "blockOnDataGap": True,
        "maxSignalAgeBars": 4,
        "allowDivSignalAsPrimary": True,
        "minPassScore": 60,
    }
    config = {**defaults, **request.config}

    require_non_neutral = _as_bool(config.get("requireNonNeutralSignal"), True)
    block_on_data_gap = _as_bool(config.get("blockOnDataGap"), True)
    allow_div_primary = _as_bool(config.get("allowDivSignalAsPrimary"), True)
    max_signal_age = _safe_age(config.get("maxSignalAgeBars"))
    max_signal_age = max_signal_age if max_signal_age is not None else 4
    min_pass_score = _as_float(config.get("minPassScore"))
    min_pass_score = min_pass_score if min_pass_score is not None else 60.0

    signal = request.context.signal or "neutral"
    snapshot = _as_dict(request.featureSnapshot)
    indicators = _as_dict(snapshot.get("indicators"))
    vmc = _as_dict(indicators.get("vumanchu"))
    signals = _as_dict(vmc.get("signals"))
    wave = _as_dict(vmc.get("waveTrend"))
    ages = _as_dict(signals.get("ages"))
    risk_flags = _as_dict(snapshot.get("riskFlags"))

    vmc_missing = not vmc
    vmc_data_gap = _as_bool(vmc.get("dataGap"), False)
    risk_data_gap = _as_bool(risk_flags.get("dataGap"), False)
    data_gap = vmc_data_gap or risk_data_gap

    buy_signal = _as_bool(signals.get("buy"), False)
    sell_signal = _as_bool(signals.get("sell"), False)
    buy_div_signal = _as_bool(signals.get("buyDiv"), False)
    sell_div_signal = _as_bool(signals.get("sellDiv"), False)
    gold_no_buy = _as_bool(signals.get("goldNoBuyLong"), False)

    buy_age = _safe_age(ages.get("buy"))
    sell_age = _safe_age(ages.get("sell"))
    buy_div_age = _safe_age(ages.get("buyDiv"))
    sell_div_age = _safe_age(ages.get("sellDiv"))

    cross_up = _as_bool(wave.get("crossUp"), False)
    cross_down = _as_bool(wave.get("crossDown"), False)
    oversold = _as_bool(wave.get("oversold"), False)
    overbought = _as_bool(wave.get("overbought"), False)

    directional_primary = (
        (signal == "up" and buy_signal)
        or (signal == "down" and sell_signal)
    )
    directional_div = (
        (signal == "up" and buy_div_signal)
        or (signal == "down" and sell_div_signal)
    )
    directional_ok = directional_primary or (allow_div_primary and directional_div)

    directional_age = (
        buy_age if signal == "up"
        else sell_age if signal == "down"
        else None
    )
    div_age = (
        buy_div_age if signal == "up"
        else sell_div_age if signal == "down"
        else None
    )
    effective_age = directional_age if directional_age is not None else div_age
    age_fresh = effective_age is not None and effective_age <= max_signal_age

    cross_aligned = (signal == "up" and cross_up) or (signal == "down" and cross_down)
    zone_aligned = (signal == "up" and oversold) or (signal == "down" and overbought)
    div_aligned = directional_div

    score = round(
        _clamp(
            25.0
            + 30.0 * (1.0 if directional_ok else 0.0)
            + 20.0 * (1.0 if div_aligned else 0.0)
            + 10.0 * (1.0 if cross_aligned else 0.0)
            + 10.0 * (1.0 if zone_aligned else 0.0)
            + 5.0 * (1.0 if age_fresh else 0.0),
            0.0,
            100.0,
        )
    )

    allow = True
    reasons: list[str] = []

    if allow and require_non_neutral and signal == "neutral":
        allow = False
        reasons.append("signal_missing_or_neutral")

    if allow and vmc_missing:
        allow = False
        reasons.append("vmc_context_missing")

    if allow and block_on_data_gap and data_gap:
        allow = False
        reasons.append("vmc_data_gap")

    if allow and signal == "up" and gold_no_buy:
        allow = False
        reasons.append("vmc_gold_dot_no_long")

    if allow and not directional_ok:
        allow = False
        reasons.append("vmc_directional_signal_missing")

    if allow and not age_fresh:
        allow = False
        reasons.append("vmc_signal_too_old")

    if allow and score < min_pass_score:
        allow = False
        reasons.append("score_below_threshold")

    if allow:
        reasons.append("vmc_cipher_gate_pass")

    tags: list[str] = []
    if signal == "up":
        tags.append("vmc_up")
    elif signal == "down":
        tags.append("vmc_down")
    if div_aligned:
        tags.append("vmc_divergence")
    if signal == "up" and gold_no_buy:
        tags.append("vmc_gold_block")
    if data_gap:
        tags.append("data_gap")

    explanation = (
        f"VMC Cipher {'pass' if allow else 'block'}: signal={signal}, "
        f"primary={directional_primary}, div={directional_div}, age={effective_age}, score={score}."
    )
    explanation = explanation[:220]

    return StrategyRunResponse(
        allow=allow,
        score=score,
        reasonCodes=reasons,
        tags=tags,
        explanation=explanation,
        meta={
            "strategy": "vmc_cipher_gate",
            "signal": signal,
            "directionalPrimary": directional_primary,
            "directionalDiv": directional_div,
            "directionalOk": directional_ok,
            "effectiveAgeBars": effective_age,
            "maxSignalAgeBars": max_signal_age,
            "crossAligned": cross_aligned,
            "zoneAligned": zone_aligned,
            "divAligned": div_aligned,
            "scoreThreshold": min_pass_score,
            "dataGap": data_gap,
            "vmcDataGap": vmc_data_gap,
            "riskDataGap": risk_data_gap,
            "goldNoBuyLong": gold_no_buy,
        },
    )
