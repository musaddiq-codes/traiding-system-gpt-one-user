import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.api.routes.schemas import BacktestRecordPayload, BacktestReviewPayload
from app.api.routes.strategies import _load_strategy, _save_strategy
from app.database.database import database_connection
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


@router.post("/runs")
def save_run(payload: BacktestRecordPayload) -> dict:
    strategy = payload.strategy.model_dump(exclude_none=True)
    result = payload.result
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
