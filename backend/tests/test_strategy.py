import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app.database import database
from app.main import app


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

    def test_health_and_portfolio_state(self) -> None:
        self.assertEqual(self.request("GET", "/health").json(), {"status": "ok"})
        state = self.request("GET", "/api/state")
        self.assertEqual(state.status_code, 200)
        self.assertEqual(state.json()["account"]["balance"], 100000)

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

        result = {
            "runId": "backtest-test",
            "strategyId": strategy["id"],
            "eligibleForPaperReview": True,
            "reviewEligibilityReason": "Eligible after manual review.",
        }
        saved_run = self.request(
            "POST",
            "/api/backtests/runs",
            json={"strategy": strategy, "result": result},
        )
        self.assertEqual(saved_run.status_code, 200)

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
            self.assertEqual(len(opened.json()["state"]["positions"]), 4)

            closed = self.request("DELETE", f"/api/positions/{position_id}")
            self.assertEqual(closed.status_code, 200, closed.text)
            self.assertEqual(len(closed.json()["state"]["positions"]), 3)
            self.assertEqual(closed.json()["trade"]["realizedPnl"], 10)
            self.assertEqual(
                self.request("GET", "/api/state").json()["account"]["balance"],
                100010,
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


if __name__ == "__main__":
    unittest.main()