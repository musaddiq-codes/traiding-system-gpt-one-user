import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.database import database
from app.strategies.base import Decision
from app.trading.engine import get_strategy_signature
from app.trading.order_manager import open_paper_position
from app.trading.runner import StrategyRunner


def _strategy(
    strategy_id: str,
    *,
    risk_per_trade: float = 1,
) -> dict:
    return {
        "id": strategy_id,
        "name": strategy_id,
        "description": "runner test",
        "type": "Trend Following",
        "symbol": "BTC/USDT",
        "timeframe": "1m",
        "status": "ACTIVE",
        "algorithmId": "test-plugin",
        "params": {},
        "stopLoss": 5,
        "takeProfit": 10,
        "positionSize": 1000,
        "riskPerTrade": risk_per_trade,
        "maxPositions": 1,
        "paperApprovedBacktestId": f"run-{strategy_id}",
    }


class FakeProvider:
    def __init__(self) -> None:
        self.price = {
            "symbol": "BTC/USDT",
            "price": 100.0,
            "change24h": 2.5,
            "volume24h": 1000,
            "high24h": 105,
            "low24h": 95,
            "is_live": True,
        }
        self.candle_ts = 1_800_000_000_000
        self.events: list[dict] = []
        self.load_count = 0

    def get_price(self, _symbol: str) -> dict:
        return dict(self.price)

    async def load_candles(
        self,
        _symbol: str,
        _interval: str,
        _limit: int,
        closed_only: bool = False,
    ) -> list[dict]:
        self.load_count += 1
        return [
            {
                "timestamp": self.candle_ts,
                "open": 99,
                "high": 101,
                "low": 98,
                "close": 100,
                "volume": 10,
            }
        ]

    def publish_signal(self, event: dict) -> None:
        self.events.append(event)


class QueuePlugin:
    def __init__(self, decisions: list[Decision] | None = None, failing_ids=None):
        self.id = "test-plugin"
        self.name = "Test plugin"
        self.version = "1"
        self.description = "Test fixture plugin"
        self.long_only = False
        self.params = ()
        self.decisions = decisions or [Decision("BUY", "test buy", 80)]
        self.failing_ids = set(failing_ids or [])
        self.calls = 0

    def evaluate(self, ctx):
        self.calls += 1
        if ctx.strategy["id"] in self.failing_ids:
            raise RuntimeError("plugin failed")
        if len(self.decisions) == 1:
            return self.decisions[0]
        return self.decisions.pop(0)


class StrategyRunnerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_database_path = database.DATABASE_PATH
        self.original_legacy_path = database.LEGACY_STRATEGIES_PATH
        database.DATABASE_PATH = Path(self.temporary_directory.name) / "test.sqlite3"
        database.LEGACY_STRATEGIES_PATH = (
            Path(self.temporary_directory.name) / "missing-strategies.json"
        )
        database.initialize_database()

    def tearDown(self) -> None:
        database.DATABASE_PATH = self.original_database_path
        database.LEGACY_STRATEGIES_PATH = self.original_legacy_path
        self.temporary_directory.cleanup()

    def _save_approved_strategy(self, strategy: dict) -> None:
        signature = get_strategy_signature(strategy)
        with database.database_connection() as connection:
            connection.execute(
                """
                INSERT INTO backtest_runs (
                    id, strategy_id, strategy_signature, payload
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    strategy["paperApprovedBacktestId"],
                    strategy["id"],
                    signature,
                    json.dumps({"result": {"eligibleForPaperReview": True}}),
                ),
            )
            connection.execute(
                "INSERT INTO strategies (id, payload) VALUES (?, ?)",
                (strategy["id"], json.dumps(strategy)),
            )

    def _runner(self, provider, plugin, *, enabled=True) -> StrategyRunner:
        return StrategyRunner(
            provider,
            enabled=enabled,
            tick_seconds=60,
            clock_ms=lambda: 1_800_000_000_000,
        )

    async def _tick(self, runner, plugin, *, dry_run=False):
        with patch.dict(
            "app.strategies.registry._PLUGIN_BY_ID",
            {"test-plugin": plugin},
        ):
            return await runner.tick(dry_run=dry_run)

    async def test_buy_opens_once_and_same_candle_is_not_retraded_after_restart(self):
        strategy = _strategy("buy-test")
        self._save_approved_strategy(strategy)
        provider = FakeProvider()
        plugin = QueuePlugin()
        runner = self._runner(provider, plugin)

        first = await self._tick(runner, plugin)
        second = await self._tick(runner, plugin)
        restarted = self._runner(provider, plugin)
        after_restart = await self._tick(restarted, plugin)

        self.assertEqual(len(first["signals"]), 1)
        self.assertEqual(first["signals"][0]["actionTaken"], "opened_long")
        self.assertEqual(second["signals"], [])
        self.assertEqual(after_restart["signals"], [])
        self.assertEqual(plugin.calls, 1)
        with database.database_connection() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM positions WHERE strategy_id = ? AND status = 'OPEN'",
                (strategy["id"],),
            ).fetchone()[0]
            signal_count = connection.execute(
                "SELECT COUNT(*) FROM strategy_signals WHERE strategy_id = ?",
                (strategy["id"],),
            ).fetchone()[0]
        self.assertEqual(count, 1)
        self.assertEqual(signal_count, 1)

    async def test_sell_closes_open_strategy_position(self):
        strategy = _strategy("sell-test")
        self._save_approved_strategy(strategy)
        position, _ = open_paper_position(
            "BTC/USDT",
            "LONG",
            1,
            strategy["id"],
            100,
        )
        provider = FakeProvider()
        plugin = QueuePlugin([Decision("SELL", "exit", 70)])

        result = await self._tick(self._runner(provider, plugin), plugin)

        self.assertEqual(result["signals"][0]["actionTaken"], "closed_position")
        with database.database_connection() as connection:
            status = connection.execute(
                "SELECT status FROM positions WHERE id = ?",
                (position["id"],),
            ).fetchone()["status"]
        self.assertEqual(status, "CLOSED")

    async def test_risk_rejection_is_recorded(self):
        strategy = _strategy("risk-test", risk_per_trade=0)
        self._save_approved_strategy(strategy)
        provider = FakeProvider()
        plugin = QueuePlugin()

        result = await self._tick(self._runner(provider, plugin), plugin)

        self.assertTrue(
            result["signals"][0]["actionTaken"].startswith("rejected:")
        )
        with database.database_connection() as connection:
            signal = connection.execute(
                "SELECT action_taken FROM strategy_signals WHERE strategy_id = ?",
                (strategy["id"],),
            ).fetchone()
        self.assertTrue(signal["action_taken"].startswith("rejected:"))

    async def test_stale_or_mock_data_skips_signal_and_records_error(self):
        strategy = _strategy("stale-test")
        self._save_approved_strategy(strategy)
        provider = FakeProvider()
        provider.price["is_live"] = False
        plugin = QueuePlugin()

        result = await self._tick(self._runner(provider, plugin), plugin)

        self.assertEqual(result["signals"], [])
        self.assertEqual(plugin.calls, 0)
        with database.database_connection() as connection:
            runtime = connection.execute(
                "SELECT last_error FROM strategy_runtime WHERE strategy_id = ?",
                (strategy["id"],),
            ).fetchone()
            count = connection.execute(
                "SELECT COUNT(*) FROM strategy_signals WHERE strategy_id = ?",
                (strategy["id"],),
            ).fetchone()[0]
        self.assertIn("stale or unavailable", runtime["last_error"])
        self.assertEqual(count, 0)

    async def test_plugin_exception_isolated_from_other_strategies(self):
        failing = _strategy("bad-plugin")
        succeeding = _strategy("good-plugin")
        self._save_approved_strategy(failing)
        self._save_approved_strategy(succeeding)
        provider = FakeProvider()
        plugin = QueuePlugin(failing_ids={"bad-plugin"})

        result = await self._tick(self._runner(provider, plugin), plugin)

        self.assertEqual(len(result["signals"]), 1)
        self.assertEqual(result["signals"][0]["strategyId"], "good-plugin")
        with database.database_connection() as connection:
            error = connection.execute(
                "SELECT last_error FROM strategy_runtime WHERE strategy_id = ?",
                ("bad-plugin",),
            ).fetchone()["last_error"]
        self.assertIn("plugin failed", error)

    async def test_dry_run_records_signal_without_opening_position(self):
        strategy = _strategy("dry-test")
        self._save_approved_strategy(strategy)
        provider = FakeProvider()
        plugin = QueuePlugin()

        result = await self._tick(
            self._runner(provider, plugin),
            plugin,
            dry_run=True,
        )

        self.assertEqual(result["signals"][0]["actionTaken"], "dry_run: buy")
        with database.database_connection() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM positions WHERE strategy_id = ?",
                (strategy["id"],),
            ).fetchone()[0]
        self.assertEqual(count, 0)
        self.assertEqual(provider.events[0]["signal"], "BUY")

    async def test_disabled_runner_is_inert(self):
        strategy = _strategy("disabled-test")
        self._save_approved_strategy(strategy)
        provider = FakeProvider()
        plugin = QueuePlugin()
        runner = self._runner(provider, plugin, enabled=False)

        result = await runner.tick()
        status = await runner.start()

        self.assertEqual(result, {"enabled": False, "dryRun": False, "signals": []})
        self.assertFalse(status["running"])
        self.assertEqual(plugin.calls, 0)
        self.assertEqual(provider.load_count, 0)

    async def test_non_long_only_sell_while_flat_opens_short(self):
        strategy = _strategy("short-test")
        self._save_approved_strategy(strategy)
        provider = FakeProvider()
        plugin = QueuePlugin([Decision("SELL", "short", 60)])

        result = await self._tick(self._runner(provider, plugin), plugin)

        self.assertEqual(result["signals"][0]["actionTaken"], "opened_short")
        with database.database_connection() as connection:
            side = connection.execute(
                "SELECT side FROM positions WHERE strategy_id = ?",
                (strategy["id"],),
            ).fetchone()["side"]
        self.assertEqual(side, "SHORT")


if __name__ == "__main__":
    unittest.main()
