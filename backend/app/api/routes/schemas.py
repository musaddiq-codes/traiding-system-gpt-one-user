from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    entryCondition: str = Field(min_length=1, max_length=2_000)
    exitCondition: str = Field(min_length=1, max_length=2_000)
    stopLoss: float = Field(gt=0, allow_inf_nan=False)
    takeProfit: float = Field(gt=0, allow_inf_nan=False)
    positionSize: float = Field(gt=0, allow_inf_nan=False)
    riskPerTrade: float = Field(gt=0, le=100, allow_inf_nan=False)
    maxPositions: int = Field(ge=1, le=100)
    paperApprovedBacktestId: str | None = None
    paperApprovedAt: str | None = None
    createdAt: str
    updatedAt: str


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
