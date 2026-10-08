import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.market.data import (
    CHART_RANGES,
    FALLBACK_ASSETS,
    fetch_candles,
    fetch_market_snapshot,
)


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
            candles = await fetch_candles(symbol, interval, limit)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except httpx.HTTPError as error:
            logger.exception("Live candle request failed for %s", symbol)
            raise HTTPException(
                status_code=502,
                detail="Live market or candle data is currently unavailable.",
            ) from error
        return {"candles": candles, "updatedAt": updated_at, "source": "binance-live"}

    try:
        assets = await fetch_market_snapshot()
    except (httpx.HTTPError, ValueError, KeyError) as error:
        logger.warning("Live market snapshot unavailable; returning demo prices: %s", error)
        return {
            "assets": FALLBACK_ASSETS,
            "updatedAt": updated_at,
            "source": "mock-market-data-fallback",
        }
    return {"assets": assets, "updatedAt": updated_at, "source": "binance-live"}