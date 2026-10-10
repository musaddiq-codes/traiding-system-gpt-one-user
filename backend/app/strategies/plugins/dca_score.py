"""KNOWN ISSUES (not fixed yet):
- Profit is measured from the last buy instead of average entry.
- There is no stop loss or cap on averaging down.
- There is no cooldown between buys.
- The emergency drop rule has duplicate score branches.
- There is no trailing profit protection.
- SELL carries no quantity.
"""

import math
import re
from typing import Any, Literal

from app.market.indicators import clamp, get_indicator_snapshot
from app.strategies.base import (
    Decision,
    PluginContext,
    StrategyPlugin,
)


CONFIG = {
    "normalBuyUSDT": 1,
    "doubleBuyUSDT": 2,
    "buyDropPct": 3,
    "emergencyDropPct": 15,
    "rapidDropMinutes": 5,
    "rapidRiseMinutes": 5,
    "normalSellProfitPct": 3,
    "rapidRiseTargetPct": 10,
    "extendedRisePct": 5,
}


Action = Literal["BUY", "BUY_DOUBLE", "SELL", "WAIT", "HOLD"]


def decide_trade(input_data: dict[str, Any]) -> dict[str, Any]:
    symbol = input_data["symbol"]
    score = input_data["score"]
    current_price = input_data["currentPrice"]
    short_term_change_pct = input_data["shortTermChangePct"]
    change_window_minutes = input_data["changeWindowMinutes"]
    long_term_change_pct = input_data["longTermChangePct"]
    trades = input_data["trades"]

    def result(
        action: Action,
        reason: str,
        amount_usdt: float = 0,
    ) -> dict[str, Any]:
        return {
            "action": action,
            "symbol": symbol,
            "amountUSDT": amount_usdt,
            "reason": reason,
        }

    if (
        not symbol
        or not isinstance(score, (int, float))
        or isinstance(score, bool)
        or not _is_finite(score)
        or score < 0
        or score > 100
        or not isinstance(current_price, (int, float))
        or isinstance(current_price, bool)
        or not _is_finite(current_price)
        or current_price <= 0
        or not isinstance(short_term_change_pct, (int, float))
        or isinstance(short_term_change_pct, bool)
        or not _is_finite(short_term_change_pct)
        or not isinstance(change_window_minutes, (int, float))
        or isinstance(change_window_minutes, bool)
        or not _is_finite(change_window_minutes)
        or change_window_minutes <= 0
        or not isinstance(long_term_change_pct, (int, float))
        or isinstance(long_term_change_pct, bool)
        or not _is_finite(long_term_change_pct)
        or not isinstance(trades, list)
    ):
        return result("WAIT", "Invalid input data.")

    coin_trades = [trade for trade in trades if trade["symbol"] == symbol]
    last_buy = coin_trades[-1] if coin_trades else None
    last_buy_price = (
        _to_number(last_buy.get("price", math.nan)) if last_buy else 0
    )
    drop_from_last_buy = (
        _js_divide(last_buy_price - current_price, last_buy_price) * 100
        if last_buy
        else 0
    )
    profit_from_last_buy = (
        _js_divide(current_price - last_buy_price, last_buy_price) * 100
        if last_buy
        else 0
    )
    rapid_drop = (
        short_term_change_pct <= -CONFIG["buyDropPct"]
        and change_window_minutes <= CONFIG["rapidDropMinutes"]
    )
    severe_drop = (
        short_term_change_pct <= -CONFIG["emergencyDropPct"] and rapid_drop
    )
    rapid_rise = (
        short_term_change_pct >= CONFIG["buyDropPct"]
        and change_window_minutes <= CONFIG["rapidRiseMinutes"]
    )

    if last_buy:
        if (
            rapid_rise
            and score < 70
            and profit_from_last_buy < CONFIG["rapidRiseTargetPct"]
        ):
            return result("HOLD", "Rapid rise: wait for the 10% profit target.")

        if profit_from_last_buy >= CONFIG["normalSellProfitPct"]:
            if score >= 70:
                return result(
                    "HOLD",
                    "Bullish score: continue holding and protect profits.",
                )
            return result(
                "SELL",
                "Profit target reached with neutral or bearish score.",
            )

    if severe_drop:
        if score >= 70:
            return result(
                "BUY_DOUBLE",
                "Severe rapid drop with bullish score.",
                CONFIG["doubleBuyUSDT"],
            )
        if score >= 30:
            return result(
                "BUY_DOUBLE",
                "Severe rapid drop with neutral score.",
                CONFIG["doubleBuyUSDT"],
            )
        return result(
            "BUY",
            "Severe rapid drop with bearish score; reduced emergency entry.",
            CONFIG["normalBuyUSDT"],
        )

    if not last_buy:
        if score >= 70:
            if long_term_change_pct >= CONFIG["extendedRisePct"]:
                return result(
                    "WAIT",
                    "Bullish score, but price has already risen significantly.",
                )
            return result(
                "BUY",
                "Bullish score: initial entry.",
                CONFIG["normalBuyUSDT"],
            )
        return result("WAIT", "No existing position and score is below 70.")

    if drop_from_last_buy < CONFIG["buyDropPct"]:
        return result(
            "WAIT",
            "Price has not dropped 3% below the last buy price.",
        )

    if rapid_drop:
        return result(
            "WAIT",
            "Price is dropping rapidly; wait for the market to slow.",
        )

    if score >= 70:
        return result(
            "BUY_DOUBLE",
            "Gradual 3% drop with bullish score.",
            CONFIG["doubleBuyUSDT"],
        )
    if score >= 30:
        return result(
            "BUY",
            "Gradual 3% drop with neutral score.",
            CONFIG["normalBuyUSDT"],
        )
    return result("WAIT", "Bearish score: wait for price stabilization.")


def _is_finite(value: int | float) -> bool:
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def _to_number(value: Any) -> float:
    if value is None:
        return 0
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def _js_divide(numerator: float, denominator: float) -> float:
    if denominator != 0:
        return numerator / denominator
    if numerator == 0:
        return math.nan
    return math.copysign(math.inf, numerator * math.copysign(1, denominator))


def _timeframe_minutes(timeframe: str) -> float:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)([smhdw])", timeframe.strip().lower())
    if match is None:
        raise ValueError(f"Unsupported strategy timeframe: {timeframe}")
    amount = float(match.group(1))
    unit = match.group(2)
    multiplier = {
        "s": 1 / 60,
        "m": 1,
        "h": 60,
        "d": 1_440,
        "w": 10_080,
    }[unit]
    return amount * multiplier


def _change_pct(candles: list[dict[str, Any]], count: int) -> float | None:
    if len(candles) < count:
        return None
    start_price = float(candles[-count]["close"])
    end_price = float(candles[-1]["close"])
    if start_price == 0:
        return None
    return ((end_price - start_price) / start_price) * 100


class DcaScorePlugin(StrategyPlugin):
    def __init__(self) -> None:
        super().__init__(
            id="dca-score",
            name="DCA Score Strategy",
            version="1.0.0",
            description="Dollar-cost averaging decisions based on score and price changes.",
            long_only=True,
        )

    def evaluate(self, ctx: PluginContext) -> Decision:
        asset = {
            "symbol": ctx.symbol,
            "price": ctx.price,
            "change24h": ctx.change24h,
            "volume24h": ctx.volume24h,
            "high24h": ctx.price if ctx.high24h is None else ctx.high24h,
            "low24h": ctx.price if ctx.low24h is None else ctx.low24h,
        }
        metrics = get_indicator_snapshot(asset, ctx.candles)
        # Placeholder score until the DCA plugin receives its native score input.
        score = clamp((metrics["trendBias"] + 100) / 2, 0, 100)
        short_term_change = _change_pct(ctx.candles, 5)
        long_term_change = _change_pct(ctx.candles, 60)
        position = ctx.position
        trades = (
            []
            if position is None
            else [
                {
                    "symbol": ctx.symbol,
                    "price": position.entry_price,
                    "amountUSDT": position.value_usdt,
                    "quantity": position.quantity,
                    "timestamp": position.opened_at_ms,
                }
            ]
        )
        result = decide_trade(
            {
                "symbol": ctx.symbol,
                "score": score,
                "currentPrice": ctx.price,
                "shortTermChangePct": (
                    short_term_change if short_term_change is not None else 0
                ),
                "changeWindowMinutes": 5 * _timeframe_minutes(ctx.timeframe),
                "longTermChangePct": (
                    long_term_change
                    if long_term_change is not None
                    else ctx.change24h
                ),
                "trades": trades,
            }
        )
        action = result["action"]
        signal = (
            "BUY" if action in ("BUY", "BUY_DOUBLE")
            else "SELL" if action == "SELL"
            else "HOLD"
        )
        amount = result["amountUSDT"] if signal == "BUY" else None
        return Decision(
            signal=signal,
            reason=result["reason"],
            score=score,
            amount_usdt=amount,
        )
