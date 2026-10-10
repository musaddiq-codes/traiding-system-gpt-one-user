import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.market.data import (
    CHART_RANGES,
    FALLBACK_ASSETS,
    FAVORITE_SYMBOLS,
    fetch_market_snapshot,
)
from app.market.service import market_data_service


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("")
async def get_market(
    symbol: str | None = None,
    interval: str = Query(default="1m"),
    limit: int = Query(default=200, ge=1, le=1_000),
) -> dict:
    updated_at = datetime.now(timezone.utc).isoformat()
    if symbol:
        if interval not in CHART_RANGES:
            raise HTTPException(status_code=400, detail="Unsupported candle interval.")
        try:
            candles = await market_data_service.load_candles(
                symbol,
                interval,
                limit,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except httpx.HTTPError as error:
            logger.exception("Live candle request failed for %s", symbol)
            raise HTTPException(
                status_code=502,
                detail="Live market or candle data is currently unavailable.",
            ) from error
        return {
            "candles": candles,
            "updatedAt": updated_at,
            "source": "binance-live",
            "is_live": True,
        }

    cached_assets = market_data_service.get_market_snapshot()
    if (
        len(cached_assets) == len(FAVORITE_SYMBOLS)
        and all(asset["is_live"] for asset in cached_assets)
    ):
        return {
            "assets": cached_assets,
            "updatedAt": updated_at,
            "source": "binance-live",
            "is_live": True,
        }
    try:
        assets = await fetch_market_snapshot()
    except (httpx.HTTPError, ValueError, KeyError) as error:
        logger.warning("Live market snapshot unavailable; returning demo prices: %s", error)
        return {
            "assets": FALLBACK_ASSETS,
            "updatedAt": updated_at,
            "source": "mock-market-data-fallback",
            "is_live": False,
        }
    market_data_service.ingest_market_snapshot(assets)
    return {
        "assets": assets,
        "updatedAt": updated_at,
        "source": "binance-live",
        "is_live": True,
    }