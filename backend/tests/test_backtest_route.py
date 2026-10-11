import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app.api.routes.backtests import _read_run, run_backtest_route
from app.api.routes.schemas import BacktestRunPayload
from app.database import database


def _strategy() -> dict:
    return {
        "id": "route-backtest",
        "name": "Route backtest",
        "description": "test",
        "type": "Trend Following",
        "symbol": "BTC/USDT",
        "timeframe": "1m",
        "status": "DRAFT",
        "entryCondition": "RSI < 30",
        "exitCondition": "RSI > 70",
        "stopLoss": 5,
        "takeProfit": 5,
        "positionSize": 1000,
        "riskPerTrade": 1,
        "maxPositions": 1,
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-01T00:00:00Z",
    }


def _candles() -> list[dict]:
    return [
        {
            "time": f"2026-01-01T00:0{index}:00Z",
            "timestamp": 1_767_225_600_000 + index * 60_000,
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 10,
        }
        for index in range(4)
    ]


class BacktestRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_database_path = database.DATABASE_PATH
        self.original_legacy_path = database.LEGACY_STRATEGIES_PATH
        root = Path(self.temporary_directory.name)
        database.DATABASE_PATH = root / "test.sqlite3"
        database.LEGACY_STRATEGIES_PATH = root / "missing-strategies.json"
        database.initialize_database()
        with database.database_connection() as connection:
            strategy = _strategy()
            connection.execute(
                "INSERT INTO strategies (id, payload) VALUES (?, ?)",
                (strategy["id"], json.dumps(strategy)),
            )

    def tearDown(self) -> None:
        database.DATABASE_PATH = self.original_database_path
        database.LEGACY_STRATEGIES_PATH = self.original_legacy_path
        self.temporary_directory.cleanup()

    def test_run_uses_saved_strategy_defaults_and_persists_result(self) -> None:
        async def fake_fetch(*_args, **_kwargs):
            return _candles()

        with patch(
            "app.api.routes.backtests.fetch_historical_candles",
            side_effect=fake_fetch,
        ):
            result = asyncio.run(
                run_backtest_route(
                    BacktestRunPayload(strategyId="route-backtest")
                )
            )

        self.assertEqual(result["strategyId"], "route-backtest")
        self.assertEqual(result["initialBalance"], 100_000)
        self.assertEqual(result["feeBps"], 10)
        self.assertEqual(result["slippageBps"], 5)
        self.assertIsNotNone(_read_run(result["runId"]))

    def test_bad_lookback_uses_existing_message_and_4xx(self) -> None:
        with self.assertRaises(HTTPException) as error:
            asyncio.run(
                run_backtest_route(
                    BacktestRunPayload(
                        strategyId="route-backtest",
                        days=181,
                    )
                )
            )

        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(
            error.exception.detail,
            "Lookback days must be an integer between 1 and 180.",
        )

    def test_market_data_failure_returns_502(self) -> None:
        async def failed_fetch(*_args, **_kwargs):
            raise httpx.ConnectError("offline")

        with patch(
            "app.api.routes.backtests.fetch_historical_candles",
            side_effect=failed_fetch,
        ):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(
                    run_backtest_route(
                        BacktestRunPayload(strategyId="route-backtest")
                    )
                )

        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(
            error.exception.detail,
            "Live market or candle data is currently unavailable.",
        )

    def test_unknown_strategy_cannot_be_run(self) -> None:
        with self.assertRaises(HTTPException) as error:
            asyncio.run(
                run_backtest_route(
                    BacktestRunPayload(strategyId="not-saved")
                )
            )

        self.assertEqual(error.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
