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
        "blockedTags": ["data_gap", "news_risk"],
        "requiredTags": [],
        "maxVolZ": 2.5,
        "blockRangeStates": ["range"],
        "allowRangeWhenTrendTag": False,
    }
    config = {**defaults, **request.config}
    snapshot = _as_dict(request.featureSnapshot)

    tags = [str(tag).strip().lower() for tag in snapshot.get("tags", []) if isinstance(tag, str)]

    history = _as_dict(snapshot.get("historyContext"))
    reg = _as_dict(history.get("reg"))
    vol = _as_dict(history.get("vol"))

    state = str(reg.get("state") or "unknown").strip() or "unknown"
    vol_z = _as_float(vol.get("z"))

    blocked_tags = [str(x).strip().lower() for x in config.get("blockedTags", []) if isinstance(x, str)]
    required_tags = [str(x).strip().lower() for x in config.get("requiredTags", []) if isinstance(x, str)]
    block_range_states = [str(x).strip() for x in config.get("blockRangeStates", []) if isinstance(x, str)]
    allow_range_when_trend_tag = bool(config.get("allowRangeWhenTrendTag", False))
    max_vol_z = _as_float(config.get("maxVolZ"))
    max_vol_z = max_vol_z if max_vol_z is not None else 2.5

    allow = True
    reasons: list[str] = []

    if allow and any(tag in tags for tag in blocked_tags):
        allow = False
        reasons.append("blocked_tag_match")

    if allow and required_tags and not all(tag in tags for tag in required_tags):
        allow = False
        reasons.append("required_tag_missing")

    if allow and vol_z is not None and abs(vol_z) > max_vol_z:
        allow = False
        reasons.append("volatility_guard")

    has_trend_tag = "trend_up" in tags or "trend_down" in tags
    if allow and state in block_range_states:
        if not (allow_range_when_trend_tag and has_trend_tag):
            allow = False
            reasons.append("range_state_block")

    score = 70.0
    if vol_z is not None:
        score = max(0.0, min(100.0, score - max(0.0, abs(vol_z) - 1.0) * 10.0))
    if not allow:
        score = min(score, 30.0)

    return StrategyRunResponse(
        allow=allow,
        score=score,
        reasonCodes=reasons,
        tags=["signal_filter_ok"] if allow else ["signal_filter_block"],
        explanation=(
            "Signal filter passed with acceptable tag/volatility regime context."
            if allow
            else "Signal filter blocked due to tag, volatility, or range-state restrictions."
        ),
        meta={
            "tags": tags,
            "blockedTags": blocked_tags,
            "requiredTags": required_tags,
            "regimeState": state,
            "volZ": vol_z,
            "maxVolZ": max_vol_z,
            "allowRangeWhenTrendTag": allow_range_when_trend_tag,
        },
    )
