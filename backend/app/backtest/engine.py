import math
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal
from uuid import uuid4

from app.market.data import interval_milliseconds, normalize_symbol
from app.risk.backtest_policy import evaluate_eligibility
from app.strategies.base import PluginContext, PluginPosition
from app.strategies.registry import DEFAULT_PLUGIN_ID, get_plugin, resolve_params


ExitReason = Literal["SIGNAL", "STOP_LOSS", "TAKE_PROFIT", "END_OF_TEST"]


@dataclass
class OpenPosition:
    direction: Literal["LONG", "SHORT"]
    quantity: float
    entry_price: float
    entry_fee: float
    margin: float
    entry_timestamp: str
    opened_at_ms: int
    stop_price: float
    take_profit_price: float


def _to_fixed_number(value: float, digits: int = 2) -> float:
    rounded = Decimal.from_float(abs(value)).quantize(
        Decimal(1).scaleb(-digits),
        rounding=ROUND_HALF_UP,
    )
    return float(f"-{rounded}" if value < 0 else rounded)


def _apply_slippage(
    reference_price: float,
    action: Literal["BUY", "SELL"],
    slippage_bps: float,
) -> float:
    slippage = slippage_bps / 10_000
    return reference_price * (1 + slippage if action == "BUY" else 1 - slippage)


def _stop_or_target_fill(
    candle: dict[str, Any],
    position: OpenPosition,
) -> tuple[float, Literal["STOP_LOSS", "TAKE_PROFIT"]] | None:
    is_long = position.direction == "LONG"
    stop_hit = (
        float(candle["low"]) <= position.stop_price
        if is_long
        else float(candle["high"]) >= position.stop_price
    )
    target_hit = (
        float(candle["high"]) >= position.take_profit_price
        if is_long
        else float(candle["low"]) <= position.take_profit_price
    )
    if stop_hit:
        reference = (
            min(float(candle["open"]), position.stop_price)
            if is_long
            else max(float(candle["open"]), position.stop_price)
        )
        return (
            _apply_slippage(reference, "SELL" if is_long else "BUY", 0),
            "STOP_LOSS",
        )
    if target_hit:
        reference = (
            max(float(candle["open"]), position.take_profit_price)
            if is_long
            else min(float(candle["open"]), position.take_profit_price)
        )
        return reference, "TAKE_PROFIT"
    return None


def _build_context(
    strategy: dict[str, Any],
    candles: list[dict[str, Any]],
    index: int,
    candles_per_day: int,
    position: OpenPosition | None,
    now_ms: int,
) -> PluginContext:
    previous = candles[index - 1]
    previous_day = candles[max(0, index - 1 - candles_per_day)]
    previous_day_close = float(previous_day["close"])
    close = float(previous["close"])
    change_24h = (
        ((close - previous_day_close) / previous_day_close) * 100
        if previous_day_close > 0
        else 0
    )
    simulated_position = (
        PluginPosition(
            entry_price=position.entry_price,
            quantity=position.quantity,
            value_usdt=position.margin,
            opened_at_ms=position.opened_at_ms,
        )
        if position is not None
        else None
    )
    return PluginContext(
        strategy=strategy,
        symbol=strategy["symbol"],
        price=close,
        change24h=change_24h,
        candles=candles[max(0, index - 100) : index],
        position=simulated_position,
        params=resolve_params(
            strategy.get("algorithmId") or DEFAULT_PLUGIN_ID,
            strategy.get("params", {}),
        ),
        timeframe=strategy["timeframe"],
        now_ms=now_ms,
        volume24h=float(previous["volume"]),
        high24h=float(previous["high"]),
        low24h=float(previous["low"]),
    )


def run_backtest(
    strategy: dict[str, Any],
    candles: list[dict[str, Any]],
    *,
    initial_balance: float = 100_000,
    fee_bps: float = 10,
    slippage_bps: float = 5,
    run_id: str | None = None,
) -> dict[str, Any]:
    if len(candles) < 3:
        raise ValueError("Not enough historical candles are available for this backtest.")

    strategy = {**strategy, "status": "ACTIVE"}
    symbol = strategy["symbol"]
    timeframe = strategy["timeframe"]
    plugin_id = strategy.get("algorithmId") or DEFAULT_PLUGIN_ID
    plugin = get_plugin(plugin_id)
    params = resolve_params(plugin_id, strategy.get("params", {}))
    strategy["params"] = params

    fee_rate = fee_bps / 10_000
    interval_ms = interval_milliseconds(timeframe)
    candles_per_day = max(1, math.floor(86_400_000 / interval_ms))
    cash = initial_balance
    position: OpenPosition | None = None
    winning_trades = 0
    losing_trades = 0
    fees_paid = 0.0
    max_drawdown = 0.0
    peak_equity = initial_balance
    equity_curve: list[float] = []
    trades: list[dict[str, Any]] = []

    def close_position(
        fill_price: float,
        timestamp: str,
        exit_reason: ExitReason,
    ) -> None:
        nonlocal cash, position, winning_trades, losing_trades, fees_paid
        if position is None:
            return
        exiting = position
        exit_action = "SELL" if exiting.direction == "LONG" else "BUY"
        exit_price = _apply_slippage(fill_price, exit_action, slippage_bps)
        exit_fee = exiting.quantity * exit_price * fee_rate
        gross_pnl = (
            (exit_price - exiting.entry_price) * exiting.quantity
            if exiting.direction == "LONG"
            else (exiting.entry_price - exit_price) * exiting.quantity
        )
        net_pnl = gross_pnl - exiting.entry_fee - exit_fee
        cash += exiting.margin + gross_pnl - exit_fee
        fees_paid += exit_fee
        if net_pnl >= 0:
            winning_trades += 1
        else:
            losing_trades += 1
        trades.append(
            {
                "direction": exiting.direction,
                "entryTimestamp": exiting.entry_timestamp,
                "entryPrice": exiting.entry_price,
                "exitPrice": exit_price,
                "pnl": _to_fixed_number(net_pnl),
                "entryFee": _to_fixed_number(exiting.entry_fee),
                "exitFee": _to_fixed_number(exit_fee),
                "exitReason": exit_reason,
                "timestamp": timestamp,
            }
        )
        position = None

    def evaluate(index: int, simulated_position: OpenPosition | None):
        context = _build_context(
            strategy,
            candles,
            index,
            candles_per_day,
            simulated_position,
            int(candles[index - 1]["timestamp"]) + interval_ms,
        )
        decision = plugin.evaluate(context)
        if decision.signal not in ("BUY", "SELL", "HOLD"):
            raise ValueError("Strategy plugin returned an invalid signal.")
        if not isinstance(decision.reason, str):
            raise ValueError("Strategy plugin returned an invalid decision.")
        if not math.isfinite(float(decision.score)):
            raise ValueError("Strategy plugin returned an invalid score.")
        return decision

    for index in range(1, len(candles)):
        candle = candles[index]

        if position is not None:
            stop_or_target = _stop_or_target_fill(candle, position)
            if stop_or_target is not None:
                close_position(stop_or_target[0], candle["time"], stop_or_target[1])
            else:
                opposite_signal = evaluate(index, position)
                should_exit = (
                    opposite_signal.signal == "SELL"
                    if position.direction == "LONG"
                    else opposite_signal.signal == "BUY"
                )
                if should_exit:
                    close_position(float(candle["open"]), candle["time"], "SIGNAL")

        if position is None:
            signal = evaluate(index, None)
            can_open_short = not plugin.long_only
            if signal.signal == "BUY" or (
                signal.signal == "SELL" and can_open_short
            ):
                direction: Literal["LONG", "SHORT"] = (
                    "LONG" if signal.signal == "BUY" else "SHORT"
                )
                entry_action = "BUY" if direction == "LONG" else "SELL"
                entry_price = _apply_slippage(
                    float(candle["open"]),
                    entry_action,
                    slippage_bps,
                )
                risk_amount = cash * (float(strategy["riskPerTrade"]) / 100)
                stop_distance = entry_price * (float(strategy["stopLoss"]) / 100)
                quantity_by_risk = risk_amount / stop_distance
                quantity_by_size = float(strategy["positionSize"]) / entry_price
                quantity_by_cash = cash / (entry_price * (1 + fee_rate))
                quantity = min(
                    quantity_by_risk,
                    quantity_by_size,
                    quantity_by_cash,
                )
                margin = quantity * entry_price
                entry_fee = margin * fee_rate
                if (
                    math.isfinite(quantity)
                    and quantity > 0
                    and margin + entry_fee <= cash
                ):
                    cash -= margin + entry_fee
                    fees_paid += entry_fee
                    opened_at_ms = int(candle["timestamp"])
                    position = OpenPosition(
                        direction=direction,
                        quantity=quantity,
                        entry_price=entry_price,
                        entry_fee=entry_fee,
                        margin=margin,
                        entry_timestamp=candle["time"],
                        opened_at_ms=opened_at_ms,
                        stop_price=(
                            entry_price * (1 - float(strategy["stopLoss"]) / 100)
                            if direction == "LONG"
                            else entry_price * (1 + float(strategy["stopLoss"]) / 100)
                        ),
                        take_profit_price=(
                            entry_price * (1 + float(strategy["takeProfit"]) / 100)
                            if direction == "LONG"
                            else entry_price * (1 - float(strategy["takeProfit"]) / 100)
                        ),
                    )
                    same_candle_exit = _stop_or_target_fill(candle, position)
                    if same_candle_exit is not None:
                        close_position(
                            same_candle_exit[0],
                            candle["time"],
                            same_candle_exit[1],
                        )

        unrealized_pnl = (
            (
                float(candle["close"]) - position.entry_price
                if position.direction == "LONG"
                else position.entry_price - float(candle["close"])
            )
            * position.quantity
            if position is not None
            else 0
        )
        equity = cash + (position.margin if position is not None else 0) + unrealized_pnl
        equity_curve.append(_to_fixed_number(equity))
        peak_equity = max(peak_equity, equity)
        max_drawdown = max(
            max_drawdown,
            ((peak_equity - equity) / peak_equity) * 100,
        )

    if position is not None:
        final_candle = candles[-1]
        close_position(
            float(final_candle["close"]),
            final_candle["time"],
            "END_OF_TEST",
        )
        equity_curve[-1] = _to_fixed_number(cash)
        max_drawdown = max(
            max_drawdown,
            ((peak_equity - cash) / peak_equity) * 100,
        )

    net_profit = cash - initial_balance
    total_return = (net_profit / initial_balance) * 100
    total_trades = winning_trades + losing_trades
    win_rate = (winning_trades / total_trades) * 100 if total_trades else 0
    result: dict[str, Any] = {
        "runId": run_id or str(uuid4()),
        "strategyId": strategy["id"],
        "strategyName": strategy["name"],
        "symbol": symbol,
        "timeframe": timeframe,
        "initialBalance": initial_balance,
        "feeBps": fee_bps,
        "slippageBps": slippage_bps,
        "executionAssumptions": [
            "Signals use completed candle data and enter at the next candle open.",
            "Market orders include adverse slippage and fees on entry and exit.",
            "Position size is capped by strategy size, available cash, and risk-per-trade divided by stop distance.",
            "Only one simultaneous position is modeled; maxPositions above one is not simulated.",
            "Only one position is simulated, so plugin double buys/averaging down count as a single entry.",
            "Stop loss and take profit are evaluated against candle high/low; if both trigger in one candle, stop loss is assumed first.",
            "Short positions are simulated as margin-backed paper positions; funding, borrow costs, partial fills, and exchange filters are not modeled.",
        ],
        "from": candles[0]["time"],
        "to": candles[-1]["time"],
        "totalTrades": total_trades,
        "winningTrades": winning_trades,
        "losingTrades": losing_trades,
        "winRate": _to_fixed_number(win_rate),
        "netProfit": _to_fixed_number(net_profit),
        "totalReturn": _to_fixed_number(total_return),
        "maxDrawdown": _to_fixed_number(max_drawdown),
        "feesPaid": _to_fixed_number(fees_paid),
        "eligibleForPaperReview": False,
        "reviewEligibilityReason": "",
        "equityCurve": equity_curve,
        "trades": trades,
    }
    eligible, reason = evaluate_eligibility(result)
    result["eligibleForPaperReview"] = eligible
    result["reviewEligibilityReason"] = reason
    return result
