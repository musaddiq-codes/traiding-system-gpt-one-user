import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.api.routes.schemas import StrategyPayload
from app.database.database import database_connection
from app.trading.engine import get_strategy_signature


router = APIRouter(prefix="/api/strategies", tags=["strategies"])


def _load_strategies() -> list[dict]:
    with database_connection() as connection:
        rows = connection.execute(
            "SELECT payload FROM strategies ORDER BY rowid DESC"
        ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def _load_strategy(strategy_id: str) -> dict | None:
    with database_connection() as connection:
        row = connection.execute(
            "SELECT payload FROM strategies WHERE id = ?", (strategy_id,)
        ).fetchone()
    return json.loads(row["payload"]) if row else None


def _save_strategy(strategy: dict) -> None:
    with database_connection() as connection:
        connection.execute(
            """
            INSERT INTO strategies (id, payload) VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
            """,
            (strategy["id"], json.dumps(strategy)),
        )


def _has_valid_paper_approval(strategy: dict) -> bool:
    run_id = strategy.get("paperApprovedBacktestId")
    if not run_id:
        return False
    with database_connection() as connection:
        row = connection.execute(
            "SELECT strategy_id, strategy_signature, payload FROM backtest_runs WHERE id = ?",
            (run_id,),
        ).fetchone()
    if row is None:
        return False
    run = json.loads(row["payload"])
    return (
        row["strategy_id"] == strategy["id"]
        and row["strategy_signature"] == get_strategy_signature(strategy)
        and run.get("result", {}).get("eligibleForPaperReview") is True
    )


@router.get("")
def list_strategies(strategy_id: str | None = Query(default=None, alias="id")) -> dict:
    strategies = _load_strategies()
    if strategy_id is not None:
        strategy = next((item for item in strategies if item["id"] == strategy_id), None)
        if strategy is None:
            raise HTTPException(status_code=404, detail="Strategy not found.")
        return {"strategy": strategy, "strategies": strategies}
    return {
        "strategies": strategies,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/{strategy_id}")
def get_strategy(strategy_id: str) -> dict:
    strategy = _load_strategy(strategy_id)
    if strategy is None:
        raise HTTPException(status_code=404, detail="Strategy not found.")
    return {"strategy": strategy}


@router.post("")
def create_strategy(payload: StrategyPayload) -> dict:
    strategy = payload.model_dump(exclude_none=True)
    if strategy["status"] == "ACTIVE":
        raise HTTPException(
            status_code=409,
            detail="Run and review an eligible backtest before activating a strategy for paper trading.",
        )
    with database_connection() as connection:
        if connection.execute(
            "SELECT 1 FROM strategies WHERE id = ?", (strategy["id"],)
        ).fetchone():
            raise HTTPException(status_code=409, detail="Strategy id already exists.")
        connection.execute(
            "INSERT INTO strategies (id, payload) VALUES (?, ?)",
            (strategy["id"], json.dumps(strategy)),
        )
    return {
        "strategy": strategy,
        "strategies": _load_strategies(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.put("/{strategy_id}")
def update_strategy(strategy_id: str, payload: StrategyPayload) -> dict:
    strategy = payload.model_dump(exclude_none=True)
    if strategy_id != strategy["id"]:
        raise HTTPException(status_code=400, detail="Strategy id does not match the URL.")
    previous = _load_strategy(strategy_id)
    if previous is None:
        raise HTTPException(status_code=404, detail="Strategy not found.")

    approval_is_current = (
        bool(strategy.get("paperApprovedBacktestId"))
        and bool(previous.get("paperApprovedBacktestId"))
        and get_strategy_signature(strategy) == get_strategy_signature(previous)
        and _has_valid_paper_approval(strategy)
    )
    if strategy["status"] == "ACTIVE" and not approval_is_current:
        raise HTTPException(
            status_code=409,
            detail="Run and review an eligible backtest for this strategy version before activating paper trading.",
        )
    if not approval_is_current:
        if strategy["status"] == "ACTIVE":
            strategy["status"] = "DRAFT"
        strategy.pop("paperApprovedBacktestId", None)
        strategy.pop("paperApprovedAt", None)

    _save_strategy(strategy)
    return {
        "strategy": strategy,
        "strategies": _load_strategies(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("")
def delete_strategy(strategy_id: str = Query(alias="id", min_length=1)) -> dict:
    with database_connection() as connection:
        connection.execute("DELETE FROM strategies WHERE id = ?", (strategy_id,))
    return {
        "strategies": _load_strategies(),
        "deletedId": strategy_id,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }