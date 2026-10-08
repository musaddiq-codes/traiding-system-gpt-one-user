import json
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException

from app.api.routes.schemas import OrderPayload
from app.database.database import database_connection
from app.market.data import FALLBACK_ASSETS, fetch_market_snapshot, normalize_symbol


router = APIRouter(prefix="/api", tags=["portfolio"])


def get_portfolio_snapshot() -> dict:
    with database_connection() as connection:
        row = connection.execute(
            "SELECT payload FROM app_state WHERE id = 1"
        ).fetchone()
    if row is None:
        raise RuntimeError("Portfolio state has not been initialized.")
    return json.loads(row["payload"])


def _load_portfolio_snapshot(connection) -> dict:
    row = connection.execute(
        "SELECT payload FROM app_state WHERE id = 1"
    ).fetchone()
    if row is None:
        raise RuntimeError("Portfolio state has not been initialized.")
    return json.loads(row["payload"])


def _save_portfolio_snapshot(connection, snapshot: dict) -> None:
    connection.execute(
        "UPDATE app_state SET payload = ? WHERE id = 1",
        (json.dumps(snapshot),),
    )


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
        snapshot = _load_portfolio_snapshot(connection)
        account = snapshot["account"]
        margin = price * payload.quantity
        available = float(account["balance"]) - float(account["usedMargin"])
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

        snapshot["positions"].insert(0, position)
        snapshot["trades"].insert(0, trade)
        account["usedMargin"] = round(float(account["usedMargin"]) + margin, 2)
        account["availableBalance"] = round(
            max(0, float(account["balance"]) - account["usedMargin"]), 2
        )
        _save_portfolio_snapshot(connection, snapshot)
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
        snapshot = _load_portfolio_snapshot(connection)
        position_index = next(
            (
                index
                for index, item in enumerate(snapshot["positions"])
                if item["id"] == position_id
            ),
            None,
        )
        if position_index is None:
            raise HTTPException(status_code=404, detail="Position not found.")
        position = snapshot["positions"][position_index]
        quantity = float(position["quantity"])
        entry_price = float(position["entryPrice"])
        direction = 1 if position["side"] == "LONG" else -1
        realized_pnl = (price - entry_price) * quantity * direction
        margin = float(position["margin"])
        account = snapshot["account"]
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

        snapshot["positions"].pop(position_index)
        snapshot["trades"].insert(0, trade)
        account["balance"] = round(float(account["balance"]) + realized_pnl, 2)
        account["realizedPnl"] = round(float(account["realizedPnl"]) + realized_pnl, 2)
        account["usedMargin"] = round(max(0, float(account["usedMargin"]) - margin), 2)
        account["availableBalance"] = round(
            max(0, float(account["balance"]) - account["usedMargin"]), 2
        )
        account["unrealizedPnl"] = round(
            sum(float(item.get("unrealizedPnl", 0)) for item in snapshot["positions"]), 2
        )
        account["equity"] = round(account["balance"] + account["unrealizedPnl"], 2)
        account["totalPnl"] = round(account["realizedPnl"] + account["unrealizedPnl"], 2)
        _save_portfolio_snapshot(connection, snapshot)
    return {"trade": trade, "state": snapshot, "mode": "paper"}