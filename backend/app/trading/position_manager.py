import json
import logging
import math
import sqlite3
from collections.abc import Callable
from typing import Any

from app.database.database import database_connection
from app.market.data import normalize_symbol
from app.market.service import MarketDataService
from app.trading.order_manager import PaperTradingError, close_paper_position


logger = logging.getLogger(__name__)


def _live_price_map(prices: dict[str, Any]) -> dict[str, float]:
    live_prices: dict[str, float] = {}
    for symbol, value in prices.items():
        if isinstance(value, dict):
            if value.get("is_live") is not True:
                continue
            price = value.get("price")
        else:
            price = value
        if (
            not isinstance(price, (int, float))
            or isinstance(price, bool)
            or not math.isfinite(price)
            or price <= 0
        ):
            continue
        live_prices[normalize_symbol(symbol)] = float(price)
    return live_prices


def _mark_to_market(
    connection: sqlite3.Connection,
    prices: dict[str, float],
) -> int:
    if not prices:
        return 0
    positions = connection.execute(
        """
        SELECT id, symbol, side, quantity, entry_price
        FROM positions
        WHERE status = 'OPEN'
        """
    ).fetchall()
    updated = 0
    for position in positions:
        current_price = prices.get(normalize_symbol(position["symbol"]))
        if current_price is None:
            continue
        entry_price = float(position["entry_price"])
        quantity = float(position["quantity"])
        direction = 1 if position["side"] == "LONG" else -1
        pnl = (current_price - entry_price) * quantity * direction
        entry_value = entry_price * quantity
        pnl_percent = (pnl / entry_value) * 100 if entry_value else 0
        connection.execute(
            """
            UPDATE positions
            SET current_price = ?, unrealized_pnl = ?,
                unrealized_pnl_percent = ?
            WHERE id = ? AND status = 'OPEN'
            """,
            (current_price, pnl, pnl_percent, position["id"]),
        )
        updated += 1
    return updated


def mark_to_market(
    prices: dict[str, Any],
    *,
    connection: sqlite3.Connection | None = None,
) -> int:
    live_prices = _live_price_map(prices)
    if connection is not None:
        return _mark_to_market(connection, live_prices)
    with database_connection() as database:
        return _mark_to_market(database, live_prices)


def _strategy_exit_reason(
    position: dict[str, Any],
    strategy: dict[str, Any],
    price: float,
) -> str | None:
    entry_price = float(position["entry_price"])
    if entry_price <= 0:
        return None
    direction = 1 if position["side"] == "LONG" else -1
    pnl_percent = ((price - entry_price) / entry_price) * 100 * direction
    stop_loss = float(strategy["stopLoss"])
    take_profit = float(strategy["takeProfit"])
    stop_hit = pnl_percent <= -stop_loss
    take_profit_hit = pnl_percent >= take_profit
    if stop_hit:
        return "SL"
    if take_profit_hit:
        return "TP"
    return None


def enforce_strategy_exits(symbol: str, price: float) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    with database_connection() as connection:
        rows = connection.execute(
            """
            SELECT p.id, p.strategy_id, p.symbol, p.side, p.quantity, p.entry_price,
                   s.payload AS strategy_payload
            FROM positions AS p
            LEFT JOIN strategies AS s ON s.id = p.strategy_id
            WHERE p.status = 'OPEN' AND p.strategy_id IS NOT NULL
            """
        ).fetchall()
    closures: list[tuple[str, str]] = []
    for row in rows:
        if normalize_symbol(row["symbol"]) != normalized_symbol:
            continue
        if row["strategy_payload"] is None:
            logger.warning(
                "Cannot enforce SL/TP for position %s: strategy is missing.",
                row["id"],
            )
            continue
        strategy = json.loads(row["strategy_payload"])
        try:
            reason = _strategy_exit_reason(dict(row), strategy, price)
        except (KeyError, TypeError, ValueError):
            logger.exception(
                "Cannot evaluate SL/TP for position %s.",
                row["id"],
            )
            continue
        if reason is not None:
            closures.append((row["id"], reason))

    closed: list[dict] = []
    for position_id, reason in closures:
        try:
            closed.append(
                close_paper_position(position_id, price, reason=reason)
            )
        except PaperTradingError as error:
            if error.status_code == 404:
                logger.info("Position %s was already closed.", position_id)
                continue
            raise
    return closed


def handle_market_update(event: dict[str, Any]) -> None:
    if event.get("type") != "ticker" or event.get("is_live") is not True:
        return
    symbol = event.get("symbol")
    price = event.get("price")
    if not isinstance(symbol, str):
        return
    try:
        mark_to_market({symbol: {"price": price, "is_live": True}})
        enforce_strategy_exits(symbol, float(price))
    except (TypeError, ValueError):
        logger.exception("Ignoring invalid live market update for %s.", symbol)


def start_market_updates(
    service: MarketDataService,
) -> Callable[[], None]:
    return service.subscribe(handle_market_update)