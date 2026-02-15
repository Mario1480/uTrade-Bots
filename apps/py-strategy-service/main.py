from __future__ import annotations

import os
from typing import Callable

from fastapi import Depends, FastAPI, Header, HTTPException

from models import HealthResponse, StrategyRegistryResponse, StrategyRunRequest, StrategyRunResponse
from registry import registry
from strategies import regime_gate, signal_filter

SERVICE_VERSION = "1.0.0"
AUTH_TOKEN = os.getenv("PY_STRATEGY_AUTH_TOKEN", "").strip()

app = FastAPI(title="py-strategy-service", version=SERVICE_VERSION)


def require_auth(x_py_strategy_token: str | None = Header(default=None)) -> None:
    if not AUTH_TOKEN:
        return
    if x_py_strategy_token and x_py_strategy_token.strip() == AUTH_TOKEN:
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
