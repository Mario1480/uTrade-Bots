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


def _directional_divergence(
    signal: str,
    branch: dict[str, Any],
    include_hidden: bool
) -> bool:
    if signal == "up":
        regular = _as_bool(branch.get("bullish"), False) or _as_bool(branch.get("bullishAdd"), False)
        hidden = _as_bool(branch.get("bullishHidden"), False)
    elif signal == "down":
        regular = _as_bool(branch.get("bearish"), False) or _as_bool(branch.get("bearishAdd"), False)
        hidden = _as_bool(branch.get("bearishHidden"), False)
    else:
        return False
    return regular or (include_hidden and hidden)


def _directional_regular_divergence(signal: str, branch: dict[str, Any]) -> bool:
    if signal == "up":
        return _as_bool(branch.get("bullish"), False) or _as_bool(branch.get("bullishAdd"), False)
    if signal == "down":
        return _as_bool(branch.get("bearish"), False) or _as_bool(branch.get("bearishAdd"), False)
    return False


def _directional_div_age(signal: str, branch: dict[str, Any], include_hidden: bool) -> int | None:
    if signal == "up":
        regular_age = _safe_age(branch.get("lastBullishAgeBars"))
        hidden_age = _safe_age(branch.get("lastBullishAgeBars")) if include_hidden else None
    elif signal == "down":
        regular_age = _safe_age(branch.get("lastBearishAgeBars"))
        hidden_age = _safe_age(branch.get("lastBearishAgeBars")) if include_hidden else None
    else:
        return None
    candidates = [age for age in [regular_age, hidden_age] if age is not None]
    if len(candidates) == 0:
        return None
    return min(candidates)


def run(request: StrategyRunRequest) -> StrategyRunResponse:
    defaults = {
        "requireNonNeutralSignal": True,
        "blockOnDataGap": True,
        "requireRegularDiv": True,
        "allowHiddenDiv": False,
        "requireCrossAlignment": True,
        "requireExtremeZone": True,
        "maxDivergenceAgeBars": 8,
        "minPassScore": 65,
    }
    config = {**defaults, **request.config}

    require_non_neutral = _as_bool(config.get("requireNonNeutralSignal"), True)
    block_on_data_gap = _as_bool(config.get("blockOnDataGap"), True)
    require_regular_div = _as_bool(config.get("requireRegularDiv"), True)
    allow_hidden_div = _as_bool(config.get("allowHiddenDiv"), False)
    require_cross_alignment = _as_bool(config.get("requireCrossAlignment"), True)
    require_extreme_zone = _as_bool(config.get("requireExtremeZone"), True)
    max_div_age = _safe_age(config.get("maxDivergenceAgeBars"))
    max_div_age = max_div_age if max_div_age is not None else 8
    min_pass_score = _as_float(config.get("minPassScore"))
    min_pass_score = min_pass_score if min_pass_score is not None else 65.0

    signal = request.context.signal or "neutral"
    snapshot = _as_dict(request.featureSnapshot)
    indicators = _as_dict(snapshot.get("indicators"))
    vmc = _as_dict(indicators.get("vumanchu"))
    divergences = _as_dict(vmc.get("divergences"))
    wt = _as_dict(divergences.get("wt"))
    rsi = _as_dict(divergences.get("rsi"))
    stoch = _as_dict(divergences.get("stoch"))
    wave = _as_dict(vmc.get("waveTrend"))
    signals = _as_dict(vmc.get("signals"))
    risk_flags = _as_dict(snapshot.get("riskFlags"))

    vmc_missing = not vmc
    vmc_data_gap = _as_bool(vmc.get("dataGap"), False)
    risk_data_gap = _as_bool(risk_flags.get("dataGap"), False)
    data_gap = vmc_data_gap or risk_data_gap
    gold_no_buy = _as_bool(signals.get("goldNoBuyLong"), False)

    wt_regular = _directional_regular_divergence(signal, wt)
    rsi_regular = _directional_regular_divergence(signal, rsi)
    stoch_regular = _directional_regular_divergence(signal, stoch)
    regular_div = wt_regular or rsi_regular or stoch_regular

    wt_any = _directional_divergence(signal, wt, allow_hidden_div)
    rsi_any = _directional_divergence(signal, rsi, allow_hidden_div)
    stoch_any = _directional_divergence(signal, stoch, allow_hidden_div)
    any_div = wt_any or rsi_any or stoch_any

    div_age_candidates = [
        _directional_div_age(signal, wt, allow_hidden_div),
        _directional_div_age(signal, rsi, allow_hidden_div),
        _directional_div_age(signal, stoch, allow_hidden_div),
    ]
    valid_age_candidates = [age for age in div_age_candidates if age is not None]
    divergence_age = min(valid_age_candidates) if len(valid_age_candidates) > 0 else None
    divergence_fresh = divergence_age is not None and divergence_age <= max_div_age

    cross_up = _as_bool(wave.get("crossUp"), False)
    cross_down = _as_bool(wave.get("crossDown"), False)
    oversold = _as_bool(wave.get("oversold"), False)
    overbought = _as_bool(wave.get("overbought"), False)
    cross_aligned = (signal == "up" and cross_up) or (signal == "down" and cross_down)
    zone_aligned = (signal == "up" and oversold) or (signal == "down" and overbought)

    score = round(
        _clamp(
            20.0
            + 35.0 * (1.0 if any_div else 0.0)
            + 15.0 * (1.0 if regular_div else 0.0)
            + 15.0 * (1.0 if cross_aligned else 0.0)
            + 10.0 * (1.0 if zone_aligned else 0.0)
            + 5.0 * (1.0 if divergence_fresh else 0.0),
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

    if allow and require_regular_div and not regular_div:
        allow = False
        reasons.append("vmc_divergence_missing")
    elif allow and not any_div:
        allow = False
        reasons.append("vmc_divergence_missing")

    if allow and not divergence_fresh:
        allow = False
        reasons.append("vmc_divergence_stale")

    if allow and require_cross_alignment and not cross_aligned:
        allow = False
        reasons.append("vmc_cross_conflict")

    if allow and require_extreme_zone and not zone_aligned:
        allow = False
        reasons.append("vmc_zone_not_extreme")

    if allow and score < min_pass_score:
        allow = False
        reasons.append("score_below_threshold")

    if allow:
        reasons.append("vmc_divergence_reversal_pass")

    tags: list[str] = []
    if signal == "up":
        tags.append("vmc_up")
    elif signal == "down":
        tags.append("vmc_down")
    if regular_div:
        tags.append("vmc_regular_div")
    elif any_div:
        tags.append("vmc_hidden_div")
    if zone_aligned:
        tags.append("vmc_extreme_zone")
    if data_gap:
        tags.append("data_gap")

    explanation = (
        f"VMC DivReversal {'pass' if allow else 'block'}: signal={signal}, "
        f"regular={regular_div}, anyDiv={any_div}, age={divergence_age}, score={score}."
    )
    explanation = explanation[:220]

    return StrategyRunResponse(
        allow=allow,
        score=score,
        reasonCodes=reasons,
        tags=tags,
        explanation=explanation,
        meta={
            "strategy": "vmc_divergence_reversal",
            "signal": signal,
            "regularDivergence": regular_div,
            "anyDivergence": any_div,
            "allowHiddenDiv": allow_hidden_div,
            "divergenceAgeBars": divergence_age,
            "maxDivergenceAgeBars": max_div_age,
            "crossAligned": cross_aligned,
            "zoneAligned": zone_aligned,
            "scoreThreshold": min_pass_score,
            "dataGap": data_gap,
            "vmcDataGap": vmc_data_gap,
            "riskDataGap": risk_data_gap,
            "goldNoBuyLong": gold_no_buy,
        },
    )
