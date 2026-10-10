import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

import websockets

from app.database.database import database_connection
from app.market.data import (
    CHART_RANGES,
    FAVORITE_SYMBOLS,
    fetch_candles,
    fetch_market_snapshot,
    fetch_market_ticker,
    interval_milliseconds,
    normalize_symbol,
)


logger = logging.getLogger(__name__)
BINANCE_STREAM_URL = "wss://stream.binance.com:9443/stream"
REST_POLL_SECONDS = 5
STALE_AFTER_SECONDS = 30
CANDLE_CACHE_SIZE = 500
ReconnectConnector = Callable[..., Any]
MarketListener = Callable[[dict[str, Any]], Any]


class MarketDataService:
    def __init__(
        self,
        *,
        connector: ReconnectConnector | None = None,
        snapshot_fetcher: Callable[[], Awaitable[list[dict]]] = fetch_market_snapshot,
        ticker_fetcher: Callable[[str], Awaitable[dict]] = fetch_market_ticker,
        candles_fetcher: Callable[[str, str, int], Awaitable[list[dict]]] = fetch_candles,
        poll_seconds: float = REST_POLL_SECONDS,
        stale_after_seconds: float = STALE_AFTER_SECONDS,
        reconnect_initial_seconds: float = 1,
        reconnect_max_seconds: float = 30,
    ) -> None:
        self._connector = connector or websockets.connect
        self._snapshot_fetcher = snapshot_fetcher
        self._ticker_fetcher = ticker_fetcher
        self._candles_fetcher = candles_fetcher
        self._poll_seconds = poll_seconds
        self._stale_after_seconds = stale_after_seconds
        self._reconnect_initial_seconds = reconnect_initial_seconds
        self._reconnect_max_seconds = reconnect_max_seconds
        self._prices: dict[str, dict[str, Any]] = {}
        self._candles: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self._active_series: set[tuple[str, str]] = set()
        self._requested_series: dict[tuple[str, str], int] = {}
        self._seed_tasks: dict[tuple[str, str], asyncio.Task] = {}
        self._listeners: set[MarketListener] = set()
        self._lock = asyncio.Lock()
        self._socket_send_lock = asyncio.Lock()
        self._socket: Any = None
        self._connected_streams: set[str] = set()
        self._tasks: list[asyncio.Task] = []
        self._running = False
        self._last_active_refresh = 0.0
        self._now_ms: Callable[[], int] = lambda: int(time.time() * 1000)

    @property
    def socket_connected(self) -> bool:
        return self._socket is not None

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        await self._refresh_active_series()
        self._tasks = [
            asyncio.create_task(self._socket_loop(), name="market-websocket"),
            asyncio.create_task(self._rest_poll_loop(), name="market-rest-fallback"),
            asyncio.create_task(self._active_series_loop(), name="market-strategy-series"),
        ]

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()
        socket = self._socket
        self._socket = None
        if socket is not None:
            await socket.close()

    def subscribe(self, listener: MarketListener) -> Callable[[], None]:
        self._listeners.add(listener)

        def unsubscribe() -> None:
            self._listeners.discard(listener)

        return unsubscribe

    def get_price(self, symbol: str) -> dict[str, Any]:
        normalized = normalize_symbol(symbol)
        price = self._prices.get(normalized)
        if price is None:
            return {
                "symbol": f"{normalized.removesuffix('USDT')}/USDT",
                "price": None,
                "status": "unavailable",
                "is_live": False,
                "ageSeconds": None,
            }
        age_seconds = max(0, (self._now_ms() - price["timestamp"]) / 1000)
        status = "live" if age_seconds <= self._stale_after_seconds else "stale"
        return {
            **price,
            "ageSeconds": age_seconds,
            "status": status,
            "is_live": status == "live" and price["source"] != "mock-market-data-fallback",
        }

    def get_candles(
        self,
        symbol: str,
        interval: str,
        limit: int,
        closed_only: bool = False,
    ) -> list[dict[str, Any]]:
        key = self._series_key(symbol, interval)
        items = self._candles.get(key, [])
        if closed_only:
            items = [candle for candle in items if candle["closed"]]
        selected = items[-limit:] if limit > 0 else []
        return [
            {field: value for field, value in candle.items() if field != "closed"}
            for candle in selected
        ]

    async def load_candles(
        self,
        symbol: str,
        interval: str,
        limit: int,
        closed_only: bool = False,
    ) -> list[dict[str, Any]]:
        key = self._series_key(symbol, interval)
        if key not in self._candles:
            await self._seed_series(key)
        return self.get_candles(symbol, interval, limit, closed_only)

    def get_market_snapshot(self) -> list[dict[str, Any]]:
        assets: list[dict[str, Any]] = []
        for symbol in FAVORITE_SYMBOLS:
            price = self.get_price(symbol)
            if price is None or price["status"] == "unavailable":
                continue
            assets.append(
                {
                    key: price[key]
                    for key in (
                        "symbol",
                        "name",
                        "price",
                        "change24h",
                        "volume24h",
                        "high24h",
                        "low24h",
                        "updatedAt",
                        "status",
                        "is_live",
                    )
                }
            )
        return assets

    def ingest_market_snapshot(self, assets: list[dict[str, Any]]) -> None:
        for asset in assets:
            self._ingest_ticker_asset(asset, source="binance-rest")

    def publish_signal(self, event: dict[str, Any]) -> None:
        self._publish({"type": "signal", **event})

    async def add_kline_subscription(self, symbol: str, interval: str) -> tuple[str, str]:
        key = self._series_key(symbol, interval)
        await self._seed_series(key)
        async with self._lock:
            self._requested_series[key] = self._requested_series.get(key, 0) + 1
        await self._sync_streams()
        return key

    async def remove_kline_subscription(self, key: tuple[str, str]) -> None:
        async with self._lock:
            count = self._requested_series.get(key, 0)
            if count <= 1:
                self._requested_series.pop(key, None)
            else:
                self._requested_series[key] = count - 1
        await self._sync_streams()

    async def _seed_series(self, key: tuple[str, str]) -> None:
        existing = self._seed_tasks.get(key)
        if existing is not None:
            await existing
            return

        async def seed() -> None:
            symbol, interval = key
            candles = await self._candles_fetcher(symbol, interval, CANDLE_CACHE_SIZE)
            step_ms = interval_milliseconds(interval)
            now_ms = self._now_ms()
            self._candles[key] = [
                {
                    **candle,
                    "closed": int(candle["timestamp"]) + step_ms <= now_ms,
                }
                for candle in candles[-CANDLE_CACHE_SIZE:]
            ]

        task = asyncio.create_task(seed())
        self._seed_tasks[key] = task
        try:
            await task
        finally:
            self._seed_tasks.pop(key, None)

    @staticmethod
    def _series_key(symbol: str, interval: str) -> tuple[str, str]:
        if interval not in CHART_RANGES:
            raise ValueError("Unsupported candle interval.")
        normalized_symbol = normalize_symbol(symbol)
        if not normalized_symbol.endswith("USDT"):
            raise ValueError("Unsupported market symbol.")
        return normalized_symbol, interval

    async def _refresh_active_series(self) -> None:
        active: set[tuple[str, str]] = set()
        with database_connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM strategies"
            ).fetchall()
        for row in rows:
            try:
                strategy = json.loads(row["payload"])
                if strategy.get("status") != "ACTIVE":
                    continue
                active.add(
                    self._series_key(strategy["symbol"], strategy["timeframe"])
                )
            except (KeyError, TypeError, ValueError):
                logger.warning("Skipping active strategy with invalid market series.")
        added = active - self._active_series
        self._active_series = active
        for series in added:
            try:
                await self._seed_series(series)
            except Exception:
                logger.exception("Unable to seed active strategy candles for %s", series)
        self._last_active_refresh = time.monotonic()
        await self._sync_streams()

    def _desired_streams(self) -> set[str]:
        streams = {f"{symbol.lower()}@miniTicker" for symbol in FAVORITE_SYMBOLS}
        series = self._active_series | set(self._requested_series)
        streams.update(
            f"{symbol.lower()}@kline_{interval}" for symbol, interval in series
        )
        return streams

    async def _sync_streams(self) -> None:
        socket = self._socket
        if socket is None:
            return
        async with self._socket_send_lock:
            desired = self._desired_streams()
            to_add = sorted(desired - self._connected_streams)
            to_remove = sorted(self._connected_streams - desired)
            if to_add:
                await socket.send(
                    json.dumps(
                        {
                            "method": "SUBSCRIBE",
                            "params": to_add,
                            "id": 1,
                        }
                    )
                )
            if to_remove:
                await socket.send(
                    json.dumps(
                        {
                            "method": "UNSUBSCRIBE",
                            "params": to_remove,
                            "id": 2,
                        }
                    )
                )
            self._connected_streams = desired

    async def _socket_loop(self) -> None:
        backoff = self._reconnect_initial_seconds
        while self._running:
            connected_at: float | None = None
            try:
                streams = ",".join(sorted(self._desired_streams()))
                uri = (
                    f"{BINANCE_STREAM_URL}?streams={streams}"
                    if streams
                    else BINANCE_STREAM_URL
                )
                async with self._connector(
                    uri,
                    ping_interval=20,
                    ping_timeout=20,
                    close_timeout=5,
                ) as socket:
                    self._socket = socket
                    self._connected_streams = self._desired_streams()
                    connected_at = time.monotonic()
                    async for message in socket:
                        await self.ingest_message(message)
            except asyncio.CancelledError:
                raise
            except Exception:
                if self._running:
                    logger.warning("Market WebSocket disconnected; retrying.")
            finally:
                self._socket = None
                self._connected_streams.clear()
                if (
                    connected_at is not None
                    and time.monotonic() - connected_at >= 60
                ):
                    backoff = self._reconnect_initial_seconds
            if self._running:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, self._reconnect_max_seconds)

    async def _rest_poll_loop(self) -> None:
        while self._running:
            if not self.socket_connected:
                await self._poll_rest()
            await asyncio.sleep(self._poll_seconds)

    async def _active_series_loop(self) -> None:
        while self._running:
            await asyncio.sleep(30)
            if time.monotonic() - self._last_active_refresh >= 30:
                await self._refresh_active_series()

    async def _poll_rest(self) -> None:
        symbols = {
            symbol
            for symbol, _ in (self._active_series | set(self._requested_series))
        }
        symbols.update(FAVORITE_SYMBOLS)
        results = await asyncio.gather(
            self._snapshot_fetcher(),
            *(
                self._ticker_fetcher(symbol)
                for symbol in sorted(symbols - set(FAVORITE_SYMBOLS))
            ),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, BaseException):
                logger.warning("REST market-data fallback request failed: %s", result)
                continue
            assets = result if isinstance(result, list) else [result]
            for asset in assets:
                try:
                    self._ingest_ticker_asset(asset, source="binance-rest")
                except (KeyError, TypeError, ValueError):
                    logger.exception("REST market-data response contained an invalid ticker.")

        for symbol, interval in sorted(self._active_series | set(self._requested_series)):
            try:
                candles = await self._candles_fetcher(symbol, interval, 2)
            except Exception:
                logger.warning(
                    "REST candle fallback failed for %s %s.",
                    symbol,
                    interval,
                    exc_info=True,
                )
                continue
            for candle in candles:
                await self._store_candle(
                    (symbol, interval),
                    candle,
                    closed=(
                        int(candle["timestamp"]) + interval_milliseconds(interval)
                        <= self._now_ms()
                    ),
                    publish=False,
                )

    async def ingest_message(self, raw_message: str | bytes) -> None:
        payload = json.loads(raw_message)
        data = payload.get("data", payload)
        if "c" in data and "s" in data:
            self._ingest_mini_ticker(data)
        elif isinstance(data.get("k"), dict):
            await self._ingest_kline(data["k"])

    def _ingest_mini_ticker(self, data: dict[str, Any]) -> None:
        symbol = normalize_symbol(data["s"])
        opened = float(data["o"])
        close = float(data["c"])
        change = ((close - opened) / opened) * 100 if opened else 0
        self._set_price(
            {
                "symbol": f"{symbol.removesuffix('USDT')}/USDT",
                "name": symbol.removesuffix("USDT"),
                "price": close,
                "change24h": change,
                "volume24h": float(data.get("q", 0)),
                "high24h": float(data.get("h", close)),
                "low24h": float(data.get("l", close)),
            },
            source="binance-websocket",
        )

    def _ingest_ticker_asset(self, asset: dict[str, Any], source: str) -> None:
        self._set_price(asset, source=source)

    def _set_price(self, asset: dict[str, Any], source: str) -> None:
        symbol = normalize_symbol(asset["symbol"])
        updated_at = self._now_ms()
        self._prices[symbol] = {
            **asset,
            "symbol": f"{symbol.removesuffix('USDT')}/USDT",
            "timestamp": updated_at,
            "updatedAt": datetime.fromtimestamp(
                updated_at / 1000, tz=timezone.utc
            ).isoformat().replace("+00:00", "Z"),
            "source": source,
            "is_live": source != "mock-market-data-fallback",
        }
        price = self.get_price(symbol)
        if price is not None:
            self._publish(
                {
                    "type": "ticker",
                    **price,
                }
            )

    async def _ingest_kline(self, kline: dict[str, Any]) -> None:
        key = self._series_key(kline["s"], kline["i"])
        candle = {
            "timestamp": int(kline["t"]),
            "time": datetime.fromtimestamp(
                int(kline["t"]) / 1000, tz=timezone.utc
            ).isoformat().replace("+00:00", "Z"),
            "open": float(kline["o"]),
            "high": float(kline["h"]),
            "low": float(kline["l"]),
            "close": float(kline["c"]),
            "volume": float(kline["v"]),
        }
        await self._store_candle(key, candle, bool(kline["x"]), publish=True)
        self._set_price(
            {
                "symbol": f"{key[0].removesuffix('USDT')}/USDT",
                "name": key[0].removesuffix("USDT"),
                "price": candle["close"],
                "change24h": self._prices.get(key[0], {}).get("change24h", 0),
                "volume24h": self._prices.get(key[0], {}).get("volume24h", 0),
                "high24h": self._prices.get(key[0], {}).get("high24h", candle["high"]),
                "low24h": self._prices.get(key[0], {}).get("low24h", candle["low"]),
            },
            source="binance-websocket",
        )

    async def _store_candle(
        self,
        key: tuple[str, str],
        candle: dict[str, Any],
        closed: bool,
        *,
        publish: bool,
    ) -> None:
        series = self._candles.setdefault(key, [])
        stored = {**candle, "closed": closed}
        if series and series[-1]["timestamp"] == stored["timestamp"]:
            series[-1] = stored
        else:
            series.append(stored)
            series.sort(key=lambda item: item["timestamp"])
            del series[:-CANDLE_CACHE_SIZE]
        if publish:
            self._publish(
                {
                    "type": "kline",
                    "symbol": f"{key[0].removesuffix('USDT')}/USDT",
                    "interval": key[1],
                    "candle": {key: value for key, value in stored.items() if key != "closed"},
                    "closed": closed,
                    "is_live": True,
                }
            )

    def _publish(self, event: dict[str, Any]) -> None:
        for listener in tuple(self._listeners):
            try:
                result = listener(event)
                if asyncio.iscoroutine(result):
                    asyncio.create_task(result)
            except Exception:
                logger.exception("Market-data listener failed.")


market_data_service = MarketDataService()
