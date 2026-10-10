import math
import re
from typing import Any


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _average(values: list[float]) -> float:
    return sum(values) / len(values) if values else math.nan


def _js_divide(numerator: float, denominator: float) -> float:
    if denominator != 0:
        return numerator / denominator
    if numerator == 0:
        return math.nan
    return math.copysign(math.inf, numerator * math.copysign(1, denominator))


def _ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    multiplier = 2 / (period + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(result[-1] + (value - result[-1]) * multiplier)
    return result


def get_indicator_snapshot(
    asset: dict[str, Any],
    candles: list[dict[str, Any]] | None = None,
) -> dict[str, float]:
    if candles:
        closes = [float(candle["close"]) for candle in candles]
        volumes = [float(candle["volume"]) for candle in candles]
        recent_closes = closes[-15:]
        recent_changes = [
            close - recent_closes[index]
            for index, close in enumerate(recent_closes[1:])
        ]
        gains = [change for change in recent_changes if change > 0]
        losses = [abs(change) for change in recent_changes if change < 0]
        average_gain = _average(gains) if gains else 0
        average_loss = _average(losses) if losses else 0
        if average_loss == 0:
            rsi = 100 if average_gain > 0 else 50
        else:
            rsi = 100 - 100 / (1 + average_gain / average_loss)

        fast_ema = _ema_series(closes, 12)
        slow_ema = _ema_series(closes, 26)
        macd_values = [fast - slow for fast, slow in zip(fast_ema, slow_ema)]
        average_volume = _average(volumes[-21:-1])
        price = closes[-1]
        sma20 = _average(closes[-20:])
        ema9_values = _ema_series(closes[-9:], 9)
        ema21_values = _ema_series(closes[-21:], 21)
        signal_values = _ema_series(macd_values[-9:], 9)
        trend_bias = 0 if price == 0 else ((price - sma20) / price) * 100
        return {
            "price": price,
            "change24h": float(asset["change24h"]),
            "sma20": sma20,
            "sma50": _average(closes[-50:]),
            "ema9": ema9_values[-1],
            "ema21": ema21_values[-1],
            "rsi": rsi,
            "macd": macd_values[-1] if macd_values else 0,
            "signalLine": signal_values[-1] if signal_values else 0,
            "volumeRatio": (
                volumes[-1] / average_volume if average_volume > 0 else 0
            ),
            "trendBias": trend_bias,
        }

    momentum = float(asset["change24h"])
    price = float(asset["price"])
    drift = momentum / 100
    range_bias = (
        _js_divide(
            float(asset["high24h"]) - float(asset["low24h"]),
            price,
        )
        * 100
    )
    return {
        "price": price,
        "change24h": momentum,
        "sma20": price * (1 + drift * 0.45),
        "sma50": price * (1 + drift * 0.25),
        "ema9": price * (1 + drift * 0.72),
        "ema21": price * (1 + drift * 0.38),
        "rsi": clamp(50 + momentum * 11.5, 0, 100),
        "macd": momentum * 1.7,
        "signalLine": momentum * 0.9,
        "volumeRatio": clamp(float(asset["volume24h"]) / 1_000_000_000 * 0.9, 0, 10),
        "trendBias": clamp(momentum * 3.5 + range_bias, -100, 100),
    }


def normalize_condition(condition: str) -> str:
    normalized = re.sub(r"\s+", " ", condition.strip().lower())
    normalized = re.sub(r"\band\b", " and ", normalized)
    normalized = re.sub(r"\bor\b", " or ", normalized)
    return re.sub(r"\bif\b", "", normalized).strip()


def lookup_value(name: str, metrics: dict[str, float]) -> float:
    normalized = re.sub(r"\s+", "", name).lower()
    aliases = {
        "price": "price",
        "change24h": "change24h",
        "momentum": "change24h",
        "sma20": "sma20",
        "sma50": "sma50",
        "ema9": "ema9",
        "ema21": "ema21",
        "rsi": "rsi",
        "macd": "macd",
        "signalline": "signalLine",
        "signal": "signalLine",
        "volumeratio": "volumeRatio",
        "volume": "volumeRatio",
        "trendbias": "trendBias",
    }
    return metrics.get(aliases.get(normalized, ""), math.nan)


def compare_values(left: float, operator: str, right: float) -> bool:
    if operator == ">":
        return left > right
    if operator == ">=":
        return left >= right
    if operator == "<":
        return left < right
    if operator == "<=":
        return left <= right
    if operator in ("==", "="):
        return left == right
    return False