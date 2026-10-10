import asyncio
import json
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

import httpx
from starlette.websockets import WebSocketDisconnect

from app.api import websocket as websocket_api
from app.market.data import fetch_historical_candles
from app.market.service import MarketDataService


def _market_asset(symbol: str = "BTC/USDT", price: float = 100) -> dict:
    return {
        "symbol": symbol,
        "name": symbol.split("/")[0],
        "price": price,
        "change24h": 1,
        "volume24h": 1_000_000,
        "high24h": price + 1,
        "low24h": price - 1,
    }


def _candle(timestamp: int, close: float = 100) -> dict:
    return {
        "timestamp": timestamp,
        "time": "1970-01-01T00:00:00Z",
        "open": close,
        "high": close,
        "low": close,
        "close": close,
        "volume": 1,
    }


def _fake_database_connection():
    connection = Mock()
    connection.execute.return_value.fetchall.return_value = []

    @contextmanager
    def connect():
        yield connection

    return connect


class _FakeSocket:
    def __init__(self, *, fail_on_receive: bool = False) -> None:
        self.fail_on_receive = fail_on_receive
        self.received = asyncio.Event()
        self.sent: list[str] = []
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> None:
        self.closed = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.fail_on_receive:
            self.fail_on_receive = False
            raise ConnectionError("simulated Binance disconnect")
        await self.received.wait()
        raise StopAsyncIteration

    async def send(self, message: str) -> None:
        self.sent.append(message)

    async def close(self) -> None:
        self.closed = True
        self.received.set()


class _FakeConnector:
    def __init__(self) -> None:
        self.calls = 0
        self.sockets: list[_FakeSocket] = []

    def __call__(self, *_args, **_kwargs) -> _FakeSocket:
        self.calls += 1
        socket = _FakeSocket(fail_on_receive=self.calls == 1)
        self.sockets.append(socket)
        return socket


class _FakeApiWebSocket:
    def __init__(self, initial_message: dict) -> None:
        self.initial_message: dict | None = initial_message
        self.accepted = False
        self.sent: list[dict] = []
        self.disconnect_requested = asyncio.Event()
        self.sent_event = asyncio.Event()
        self.closed: tuple[int, str] | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def receive_json(self) -> dict:
        if self.initial_message is not None:
            message = self.initial_message
            self.initial_message = None
            return message
        await self.disconnect_requested.wait()
        raise WebSocketDisconnect()

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)
        self.sent_event.set()

    async def close(self, code: int, reason: str) -> None:
        self.closed = (code, reason)

    async def wait_for_sent(self, count: int) -> None:
        async def wait_until_sent() -> None:
            while len(self.sent) < count:
                self.sent_event.clear()
                await self.sent_event.wait()

        await asyncio.wait_for(wait_until_sent(), timeout=2)


class MarketDataServiceTests(unittest.IsolatedAsyncioTestCase):
    def create_service(self, **kwargs) -> MarketDataService:
        return MarketDataService(
            snapshot_fetcher=kwargs.pop(
                "snapshot_fetcher",
                lambda: asyncio.sleep(0, result=[_market_asset()]),
            ),
            ticker_fetcher=kwargs.pop(
                "ticker_fetcher",
                lambda symbol: asyncio.sleep(
                    0,
                    result=_market_asset(f"{symbol.removesuffix('USDT')}/USDT"),
                ),
            ),
            candles_fetcher=kwargs.pop(
                "candles_fetcher",
                lambda _symbol, _interval, _limit: asyncio.sleep(0, result=[]),
            ),
            poll_seconds=kwargs.pop("poll_seconds", 60),
            **kwargs,
        )

    async def test_live_prices_become_stale_after_threshold(self) -> None:
        service = self.create_service(stale_after_seconds=30)
        unavailable = service.get_price("ETH/USDT")
        self.assertEqual(unavailable["status"], "unavailable")
        self.assertFalse(unavailable["is_live"])
        now = [1_000_000]
        service._now_ms = lambda: now[0]
        await service.ingest_message(
            json.dumps(
                {
                    "stream": "btcusdt@miniTicker",
                    "data": {
                        "s": "BTCUSDT",
                        "o": "90",
                        "c": "100",
                        "h": "101",
                        "l": "89",
                        "q": "5000",
                    },
                }
            )
        )
        live = service.get_price("BTC/USDT")
        self.assertEqual(live["price"], 100)
        self.assertTrue(live["is_live"])
        self.assertEqual(live["status"], "live")

        now[0] += 30_001
        stale = service.get_price("BTCUSDT")
        self.assertFalse(stale["is_live"])
        self.assertEqual(stale["status"], "stale")

    async def test_subscriber_fanout_ticker_and_kline_events(self) -> None:
        service = self.create_service()
        events: list[dict] = []
        unsubscribe = service.subscribe(events.append)
        await service.ingest_message(
            json.dumps(
                {
                    "s": "BTCUSDT",
                    "o": "99",
                    "c": "100",
                    "h": "101",
                    "l": "98",
                    "q": "500",
                }
            )
        )
        await service.ingest_message(
            json.dumps(
                {
                    "s": "BTCUSDT",
                    "k": {
                        "s": "BTCUSDT",
                        "i": "1m",
                        "t": 60_000,
                        "o": "99",
                        "h": "101",
                        "l": "98",
                        "c": "100",
                        "v": "7",
                        "x": False,
                    },
                }
            )
        )
        self.assertEqual([event["type"] for event in events], ["ticker", "kline", "ticker"])
        self.assertEqual(events[1]["candle"]["close"], 100)
        self.assertFalse(events[1]["closed"])
        unsubscribe()
        service.publish_signal({"strategyId": "strat-1", "signal": "BUY"})
        self.assertEqual(len(events), 3)

    async def test_rest_seed_closed_only_filters_open_latest_candle(self) -> None:
        service = self.create_service(
            candles_fetcher=lambda *_args: asyncio.sleep(
                0,
                result=[_candle(60_000, 1), _candle(180_000, 2)],
            )
        )
        service._now_ms = lambda: 200_000
        all_candles = await service.load_candles("BTC/USDT", "1m", 10)
        closed_candles = service.get_candles("BTC/USDT", "1m", 10, closed_only=True)
        self.assertEqual(len(all_candles), 2)
        self.assertEqual([candle["timestamp"] for candle in closed_candles], [60_000])

    async def test_socket_reconnects_after_disconnect(self) -> None:
        connector = _FakeConnector()
        service = self.create_service(
            connector=connector,
            reconnect_initial_seconds=0.01,
            reconnect_max_seconds=0.02,
        )
        with patch("app.market.service.database_connection", _fake_database_connection()):
            await service.start()
            try:
                for _ in range(100):
                    if connector.calls >= 2:
                        break
                    await asyncio.sleep(0.01)
                self.assertGreaterEqual(connector.calls, 2)
            finally:
                await service.stop()

    async def test_dynamic_series_subscription_adds_and_removes_stream(self) -> None:
        connector = _FakeConnector()
        service = self.create_service(connector=connector)
        with patch("app.market.service.database_connection", _fake_database_connection()):
            await service.start()
            try:
                for _ in range(100):
                    if service.socket_connected:
                        break
                    await asyncio.sleep(0.01)
                key = await service.add_kline_subscription("ETH/USDT", "5m")
                await asyncio.sleep(0)
                sent = [
                    json.loads(message)
                    for socket in connector.sockets
                    for message in socket.sent
                ]
                self.assertTrue(
                    any(
                        message["method"] == "SUBSCRIBE"
                        and "ethusdt@kline_5m" in message["params"]
                        for message in sent
                    )
                )
                await service.remove_kline_subscription(key)
                sent = [
                    json.loads(message)
                    for socket in connector.sockets
                    for message in socket.sent
                ]
                self.assertTrue(
                    any(
                        message["method"] == "UNSUBSCRIBE"
                        and "ethusdt@kline_5m" in message["params"]
                        for message in sent
                    )
                )
            finally:
                await service.stop()

    async def test_websocket_endpoint_validates_subscriptions_and_fans_out_events(self) -> None:
        service = self.create_service()
        fake_socket = _FakeApiWebSocket(
            {
                "subscribe": [
                    {"type": "ticker"},
                    {"type": "kline", "symbol": "BTC/USDT", "interval": "1m"},
                ]
            }
        )
        with patch.object(websocket_api, "market_data_service", service):
            endpoint = asyncio.create_task(
                websocket_api.stream_market_data(fake_socket)
            )
            await fake_socket.wait_for_sent(1)
            service._publish(
                {"type": "ticker", "symbol": "BTC/USDT", "price": 100}
            )
            await fake_socket.wait_for_sent(2)
            service._publish(
                {
                    "type": "kline",
                    "symbol": "BTC/USDT",
                    "interval": "1m",
                    "closed": False,
                }
            )
            await fake_socket.wait_for_sent(3)
            service.publish_signal({"strategyId": "test", "signal": "BUY"})
            await fake_socket.wait_for_sent(4)
            fake_socket.disconnect_requested.set()
            await asyncio.wait_for(endpoint, timeout=2)

        self.assertTrue(fake_socket.accepted)
        self.assertEqual(fake_socket.sent[0]["type"], "subscribed")
        self.assertEqual(
            [message["type"] for message in fake_socket.sent[1:]],
            ["ticker", "kline", "signal"],
        )
        self.assertEqual(service._requested_series, {})

    async def test_websocket_endpoint_rejects_invalid_candle_subscription(self) -> None:
        fake_socket = _FakeApiWebSocket(
            {
                "subscribe": [
                    {"type": "kline", "symbol": "BTC/USDT", "interval": "2m"}
                ]
            }
        )
        with patch.object(
            websocket_api,
            "market_data_service",
            self.create_service(),
        ):
            await websocket_api.stream_market_data(fake_socket)
        self.assertEqual(fake_socket.sent[0]["type"], "error")
        self.assertEqual(fake_socket.closed[0], 1008)

    async def test_ticker_subscription_also_emits_live_portfolio_updates(self) -> None:
        service = self.create_service()
        fake_socket = _FakeApiWebSocket(
            {"subscribe": [{"type": "ticker"}, {"type": "portfolio"}]}
        )
        portfolio = {
            "account": {
                "balance": 100,
                "equity": 100,
                "realizedPnl": 0,
                "totalPnl": 0,
            },
            "positions": [],
            "trades": [],
        }
        with (
            patch.object(websocket_api, "market_data_service", service),
            patch.object(websocket_api, "get_portfolio_snapshot", return_value=portfolio),
        ):
            endpoint = asyncio.create_task(
                websocket_api.stream_market_data(fake_socket)
            )
            await fake_socket.wait_for_sent(2)
            service._publish(
                {"type": "ticker", "symbol": "BTC/USDT", "price": 100}
            )
            await fake_socket.wait_for_sent(4)
            fake_socket.disconnect_requested.set()
            await asyncio.wait_for(endpoint, timeout=2)

        self.assertEqual(
            [event["type"] for event in fake_socket.sent],
            ["subscribed", "portfolio", "ticker", "portfolio"],
        )


class HistoricalCandleTests(unittest.IsolatedAsyncioTestCase):
    async def test_historical_candle_pagination_uses_1000_limit_and_excludes_end_time(self) -> None:
        requested: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            params = dict(request.url.params)
            requested.append(params)
            start = int(params["startTime"])
            timestamp = start
            if timestamp >= 180_000:
                rows = []
            else:
                rows = [
                    [
                        timestamp,
                        "1",
                        "2",
                        "0.5",
                        str(timestamp / 60_000 + 1),
                        "10",
                    ]
                ]
            return httpx.Response(200, json=rows)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            candles = await fetch_historical_candles(
                "BTC/USDT",
                "1m",
                3 / 1_440,
                client=client,
                now_ms=180_000,
            )

        self.assertEqual([candle["timestamp"] for candle in candles], [0, 60_000, 120_000])
        self.assertEqual(requested[0]["limit"], "1000")
        self.assertEqual(requested[1]["startTime"], "60000")
        self.assertEqual(requested[2]["startTime"], "120000")
        self.assertTrue(candles[0]["time"].endswith("Z"))

    async def test_historical_candle_request_enforces_maximum(self) -> None:
        with self.assertRaisesRegex(ValueError, "maximum supported backtest size is 20000"):
            await fetch_historical_candles("BTC/USDT", "1s", 1, now_ms=86_400_000)

    async def test_historical_candle_invalid_interval_and_pagination_failure(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported candle interval"):
            await fetch_historical_candles("BTC/USDT", "2m", 1)

        def repeated_page(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json=[[0, "1", "1", "1", "1", "1"]],
            )

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(repeated_page)
        ) as client:
            with self.assertRaisesRegex(ValueError, "pagination did not advance"):
                await fetch_historical_candles(
                    "BTC/USDT",
                    "1m",
                    2 / 1_440,
                    client=client,
                    now_ms=120_000,
                )


if __name__ == "__main__":
    unittest.main()
