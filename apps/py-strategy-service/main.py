from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from models import HealthResponse, StrategyRegistryResponse, StrategyRunRequest, StrategyRunResponse
from registry import registry
from strategies import regime_gate, signal_filter, smart_money_concept, trend_vol_gate

SERVICE_VERSION = "1.0.0"
AUTH_TOKEN = os.getenv("PY_STRATEGY_AUTH_TOKEN", "").strip()

app = FastAPI(title="py-strategy-service", version=SERVICE_VERSION)


def is_token_authorized(received_token: str | None, expected_token: str) -> bool:
    if not expected_token:
        return True
    if not received_token:
        return False
    return hmac.compare_digest(received_token.strip(), expected_token)


def require_auth(x_py_strategy_token: str | None = Header(default=None)) -> None:
    if is_token_authorized(x_py_strategy_token, AUTH_TOKEN):
        return
    raise HTTPException(status_code=401, detail="unauthorized")


def register_strategies() -> None:
    registry.register(
        "regime_gate",
        name="Regime Gate",
        version="1.0.0",
        default_config={
            "allowStates": ["trend_up", "trend_down", "transition"],
            "minRegimeConfidencePct": 45,
            "requireStackAlignment": True,
            "allowUnknownRegime": False,
        },
        ui_schema={
            "title": "Regime Gate",
            "description": "Uses historyContext.reg and historyContext.ema.stk to allow/block deterministic setups.",
            "fields": {
                "allowStates": {"type": "multiselect", "options": ["trend_up", "trend_down", "range", "transition", "unknown"]},
                "minRegimeConfidencePct": {"type": "number", "min": 0, "max": 100, "step": 1},
                "requireStackAlignment": {"type": "boolean"},
                "allowUnknownRegime": {"type": "boolean"},
            },
        },
        handler=regime_gate.run,
    )

    registry.register(
        "signal_filter",
        name="Signal Filter",
        version="1.0.0",
        default_config={
            "blockedTags": ["data_gap", "news_risk"],
            "requiredTags": [],
            "maxVolZ": 2.5,
            "blockRangeStates": ["range"],
            "allowRangeWhenTrendTag": False,
        },
        ui_schema={
            "title": "Signal Filter",
            "description": "Blocks setups by tags, volatility pressure, and range-state constraints.",
            "fields": {
                "blockedTags": {"type": "string_array"},
                "requiredTags": {"type": "string_array"},
                "maxVolZ": {"type": "number", "min": 0, "max": 10, "step": 0.1},
                "blockRangeStates": {"type": "multiselect", "options": ["range", "transition", "unknown"]},
                "allowRangeWhenTrendTag": {"type": "boolean"},
            },
        },
        handler=signal_filter.run,
    )

    registry.register(
        "trend_vol_gate",
        name="Trend+Vol Gate",
        version="1.0.0",
        default_config={
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
        },
        ui_schema={
            "title": "Trend+Vol Gate",
            "description": "Deterministic gate on regime, EMA alignment, distance and volume pressure.",
            "fields": {
                "allowedStates": {"type": "multiselect", "options": ["trend_up", "trend_down", "range", "transition", "unknown"]},
                "minRegimeConf": {"type": "number", "min": 0, "max": 100, "step": 1},
                "requireStackAlignment": {"type": "boolean"},
                "requireSlopeAlignment": {"type": "boolean"},
                "minAbsD50Pct": {"type": "number", "min": 0, "max": 5, "step": 0.01},
                "minAbsD200Pct": {"type": "number", "min": 0, "max": 5, "step": 0.01},
                "maxVolZ": {"type": "number", "min": 0, "max": 10, "step": 0.1},
                "maxRelVol": {"type": "number", "min": 0, "max": 5, "step": 0.1},
                "minVolZ": {"type": "number", "min": -10, "max": 0, "step": 0.1},
                "minRelVol": {"type": "number", "min": 0, "max": 2, "step": 0.1},
                "minPassScore": {"type": "number", "min": 0, "max": 100, "step": 1},
                "allowNeutralSignal": {"type": "boolean"},
            },
        },
        handler=trend_vol_gate.run,
    )

    registry.register(
        "smart_money_concept",
        name="Smart Money Concept",
        version="1.0.0",
        default_config={
            "requireNonNeutralSignal": True,
            "blockOnDataGap": True,
            "requireTrendAlignment": True,
            "requireStructureAlignment": True,
            "requireZoneAlignment": True,
            "allowEquilibriumZone": True,
            "maxEventAgeBars": 120,
            "minPassScore": 65,
        },
        ui_schema={
            "title": "Smart Money Concept",
            "description": "Deterministic SMC gate using structure, trend and premium/discount zones.",
            "fields": {
                "requireNonNeutralSignal": {"type": "boolean"},
                "blockOnDataGap": {"type": "boolean"},
                "requireTrendAlignment": {"type": "boolean"},
                "requireStructureAlignment": {"type": "boolean"},
                "requireZoneAlignment": {"type": "boolean"},
                "allowEquilibriumZone": {"type": "boolean"},
                "maxEventAgeBars": {"type": "number", "min": 1, "max": 1000, "step": 1},
                "minPassScore": {"type": "number", "min": 0, "max": 100, "step": 1},
            },
        },
        handler=smart_money_concept.run,
    )


register_strategies()


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=SERVICE_VERSION)


@app.get("/v1/strategies", response_model=StrategyRegistryResponse)
def list_strategies(_: None = Depends(require_auth)) -> StrategyRegistryResponse:
    return StrategyRegistryResponse(items=registry.list_public())


@app.post("/v1/strategies/run", response_model=StrategyRunResponse)
def run_strategy(payload: StrategyRunRequest, _: None = Depends(require_auth)) -> StrategyRunResponse:
    registration = registry.get(payload.strategyType)
    if not registration:
        raise HTTPException(status_code=404, detail=f"strategy_not_found:{payload.strategyType}")

    result = registration.handler(payload)
    merged_meta = {
        **(result.meta or {}),
        "engine": "python",
        "strategyType": registration.type,
        "strategyVersion": registration.version,
    }
    return StrategyRunResponse(
        allow=result.allow,
        score=result.score,
        reasonCodes=result.reasonCodes,
        tags=result.tags,
        explanation=result.explanation,
        meta=merged_meta,
    )
