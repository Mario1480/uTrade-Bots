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


def run(request: StrategyRunRequest) -> StrategyRunResponse:
    defaults = {
        "allowStates": ["trend_up", "trend_down", "transition"],
        "minRegimeConfidencePct": 45,
        "requireStackAlignment": True,
        "allowUnknownRegime": False,
    }
    config = {**defaults, **request.config}
    snapshot = _as_dict(request.featureSnapshot)
    history = _as_dict(snapshot.get("historyContext"))
    reg = _as_dict(history.get("reg"))
    ema = _as_dict(history.get("ema"))

    state = str(reg.get("state") or "unknown").strip() or "unknown"
    conf = _as_float(reg.get("conf"))
    stack = str(ema.get("stk") or "unknown").strip() or "unknown"
    signal = request.context.signal or "neutral"

    allow_states = [str(x) for x in config.get("allowStates", defaults["allowStates"]) if isinstance(x, str)]
    min_conf = _as_float(config.get("minRegimeConfidencePct"))
    min_conf = min_conf if min_conf is not None else 45.0
    require_stack_alignment = bool(config.get("requireStackAlignment", True))
    allow_unknown = bool(config.get("allowUnknownRegime", False))

    allow = True
    reasons: list[str] = []

    if state == "unknown" and not allow_unknown:
        allow = False
        reasons.append("regime_unknown")

    if allow and state not in allow_states:
        allow = False
        reasons.append("regime_state_not_allowed")

    if allow and conf is not None and conf < min_conf:
        allow = False
        reasons.append("regime_confidence_low")

    if allow and require_stack_alignment:
        state_mismatch = (state == "trend_up" and stack == "bear") or (state == "trend_down" and stack == "bull")
        if state_mismatch:
            allow = False
            reasons.append("ema_stack_conflict")

        signal_mismatch = (signal == "up" and stack == "bear") or (signal == "down" and stack == "bull")
        if allow and signal_mismatch:
            allow = False
            reasons.append("signal_stack_conflict")

    score_base = conf if conf is not None else 50.0
    score = max(0.0, min(100.0, score_base if allow else min(score_base, 35.0)))

    return StrategyRunResponse(
        allow=allow,
        score=score,
        reasonCodes=reasons,
        tags=["regime_ok"] if allow else ["regime_block"],
        explanation=(
            "Regime gate passed with aligned structure context."
            if allow
            else "Regime gate blocked due to incompatible regime/EMA alignment."
        ),
        meta={
            "regimeState": state,
            "regimeConfidencePct": conf,
            "emaStack": stack,
            "signal": signal,
            "minRegimeConfidencePct": min_conf,
            "requireStackAlignment": require_stack_alignment,
        },
    )
