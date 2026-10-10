from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.strategies.registry import DEFAULT_PLUGIN_ID, get_plugin, resolve_params


class StrategyPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2_000)
    type: Literal[
        "Trend Following",
        "Mean Reversion",
        "Breakout",
        "Scalping",
        "Grid",
        "Custom",
    ]
    symbol: str = Field(min_length=3, max_length=30)
    timeframe: str = Field(min_length=1, max_length=10)
    status: Literal["ACTIVE", "PAUSED", "DRAFT"] = "DRAFT"
    entryCondition: str | None = Field(default=None, min_length=1, max_length=2_000)
    exitCondition: str | None = Field(default=None, min_length=1, max_length=2_000)
    stopLoss: float = Field(gt=0, allow_inf_nan=False)
    takeProfit: float = Field(gt=0, allow_inf_nan=False)
    positionSize: float = Field(gt=0, allow_inf_nan=False)
    riskPerTrade: float = Field(gt=0, le=100, allow_inf_nan=False)
    maxPositions: int = Field(ge=1, le=100)
    paperApprovedBacktestId: str | None = None
    paperApprovedAt: str | None = None
    createdAt: str
    updatedAt: str
    algorithmId: str | None = Field(default=None, min_length=1, max_length=100)
    params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_plugin_configuration(self) -> "StrategyPayload":
        plugin_id = self.algorithmId or DEFAULT_PLUGIN_ID
        get_plugin(plugin_id)
        if plugin_id == DEFAULT_PLUGIN_ID:
            if self.entryCondition is None or self.exitCondition is None:
                raise ValueError(
                    "Text-rules strategies require entryCondition and exitCondition."
                )
        self.params = resolve_params(self.algorithmId, self.params)
        return self


class OrderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = Field(min_length=3, max_length=30)
    side: Literal["LONG", "SHORT"]
    quantity: float = Field(gt=0, allow_inf_nan=False)
    strategyId: str | None = None


class BacktestRecordPayload(BaseModel):
    strategy: StrategyPayload
    result: dict


class BacktestReviewPayload(BaseModel):
    runId: str = Field(min_length=1, max_length=100)
    confirmPaperApproval: Literal[True]
    notes: str = Field(default="", max_length=2_000)
