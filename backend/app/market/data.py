import json
import re
from datetime import datetime, timezone
from typing import Any

import httpx


BINANCE_BASE_URL = "https://api.binance.com/api/v3"
FAVORITE_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT")
SYMBOL_NAMES = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "SOL": "Solana",
    "BNB": "BNB",
    "XRP": "XRP",
}
FALLBACK_ASSETS = [
    {
        "symbol": "BTC/USDT",
        "name": "Bitcoin",
        "price": 67842.5,
        "change24h": 2.84,
        "volume24h": 28400000000,
        "high24h": 68420.0,
        "low24h": 65210.0,
    },
    {
        "symbol": "ETH/USDT",
        "name": "Ethereum",
        "price": 3524.82,
        "change24h": 1.92,
        "volume24h": 14200000000,
        "high24h": 3580.0,
        "low24h": 3412.5,
    },
    {
        "symbol": "SOL/USDT",
        "name": "Solana",
        "price": 184.62,
        "change24h": 5.41,
        "volume24h": 4200000000,
        "high24h": 190.4,
        "low24h": 172.8,
    },
    {
        "symbol": "BNB/USDT",
        "name": "BNB",
        "price": 592.34,
        "change24h": -0.74,
        "volume24h": 980000000,
        "high24h": 604.2,
        "low24h": 584.1,
    },
    {
        "symbol": "XRP/USDT",
        "name": "XRP",
        "price": 0.5428,
        "change24h": 3.18,
        "volume24h": 2100000000,
        "high24h": 0.558,
        "low24h": 0.521,
    },
]
CHART_RANGES = {"1s", "1m", "5m", "15m", "30m", "1h", "4h", "1d"}
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9]{5,20}$")
MAX_HISTORICAL_CANDLES = 20_000
HISTORICAL_PAGE_SIZE = 1_000


def interval_milliseconds(interval: str) -> int:
    match = re.fullmatch(r"(\d+)([smhd])", interval)
    if match is None:
        raise ValueError("Unsupported candle interval.")
    amount = int(match.group(1))
    multiplier = {
        "s": 1_000,
        "m": 60_000,
        "h": 3_600_000,
        "d": 86_400_000,
    }[match.group(2)]
    return amount * multiplier


def normalize_symbol(symbol: str) -> str:
    normalized = re.sub(r"[\s/]", "", symbol).upper()
    if not SYMBOL_PATTERN.fullmatch(normalized):
        raise ValueError("Invalid market symbol.")
    return normalized


async def fetch_market_snapshot() -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{BINANCE_BASE_URL}/ticker/24hr",
            params={"symbols": json.dumps(FAVORITE_SYMBOLS, separators=(",", ":"))},
        )
        response.raise_for_status()
        payload = response.json()

    assets = []
    for item in payload:
        base_symbol = item["symbol"].removesuffix("USDT")
        assets.append(
            {
                "symbol": f"{base_symbol}/USDT",
                "name": SYMBOL_NAMES.get(base_symbol, base_symbol),
                "price": float(item["lastPrice"]),
                "change24h": float(item["priceChangePercent"]),
                "volume24h": float(item["quoteVolume"]),
                "high24h": float(item["highPrice"]),
                "low24h": float(item["lowPrice"]),
            }
        )
    return assets


async def fetch_market_ticker(symbol: str) -> dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{BINANCE_BASE_URL}/ticker/24hr",
            params={"symbol": normalized_symbol},
        )
        response.raise_for_status()
        item = response.json()
    base_symbol = normalized_symbol.removesuffix("USDT")
    return {
        "symbol": f"{base_symbol}/USDT",
        "name": SYMBOL_NAMES.get(base_symbol, base_symbol),
        "price": float(item["lastPrice"]),
        "change24h": float(item["priceChangePercent"]),
        "volume24h": float(item["quoteVolume"]),
        "high24h": float(item["highPrice"]),
        "low24h": float(item["lowPrice"]),
    }


async def fetch_candles(symbol: str, interval: str, limit: int) -> list[dict]:
    if interval not in CHART_RANGES:
        raise ValueError("Unsupported candle interval.")
    normalized_symbol = normalize_symbol(symbol)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{BINANCE_BASE_URL}/klines",
            params={
                "symbol": normalized_symbol,
                "interval": interval,
                "limit": limit,
            },
        )
        response.raise_for_status()
        rows = response.json()

    candles = []
    for row in rows:
        timestamp = int(row[0])
        candles.append(
            {
                "time": datetime.fromtimestamp(
                    timestamp / 1000, tz=timezone.utc
                ).isoformat().replace("+00:00", "Z"),
                "timestamp": timestamp,
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            }
        )
    return candles


def _map_historical_klines(rows: list[list[Any]]) -> list[dict]:
    return [
        {
            "time": datetime.fromtimestamp(
                int(row[0]) / 1000, tz=timezone.utc
            ).isoformat().replace("+00:00", "Z"),
            "timestamp": int(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        }
        for row in rows
    ]


async def _fetch_historical_pages(
    client: httpx.AsyncClient,
    symbol: str,
    interval: str,
    start_time: int,
    end_time: int,
    step_ms: int,
) -> list[dict]:
    candles: list[dict] = []
    cursor = start_time
    while cursor < end_time:
        response = await client.get(
            f"{BINANCE_BASE_URL}/klines",
            params={
                "symbol": symbol,
                "interval": interval,
                "startTime": cursor,
                "endTime": end_time,
                "limit": HISTORICAL_PAGE_SIZE,
            },
        )
        response.raise_for_status()
        page = _map_historical_klines(response.json())
        if not page:
            break
        candles.extend(page)
        next_cursor = page[-1]["timestamp"] + step_ms
        if next_cursor <= cursor:
            raise ValueError("Historical candle pagination did not advance.")
        cursor = next_cursor
    return [candle for candle in candles if candle["timestamp"] < end_time]


async def fetch_historical_candles(
    symbol: str,
    interval: str,
    days: float,
    *,
    client: httpx.AsyncClient | None = None,
    now_ms: int | None = None,
) -> list[dict]:
    if interval not in CHART_RANGES:
        raise ValueError("Unsupported candle interval.")
    normalized_symbol = normalize_symbol(symbol)
    step_ms = interval_milliseconds(interval)
    end_time = now_ms if now_ms is not None else int(
        datetime.now(timezone.utc).timestamp() * 1000
    )
    start_time = end_time - int(days * 86_400_000)
    requested_candles = (end_time - start_time + step_ms - 1) // step_ms
    if requested_candles > MAX_HISTORICAL_CANDLES:
        raise ValueError(
            f"This timeframe and lookback require {requested_candles} candles; "
            "the maximum supported backtest size is 20000. Choose a shorter "
            "lookback or larger candle interval."
        )
    if start_time >= end_time:
        return []

    if client is not None:
        return await _fetch_historical_pages(
            client,
            normalized_symbol,
            interval,
            start_time,
            end_time,
            step_ms,
        )
    async with httpx.AsyncClient(timeout=20) as owned_client:
        return await _fetch_historical_pages(
            owned_client,
            normalized_symbol,
            interval,
            start_time,
            end_time,
            step_ms,
        )