from __future__ import annotations

import json
import sqlite3

from app.market.data import normalize_symbol
from app.trading.engine import get_strategy_signature


class OrderRejected(Exception):
    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


def _load_strategy(connection: sqlite3.Connection, strategy_id: str) -> dict | None:
    row = connection.execute(
        "SELECT payload FROM strategies WHERE id = ?", (strategy_id,)
    ).fetchone()
    return json.loads(row["payload"]) if row else None


def _approval_is_valid(connection: sqlite3.Connection, strategy: dict) -> bool:
    run_id = strategy.get("paperApprovedBacktestId")
    if not run_id:
        return False
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


def check_order(
    connection: sqlite3.Connection,
    snapshot: dict,
    *,
    strategy_id: str | None,
    symbol: str,
    quantity: float,
    price: float,
) -> None:
    """Raise OrderRejected if a strategy-driven order breaks any rule."""
    if not strategy_id or strategy_id == "manual":
        return  # manual orders: only the balance check applies

    strategy = _load_strategy(connection, strategy_id)
    if strategy is None:
        raise OrderRejected("Strategy not found.", 404)
    if strategy.get("status") != "ACTIVE":
        raise OrderRejected("Strategy is not active.", 409)
    if not _approval_is_valid(connection, strategy):
        raise OrderRejected(
            "Strategy has no valid backtest approval for its current version.", 409
        )
    if normalize_symbol(strategy["symbol"]) != normalize_symbol(symbol):
        raise OrderRejected("Order symbol does not match the strategy symbol.")

    open_positions = [
        p
        for p in snapshot["positions"]
        if p.get("strategyId") == strategy_id and p.get("status") == "OPEN"
    ]
    if len(open_positions) >= strategy["maxPositions"]:
        raise OrderRejected("Maximum positions reached for this strategy.")

    notional = price * quantity
    if notional > float(strategy["positionSize"]) * 1.0001:
        raise OrderRejected("Order exceeds the strategy's configured position size.")

    # Risk cap: the most you can put on so a stop-out loses <= riskPerTrade% of the account.
    # Uses balance (not stored equity, which is stale until Step 3).
    balance = float(snapshot["account"]["balance"])
    risk_amount = balance * float(strategy["riskPerTrade"]) / 100
    max_notional = risk_amount / (float(strategy["stopLoss"]) / 100)
    if notional > max_notional * 1.0001:
        raise OrderRejected(
            f"Order exceeds the risk limit (max position value {max_notional:.2f})."
        )