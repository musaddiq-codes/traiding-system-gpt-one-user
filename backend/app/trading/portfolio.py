import sqlite3


STATE_TRADE_LIMIT = 500


def _position_from_row(row: sqlite3.Row) -> dict:
    position = {
        "id": row["id"],
        "symbol": row["symbol"],
        "name": row["name"],
        "side": row["side"],
        "quantity": row["quantity"],
        "entryPrice": row["entry_price"],
        "currentPrice": row["current_price"],
        "leverage": row["leverage"],
        "margin": row["margin"],
        "unrealizedPnl": row["unrealized_pnl"],
        "unrealizedPnlPercent": row["unrealized_pnl_percent"],
        "status": row["status"],
        "openedAt": row["opened_at"],
    }
    if row["strategy_id"] is not None:
        position["strategyId"] = row["strategy_id"]
    return position


def _trade_from_row(row: sqlite3.Row) -> dict:
    trade = {
        "id": row["id"],
        "symbol": row["symbol"],
        "side": row["side"],
        "quantity": row["quantity"],
        "price": row["price"],
        "value": row["value"],
        "fee": row["fee"],
        "realizedPnl": row["realized_pnl"],
        "status": row["status"],
        "executedAt": row["executed_at"],
    }
    if row["strategy_id"] is not None:
        trade["strategyId"] = row["strategy_id"]
    return trade


def load_portfolio(connection: sqlite3.Connection) -> dict:
    account_row = connection.execute(
        "SELECT balance, realized_pnl FROM account WHERE id = 1"
    ).fetchone()
    if account_row is None:
        raise RuntimeError("Portfolio account has not been initialized.")

    position_rows = connection.execute(
        """
        SELECT * FROM positions
        WHERE status = 'OPEN'
        ORDER BY rowid DESC
        """
    ).fetchall()
    positions = [_position_from_row(row) for row in position_rows]

    trade_rows = connection.execute(
        """
        SELECT * FROM trades
        ORDER BY executed_at DESC, rowid DESC
        LIMIT ?
        """,
        (STATE_TRADE_LIMIT,),
    ).fetchall()
    trades = [_trade_from_row(row) for row in trade_rows]

    balance = float(account_row["balance"])
    realized_pnl = float(account_row["realized_pnl"])
    used_margin = sum(float(row["margin"]) for row in position_rows)
    unrealized_pnl = sum(float(row["unrealized_pnl"]) for row in position_rows)
    equity = balance + unrealized_pnl
    return {
        "account": {
            "balance": round(balance, 2),
            "equity": round(equity, 2),
            "availableBalance": round(max(0, balance - used_margin), 2),
            "usedMargin": round(used_margin, 2),
            "unrealizedPnl": round(unrealized_pnl, 2),
            "realizedPnl": round(realized_pnl, 2),
            "totalPnl": round(realized_pnl + unrealized_pnl, 2),
        },
        "positions": positions,
        "trades": trades,
    }


def insert_position(connection: sqlite3.Connection, position: dict) -> None:
    connection.execute(
        """
        INSERT INTO positions (
            id, strategy_id, symbol, name, side, quantity, entry_price,
            current_price, leverage, margin, unrealized_pnl,
            unrealized_pnl_percent, status, opened_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        """,
        (
            position["id"],
            position.get("strategyId"),
            position["symbol"],
            position["name"],
            position["side"],
            position["quantity"],
            position["entryPrice"],
            position["currentPrice"],
            position["leverage"],
            position["margin"],
            position["unrealizedPnl"],
            position["unrealizedPnlPercent"],
            position["status"],
            position["openedAt"],
        ),
    )


def insert_trade(
    connection: sqlite3.Connection,
    trade: dict,
    position_id: str,
) -> None:
    connection.execute(
        """
        INSERT INTO trades (
            id, strategy_id, position_id, symbol, side, quantity, price, value,
            fee, realized_pnl, status, executed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trade["id"],
            trade.get("strategyId"),
            position_id,
            trade["symbol"],
            trade["side"],
            trade["quantity"],
            trade["price"],
            trade["value"],
            trade["fee"],
            trade["realizedPnl"],
            trade["status"],
            trade["executedAt"],
        ),
    )


def mark_position_closed(
    connection: sqlite3.Connection,
    position_id: str,
    closed_at: str,
) -> None:
    connection.execute(
        """
        UPDATE positions
        SET status = 'CLOSED', closed_at = ?
        WHERE id = ? AND status = 'OPEN'
        """,
        (closed_at, position_id),
    )


def apply_realized_pnl(connection: sqlite3.Connection, pnl: float) -> None:
    row = connection.execute(
        "SELECT balance, realized_pnl FROM account WHERE id = 1"
    ).fetchone()
    if row is None:
        raise RuntimeError("Portfolio account has not been initialized.")
    connection.execute(
        """
        UPDATE account
        SET balance = ?, realized_pnl = ?
        WHERE id = 1
        """,
        (
            round(float(row["balance"]) + pnl, 2),
            round(float(row["realized_pnl"]) + pnl, 2),
        ),
    )