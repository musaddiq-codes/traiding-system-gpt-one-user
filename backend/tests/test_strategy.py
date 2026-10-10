import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app.database import database
from app.main import app
from app.trading.portfolio import load_portfolio


def strategy_payload() -> dict:
    return {
        "id": "test-strategy",
        "name": "Test strategy",
        "description": "Test fixture",
        "type": "Trend Following",
        "symbol": "BTC/USDT",
        "timeframe": "15m",
        "status": "DRAFT",
        "entryCondition": "RSI < 30",
        "exitCondition": "RSI > 70",
        "stopLoss": 1.5,
        "takeProfit": 3,
        "positionSize": 1000,
        "riskPerTrade": 1,
        "maxPositions": 1,
        "createdAt": "2026-10-08T00:00:00Z",
        "updatedAt": "2026-10-08T00:00:00Z",
    }


def backtest_result(
    run_id: str = "backtest-test",
    *,
    net_profit: float = 100,
    total_trades: int = 5,
) -> dict:
    return {
        "runId": run_id,
        "strategyId": "test-strategy",
        "netProfit": net_profit,
        "totalTrades": total_trades,
        "maxDrawdown": 10,
        "trades": [
            {
                "direction": "LONG",
                "entryPrice": 100,
                "exitPrice": 102,
                "pnl": 20,
                "entryFee": 1,
                "exitFee": 1,
                "exitReason": "SIGNAL",
                "entryTimestamp": f"2026-10-08T00:0{index}:00Z",
                "timestamp": f"2026-10-08T00:1{index}:00Z",
            }
            for index in range(total_trades)
        ],
        "eligibleForPaperReview": True,
        "reviewEligibilityReason": "Client-supplied reason.",
    }


class BackendApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        database.DATABASE_PATH = root / "test.sqlite3"
        database.LEGACY_STRATEGIES_PATH = root / "missing-strategies.json"
        database.initialize_database()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async def send_request() -> httpx.Response:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                return await client.request(method, path, **kwargs)

        return asyncio.run(send_request())

    def test_plugin_manifests_and_algorithm_validation(self) -> None:
        plugins = self.request("GET", "/api/plugins")
        self.assertEqual(plugins.status_code, 200)
        manifest = {plugin["id"]: plugin for plugin in plugins.json()}
        self.assertEqual(
            list(manifest),
            ["text-rules", "dca-score"],
        )
        self.assertTrue(manifest["dca-score"]["longOnly"])
        self.assertEqual(manifest["dca-score"]["params"], [])

        dca_strategy = strategy_payload()
        dca_strategy.pop("entryCondition")
        dca_strategy.pop("exitCondition")
        dca_strategy["algorithmId"] = "dca-score"
        created = self.request(
            "POST",
            "/api/strategies",
            json=dca_strategy,
        )
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["strategy"]["params"], {})

        unknown_strategy = {
            **strategy_payload(),
            "algorithmId": "not-registered",
        }
        unknown = self.request(
            "POST",
            "/api/strategies",
            json=unknown_strategy,
        )
        self.assertEqual(unknown.status_code, 422)

    def test_backtest_snapshot_records_non_default_plugin_configuration(self) -> None:
        dca_strategy = strategy_payload()
        dca_strategy.pop("entryCondition")
        dca_strategy.pop("exitCondition")
        dca_strategy["algorithmId"] = "dca-score"
        dca_strategy["params"] = {}
        response = self.request(
            "POST",
            "/api/backtests/runs",
            json={
                "strategy": dca_strategy,
                "result": backtest_result(),
            },
        )
        self.assertEqual(response.status_code, 200)
        snapshot = response.json()["strategySnapshot"]
        self.assertEqual(snapshot["algorithmId"], "dca-score")
        self.assertEqual(snapshot["params"], {})

    def test_health_and_portfolio_state(self) -> None:
        self.assertEqual(self.request("GET", "/health").json(), {"status": "ok"})
        state = self.request("GET", "/api/state")
        self.assertEqual(state.status_code, 200)
        self.assertEqual(state.json()["account"]["balance"], 100000)
        self.assertEqual(state.json()["positions"], [])
        self.assertEqual(state.json()["trades"], [])
        with database.database_connection() as connection:
            self.assertEqual(
                connection.execute("PRAGMA user_version").fetchone()[0],
                1,
            )

    def test_strategy_requires_review_before_activation(self) -> None:
        strategy = strategy_payload()
        created = self.request("POST", "/api/strategies", json=strategy)
        self.assertEqual(created.status_code, 200)

        activated = {**strategy, "status": "ACTIVE"}
        response = self.request(
            "PUT",
            f"/api/strategies/{strategy['id']}",
            json=activated,
        )
        self.assertEqual(response.status_code, 409)

        result = backtest_result()
        saved_run = self.request(
            "POST",
            "/api/backtests/runs",
            json={"strategy": strategy, "result": result},
        )
        self.assertEqual(saved_run.status_code, 200)
        stored_run = self.request("GET", "/api/backtests/runs/backtest-test")
        self.assertTrue(stored_run.json()["result"]["eligibleForPaperReview"])

        reviewed = self.request(
            "POST",
            "/api/backtests/review",
            json={
                "runId": "backtest-test",
                "confirmPaperApproval": True,
                "notes": "Reviewed",
            },
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        self.assertEqual(reviewed.json()["strategy"]["status"], "ACTIVE")

    def test_client_cannot_fake_backtest_eligibility(self) -> None:
        strategy = strategy_payload()
        self.assertEqual(
            self.request("POST", "/api/strategies", json=strategy).status_code,
            200,
        )
        saved = self.request(
            "POST",
            "/api/backtests/runs",
            json={
                "strategy": strategy,
                "result": backtest_result(net_profit=0),
            },
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        stored_run = self.request("GET", "/api/backtests/runs/backtest-test")
        self.assertFalse(stored_run.json()["result"]["eligibleForPaperReview"])

        reviewed = self.request(
            "POST",
            "/api/backtests/review",
            json={
                "runId": "backtest-test",
                "confirmPaperApproval": True,
                "notes": "Reviewed",
            },
        )
        self.assertEqual(reviewed.status_code, 422)

    def test_backtest_trade_count_must_match_trades(self) -> None:
        strategy = strategy_payload()
        result = backtest_result()
        result["totalTrades"] = 4
        response = self.request(
            "POST",
            "/api/backtests/runs",
            json={
                "strategy": strategy,
                "result": result,
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_public_mark_reviewed_patch_route_is_removed(self) -> None:
        response = self.request(
            "PATCH",
            "/api/backtests/runs/backtest-test/review",
            params={"notes": "Reviewed"},
        )
        self.assertIn(response.status_code, (404, 405))

    def test_paper_order_open_close_and_persist_state(self) -> None:
        market_responses = [
            [
                {
                    "symbol": "BTC/USDT",
                    "name": "Bitcoin",
                    "price": 60000,
                }
            ],
            [
                {
                    "symbol": "BTC/USDT",
                    "name": "Bitcoin",
                    "price": 61000,
                }
            ],
        ]
        with patch(
            "app.api.routes.positions.fetch_market_snapshot",
            new=AsyncMock(side_effect=market_responses),
        ):
            opened = self.request(
                "POST",
                "/api/orders",
                json={
                    "symbol": "BTC/USDT",
                    "side": "LONG",
                    "quantity": 0.01,
                },
            )
            self.assertEqual(opened.status_code, 200, opened.text)
            self.assertEqual(opened.json()["mode"], "paper")
            position_id = opened.json()["position"]["id"]
            self.assertEqual(len(opened.json()["state"]["positions"]), 1)
            opened_position = opened.json()["position"]
            self.assertEqual(
                set(opened_position),
                {
                    "id",
                    "symbol",
                    "name",
                    "side",
                    "quantity",
                    "entryPrice",
                    "currentPrice",
                    "leverage",
                    "margin",
                    "unrealizedPnl",
                    "unrealizedPnlPercent",
                    "status",
                    "openedAt",
                },
            )
            self.assertEqual(
                opened.json()["state"]["account"]["usedMargin"],
                opened_position["margin"],
            )
            self.assertEqual(
                opened.json()["state"]["account"]["availableBalance"],
                opened.json()["state"]["account"]["balance"]
                - opened_position["margin"],
            )

            closed = self.request("DELETE", f"/api/positions/{position_id}")
            self.assertEqual(closed.status_code, 200, closed.text)
            self.assertEqual(closed.json()["state"]["positions"], [])
            self.assertEqual(closed.json()["trade"]["realizedPnl"], 10)
            self.assertNotIn(
                position_id,
                [item["id"] for item in closed.json()["state"]["positions"]],
            )
            with database.database_connection() as connection:
                position_row = connection.execute(
                    "SELECT status, closed_at FROM positions WHERE id = ?",
                    (position_id,),
                ).fetchone()
                trade_row = connection.execute(
                    "SELECT position_id FROM trades WHERE id = ?",
                    (closed.json()["trade"]["id"],),
                ).fetchone()
            self.assertEqual(position_row["status"], "CLOSED")
            self.assertIsNotNone(position_row["closed_at"])
            self.assertEqual(trade_row["position_id"], position_id)
            self.assertEqual(
                self.request("GET", "/api/state").json()["account"]["balance"],
                100010,
            )

    def test_closing_same_position_twice_returns_not_found(self) -> None:
        with self._fake_market():
            opened = self.request(
                "POST",
                "/api/orders",
                json={"symbol": "BTC/USDT", "side": "LONG", "quantity": 1},
            )
            self.assertEqual(opened.status_code, 200, opened.text)
            position_id = opened.json()["position"]["id"]
            first_close = self.request("DELETE", f"/api/positions/{position_id}")
            self.assertEqual(first_close.status_code, 200, first_close.text)
            second_close = self.request("DELETE", f"/api/positions/{position_id}")
        self.assertEqual(second_close.status_code, 404)

    def test_open_position_response_includes_strategy_id_when_set(self) -> None:
        self._create_approved_strategy()
        response = self._order(1, "test-strategy")
        self.assertEqual(response.status_code, 200, response.text)
        expected_keys = {
            "id",
            "symbol",
            "name",
            "side",
            "quantity",
            "entryPrice",
            "currentPrice",
            "leverage",
            "margin",
            "unrealizedPnl",
            "unrealizedPnlPercent",
            "status",
            "openedAt",
            "strategyId",
        }
        self.assertEqual(set(response.json()["position"]), expected_keys)

    def test_legacy_portfolio_migrates_once(self) -> None:
        legacy_path = Path(self.temporary_directory.name) / "legacy.sqlite3"
        database.DATABASE_PATH = legacy_path
        legacy_positions = [
            {
                "id": "legacy-position-1",
                "strategyId": "deleted-strategy",
                "symbol": "BTC/USDT",
                "name": "Bitcoin",
                "side": "LONG",
                "quantity": 1,
                "entryPrice": 100,
                "currentPrice": 110,
                "leverage": 2,
                "margin": 50,
                "unrealizedPnl": 10,
                "unrealizedPnlPercent": 20,
                "status": "OPEN",
                "openedAt": "2026-10-07T00:00:00Z",
            },
            {
                "id": "legacy-position-2",
                "symbol": "ETH/USDT",
                "name": "Ethereum",
                "side": "SHORT",
                "quantity": 2,
                "entryPrice": 50,
                "currentPrice": 45,
                "leverage": 1,
                "margin": 25,
                "unrealizedPnl": 10,
                "unrealizedPnlPercent": 40,
                "openedAt": "2026-10-06T00:00:00Z",
            },
        ]
        legacy_trades = [
            {
                "id": f"legacy-trade-{index}",
                "strategyId": "deleted-strategy" if index == 1 else None,
                "symbol": "BTC/USDT",
                "side": "BUY",
                "quantity": 1,
                "price": 100 + index,
                "value": 100 + index,
                "fee": 1,
                "realizedPnl": index,
                "status": "FILLED",
                "executedAt": f"2026-10-0{index}T00:00:00Z",
            }
            for index in range(1, 4)
        ]
        legacy_payload = {
            "account": {"balance": 5000, "realizedPnl": 125},
            "positions": legacy_positions,
            "trades": legacy_trades,
        }
        connection = sqlite3.connect(legacy_path)
        connection.execute(
            "CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO app_state (id, payload) VALUES (1, ?)",
            (json.dumps(legacy_payload),),
        )
        connection.commit()
        connection.close()

        database.initialize_database()
        with database.database_connection() as connection:
            state = load_portfolio(connection)
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM positions").fetchone()[0],
                2,
            )
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM trades").fetchone()[0],
                3,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT strategy_id FROM positions WHERE id = ?",
                    ("legacy-position-1",),
                ).fetchone()[0],
                "deleted-strategy",
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT strategy_id FROM positions WHERE id = ?",
                    ("legacy-position-2",),
                ).fetchone()[0]
            )
            self.assertEqual(
                connection.execute(
                    "SELECT position_id FROM trades WHERE id = ?",
                    ("legacy-trade-1",),
                ).fetchone()[0],
                None,
            )
            self.assertEqual(state["account"]["usedMargin"], 75)
            self.assertEqual(
                connection.execute("PRAGMA user_version").fetchone()[0],
                1,
            )
            self.assertIsNotNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master "
                    "WHERE type = 'table' AND name = 'app_state_legacy'"
                ).fetchone()
            )

        database.initialize_database()
        with database.database_connection() as connection:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM positions").fetchone()[0],
                2,
            )
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM trades").fetchone()[0],
                3,
            )
            self.assertEqual(
                connection.execute("SELECT balance FROM account WHERE id = 1").fetchone()[0],
                5000,
            )

    def test_invalid_order_is_rejected(self) -> None:
        response = self.request(
            "POST",
            "/api/orders",
            json={
                "symbol": "BTC/USDT",
                "side": "LONG",
                "quantity": 0,
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_market_fallback_is_explicitly_non_live(self) -> None:
        with patch(
            "app.api.routes.market.fetch_market_snapshot",
            new=AsyncMock(side_effect=httpx.ConnectError("offline")),
        ):
            response = self.request("GET", "/api/market")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["source"],
            "mock-market-data-fallback",
        )
        self.assertFalse(response.json()["is_live"])

    def test_order_for_non_favorite_never_uses_demo_fallback_price(self) -> None:
        with (
            patch(
                "app.api.routes.positions.fetch_market_snapshot",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "app.api.routes.positions.fetch_market_ticker",
                new=AsyncMock(side_effect=httpx.ConnectError("offline")),
            ),
        ):
            response = self.request(
                "POST",
                "/api/orders",
                json={
                    "symbol": "DOGE/USDT",
                    "side": "LONG",
                    "quantity": 1,
                },
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("live market price is required", response.json()["detail"])

    def _fake_market(self):
        return patch(
            "app.api.routes.positions.fetch_market_snapshot",
            new=AsyncMock(
                return_value=[
                    {
                        "symbol": "BTC/USDT",
                        "name": "Bitcoin",
                        "price": 100.0,
                        "change24h": 0,
                        "volume24h": 0,
                        "high24h": 0,
                        "low24h": 0,
                    }
                ]
            ),
        )

    def _create_approved_strategy(self) -> None:
        strategy = strategy_payload()
        self.request("POST", "/api/strategies", json=strategy)
        self.request(
            "POST",
            "/api/backtests/runs",
            json={"strategy": strategy, "result": backtest_result()},
        )
        reviewed = self.request(
            "POST",
            "/api/backtests/review",
            json={
                "runId": "backtest-test",
                "confirmPaperApproval": True,
                "notes": "ok",
            },
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.text)

    def _order(self, quantity: float, strategy_id: str | None = None):
        body = {"symbol": "BTC/USDT", "side": "LONG", "quantity": quantity}
        if strategy_id is not None:
            body["strategyId"] = strategy_id
        with self._fake_market():
            return self.request("POST", "/api/orders", json=body)

    def test_manual_order_still_works(self) -> None:
        self.assertEqual(self._order(1).status_code, 200)

    def test_order_for_unknown_strategy_is_rejected(self) -> None:
        self.assertEqual(self._order(1, "nope").status_code, 404)

    def test_order_for_unapproved_strategy_is_rejected(self) -> None:
        self.request("POST", "/api/strategies", json=strategy_payload())
        self.assertEqual(self._order(1, "test-strategy").status_code, 409)

    def test_order_for_approved_strategy_within_limits_is_accepted(self) -> None:
        self._create_approved_strategy()
        response = self._order(10, "test-strategy")  # 10 * 100 = 1000 = positionSize
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["position"]["strategyId"], "test-strategy")

    def test_order_larger_than_position_size_is_rejected(self) -> None:
        self._create_approved_strategy()
        response = self._order(11, "test-strategy")  # 1100 > positionSize 1000
        self.assertEqual(response.status_code, 422)

    def test_order_beyond_max_positions_is_rejected(self) -> None:
        self._create_approved_strategy()  # maxPositions = 1
        self.assertEqual(self._order(1, "test-strategy").status_code, 200)
        self.assertEqual(self._order(1, "test-strategy").status_code, 422)


if __name__ == "__main__":
    unittest.main()