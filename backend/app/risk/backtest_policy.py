import math


MIN_TRADES = 5
MAX_DRAWDOWN_PERCENT = 100


def evaluate_eligibility(result: dict) -> tuple[bool, str]:
    metrics = {}
    for key in ("netProfit", "totalTrades", "maxDrawdown"):
        value = result.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False, f"{key} must be a finite number for paper review."
        if isinstance(value, float) and not math.isfinite(value):
            return False, f"{key} must be a finite number for paper review."
        metrics[key] = value

    net_profit = metrics["netProfit"]
    total_trades = metrics["totalTrades"]
    max_drawdown = metrics["maxDrawdown"]

    if net_profit <= 0:
        return (
            False,
            "Net return must be positive before this run can be approved for paper trading.",
        )
    if total_trades < MIN_TRADES:
        return False, "At least five completed trades are required before paper review."
    if max_drawdown >= MAX_DRAWDOWN_PERCENT:
        return False, "Drawdown reached 100%; this run is not eligible for paper approval."
    return (
        True,
        "Positive net return, at least five completed trades, and no total-equity wipeout. Manual review is still required.",
    )


def validate_result_shape(result: dict) -> None:
    trades = result.get("trades")
    if not isinstance(trades, list):
        raise ValueError("Backtest result trades must be a list.")

    total_trades = result.get("totalTrades")
    if isinstance(total_trades, bool) or not isinstance(total_trades, int):
        raise ValueError("Backtest result totalTrades must be an integer.")
    if total_trades != len(trades):
        raise ValueError("Backtest result totalTrades must match the number of trades.")
