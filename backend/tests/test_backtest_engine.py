import unittest
import json
from pathlib import Path
from unittest.mock import patch

from app.backtest.engine import run_backtest
from app.strategies.base import Decision


class ScriptedPlugin:
    def __init__(self, signal="BUY", *, long_only=False, exit_at_history=None):
        self.id = "test-plugin"
        self.name = "Test plugin"
        self.version = "1"
        self.description = "Backtest test plugin"
        self.long_only = long_only
        self.params = ()
        self.signal = signal
        self.exit_at_history = exit_at_history

    def evaluate(self, ctx):
        history_length = len(ctx.candles)
        if ctx.position is not None and history_length == self.exit_at_history:
            return Decision("SELL" if ctx.position else "HOLD", "scripted exit", 1)
        if ctx.position is None and history_length == 1:
            return Decision(self.signal, "scripted entry", 1)
        return Decision("HOLD", "no signal", 0)


def _strategy() -> dict:
    return {
        "id": "backtest-strategy",
        "name": "Backtest fixture",
        "symbol": "BTC/USDT",
        "timeframe": "1m",
        "status": "DRAFT",
        "algorithmId": "test-plugin",
        "params": {},
        "stopLoss": 5,
        "takeProfit": 5,
        "positionSize": 1000,
        "riskPerTrade": 1,
    }


def _candles(*, entry_high=101, entry_low=99, last_close=104, second=None):
    return [
        {
            "time": "2026-01-01T00:00:00Z",
            "timestamp": 1_767_225_600_000,
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 10,
        },
        {
            "time": "2026-01-01T00:01:00Z",
            "timestamp": 1_767_225_660_000,
            "open": 100,
            "high": entry_high,
            "low": entry_low,
            "close": 100,
            "volume": 11,
        },
        second
        or {
            "time": "2026-01-01T00:02:00Z",
            "timestamp": 1_767_225_720_000,
            "open": 100,
            "high": 102,
            "low": 98,
            "close": 101,
            "volume": 12,
        },
        {
            "time": "2026-01-01T00:03:00Z",
            "timestamp": 1_767_225_780_000,
            "open": 101,
            "high": 104,
            "low": 100,
            "close": last_close,
            "volume": 13,
        },
    ]


class BacktestEngineTests(unittest.TestCase):
    def run_with_plugin(self, plugin, candles=None, **options):
        with patch.dict(
            "app.strategies.registry._PLUGIN_BY_ID",
            {"test-plugin": plugin},
        ):
            return run_backtest(
                _strategy(),
                candles or _candles(),
                initial_balance=10_000,
                fee_bps=options.get("fee_bps", 0),
                slippage_bps=options.get("slippage_bps", 0),
                run_id="run-test",
            )

    def test_result_shape_and_end_of_test_close(self):
        result = self.run_with_plugin(ScriptedPlugin())

        self.assertEqual(
            set(result),
            {
                "runId",
                "strategyId",
                "strategyName",
                "symbol",
                "timeframe",
                "initialBalance",
                "feeBps",
                "slippageBps",
                "executionAssumptions",
                "from",
                "to",
                "totalTrades",
                "winningTrades",
                "losingTrades",
                "winRate",
                "netProfit",
                "totalReturn",
                "maxDrawdown",
                "feesPaid",
                "eligibleForPaperReview",
                "reviewEligibilityReason",
                "equityCurve",
                "trades",
            },
        )
        self.assertEqual(result["runId"], "run-test")
        self.assertEqual(result["totalTrades"], 1)
        self.assertEqual(result["trades"][0]["direction"], "LONG")
        self.assertEqual(result["trades"][0]["exitReason"], "END_OF_TEST")
        self.assertEqual(result["trades"][0]["entryTimestamp"], _candles()[1]["time"])
        self.assertEqual(result["trades"][0]["timestamp"], _candles()[-1]["time"])
        self.assertEqual(result["netProfit"], 40)

    def test_stop_loss_wins_when_stop_and_target_are_both_hit(self):
        candles = _candles(
            entry_high=110,
            entry_low=90,
        )
        result = self.run_with_plugin(ScriptedPlugin(), candles)

        self.assertEqual(result["trades"][0]["exitReason"], "STOP_LOSS")
        self.assertEqual(result["trades"][0]["pnl"], -50)
        self.assertEqual(result["netProfit"], -50)

    def test_take_profit_triggered_on_candle_high(self):
        candles = _candles(
            entry_high=106,
            entry_low=99,
        )
        result = self.run_with_plugin(ScriptedPlugin(), candles)

        self.assertEqual(result["trades"][0]["exitReason"], "TAKE_PROFIT")
        self.assertEqual(result["trades"][0]["pnl"], 50)

    def test_long_only_plugin_ignores_sell_while_flat(self):
        result = self.run_with_plugin(
            ScriptedPlugin("SELL", long_only=True),
        )

        self.assertEqual(result["totalTrades"], 0)
        self.assertEqual(result["trades"], [])

    def test_fees_and_slippage_are_included_in_trade_and_profit(self):
        result = self.run_with_plugin(
            ScriptedPlugin(),
            fee_bps=10,
            slippage_bps=5,
        )

        trade = result["trades"][0]
        self.assertGreater(trade["entryPrice"], 100)
        self.assertLess(trade["exitPrice"], 105)
        self.assertGreater(trade["entryFee"], 0)
        self.assertGreater(trade["exitFee"], 0)
        self.assertGreater(result["feesPaid"], 0)
        self.assertLess(result["netProfit"], 100)

    def test_insufficient_candle_input_is_rejected(self):
        with patch.dict(
            "app.strategies.registry._PLUGIN_BY_ID",
            {"test-plugin": ScriptedPlugin()},
        ):
            with self.assertRaisesRegex(
                ValueError,
                "Not enough historical candles",
            ):
                run_backtest(_strategy(), _candles()[:2])

    def test_text_rules_matches_original_typescript_golden(self):
        strategy = {
            "id": "golden",
            "name": "Golden",
            "description": "",
            "type": "Trend Following",
            "symbol": "BTC/USDT",
            "timeframe": "1m",
            "status": "DRAFT",
            "entryCondition": "RSI < 101",
            "exitCondition": "RSI > 101",
            "stopLoss": 50,
            "takeProfit": 50,
            "positionSize": 1000,
            "riskPerTrade": 1,
            "maxPositions": 1,
        }
        candles = [
            {
                "time": f"2026-01-01T00:0{index}:00Z",
                "timestamp": 1_767_225_600_000 + index * 60_000,
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
            for index, (open_price, high, low, close, volume) in enumerate(
                [
                    (100, 101, 99, 100, 10),
                    (100, 102, 98, 100, 11),
                    (100, 102, 98, 101, 12),
                    (101, 104, 100, 104, 13),
                ]
            )
        ]
        golden_path = Path(__file__).parent / "fixtures" / "backtest-golden.json"
        golden = json.loads(golden_path.read_text(encoding="utf-8"))

        result = run_backtest(
            strategy,
            candles,
            initial_balance=10_000,
            fee_bps=0,
            slippage_bps=0,
            run_id="golden",
        )

        self.assertEqual(result["netProfit"], golden["netProfit"])
        self.assertEqual(result["trades"], golden["trades"])


if __name__ == "__main__":
    unittest.main()
