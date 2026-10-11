import asyncio
import json
import math
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException

from app.backtest.engine import run_backtest
from app.api.routes.schemas import (
    BacktestRecordPayload,
    BacktestReviewPayload,
    BacktestRunPayload,
)
from app.api.routes.strategies import _load_strategy, _save_strategy
from app.database.database import database_connection
from app.market.data import CHART_RANGES, fetch_historical_candles, normalize_symbol
from app.risk.backtest_policy import evaluate_eligibility, validate_result_shape
from app.trading.engine import get_strategy_signature, get_strategy_snapshot


router = APIRouter(prefix="/api/backtests", tags=["backtests"])


def _read_run(run_id: str) -> dict | None:
    with database_connection() as connection:
        row = connection.execute(
            """
            SELECT payload, reviewed_at, review_notes
            FROM backtest_runs WHERE id = ?
            """,
            (run_id,),
        ).fetchone()
    if row is None:
        return None
    run = json.loads(row["payload"])
    if row["reviewed_at"]:
        run["reviewedAt"] = row["reviewed_at"]
    if row["review_notes"] is not None:
        run["reviewNotes"] = row["review_notes"]
    return run


def save_backtest_run(strategy: dict, result: dict) -> dict:
    try:
        validate_result_shape(result)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    run_id = result.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise HTTPException(status_code=422, detail="Backtest result must include a runId.")
    if result.get("strategyId") != strategy["id"]:
        raise HTTPException(status_code=422, detail="Backtest strategy id does not match.")
    eligible, reason = evaluate_eligibility(result)
    result["eligibleForPaperReview"] = eligible
    result["reviewEligibilityReason"] = reason

    run = {
        "id": run_id,
        "strategyId": strategy["id"],
        "strategySignature": get_strategy_signature(strategy),
        "strategySnapshot": get_strategy_snapshot(strategy),
        "result": result,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    with database_connection() as connection:
        connection.execute(
            """
            INSERT INTO backtest_runs
                (id, strategy_id, strategy_signature, payload)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                strategy_id = excluded.strategy_id,
                strategy_signature = excluded.strategy_signature,
                payload = excluded.payload
            """,
            (
                run_id,
                strategy["id"],
                run["strategySignature"],
                json.dumps(run),
            ),
        )
        connection.execute(
            """
            DELETE FROM backtest_runs
            WHERE id NOT IN (
                SELECT id FROM backtest_runs ORDER BY rowid DESC LIMIT 500
            )
            """
        )
    return run


@router.post("/runs")
def save_run(payload: BacktestRecordPayload) -> dict:
    strategy = payload.strategy.model_dump(exclude_none=True)
    return save_backtest_run(strategy, payload.result)


def _finite_number(value: object) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


@router.post("/run")
async def run_backtest_route(payload: BacktestRunPayload) -> dict:
    strategy_id = payload.strategyId
    if not isinstance(strategy_id, str) or not strategy_id:
        raise HTTPException(
            status_code=400,
            detail="Strategy and symbol are required.",
        )
    strategy = _load_strategy(strategy_id)
    if strategy is None:
        raise HTTPException(
            status_code=409,
            detail="Save the current strategy version before running its backtest.",
        )

    days = 30 if payload.days is None else payload.days
    initial_balance = (
        100_000 if payload.initialBalance is None else payload.initialBalance
    )
    fee_bps = 10 if payload.feeBps is None else payload.feeBps
    slippage_bps = 5 if payload.slippageBps is None else payload.slippageBps
    if (
        isinstance(days, bool)
        or not isinstance(days, int)
        or days < 1
        or days > 180
    ):
        raise HTTPException(
            status_code=400,
            detail="Lookback days must be an integer between 1 and 180.",
        )
    if not _finite_number(initial_balance) or initial_balance <= 0:
        raise HTTPException(
            status_code=400,
            detail="Initial balance must be greater than zero.",
        )
    if not _finite_number(fee_bps) or fee_bps < 0 or fee_bps > 1_000:
        raise HTTPException(
            status_code=400,
            detail="Fee must be between 0 and 1,000 basis points.",
        )
    if (
        not _finite_number(slippage_bps)
        or slippage_bps < 0
        or slippage_bps > 1_000
    ):
        raise HTTPException(
            status_code=400,
            detail="Slippage must be between 0 and 1,000 basis points.",
        )

    timeframe = strategy.get("timeframe")
    if timeframe not in CHART_RANGES:
        raise HTTPException(
            status_code=400,
            detail="The strategy timeframe is not supported for backtesting.",
        )
    try:
        normalize_symbol(strategy["symbol"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=400,
            detail="Backtest market must match the saved strategy market.",
        ) from error
    metrics = (
        strategy.get("stopLoss"),
        strategy.get("takeProfit"),
        strategy.get("positionSize"),
        strategy.get("riskPerTrade"),
    )
    if (
        not all(_finite_number(value) for value in metrics)
        or strategy["stopLoss"] <= 0
        or strategy["takeProfit"] <= 0
        or strategy["positionSize"] <= 0
        or strategy["riskPerTrade"] <= 0
        or strategy["riskPerTrade"] > 100
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Strategy risk, stop-loss, take-profit, and position-size "
                "settings must be valid."
            ),
        )

    try:
        candles = await fetch_historical_candles(
            strategy["symbol"],
            timeframe,
            days,
        )
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="Live market or candle data is currently unavailable.",
        ) from error
    except ValueError as error:
        if str(error).startswith("This timeframe and lookback require"):
            raise HTTPException(status_code=400, detail=str(error)) from error
        raise HTTPException(
            status_code=502,
            detail="Live market or candle data is currently unavailable.",
        ) from error

    if len(candles) < 3:
        raise HTTPException(
            status_code=422,
            detail="Not enough historical candles are available for this backtest.",
        )
    result = await asyncio.to_thread(
        run_backtest,
        strategy,
        candles,
        initial_balance=float(initial_balance),
        fee_bps=float(fee_bps),
        slippage_bps=float(slippage_bps),
    )
    save_backtest_run(strategy, result)
    return result


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    run = _read_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Backtest run not found.")
    return run


def _mark_reviewed(run_id: str, notes: str = "") -> dict:
    if len(notes) > 2_000:
        raise HTTPException(status_code=422, detail="Review notes cannot exceed 2,000 characters.")
    reviewed_at = datetime.now(timezone.utc).isoformat()
    with database_connection() as connection:
        cursor = connection.execute(
            """
            UPDATE backtest_runs
            SET reviewed_at = ?, review_notes = ?
            WHERE id = ?
            """,
            (reviewed_at, notes, run_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Backtest run not found.")
    run = _read_run(run_id)
    if run is None:
        raise RuntimeError("Reviewed backtest run could not be read.")
    return run


@router.post("/review")
def review_run(payload: BacktestReviewPayload) -> dict:
    run = _read_run(payload.runId)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail="Backtest run was not found. Run the backtest again before review.",
        )
    result = run["result"]
    if result.get("eligibleForPaperReview") is not True:
        raise HTTPException(
            status_code=422,
            detail=result.get(
                "reviewEligibilityReason",
                "This backtest run is not eligible for paper review.",
            ),
        )

    strategy = _load_strategy(run["strategyId"])
    if strategy is None:
        raise HTTPException(
            status_code=404,
            detail="The strategy associated with this backtest no longer exists.",
        )
    if get_strategy_signature(strategy) != run["strategySignature"]:
        raise HTTPException(
            status_code=409,
            detail="The strategy has changed since this backtest. Run a new backtest before approving it.",
        )

    approved_at = datetime.now(timezone.utc).isoformat()
    strategy["status"] = "ACTIVE"
    strategy["paperApprovedBacktestId"] = run["id"]
    strategy["paperApprovedAt"] = approved_at
    strategy["updatedAt"] = approved_at
    _save_strategy(strategy)
    _mark_reviewed(run["id"], payload.notes.strip())
    return {"strategy": strategy, "reviewedAt": approved_at}
