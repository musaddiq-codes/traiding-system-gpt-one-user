import math
import os
from datetime import datetime, timezone
from uuid import uuid4

from app.database.database import database_connection
from app.market.data import SYMBOL_NAMES, normalize_symbol
from app.risk.manager import OrderRejected, check_order
from app.trading.portfolio import (
    _position_from_row,
    apply_realized_pnl,
    insert_position,
    insert_trade,
    load_portfolio,
    mark_position_closed,
)


class PaperTradingError(Exception):
    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


class PositionNotFound(PaperTradingError):
    def __init__(self) -> None:
        super().__init__("Position not found.", 404)


def _paper_fee_bps() -> float:
    fee_bps = float(os.environ.get("PAPER_FEE_BPS", "0"))
    if not math.isfinite(fee_bps) or fee_bps < 0:
        raise ValueError("PAPER_FEE_BPS must be a finite non-negative number.")
    return fee_bps


def _fee_for_notional(notional: float) -> float:
    return notional * _paper_fee_bps() / 10_000


def _validate_price(price: float) -> float:
    if not isinstance(price, (int, float)) or isinstance(price, bool):
        raise PaperTradingError("A valid live market price is required.", 422)
    normalized_price = float(price)
    if not math.isfinite(normalized_price) or normalized_price <= 0:
        raise PaperTradingError("A valid live market price is required.", 422)
    return normalized_price


def _translate_order_rejection(error: OrderRejected) -> PaperTradingError:
    return PaperTradingError(str(error), error.status_code)


def open_paper_position(
    symbol: str,
    side: str,
    quantity: float,
    strategy_id: str | None,
    price: float,
) -> tuple[dict, dict]:
    try:
        normalized_symbol = normalize_symbol(symbol)
    except ValueError as error:
        raise PaperTradingError(str(error), 400) from error
    if side not in ("LONG", "SHORT"):
        raise PaperTradingError("Invalid paper position side.", 422)
    if (
        not isinstance(quantity, (int, float))
        or isinstance(quantity, bool)
        or not math.isfinite(quantity)
        or quantity <= 0
    ):
        raise PaperTradingError("A valid paper position quantity is required.", 422)
    live_price = _validate_price(price)
    display_symbol = (
        f"{normalized_symbol.removesuffix('USDT')}/USDT"
        if normalized_symbol.endswith("USDT")
        else normalized_symbol
    )
    base_symbol = normalized_symbol.removesuffix("USDT")
    name = SYMBOL_NAMES.get(base_symbol, base_symbol)
    margin = live_price * quantity
    fee = _fee_for_notional(margin)

    with database_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        snapshot = load_portfolio(connection, refresh_market_data=False)
        try:
            check_order(
                connection,
                snapshot,
                strategy_id=strategy_id,
                symbol=display_symbol,
                quantity=quantity,
                price=live_price,
            )
        except OrderRejected as error:
            raise _translate_order_rejection(error) from error
        available = float(snapshot["account"]["availableBalance"])
        if margin + fee > available:
            raise PaperTradingError("Insufficient available balance.")

        now = datetime.now(timezone.utc).isoformat()
        position = {
            "id": f"position-{uuid4().hex}",
            "symbol": display_symbol,
            "name": name,
            "side": side,
            "quantity": quantity,
            "entryPrice": live_price,
            "currentPrice": live_price,
            "leverage": 1,
            "margin": margin,
            "unrealizedPnl": 0,
            "unrealizedPnlPercent": 0,
            "status": "OPEN",
            "openedAt": now,
        }
        if strategy_id and strategy_id != "manual":
            position["strategyId"] = strategy_id

        trade = {
            "id": f"trade-{uuid4().hex}",
            "symbol": display_symbol,
            "side": "BUY" if side == "LONG" else "SELL",
            "quantity": quantity,
            "price": live_price,
            "value": margin,
            "fee": fee,
            "realizedPnl": -fee,
            "status": "FILLED",
            "executedAt": now,
        }
        if strategy_id and strategy_id != "manual":
            trade["strategyId"] = strategy_id

        insert_position(connection, position)
        insert_trade(connection, trade, position["id"])
        if fee:
            apply_realized_pnl(connection, -fee)
    return position, trade


def close_paper_position(
    position_id: str,
    price: float,
    reason: str = "MANUAL",
) -> dict:
    live_price = _validate_price(price)
    with database_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        position_row = connection.execute(
            """
            SELECT * FROM positions
            WHERE id = ? AND status = 'OPEN'
            """,
            (position_id,),
        ).fetchone()
        if position_row is None:
            raise PositionNotFound()
        position = _position_from_row(position_row)
        quantity = float(position["quantity"])
        entry_price = float(position["entryPrice"])
        direction = 1 if position["side"] == "LONG" else -1
        notional = live_price * quantity
        exit_fee = _fee_for_notional(notional)
        realized_pnl = (live_price - entry_price) * quantity * direction
        net_realized_pnl = realized_pnl - exit_fee
        now = datetime.now(timezone.utc).isoformat()
        trade = {
            "id": f"trade-{uuid4().hex}",
            "symbol": position["symbol"],
            "side": "SELL" if position["side"] == "LONG" else "BUY",
            "quantity": quantity,
            "price": live_price,
            "value": notional,
            "fee": exit_fee,
            "realizedPnl": round(net_realized_pnl, 2),
            "status": "FILLED",
            "executedAt": now,
        }
        if position.get("strategyId"):
            trade["strategyId"] = position["strategyId"]
        if reason not in ("", "MANUAL"):
            trade["note"] = reason

        mark_position_closed(connection, position_id, now)
        insert_trade(connection, trade, position_id)
        apply_realized_pnl(connection, net_realized_pnl)
        snapshot = load_portfolio(connection, refresh_market_data=False)
    return {"trade": trade, "state": snapshot, "mode": "paper"}