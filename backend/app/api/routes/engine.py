from fastapi import APIRouter, HTTPException, Query

from app.database.database import database_connection
from app.trading.runner import strategy_runner


router = APIRouter(prefix="/api", tags=["engine"])


@router.get("/engine/status")
def engine_status() -> dict:
    return strategy_runner.status()


@router.post("/engine/start")
async def start_engine() -> dict:
    return await strategy_runner.start()


@router.post("/engine/stop")
async def stop_engine() -> dict:
    return await strategy_runner.stop()


@router.post("/engine/tick")
async def run_engine_tick(dry_run: bool = Query(default=False)) -> dict:
    return await strategy_runner.tick(dry_run=dry_run)


@router.get("/strategies/{strategy_id}/signals")
def strategy_signals(
    strategy_id: str,
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    with database_connection() as connection:
        if connection.execute(
            "SELECT 1 FROM strategies WHERE id = ?",
            (strategy_id,),
        ).fetchone() is None:
            raise HTTPException(status_code=404, detail="Strategy not found.")
        rows = connection.execute(
            """
            SELECT id, strategy_id, symbol, candle_ts, signal, reason, score,
                   action_taken, created_at
            FROM strategy_signals
            WHERE strategy_id = ?
            ORDER BY candle_ts DESC
            LIMIT ?
            """,
            (strategy_id, limit),
        ).fetchall()
    return {
        "signals": [
            {
                "id": row["id"],
                "strategyId": row["strategy_id"],
                "symbol": row["symbol"],
                "candleTs": row["candle_ts"],
                "signal": row["signal"],
                "reason": row["reason"],
                "score": row["score"],
                "actionTaken": row["action_taken"],
                "createdAt": row["created_at"],
            }
            for row in rows
        ]
    }
