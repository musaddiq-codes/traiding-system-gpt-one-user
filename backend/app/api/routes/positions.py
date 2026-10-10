import httpx
from fastapi import APIRouter, HTTPException

from app.api.routes.schemas import OrderPayload
from app.database.database import database_connection
from app.market.data import fetch_market_snapshot, fetch_market_ticker, normalize_symbol
from app.market.service import market_data_service
from app.trading.order_manager import (
    PaperTradingError,
    close_paper_position as close_position_service,
    open_paper_position as open_position_service,
)
from app.trading.portfolio import load_portfolio


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
        try:
            asset = await fetch_market_ticker(normalized)
        except (httpx.HTTPError, KeyError, ValueError) as error:
            raise HTTPException(
                status_code=502,
                detail="A live market price is required to place a paper order.",
            ) from error
    market_data_service.ingest_market_snapshot([asset])
    return display_symbol, float(asset["price"]), str(asset["name"])


async def open_paper_position(payload: OrderPayload) -> tuple[dict, dict]:
    symbol, price, _name = await _get_current_price(payload.symbol)
    try:
        return open_position_service(
            symbol,
            payload.side,
            payload.quantity,
            payload.strategyId,
            price,
        )
    except PaperTradingError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error


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
    _, price, _ = await _get_current_price(position["symbol"])
    try:
        return close_position_service(position_id, price)
    except PaperTradingError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error