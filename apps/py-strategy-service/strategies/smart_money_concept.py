from __future__ import annotations

from datetime import datetime, timezone
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


def _as_int(value: Any) -> int | None:
    parsed = _as_float(value)
    if parsed is None:
        return None
    return int(parsed)


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _to_ts_ms(value: Any) -> int | None:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except Exception:
            return None

    parsed = _as_float(value)
    if parsed is None:
        return None
    if parsed > 1_000_000_000_000:
        return int(parsed)
    if parsed > 1_000_000_000:
        return int(parsed * 1000)
    return None


def _normalize_signal(value: str | None) -> str:
    if value == "up" or value == "down" or value == "neutral":
        return value
    return "neutral"


def _trend_state(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"bullish", "bearish", "neutral"}:
        return text
    return "neutral"


def _event_direction(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"bullish", "bearish"}:
        return text
    return "unknown"


def _safe_count(value: Any) -> int:
    parsed = _as_int(value)
    if parsed is None:
        return 0
    return max(0, parsed)


def _estimate_bar_ms(last_bars_ohlc: list[Any]) -> int | None:
    ts_values: list[int] = []
    for row in last_bars_ohlc:
        ts_ms = _to_ts_ms(_as_dict(row).get("t"))
        if ts_ms is not None:
            ts_values.append(ts_ms)
    if len(ts_values) < 2:
        return None
    diff = ts_values[-1] - ts_values[-2]
    if diff <= 0:
        return None
    return diff


def _in_band(value: float, low: float, high: float) -> bool:
    lower = min(low, high)
    upper = max(low, high)
    return lower <= value <= upper


def _resolve_zone_bucket(zones: dict[str, Any], last_close: float | None) -> str:
    if last_close is None:
        return "unknown"
    discount_top = _as_float(zones.get("discountTop"))
    discount_bottom = _as_float(zones.get("discountBottom"))
    equilibrium_top = _as_float(zones.get("equilibriumTop"))
    equilibrium_bottom = _as_float(zones.get("equilibriumBottom"))
    premium_top = _as_float(zones.get("premiumTop"))
    premium_bottom = _as_float(zones.get("premiumBottom"))

    if (
        discount_top is not None
        and discount_bottom is not None
        and _in_band(last_close, discount_bottom, discount_top)
    ):
        return "discount"
    if (
        equilibrium_top is not None
        and equilibrium_bottom is not None
        and _in_band(last_close, equilibrium_bottom, equilibrium_top)
    ):
        return "equilibrium"
    if (
        premium_top is not None
        and premium_bottom is not None
        and _in_band(last_close, premium_bottom, premium_top)
    ):
        return "premium"
    return "unknown"


def _signal_alignment(signal: str, side: str) -> bool:
    if signal == "up":
        return side == "bullish"
    if signal == "down":
        return side == "bearish"
    return False


def run(request: StrategyRunRequest) -> StrategyRunResponse:
    defaults = {
        "requireNonNeutralSignal": True,
        "blockOnDataGap": True,
        "requireTrendAlignment": True,
        "requireStructureAlignment": True,
        "requireZoneAlignment": True,
        "allowEquilibriumZone": True,
        "maxEventAgeBars": 120,
        "minPassScore": 65,
    }
    config = {**defaults, **request.config}

    require_non_neutral = _as_bool(config.get("requireNonNeutralSignal"), True)
    block_on_data_gap = _as_bool(config.get("blockOnDataGap"), True)
    require_trend_alignment = _as_bool(config.get("requireTrendAlignment"), True)
    require_structure_alignment = _as_bool(config.get("requireStructureAlignment"), True)
    require_zone_alignment = _as_bool(config.get("requireZoneAlignment"), True)
    allow_equilibrium = _as_bool(config.get("allowEquilibriumZone"), True)
    max_event_age_bars = _safe_count(config.get("maxEventAgeBars")) or 120
    min_pass_score = _as_float(config.get("minPassScore"))
    min_pass_score = min_pass_score if min_pass_score is not None else 65.0

    signal = _normalize_signal(request.context.signal)
    snapshot = _as_dict(request.featureSnapshot)
    advanced = _as_dict(snapshot.get("advancedIndicators"))
    smc = _as_dict(advanced.get("smartMoneyConcepts"))
    risk_flags = _as_dict(snapshot.get("riskFlags"))
    history = _as_dict(snapshot.get("historyContext"))
    last_bars = _as_dict(history.get("lastBars"))
    ohlc_rows = last_bars.get("ohlc") if isinstance(last_bars.get("ohlc"), list) else []
    last_bar = _as_dict(ohlc_rows[-1]) if ohlc_rows else {}
    last_close = _as_float(last_bar.get("c"))
    last_bar_ts_ms = _to_ts_ms(last_bar.get("t"))
    bar_ms = _estimate_bar_ms(ohlc_rows)

    smc_context_present = bool(smc)
    smc_data_gap = _as_bool(smc.get("dataGap"), False) if smc_context_present else False
    risk_data_gap = _as_bool(risk_flags.get("dataGap"), False)
    data_gap = smc_data_gap or risk_data_gap

    internal = _as_dict(smc.get("internal")) if smc_context_present else {}
    swing = _as_dict(smc.get("swing")) if smc_context_present else {}
    internal_trend = _trend_state(internal.get("trend"))
    swing_trend = _trend_state(swing.get("trend"))
    trend_source = "swing" if swing_trend != "neutral" else "internal"
    trend_state = swing_trend if swing_trend != "neutral" else internal_trend

    swing_event = _as_dict(swing.get("lastEvent"))
    internal_event = _as_dict(internal.get("lastEvent"))
    event = swing_event if swing_event else internal_event
    event_source = "swing" if swing_event else ("internal" if internal_event else "none")
    event_direction = _event_direction(event.get("direction"))
    event_type = str(event.get("type") or "").strip().lower() or "unknown"
    event_ts_ms = _to_ts_ms(event.get("ts"))
    event_age_bars: int | None = None
    if event_ts_ms is not None and last_bar_ts_ms is not None and bar_ms is not None and bar_ms > 0:
        diff_ms = max(0, last_bar_ts_ms - event_ts_ms)
        event_age_bars = int(diff_ms // bar_ms)
    event_is_fresh = event_age_bars is not None and event_age_bars <= max_event_age_bars

    trend_aligned = _signal_alignment(signal, trend_state)
    structure_aligned = _signal_alignment(signal, event_direction) and event_is_fresh

    zones = _as_dict(smc.get("zones")) if smc_context_present else {}
    zone_bucket = _resolve_zone_bucket(zones, last_close)
    zone_favorable = (
        (signal == "up" and zone_bucket == "discount")
        or (signal == "down" and zone_bucket == "premium")
        or (allow_equilibrium and zone_bucket == "equilibrium")
    )

    order_blocks = _as_dict(smc.get("orderBlocks")) if smc_context_present else {}
    ob_internal = _as_dict(order_blocks.get("internal"))
    ob_swing = _as_dict(order_blocks.get("swing"))
    ob_bullish = _safe_count(ob_internal.get("bullishCount")) + _safe_count(ob_swing.get("bullishCount"))
    ob_bearish = _safe_count(ob_internal.get("bearishCount")) + _safe_count(ob_swing.get("bearishCount"))

    fvgs = _as_dict(smc.get("fairValueGaps")) if smc_context_present else {}
    fvg_bullish = _safe_count(fvgs.get("bullishCount"))
    fvg_bearish = _safe_count(fvgs.get("bearishCount"))

    ob_aligned = (signal == "up" and ob_bullish > 0 and ob_bullish >= ob_bearish) or (
        signal == "down" and ob_bearish > 0 and ob_bearish >= ob_bullish
    )
    fvg_aligned = (signal == "up" and fvg_bullish > 0 and fvg_bullish >= fvg_bearish) or (
        signal == "down" and fvg_bearish > 0 and fvg_bearish >= fvg_bullish
    )
    bonus = (5.0 if ob_aligned else 0.0) + (5.0 if fvg_aligned else 0.0)

    trend_component = 100.0 if trend_aligned else 0.0
    structure_component = 100.0 if structure_aligned else 0.0
    zone_component = 100.0 if zone_favorable else 0.0
    score = round(
        _clamp(
            0.4 * trend_component
            + 0.35 * structure_component
            + 0.25 * zone_component
            + bonus,
            0.0,
            100.0,
        )
    )

    allow = True
    reasons: list[str] = []

    if allow and require_non_neutral and signal == "neutral":
        allow = False
        reasons.append("signal_missing_or_neutral")

    if allow and not smc_context_present:
        allow = False
        reasons.append("smc_context_missing")

    if allow and block_on_data_gap and data_gap:
        allow = False
        reasons.append("smc_data_gap")

    if allow and require_trend_alignment and not trend_aligned:
        allow = False
        reasons.append("smc_trend_conflict")

    if allow and require_structure_alignment and not structure_aligned:
        allow = False
        reasons.append("smc_structure_conflict")

    if allow and require_zone_alignment and not zone_favorable:
        allow = False
        reasons.append("smc_zone_not_favorable")

    if allow and score < min_pass_score:
        allow = False
        reasons.append("score_below_threshold")

    if allow:
        reasons.append("smc_structure_zone_pass")

    tags: list[str] = []
    if signal == "up":
        tags.append("smc_up")
    elif signal == "down":
        tags.append("smc_down")

    if zone_bucket == "discount":
        tags.append("zone_discount")
    elif zone_bucket == "equilibrium":
        tags.append("zone_equilibrium")
    elif zone_bucket == "premium":
        tags.append("zone_premium")

    if trend_state == "bullish":
        tags.append("smc_bullish")
    elif trend_state == "bearish":
        tags.append("smc_bearish")

    if data_gap:
        tags.append("data_gap")

    explanation = (
        f"SMC {'pass' if allow else 'block'}: signal={signal}, trend={trend_state}, "
        f"event={event_type}/{event_direction}, zone={zone_bucket}, score={score:.0f}."
    )
    explanation = explanation[:220]

    return StrategyRunResponse(
        allow=allow,
        score=score,
        reasonCodes=reasons,
        tags=tags,
        explanation=explanation,
        meta={
            "strategy": "smart_money_concept",
            "signal": signal,
            "smcContextPresent": smc_context_present,
            "dataGap": data_gap,
            "smcDataGap": smc_data_gap,
            "riskDataGap": risk_data_gap,
            "trend": {
                "source": trend_source,
                "state": trend_state,
                "aligned": trend_aligned,
            },
            "structure": {
                "source": event_source,
                "type": event_type,
                "direction": event_direction,
                "eventTsMs": event_ts_ms,
                "eventAgeBars": event_age_bars,
                "maxEventAgeBars": max_event_age_bars,
                "fresh": event_is_fresh,
                "aligned": structure_aligned,
            },
            "zone": {
                "bucket": zone_bucket,
                "favorable": zone_favorable,
                "allowEquilibriumZone": allow_equilibrium,
                "lastClose": last_close,
            },
            "score": {
                "trendComponent": trend_component,
                "structureComponent": structure_component,
                "zoneComponent": zone_component,
                "bonus": bonus,
                "obAligned": ob_aligned,
                "fvgAligned": fvg_aligned,
                "minPassScore": min_pass_score,
            },
            "counts": {
                "orderBlocksBullish": ob_bullish,
                "orderBlocksBearish": ob_bearish,
                "fvgBullish": fvg_bullish,
                "fvgBearish": fvg_bearish,
            },
        },
    )
