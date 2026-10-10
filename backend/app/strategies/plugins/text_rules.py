import math
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.market.indicators import (
    compare_values,
    get_indicator_snapshot,
    lookup_value,
    normalize_condition,
)
from app.strategies.base import Decision, PluginContext, StrategyPlugin


EXPRESSION_PATTERNS = (
    re.compile(
        r"^(ema9|ema21|price|sma20|sma50|rsi|macd|signalline|signal|change24h|momentum|volumeratio|volume|trendbias)\s*(>=|<=|==|=|>|<)\s*([-+]?\d*\.?\d+)",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?:if\s+)?(ema9|ema21|price|sma20|sma50|rsi|macd|signalline|signal|change24h|momentum|volumeratio|volume|trendbias)\s*(>=|<=|==|=|>|<)\s*([-+]?\d*\.?\d+)",
        re.IGNORECASE,
    ),
)


def _js_number_string(value: float) -> str:
    if value == 0:
        return "0"
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    rendered = repr(value).lower()
    if "e" not in rendered:
        return rendered
    mantissa, exponent_text = rendered.split("e")
    exponent = int(exponent_text)
    if -6 <= exponent < 21:
        return format(Decimal(rendered), "f")
    if mantissa.endswith(".0"):
        mantissa = mantissa[:-2]
    return f"{mantissa}e{'+' if exponent >= 0 else ''}{exponent}"


def _to_fixed(value: float, digits: int = 2) -> str:
    if abs(value) >= 1e21:
        return _js_number_string(value)
    magnitude = Decimal.from_float(abs(value)).quantize(
        Decimal(1).scaleb(-digits),
        rounding=ROUND_HALF_UP,
    )
    prefix = "-" if value < 0 else ""
    return f"{prefix}{magnitude:.{digits}f}"


def evaluate_text_condition(
    condition: str,
    metrics: dict[str, float],
) -> dict[str, Any]:
    normalized = normalize_condition(condition)

    if not normalized:
        return {
            "matches": False,
            "score": 0,
            "reason": "No custom condition specified.",
        }

    for pattern in EXPRESSION_PATTERNS:
        match = pattern.search(normalized)
        if match:
            raw_key, operator, raw_value = match.groups()
            left = lookup_value(raw_key, metrics)
            right = float(raw_value)

            if not math.isfinite(left) or not math.isfinite(right):
                break

            matches = compare_values(left, operator, right)
            return {
                "matches": matches,
                "score": 1 if matches else 0,
                "reason": (
                    f"{raw_key.upper()} {operator} {_js_number_string(right)}"
                    f" -> {'triggered' if matches else 'not triggered'}"
                ),
            }

    if "ema9" in normalized and "ema21" in normalized:
        ema9_above = metrics["ema9"] > metrics["ema21"]
        return {
            "matches": ema9_above,
            "score": 1 if ema9_above else 0,
            "reason": (
                "EMA 9 is above EMA 21."
                if ema9_above
                else "EMA 9 is not above EMA 21."
            ),
        }

    if "price" in normalized and "sma20" in normalized:
        price_above = metrics["price"] > metrics["sma20"]
        return {
            "matches": price_above,
            "score": 1 if price_above else 0,
            "reason": (
                "Price is above SMA 20."
                if price_above
                else "Price is below SMA 20."
            ),
        }

    change_24h = metrics["change24h"]
    momentum_signal = "BUY" if change_24h > 1 else "SELL" if change_24h < -1 else "HOLD"
    base_score = abs(change_24h) * 2

    if any(word in normalized for word in ("buy", "bullish", "uptrend")):
        matches = momentum_signal == "BUY" or metrics["trendBias"] > 0
        return {
            "matches": matches,
            "score": base_score if matches else 0,
            "reason": (
                "Market structure is bullish."
                if matches
                else "Market structure is not bullish."
            ),
        }

    if any(word in normalized for word in ("sell", "bearish", "downtrend")):
        matches = momentum_signal == "SELL" or metrics["trendBias"] < 0
        return {
            "matches": matches,
            "score": base_score if matches else 0,
            "reason": (
                "Market structure is bearish."
                if matches
                else "Market structure is not bearish."
            ),
        }

    default_matches = abs(change_24h) > 1
    return {
        "matches": default_matches,
        "score": abs(change_24h) if default_matches else 0,
        "reason": (
            "Momentum rule matched the market profile."
            if default_matches
            else "Momentum rule did not match the market profile."
        ),
    }


def evaluate_custom_strategy(
    strategy: dict[str, Any],
    asset: dict[str, Any],
    candles: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if strategy["status"] != "ACTIVE":
        return {
            "strategyId": strategy["id"],
            "symbol": strategy["symbol"],
            "signal": "HOLD",
            "reason": "Strategy is not active.",
            "score": 0,
        }

    if strategy["symbol"] != asset["symbol"]:
        return {
            "strategyId": strategy["id"],
            "symbol": strategy["symbol"],
            "signal": "HOLD",
            "reason": "Market symbol does not match the strategy.",
            "score": 0,
        }

    metrics = get_indicator_snapshot(asset, candles)
    entry = evaluate_text_condition(strategy["entryCondition"], metrics)
    exit_condition = evaluate_text_condition(strategy["exitCondition"], metrics)
    entry_should_buy = entry["matches"] and not exit_condition["matches"]
    entry_should_sell = exit_condition["matches"] and not entry["matches"]

    if entry_should_sell:
        return {
            "strategyId": strategy["id"],
            "symbol": strategy["symbol"],
            "signal": "SELL",
            "reason": f"Custom exit logic triggered: {exit_condition['reason']}",
            "score": exit_condition["score"],
        }

    if entry_should_buy:
        return {
            "strategyId": strategy["id"],
            "symbol": strategy["symbol"],
            "signal": "BUY",
            "reason": f"Custom entry logic triggered: {entry['reason']}",
            "score": entry["score"],
        }

    if entry["matches"] and exit_condition["matches"]:
        return {
            "strategyId": strategy["id"],
            "symbol": strategy["symbol"],
            "signal": "HOLD",
            "reason": (
                "Entry and exit conditions both matched; waiting for a clearer signal."
            ),
            "score": max(entry["score"], exit_condition["score"]),
        }

    change_24h = metrics["change24h"]
    if abs(change_24h) > 1 and not entry["matches"] and not exit_condition["matches"]:
        return {
            "strategyId": strategy["id"],
            "symbol": strategy["symbol"],
            "signal": "BUY" if change_24h > 0 else "SELL",
            "reason": (
                f"Fallback bullish momentum: {_to_fixed(change_24h)}% 24h."
                if change_24h > 0
                else f"Fallback bearish momentum: {_to_fixed(change_24h)}% 24h."
            ),
            "score": abs(change_24h),
        }

    return {
        "strategyId": strategy["id"],
        "symbol": strategy["symbol"],
        "signal": "HOLD",
        "reason": "Custom strategy did not produce a strong actionable signal.",
        "score": max(
            entry["score"],
            exit_condition["score"],
            abs(change_24h),
        ),
    }


class TextRulesPlugin(StrategyPlugin):
    def __init__(self) -> None:
        super().__init__(
            id="text-rules",
            name="Text Rules",
            version="1.0.0",
            description="Evaluates a strategy's existing entry and exit text rules.",
            long_only=False,
        )

    def evaluate(self, ctx: PluginContext) -> Decision:
        result = evaluate_custom_strategy(ctx.strategy, {
            "symbol": ctx.symbol,
            "price": ctx.price,
            "change24h": ctx.change24h,
            "volume24h": ctx.volume24h,
            "high24h": ctx.price if ctx.high24h is None else ctx.high24h,
            "low24h": ctx.price if ctx.low24h is None else ctx.low24h,
        }, ctx.candles)
        return Decision(
            signal=result["signal"],
            reason=result["reason"],
            score=result["score"],
        )
