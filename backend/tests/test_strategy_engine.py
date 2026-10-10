import json
import math
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from app.api.routes.schemas import StrategyPayload
from app.market.indicators import get_indicator_snapshot
from app.strategies.base import (
    Decision,
    ParamDef,
    PluginContext,
    PluginPosition,
    StrategyPlugin,
)
from app.strategies.plugins.dca_score import (
    DcaScorePlugin,
    _timeframe_minutes,
    decide_trade,
)
from app.strategies.plugins.text_rules import (
    TextRulesPlugin,
    evaluate_custom_strategy,
    evaluate_text_condition,
)
from app.strategies.registry import (
    get_plugin,
    list_plugins,
    manifest,
    resolve_params,
)
from app.trading.engine import get_strategy_signature, get_strategy_snapshot


def _strategy(**overrides: object) -> dict:
    strategy = {
        "id": "momentum-1",
        "name": "Momentum",
        "description": "A test strategy",
        "type": "Trend Following",
        "symbol": "BTC/USDT",
        "timeframe": "1h",
        "status": "ACTIVE",
        "entryCondition": "change24h > 1",
        "exitCondition": "change24h < -1",
        "stopLoss": 2.0,
        "takeProfit": 5.0,
        "positionSize": 100.0,
        "riskPerTrade": 1.0,
        "maxPositions": 3,
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-01T00:00:00Z",
    }
    strategy.update(overrides)
    return strategy


def _dca_input(**overrides: object) -> dict:
    data = {
        "symbol": "BTCUSDT",
        "score": 50,
        "currentPrice": 100,
        "shortTermChangePct": 0,
        "changeWindowMinutes": 5,
        "longTermChangePct": 0,
        "trades": [],
    }
    data.update(overrides)
    return data


def _trade(symbol: str = "BTCUSDT", price: float = 100) -> dict:
    return {
        "symbol": symbol,
        "price": price,
        "amountUSDT": 1,
        "quantity": 0.01,
        "timestamp": 1,
    }


def _candles(closes: list[float]) -> list[dict]:
    return [
        {"close": close, "volume": 100, "open": close, "high": close, "low": close}
        for close in closes
    ]


class IndicatorTests(unittest.TestCase):
    def test_indicator_snapshot_uses_candle_series(self) -> None:
        snapshot = get_indicator_snapshot(
            {"change24h": 1.5},
            _candles([float(value) for value in range(1, 61)]),
        )

        self.assertEqual(snapshot["price"], 60)
        self.assertEqual(snapshot["sma20"], 50.5)
        self.assertEqual(snapshot["sma50"], 35.5)
        self.assertEqual(snapshot["rsi"], 100)
        self.assertEqual(snapshot["volumeRatio"], 1)
        self.assertAlmostEqual(
            snapshot["trendBias"],
            ((60 - 50.5) / 60) * 100,
            places=12,
        )

    def test_indicator_snapshot_uses_no_candle_fallback(self) -> None:
        snapshot = get_indicator_snapshot(
            {
                "price": 100,
                "change24h": 2,
                "volume24h": 1_000_000_000,
                "high24h": 110,
                "low24h": 90,
            }
        )

        self.assertAlmostEqual(snapshot["sma20"], 100.9)
        self.assertAlmostEqual(snapshot["sma50"], 100.5)
        self.assertAlmostEqual(snapshot["ema9"], 101.44)
        self.assertAlmostEqual(snapshot["ema21"], 100.76)
        self.assertAlmostEqual(snapshot["rsi"], 73)
        self.assertAlmostEqual(snapshot["macd"], 3.4)
        self.assertAlmostEqual(snapshot["signalLine"], 1.8)
        self.assertAlmostEqual(snapshot["volumeRatio"], 0.9)
        self.assertAlmostEqual(snapshot["trendBias"], 27)

    def test_zero_price_fallback_preserves_javascript_non_finite_behavior(self) -> None:
        snapshot = get_indicator_snapshot(
            {
                "price": 0,
                "change24h": 0,
                "volume24h": 0,
                "high24h": 1,
                "low24h": 0,
            }
        )
        self.assertEqual(snapshot["trendBias"], 100)


class TextRulesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.metrics = {
            "price": 105,
            "change24h": 2,
            "sma20": 100,
            "sma50": 98,
            "ema9": 103,
            "ema21": 101,
            "rsi": 60,
            "macd": 2,
            "signalLine": 1,
            "volumeRatio": 1.5,
            "trendBias": 5,
        }
        self.asset = {
            "symbol": "BTC/USDT",
            "price": 105,
            "change24h": 2,
            "volume24h": 1_000_000_000,
            "high24h": 110,
            "low24h": 100,
        }

    def test_text_condition_expression_and_operator_aliases(self) -> None:
        for operator in (">", ">=", "<", "<=", "==", "="):
            with self.subTest(operator=operator):
                right = 104 if operator in (">", ">=") else 105
                result = evaluate_text_condition(
                    f"If price {operator} {right}",
                    self.metrics,
                )
                self.assertEqual(
                    result["matches"],
                    {
                        ">": True,
                        ">=": True,
                        "<": False,
                        "<=": True,
                        "==": True,
                        "=": True,
                    }[operator],
                )
        self.assertEqual(
            evaluate_text_condition("unknown > 1", self.metrics)["reason"],
            "Momentum rule matched the market profile.",
        )

    def test_text_condition_keyword_and_default_branches(self) -> None:
        self.assertTrue(
            evaluate_text_condition("ema9 and ema21", self.metrics)["matches"]
        )
        self.assertTrue(
            evaluate_text_condition("price and sma20", self.metrics)["matches"]
        )
        self.assertEqual(
            evaluate_text_condition("bullish", self.metrics)["reason"],
            "Market structure is bullish.",
        )
        bearish_metrics = {**self.metrics, "change24h": -2, "trendBias": -5}
        self.assertEqual(
            evaluate_text_condition("bearish", bearish_metrics)["reason"],
            "Market structure is bearish.",
        )
        neutral_metrics = {**self.metrics, "change24h": 1, "trendBias": 0}
        self.assertFalse(
            evaluate_text_condition("momentum", neutral_metrics)["matches"]
        )
        self.assertEqual(
            evaluate_text_condition("", self.metrics)["reason"],
            "No custom condition specified.",
        )

    def test_custom_strategy_entry_exit_combination_and_fallback(self) -> None:
        strategy = _strategy(entryCondition="change24h > 1", exitCondition="rsi > 99")
        result = evaluate_custom_strategy(strategy, self.asset)
        self.assertEqual(result["signal"], "BUY")
        self.assertEqual(result["reason"], "Custom entry logic triggered: CHANGE24H > 1 -> triggered")

        strategy = _strategy(entryCondition="change24h > 1", exitCondition="price > 1")
        result = evaluate_custom_strategy(strategy, self.asset)
        self.assertEqual(result["signal"], "HOLD")
        self.assertIn("both matched", result["reason"])

        strategy = _strategy(entryCondition="rsi > 99", exitCondition="price > 1")
        result = evaluate_custom_strategy(strategy, self.asset)
        self.assertEqual(result["signal"], "SELL")
        self.assertIn("Custom exit logic triggered", result["reason"])

        strategy = _strategy(entryCondition="rsi > 99", exitCondition="rsi < 1")
        result = evaluate_custom_strategy(strategy, self.asset)
        self.assertEqual(result["signal"], "BUY")
        self.assertIn("Fallback bullish momentum: 2.00% 24h.", result["reason"])

        strategy = _strategy(entryCondition="rsi > 99", exitCondition="rsi < 1")
        result = evaluate_custom_strategy(
            strategy,
            {**self.asset, "change24h": -2},
        )
        self.assertEqual(result["signal"], "SELL")
        self.assertIn("Fallback bearish momentum: -2.00% 24h.", result["reason"])

    def test_custom_strategy_holds_when_inactive_or_symbol_does_not_match(self) -> None:
        inactive = evaluate_custom_strategy(
            _strategy(status="PAUSED"),
            self.asset,
        )
        self.assertEqual(inactive["reason"], "Strategy is not active.")
        mismatch = evaluate_custom_strategy(
            _strategy(symbol="ETH/USDT"),
            self.asset,
        )
        self.assertEqual(
            mismatch["reason"],
            "Market symbol does not match the strategy.",
        )

    def test_text_rules_plugin_returns_decision(self) -> None:
        decision = TextRulesPlugin().evaluate(
            PluginContext(
                strategy=_strategy(),
                symbol="BTC/USDT",
                price=105,
                change24h=2,
                candles=[],
                position=None,
                params={},
                timeframe="1h",
                now_ms=1,
                high24h=110,
                low24h=100,
                volume24h=1_000_000_000,
            )
        )
        self.assertEqual(decision.signal, "BUY")
        self.assertEqual(decision.score, 1)

    def test_matches_original_typescript_golden_fixtures(self) -> None:
        fixture_path = (
            Path(__file__).parent
            / "fixtures"
            / "strategy-engine-golden.json"
        )
        fixtures = json.loads(fixture_path.read_text(encoding="utf-8"))
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                result = evaluate_custom_strategy(
                    fixture["strategy"],
                    fixture["asset"],
                    fixture["candles"],
                )
                expected = fixture["expected"]
                self.assertEqual(result["signal"], expected["signal"])
                self.assertEqual(result["reason"], expected["reason"])
                self.assertTrue(
                    math.isclose(
                        result["score"],
                        expected["score"],
                        rel_tol=0,
                        abs_tol=1e-9,
                    )
                )

    def test_javascript_numeric_reason_formatting(self) -> None:
        small = evaluate_text_condition(
            "change24h = 0.000001",
            {**self.metrics, "change24h": 0.000001},
        )
        self.assertEqual(
            small["reason"],
            "CHANGE24H = 0.000001 -> triggered",
        )
        fixed_rounding = evaluate_custom_strategy(
            _strategy(
                entryCondition="rsi > 101",
                exitCondition="rsi < 1",
            ),
            {**self.asset, "change24h": 2.675},
        )
        self.assertEqual(
            fixed_rounding["reason"],
            "Fallback bullish momentum: 2.67% 24h.",
        )


class DcaScoreTests(unittest.TestCase):
    def assert_action(self, expected: str, **overrides: object) -> dict:
        result = decide_trade(_dca_input(**overrides))
        self.assertEqual(result["action"], expected)
        return result

    def test_matches_original_typescript_decision_fixtures(self) -> None:
        fixture_path = Path(__file__).parent / "fixtures" / "dca-score-golden.json"
        fixtures = json.loads(fixture_path.read_text(encoding="utf-8"))
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                result = decide_trade(fixture["input"])
                expected = fixture["expected"]
                self.assertEqual(result["action"], expected["action"])
                self.assertEqual(result["symbol"], expected["symbol"])
                self.assertEqual(result["reason"], expected["reason"])
                self.assertTrue(
                    math.isclose(
                        result["amountUSDT"],
                        expected["amountUSDT"],
                        rel_tol=0,
                        abs_tol=1e-9,
                    )
                )

    def test_rejects_each_invalid_top_level_input(self) -> None:
        invalid_inputs = (
            {"symbol": ""},
            {"score": math.nan},
            {"score": -1},
            {"score": 101},
            {"score": True},
            {"currentPrice": 0},
            {"currentPrice": math.inf},
            {"shortTermChangePct": math.nan},
            {"changeWindowMinutes": 0},
            {"changeWindowMinutes": math.inf},
            {"longTermChangePct": math.nan},
            {"trades": None},
        )
        for override in invalid_inputs:
            with self.subTest(override=override):
                result = decide_trade(_dca_input(**override))
                self.assertEqual(result["action"], "WAIT")
                self.assertEqual(result["reason"], "Invalid input data.")

    def test_sell_hold_rules(self) -> None:
        rapid_rise = self.assert_action(
            "HOLD",
            score=60,
            currentPrice=105,
            shortTermChangePct=3,
            trades=[_trade()],
        )
        self.assertEqual(rapid_rise["reason"], "Rapid rise: wait for the 10% profit target.")

        bullish_profit = self.assert_action(
            "HOLD",
            score=70,
            currentPrice=103,
            trades=[_trade()],
        )
        self.assertEqual(
            bullish_profit["reason"],
            "Bullish score: continue holding and protect profits.",
        )
        neutral_profit = self.assert_action(
            "SELL",
            score=69,
            currentPrice=103,
            trades=[_trade()],
        )
        self.assertEqual(
            neutral_profit["reason"],
            "Profit target reached with neutral or bearish score.",
        )

    def test_emergency_drop_scores(self) -> None:
        cases = (
            (70, "BUY_DOUBLE", "Severe rapid drop with bullish score.", 2),
            (30, "BUY_DOUBLE", "Severe rapid drop with neutral score.", 2),
            (
                29,
                "BUY",
                "Severe rapid drop with bearish score; reduced emergency entry.",
                1,
            ),
        )
        for score, action, reason, amount in cases:
            with self.subTest(score=score):
                result = self.assert_action(
                    action,
                    score=score,
                    shortTermChangePct=-15,
                )
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["amountUSDT"], amount)

    def test_initial_entry_and_existing_position_guards(self) -> None:
        self.assertEqual(
            self.assert_action(
                "WAIT",
                score=70,
                longTermChangePct=5,
            )["reason"],
            "Bullish score, but price has already risen significantly.",
        )
        self.assertEqual(
            self.assert_action("BUY", score=70)["reason"],
            "Bullish score: initial entry.",
        )
        self.assertEqual(
            self.assert_action("WAIT", score=69)["reason"],
            "No existing position and score is below 70.",
        )
        other_symbol_trade = self.assert_action(
            "BUY",
            score=70,
            trades=[_trade("ETHUSDT")],
        )
        self.assertEqual(other_symbol_trade["reason"], "Bullish score: initial entry.")

        not_dropped = self.assert_action(
            "WAIT",
            currentPrice=98,
            trades=[_trade()],
        )
        self.assertEqual(
            not_dropped["reason"],
            "Price has not dropped 3% below the last buy price.",
        )
        rapid_drop = self.assert_action(
            "WAIT",
            currentPrice=96,
            shortTermChangePct=-5,
            trades=[_trade()],
        )
        self.assertEqual(
            rapid_drop["reason"],
            "Price is dropping rapidly; wait for the market to slow.",
        )

    def test_gradual_drop_buy_rules(self) -> None:
        cases = (
            (
                70,
                "BUY_DOUBLE",
                "Gradual 3% drop with bullish score.",
                2,
            ),
            (
                30,
                "BUY",
                "Gradual 3% drop with neutral score.",
                1,
            ),
            (
                29,
                "WAIT",
                "Bearish score: wait for price stabilization.",
                0,
            ),
        )
        for score, action, reason, amount in cases:
            with self.subTest(score=score):
                result = self.assert_action(
                    action,
                    score=score,
                    currentPrice=97,
                    trades=[_trade()],
                )
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["amountUSDT"], amount)

    def test_timeframe_and_candle_window_adapters(self) -> None:
        self.assertEqual(_timeframe_minutes("1s"), 1 / 60)
        self.assertEqual(_timeframe_minutes("5m"), 5)
        self.assertEqual(_timeframe_minutes("2h"), 120)
        with self.assertRaises(ValueError):
            _timeframe_minutes("invalid")

        candles = _candles([1] * 19 + [100])
        decision = DcaScorePlugin().evaluate(
            PluginContext(
                strategy={},
                symbol="BTCUSDT",
                price=100,
                change24h=1,
                candles=candles,
                position=None,
                params={},
                timeframe="1m",
                now_ms=1,
            )
        )
        self.assertEqual(decision.signal, "BUY")
        self.assertEqual(decision.amount_usdt, 1)

        flat_position = PluginPosition(
            entry_price=100,
            quantity=1,
            value_usdt=100,
            opened_at_ms=1,
        )
        sell_decision = DcaScorePlugin().evaluate(
            PluginContext(
                strategy={},
                symbol="BTCUSDT",
                price=104,
                change24h=0,
                candles=_candles([100] * 19 + [104]),
                position=flat_position,
                params={},
                timeframe="2m",
                now_ms=2,
            )
        )
        self.assertEqual(sell_decision.signal, "SELL")
        self.assertIsNone(sell_decision.amount_usdt)


class StrategyRegistryAndSchemaTests(unittest.TestCase):
    def test_explicit_plugin_registry_and_manifest(self) -> None:
        self.assertEqual(
            [plugin.id for plugin in list_plugins()],
            ["text-rules", "dca-score"],
        )
        self.assertEqual(get_plugin("dca-score").name, "DCA Score Strategy")
        self.assertEqual(resolve_params("dca-score", {}), {})
        self.assertEqual(
            [plugin["id"] for plugin in manifest()],
            ["text-rules", "dca-score"],
        )
        with self.assertRaisesRegex(ValueError, "Unknown strategy algorithm"):
            get_plugin("user-supplied-code")
        with self.assertRaisesRegex(ValueError, "Unknown parameter"):
            resolve_params("dca-score", {"unexpected": 1})

    def test_param_defaults_types_ranges_and_select_options(self) -> None:
        class TestPlugin(StrategyPlugin):
            def __init__(self) -> None:
                super().__init__(
                    id="test-params",
                    name="Parameter test",
                    version="1",
                    description="",
                    long_only=False,
                    params=(
                        ParamDef("amount", "Amount", "number", 3, min=2, max=4),
                        ParamDef("enabled", "Enabled", "boolean", False),
                        ParamDef(
                            "mode",
                            "Mode",
                            "select",
                            "fast",
                            options=("fast", "slow"),
                        ),
                    ),
                )

            def evaluate(self, ctx: PluginContext) -> Decision:
                return Decision("HOLD", "Test plugin.")

        test_plugin = TestPlugin()
        with patch(
            "app.strategies.registry._PLUGIN_BY_ID",
            {"test-params": test_plugin},
        ):
            self.assertEqual(
                resolve_params("test-params", {"amount": 4, "enabled": True}),
                {"amount": 4, "enabled": True, "mode": "fast"},
            )
            invalid_values = (
                {"amount": True},
                {"amount": 1},
                {"amount": 5},
                {"enabled": 1},
                {"mode": "medium"},
            )
            for params in invalid_values:
                with self.subTest(params=params):
                    with self.assertRaisesRegex(ValueError, "Invalid value"):
                        resolve_params("test-params", params)

    def test_strategy_payload_requires_text_rules_conditions_and_valid_plugin(self) -> None:
        valid = _strategy()
        payload = StrategyPayload.model_validate(valid)
        self.assertIsNone(payload.algorithmId)
        self.assertEqual(payload.params, {})

        with self.assertRaises(ValidationError):
            StrategyPayload.model_validate(
                {key: value for key, value in valid.items() if key != "entryCondition"}
            )
        dca_payload = StrategyPayload.model_validate(
            {
                **valid,
                "algorithmId": "dca-score",
                "entryCondition": None,
                "exitCondition": None,
            }
        )
        self.assertEqual(dca_payload.algorithmId, "dca-score")
        with self.assertRaises(ValidationError):
            StrategyPayload.model_validate(
                {**valid, "algorithmId": "unknown-algorithm"}
            )

    def test_default_strategy_signature_and_snapshot_remain_unchanged(self) -> None:
        strategy = _strategy()
        expected_signature = (
            '{"id":"momentum-1","name":"Momentum","description":"A test strategy",'
            '"type":"Trend Following","symbol":"BTC/USDT","timeframe":"1h",'
            '"entryCondition":"change24h > 1","exitCondition":"change24h < -1",'
            '"stopLoss":2,"takeProfit":5,"positionSize":100,"riskPerTrade":1,'
            '"maxPositions":3}'
        )
        self.assertEqual(get_strategy_signature(strategy), expected_signature)
        expected_snapshot = {
            key: strategy[key]
            for key in (
                "id",
                "name",
                "description",
                "type",
                "symbol",
                "timeframe",
                "entryCondition",
                "exitCondition",
                "stopLoss",
                "takeProfit",
                "positionSize",
                "riskPerTrade",
                "maxPositions",
            )
        }
        self.assertEqual(get_strategy_snapshot(strategy), expected_snapshot)

    def test_non_default_plugin_signature_sorts_params_and_snapshot_records_plugin(self) -> None:
        strategy = _strategy(
            algorithmId="dca-score",
            params={"zeta": 2, "alpha": 1},
        )
        signature = json.loads(get_strategy_signature(strategy))
        self.assertEqual(signature["algorithmId"], "dca-score")
        self.assertEqual(signature["params"], {"alpha": 1, "zeta": 2})
        snapshot = get_strategy_snapshot(strategy)
        self.assertEqual(snapshot["algorithmId"], "dca-score")
        self.assertEqual(snapshot["params"], {"alpha": 1, "zeta": 2})

    def test_non_default_plugin_can_omit_text_conditions(self) -> None:
        strategy = _strategy(
            algorithmId="dca-score",
            entryCondition=None,
            exitCondition=None,
        )
        strategy.pop("entryCondition")
        strategy.pop("exitCondition")
        payload = StrategyPayload.model_validate(strategy)
        dumped = payload.model_dump(exclude_none=True)
        self.assertNotIn("entryCondition", dumped)
        self.assertNotIn("exitCondition", dumped)
        self.assertIn("algorithmId", get_strategy_signature(dumped))


if __name__ == "__main__":
    unittest.main()
