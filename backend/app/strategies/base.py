from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal


ParamType = Literal["number", "boolean", "select"]
Signal = Literal["BUY", "SELL", "HOLD"]


@dataclass(frozen=True)
class ParamDef:
    key: str
    label: str
    type: ParamType
    default: Any
    min: float | None = None
    max: float | None = None
    options: tuple[str, ...] = ()


@dataclass(frozen=True)
class PluginPosition:
    entry_price: float
    quantity: float
    value_usdt: float
    opened_at_ms: int


@dataclass
class PluginContext:
    strategy: dict[str, Any]
    symbol: str
    price: float
    change24h: float
    candles: list[dict[str, Any]]
    position: PluginPosition | None
    params: dict[str, Any]
    timeframe: str
    now_ms: int
    volume24h: float = 0
    high24h: float | None = None
    low24h: float | None = None


@dataclass(frozen=True)
class Decision:
    signal: Signal
    reason: str
    score: float = 0.0
    amount_usdt: float | None = None


@dataclass(frozen=True)
class StrategyPlugin(ABC):
    id: str
    name: str
    version: str
    description: str
    long_only: bool
    params: tuple[ParamDef, ...] = field(default_factory=tuple)

    @abstractmethod
    def evaluate(self, ctx: PluginContext) -> Decision:
        raise NotImplementedError