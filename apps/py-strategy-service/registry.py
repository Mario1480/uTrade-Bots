from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict

from models import StrategyRegistryItem, StrategyRunRequest, StrategyRunResponse

StrategyHandler = Callable[[StrategyRunRequest], StrategyRunResponse]


@dataclass
class StrategyRegistration:
    type: str
    name: str
    version: str
    default_config: Dict[str, Any]
    ui_schema: Dict[str, Any]
    handler: StrategyHandler


class StrategyRegistry:
    def __init__(self) -> None:
        self._items: dict[str, StrategyRegistration] = {}

    def register(
        self,
        strategy_type: str,
        *,
        name: str,
        version: str,
        default_config: Dict[str, Any],
        ui_schema: Dict[str, Any],
        handler: StrategyHandler,
    ) -> None:
        normalized = strategy_type.strip()
        if not normalized:
            raise ValueError("strategy_type_required")
        if normalized in self._items:
            raise ValueError(f"strategy_already_registered:{normalized}")
        self._items[normalized] = StrategyRegistration(
            type=normalized,
            name=name.strip() or normalized,
            version=version.strip() or "1.0.0",
            default_config=default_config,
            ui_schema=ui_schema,
            handler=handler,
        )

    def get(self, strategy_type: str) -> StrategyRegistration | None:
        return self._items.get(strategy_type.strip())

    def list_public(self) -> list[StrategyRegistryItem]:
        return [
            StrategyRegistryItem(
                type=item.type,
                name=item.name,
                version=item.version,
                defaultConfig=item.default_config,
                uiSchema=item.ui_schema,
            )
            for item in self._items.values()
        ]


registry = StrategyRegistry()
