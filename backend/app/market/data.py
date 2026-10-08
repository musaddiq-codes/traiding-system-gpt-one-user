import json
import re
from datetime import datetime, timezone

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