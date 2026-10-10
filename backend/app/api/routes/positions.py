from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException

from app.api.routes.schemas import OrderPayload
from app.database.database import database_connection
from app.market.data import FALLBACK_ASSETS, fetch_market_snapshot, normalize_symbol
from app.risk.manager import OrderRejected, check_order
from app.trading.portfolio import (
    _position_from_row,
    apply_realized_pnl,
    insert_position,
    insert_trade,
    load_portfolio,
    mark_position_closed,
)


router = APIRouter(prefix="/api", tags=["portfolio"])


def get_portfolio_snapshot() -> dict:
    with database_connection() as connection:
        return load_portfolio(connection)


async def _get_current_price(symbol: str) -> tuple[str, float, str]:
    try:
        normalized = normalize_symbol(symbol)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    try:
        assets = await fetch_market_snapshot()
    except (httpx.HTTPError, KeyError, ValueError) as error:
        raise HTTPException(
            status_code=502,
            detail="A live market price is required to place a paper order.",
        ) from error

    display_symbol = f"{normalized.removesuffix('USDT')}/USDT"
    asset = next((item for item in assets if item["symbol"] == display_symbol), None)
    if asset is None:
        asset = next(
            (item for item in FALLBACK_ASSETS if item["symbol"] == display_symbol),
            None,
        )
    if asset is None:
        raise HTTPException(status_code=404, detail="Market pair is not supported.")
    return display_symbol, float(asset["price"]), str(asset["name"])


async def open_paper_position(payload: OrderPayload) -> tuple[dict, dict]:
    symbol, price, name = await _get_current_price(payload.symbol)
    with database_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        snapshot = load_portfolio(connection)
        account = snapshot["account"]
        margin = price * payload.quantity
        try:
            check_order(
                connection,
                snapshot,
                strategy_id=payload.strategyId,
                symbol=symbol,
                quantity=payload.quantity,
                price=price,
            )
        except OrderRejected as error:
            raise HTTPException(status_code=error.status_code, detail=str(error)) from error
        available = float(account["availableBalance"])
        if margin > available:
            raise HTTPException(status_code=422, detail="Insufficient available balance.")

        now = datetime.now(timezone.utc).isoformat()
        position = {
            "id": f"position-{uuid4().hex}",
            "symbol": symbol,
            "name": name,
            "side": payload.side,
            "quantity": payload.quantity,
            "entryPrice": price,
            "currentPrice": price,
            "leverage": 1,
            "margin": margin,
            "unrealizedPnl": 0,
            "unrealizedPnlPercent": 0,
            "status": "OPEN",
            "openedAt": now,
        }
        if payload.strategyId and payload.strategyId != "manual":
            position["strategyId"] = payload.strategyId

        trade = {
            "id": f"trade-{uuid4().hex}",
            "symbol": symbol,
            "side": "BUY" if payload.side == "LONG" else "SELL",
            "quantity": payload.quantity,
            "price": price,
            "value": margin,
            "fee": 0,
            "realizedPnl": 0,
            "status": "FILLED",
            "executedAt": now,
        }
        if payload.strategyId and payload.strategyId != "manual":
            trade["strategyId"] = payload.strategyId

        insert_position(connection, position)
        insert_trade(connection, trade, position["id"])
    return position, trade


@router.get("/state")
def get_state() -> dict:
    return get_portfolio_snapshot()


@router.get("/positions")
def list_positions() -> dict:
    snapshot = get_portfolio_snapshot()
    return {"positions": snapshot["positions"]}


@router.delete("/positions/{position_id}")
async def close_position(position_id: str) -> dict:
    snapshot = get_portfolio_snapshot()
    position = next(
        (item for item in snapshot["positions"] if item["id"] == position_id),
        None,
    )
    if position is None:
        raise HTTPException(status_code=404, detail="Position not found.")
    symbol, price, _ = await _get_current_price(position["symbol"])

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
            raise HTTPException(status_code=404, detail="Position not found.")
        position = _position_from_row(position_row)
        quantity = float(position["quantity"])
        entry_price = float(position["entryPrice"])
        direction = 1 if position["side"] == "LONG" else -1
        realized_pnl = (price - entry_price) * quantity * direction
        now = datetime.now(timezone.utc).isoformat()
        trade = {
            "id": f"trade-{uuid4().hex}",
            "symbol": symbol,
            "side": "SELL" if position["side"] == "LONG" else "BUY",
            "quantity": quantity,
            "price": price,
            "value": price * quantity,
            "fee": 0,
            "realizedPnl": round(realized_pnl, 2),
            "status": "FILLED",
            "executedAt": now,
        }
        if position.get("strategyId"):
            trade["strategyId"] = position["strategyId"]

        mark_position_closed(connection, position_id, now)
        insert_trade(connection, trade, position_id)
        apply_realized_pnl(connection, realized_pnl)
        snapshot = load_portfolio(connection)
    return {"trade": trade, "state": snapshot, "mode": "paper"}