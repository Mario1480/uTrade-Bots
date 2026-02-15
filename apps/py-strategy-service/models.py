from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Signal = Literal["up", "down", "neutral"]


class RunContext(BaseModel):
    signal: Optional[Signal] = None
    exchange: Optional[str] = None
    accountId: Optional[str] = None
    symbol: Optional[str] = None
    marketType: Optional[str] = None
    timeframe: Optional[str] = None
    nowTs: Optional[str] = None


class RunTrace(BaseModel):
    runId: Optional[str] = None
    source: Optional[str] = None


class StrategyRunRequest(BaseModel):
    strategyType: str = Field(min_length=1, max_length=128)
    strategyVersion: Optional[str] = Field(default=None, max_length=64)
    config: Dict[str, Any] = Field(default_factory=dict)
    featureSnapshot: Dict[str, Any] = Field(default_factory=dict)
    context: RunContext = Field(default_factory=RunContext)
    trace: RunTrace = Field(default_factory=RunTrace)


class StrategyRunResponse(BaseModel):
    allow: bool = True
    score: float = 0.0
    reasonCodes: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    explanation: str = ""
    meta: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("score", mode="before")
    @classmethod
    def normalize_score(cls, v: Any) -> float:
        try:
            parsed = float(v)
        except Exception:
            parsed = 0.0
        if parsed != parsed or parsed in (float("inf"), float("-inf")):
            return 0.0
        return max(0.0, min(100.0, parsed))


class StrategyRegistryItem(BaseModel):
    type: str
    name: str
    version: str
    defaultConfig: Dict[str, Any] = Field(default_factory=dict)
    uiSchema: Dict[str, Any] = Field(default_factory=dict)


class StrategyRegistryResponse(BaseModel):
    items: List[StrategyRegistryItem] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    version: str
