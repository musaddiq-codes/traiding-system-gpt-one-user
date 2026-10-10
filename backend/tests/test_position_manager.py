import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.database import database
from app.trading.order_manager import close_paper_position, open_paper_position
from app.trading.position_manager import (
    enforce_strategy_exits,
    handle_market_update,
    mark_to_market,
)
from app.trading.portfolio import load_portfolio


class PositionManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_database_path = database.DATABASE_PATH
        database.DATABASE_PATH = Path(self.temp_dir.name) / "trading.sqlite3"
        self.fee_environment = patch.dict(os.environ, {}, clear=False)
        self.fee_environment.start()
        os.environ.pop("PAPER_FEE_BPS", None)
        database.initialize_database()

    def tearDown(self):
        self.fee_environment.stop()
        database.DATABASE_PATH = self.original_database_path
        self.temp_dir.cleanup()

    def _portfolio(self, refresh_market_data=False):
        with database.database_connection() as connection:
            return load_portfolio(
                connection,
                refresh_market_data=refresh_market_data,
            )

    def _attach_strategy(self, position, *, stop_loss=5, take_profit=3):
        strategy = {
            "id": "strategy-test",
            "stopLoss": stop_loss,
            "takeProfit": take_profit,
        }
        with database.database_connection() as connection:
            connection.execute(
                "INSERT INTO strategies (id, payload) VALUES (?, ?)",
                (strategy["id"], json.dumps(strategy)),
            )
            connection.execute(
                "UPDATE positions SET strategy_id = ? WHERE id = ?",
                (strategy["id"], position["id"]),
            )
        position["strategyId"] = strategy["id"]
        return position

    def _open_strategy_position(self, side="LONG", **thresholds):
        position, _ = open_paper_position("BTC/USDT", side, 1, None, 100)
        return self._attach_strategy(position, **thresholds)

    def test_long_and_short_mark_to_market_and_equity(self):
        open_paper_position("BTC/USDT", "LONG", 2, None, 100)
        open_paper_position("ETH/USDT", "SHORT", 2, None, 100)

        self.assertEqual(
            mark_to_market(
                {
                    "BTC/USDT": 110,
                    "ETH/USDT": 90,
                }
            ),
            2,
        )
        snapshot = self._portfolio()
        positions = {position["symbol"]: position for position in snapshot["positions"]}
        self.assertEqual(positions["BTC/USDT"]["unrealizedPnl"], 20)
        self.assertEqual(positions["BTC/USDT"]["unrealizedPnlPercent"], 10)
        self.assertEqual(positions["ETH/USDT"]["unrealizedPnl"], 20)
        self.assertEqual(positions["ETH/USDT"]["unrealizedPnlPercent"], 10)
        self.assertEqual(snapshot["account"]["equity"], 100040)

    def test_portfolio_refreshes_from_live_service_prices(self):
        open_paper_position("BTC/USDT", "LONG", 1, None, 100)
        with patch(
            "app.market.service.market_data_service.get_price",
            return_value={"is_live": True, "price": 115},
        ):
            snapshot = self._portfolio(refresh_market_data=True)
        self.assertEqual(snapshot["positions"][0]["currentPrice"], 115)
        self.assertEqual(snapshot["account"]["equity"], 100015)

    def test_entry_and_exit_fees_default_to_zero(self):
        position, entry_trade = open_paper_position(
            "BTC/USDT", "LONG", 1, None, 100
        )
        result = close_paper_position(position["id"], 110)
        self.assertEqual(entry_trade["fee"], 0)
        self.assertEqual(entry_trade["realizedPnl"], 0)
        self.assertEqual(result["trade"]["fee"], 0)
        self.assertEqual(result["trade"]["realizedPnl"], 10)
        self.assertEqual(result["state"]["account"]["balance"], 100010)

    def test_entry_and_exit_fees_are_applied_when_configured(self):
        with patch.dict(os.environ, {"PAPER_FEE_BPS": "25"}):
            position, entry_trade = open_paper_position(
                "BTC/USDT", "LONG", 1, None, 100
            )
            result = close_paper_position(position["id"], 110)
        self.assertEqual(entry_trade["fee"], 0.25)
        self.assertEqual(entry_trade["realizedPnl"], -0.25)
        self.assertEqual(result["trade"]["fee"], 0.275)
        self.assertEqual(result["trade"]["realizedPnl"], 9.72)
        self.assertEqual(result["state"]["account"]["balance"], 100009.48)

    def test_live_market_update_closes_at_take_profit_and_records_reason(self):
        position = self._open_strategy_position()

        handle_market_update(
            {
                "type": "ticker",
                "symbol": "BTC/USDT",
                "price": 104,
                "is_live": True,
            }
        )

        with database.database_connection() as connection:
            status = connection.execute(
                "SELECT status FROM positions WHERE id = ?", (position["id"],)
            ).fetchone()["status"]
            trade = connection.execute(
                "SELECT note, price FROM trades WHERE position_id = ? "
                "ORDER BY rowid DESC LIMIT 1",
                (position["id"],),
            ).fetchone()
        self.assertEqual(status, "CLOSED")
        self.assertEqual(trade["note"], "TP")
        self.assertEqual(trade["price"], 104)

    def test_stop_loss_closes_short_positions(self):
        position = self._open_strategy_position(side="SHORT")

        closed = enforce_strategy_exits("BTCUSDT", 106)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0]["trade"]["note"], "SL")
        self.assertEqual(closed[0]["trade"]["realizedPnl"], -6)

    def test_stop_loss_wins_when_both_thresholds_trigger(self):
        position = self._open_strategy_position(stop_loss=2, take_profit=-1)

        closed = enforce_strategy_exits("BTC/USDT", 97)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0]["trade"]["note"], "SL")
        self.assertEqual(closed[0]["trade"]["realizedPnl"], -3)
        self.assertEqual(closed[0]["state"]["positions"], [])

    def test_stale_market_updates_do_not_mark_or_close_positions(self):
        position = self._open_strategy_position()

        handle_market_update(
            {
                "type": "ticker",
                "symbol": "BTC/USDT",
                "price": 90,
                "is_live": False,
            }
        )

        with database.database_connection() as connection:
            row = connection.execute(
                "SELECT status, current_price, unrealized_pnl FROM positions "
                "WHERE id = ?",
                (position["id"],),
            ).fetchone()
        self.assertEqual(tuple(row), ("OPEN", 100, 0))


class TradeNoteMigrationTests(unittest.TestCase):
    def test_initialize_adds_trade_note_to_existing_table(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            original_path = database.DATABASE_PATH
            database.DATABASE_PATH = Path(temp_dir) / "legacy.sqlite3"
            try:
                connection = sqlite3.connect(database.DATABASE_PATH)
                connection.execute(
                    """
                    CREATE TABLE trades (
                        id TEXT PRIMARY KEY,
                        strategy_id TEXT,
                        position_id TEXT,
                        symbol TEXT NOT NULL,
                        side TEXT NOT NULL,
                        quantity REAL NOT NULL,
                        price REAL NOT NULL,
                        value REAL NOT NULL,
                        fee REAL NOT NULL,
                        realized_pnl REAL NOT NULL,
                        status TEXT NOT NULL,
                        executed_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO trades VALUES "
                    "('trade-existing', NULL, NULL, 'BTC/USDT', 'BUY', 1, "
                    "100, 100, 0, 0, 'FILLED', '2025-01-01T00:00:00Z')"
                )
                connection.execute("PRAGMA user_version = 1")
                connection.commit()
                connection.close()

                database.initialize_database()

                with database.database_connection() as migrated:
                    columns = {
                        row["name"]
                        for row in migrated.execute(
                            "PRAGMA table_info(trades)"
                        ).fetchall()
                    }
                    existing_trade = migrated.execute(
                        "SELECT id FROM trades WHERE id = 'trade-existing'"
                    ).fetchone()
                self.assertIn("note", columns)
                self.assertIsNotNone(existing_trade)
            finally:
                database.DATABASE_PATH = original_path


if __name__ == "__main__":
    unittest.main()
