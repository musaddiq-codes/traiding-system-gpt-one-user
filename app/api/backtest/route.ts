import { randomUUID } from "node:crypto";

import {
  fetchHistoricalCandles,
  type CandlePoint,
  type ChartRange,
  isChartRange,
} from "../../lib/market-data";
import {
  getStrategySignature,
  saveBacktestRun,
} from "../../lib/backtest-storage";
import type { BacktestResult } from "../../lib/backtest-types";
import { evaluateCustomStrategy } from "../../lib/strategy-engine";
import { getStoredStrategies } from "../../lib/storage";
import type { Asset, Strategy } from "../../lib/trading-types";

interface BacktestRequest {
  strategy: Strategy;
  symbol?: string;
  days?: number;
  initialBalance?: number;
  feeBps?: number;
  slippageBps?: number;
}

interface OpenPosition {
  direction: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  entryFee: number;
  margin: number;
  entryTimestamp: string;
  stopPrice: number;
  takeProfitPrice: number;
}

function getIntervalMilliseconds(interval: ChartRange): number {
  if (interval === "1s") {
    return 1_000;
  }

  const amount = Number(interval.slice(0, -1));

  if (interval.endsWith("m")) {
    return amount * 60_000;
  }

  if (interval.endsWith("h")) {
    return amount * 3_600_000;
  }

  return amount * 86_400_000;
}

function makeAsset(
  symbol: string,
  candle: CandlePoint,
  previousDayClose: number | undefined
): Asset {
  const change24h = previousDayClose && previousDayClose > 0
    ? ((candle.close - previousDayClose) / previousDayClose) * 100
    : 0;

  return {
    symbol,
    name: symbol.replace("/USDT", ""),
    price: candle.close,
    change24h,
    volume24h: candle.volume,
    high24h: candle.high,
    low24h: candle.low,
  };
}

function applySlippage(
  referencePrice: number,
  action: "BUY" | "SELL",
  slippageBps: number
): number {
  const slippage = slippageBps / 10_000;
  return referencePrice * (action === "BUY" ? 1 + slippage : 1 - slippage);
}

function getStopOrTargetFill(
  candle: CandlePoint,
  position: OpenPosition
): { price: number; reason: "STOP_LOSS" | "TAKE_PROFIT" } | null {
  const { direction, stopPrice, takeProfitPrice } = position;
  const stopHit = direction === "LONG"
    ? candle.low <= stopPrice
    : candle.high >= stopPrice;
  const targetHit = direction === "LONG"
    ? candle.high >= takeProfitPrice
    : candle.low <= takeProfitPrice;

  if (stopHit) {
    const stopReference = direction === "LONG"
      ? Math.min(candle.open, stopPrice)
      : Math.max(candle.open, stopPrice);
    return {
      price: applySlippage(
        stopReference,
        direction === "LONG" ? "SELL" : "BUY",
        0
      ),
      reason: "STOP_LOSS",
    };
  }

  if (targetHit) {
    const targetReference = direction === "LONG"
      ? Math.max(candle.open, takeProfitPrice)
      : Math.min(candle.open, takeProfitPrice);
    return {
      price: targetReference,
      reason: "TAKE_PROFIT",
    };
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BacktestRequest;
    const requestedStrategy = payload.strategy;
    const symbol = payload.symbol ?? requestedStrategy?.symbol;
    const days = payload.days ?? 30;
    const initialBalance = payload.initialBalance ?? 100_000;
    const feeBps = payload.feeBps ?? 10;
    const slippageBps = payload.slippageBps ?? 5;
    if (!requestedStrategy || !symbol) {
      return Response.json(
        { error: "Strategy and symbol are required." },
        { status: 400 }
      );
    }

    const savedStrategies = await getStoredStrategies();
    const strategy = savedStrategies.find(
      (item) => item.id === requestedStrategy.id
    );

    if (
      !strategy ||
      getStrategySignature(strategy) !== getStrategySignature(requestedStrategy)
    ) {
      return Response.json(
        { error: "Save the current strategy version before running its backtest." },
        { status: 409 }
      );
    }

    if (symbol !== strategy.symbol) {
      return Response.json(
        { error: "Backtest market must match the saved strategy market." },
        { status: 400 }
      );
    }

    const timeframe = strategy.timeframe;

    if (!Number.isInteger(days) || days < 1 || days > 180) {
      return Response.json(
        { error: "Lookback days must be an integer between 1 and 180." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
      return Response.json(
        { error: "Initial balance must be greater than zero." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1_000) {
      return Response.json(
        { error: "Fee must be between 0 and 1,000 basis points." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 1_000) {
      return Response.json(
        { error: "Slippage must be between 0 and 1,000 basis points." },
        { status: 400 }
      );
    }

    if (!isChartRange(timeframe)) {
      return Response.json(
        { error: "The strategy timeframe is not supported for backtesting." },
        { status: 400 }
      );
    }

    if (
      strategy.stopLoss <= 0 ||
      strategy.takeProfit <= 0 ||
      strategy.positionSize <= 0 ||
      strategy.riskPerTrade <= 0 ||
      strategy.riskPerTrade > 100
    ) {
      return Response.json(
        { error: "Strategy risk, stop-loss, take-profit, and position-size settings must be valid." },
        { status: 400 }
      );
    }

    const candles = await fetchHistoricalCandles(symbol, timeframe, days);

    if (candles.length < 3) {
      return Response.json(
        { error: "Not enough historical candles are available for this backtest." },
        { status: 422 }
      );
    }

    const activeStrategy = { ...strategy, status: "ACTIVE" as const };
    const feeRate = feeBps / 10_000;
    const intervalMilliseconds = getIntervalMilliseconds(timeframe);
    const candlesPerDay = Math.max(
      1,
      Math.floor(86_400_000 / intervalMilliseconds)
    );
    let cash = initialBalance;
    let position: OpenPosition | null = null;
    let totalTrades = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let feesPaid = 0;
    let maxDrawdown = 0;
    let peakEquity = initialBalance;
    const equityCurve: number[] = [];
    const trades: BacktestResult["trades"] = [];

    const closePosition = (
      fillPrice: number,
      timestamp: string,
      exitReason: BacktestResult["trades"][number]["exitReason"]
    ) => {
      if (!position) {
        return;
      }

      const exitAction = position.direction === "LONG" ? "SELL" : "BUY";
      const exitPrice = applySlippage(fillPrice, exitAction, slippageBps);
      const exitFee = position.quantity * exitPrice * feeRate;
      const grossPnl = position.direction === "LONG"
        ? (exitPrice - position.entryPrice) * position.quantity
        : (position.entryPrice - exitPrice) * position.quantity;
      const netPnl = grossPnl - position.entryFee - exitFee;

      cash += position.margin + grossPnl - exitFee;
      feesPaid += exitFee;
      totalTrades += 1;

      if (netPnl >= 0) {
        winningTrades += 1;
      } else {
        losingTrades += 1;
      }

      trades.push({
        direction: position.direction,
        entryPrice: position.entryPrice,
        exitPrice,
        pnl: Number(netPnl.toFixed(2)),
        entryFee: Number(position.entryFee.toFixed(2)),
        exitFee: Number(exitFee.toFixed(2)),
        exitReason,
        entryTimestamp: position.entryTimestamp,
        timestamp,
      });
      position = null;
    };

    for (let index = 1; index < candles.length; index += 1) {
      const candle = candles[index];

      if (position) {
        const stopOrTarget = getStopOrTargetFill(candle, position);

        if (stopOrTarget) {
          closePosition(
            stopOrTarget.price,
            candle.time,
            stopOrTarget.reason
          );
        } else {
          const oppositeSignal = evaluateCustomStrategy(
            activeStrategy,
            makeAsset(
              symbol,
              candles[index - 1],
              candles[Math.max(0, index - 1 - candlesPerDay)]?.close
            ),
            candles.slice(Math.max(0, index - 100), index)
          );
          const shouldExit = position.direction === "LONG"
            ? oppositeSignal.signal === "SELL"
            : oppositeSignal.signal === "BUY";

          if (shouldExit) {
            closePosition(candle.open, candle.time, "SIGNAL");
          }
        }
      }

      if (!position) {
        const previousCandle = candles[index - 1];
        const history = candles.slice(Math.max(0, index - 100), index);
        const previousDayCandle =
          candles[Math.max(0, index - 1 - candlesPerDay)];
        const signal = evaluateCustomStrategy(
          activeStrategy,
          makeAsset(symbol, previousCandle, previousDayCandle?.close),
          history
        );

        if (signal.signal === "BUY" || signal.signal === "SELL") {
          const direction = signal.signal === "BUY" ? "LONG" : "SHORT";
          const entryAction = direction === "LONG" ? "BUY" : "SELL";
          const entryPrice = applySlippage(candle.open, entryAction, slippageBps);
          const equity = cash;
          const riskAmount = equity * (strategy.riskPerTrade / 100);
          const stopDistance = entryPrice * (strategy.stopLoss / 100);
          const quantityByRisk = riskAmount / stopDistance;
          const quantityBySize = strategy.positionSize / entryPrice;
          const quantityByCash = cash / (entryPrice * (1 + feeRate));
          const quantity = Math.min(
            quantityByRisk,
            quantityBySize,
            quantityByCash
          );
          const margin = quantity * entryPrice;
          const entryFee = margin * feeRate;

          if (Number.isFinite(quantity) && quantity > 0 && margin + entryFee <= cash) {
            cash -= margin + entryFee;
            feesPaid += entryFee;
            position = {
              direction,
              quantity,
              entryPrice,
              entryFee,
              margin,
              entryTimestamp: candle.time,
              stopPrice: direction === "LONG"
                ? entryPrice * (1 - strategy.stopLoss / 100)
                : entryPrice * (1 + strategy.stopLoss / 100),
              takeProfitPrice: direction === "LONG"
                ? entryPrice * (1 + strategy.takeProfit / 100)
                : entryPrice * (1 - strategy.takeProfit / 100),
            };

            const sameCandleExit = getStopOrTargetFill(candle, position);
            if (sameCandleExit) {
              closePosition(
                sameCandleExit.price,
                candle.time,
                sameCandleExit.reason
              );
            }
          }
        }
      }

      const unrealizedPnl = position
        ? (position.direction === "LONG"
            ? candle.close - position.entryPrice
            : position.entryPrice - candle.close) * position.quantity
        : 0;
      const equity = cash + (position?.margin ?? 0) + unrealizedPnl;
      equityCurve.push(Number(equity.toFixed(2)));
      peakEquity = Math.max(peakEquity, equity);
      maxDrawdown = Math.max(
        maxDrawdown,
        ((peakEquity - equity) / peakEquity) * 100
      );
    }

    if (position) {
      closePosition(
        candles[candles.length - 1].close,
        candles[candles.length - 1].time,
        "END_OF_TEST"
      );
      equityCurve[equityCurve.length - 1] = Number(cash.toFixed(2));
      maxDrawdown = Math.max(
        maxDrawdown,
        ((peakEquity - cash) / peakEquity) * 100
      );
    }

    const netProfit = cash - initialBalance;
    const totalReturn = (netProfit / initialBalance) * 100;
    const winRate = totalTrades > 0
      ? (winningTrades / totalTrades) * 100
      : 0;
    const eligibleForPaperReview =
      netProfit > 0 && totalTrades >= 5 && maxDrawdown < 100;
    const reviewEligibilityReason = eligibleForPaperReview
      ? "Positive net return, at least five completed trades, and no total-equity wipeout. Manual review is still required."
      : netProfit <= 0
        ? "Net return must be positive before this run can be approved for paper trading."
        : totalTrades < 5
          ? "At least five completed trades are required before paper review."
          : "Drawdown reached 100%; this run is not eligible for paper approval.";
    const result: BacktestResult = {
      runId: randomUUID(),
      strategyId: strategy.id,
      strategyName: strategy.name,
      symbol,
      timeframe,
      initialBalance,
      feeBps,
      slippageBps,
      executionAssumptions: [
        "Signals use completed candle data and enter at the next candle open.",
        "Market orders include adverse slippage and fees on entry and exit.",
        "Position size is capped by strategy size, available cash, and risk-per-trade divided by stop distance.",
        "Only one simultaneous position is modeled; maxPositions above one is not simulated.",
        "Stop loss and take profit are evaluated against candle high/low; if both trigger in one candle, stop loss is assumed first.",
        "Short positions are simulated as margin-backed paper positions; funding, borrow costs, partial fills, and exchange filters are not modeled.",
      ],
      from: candles[0].time,
      to: candles[candles.length - 1].time,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: Number(winRate.toFixed(2)),
      netProfit: Number(netProfit.toFixed(2)),
      totalReturn: Number(totalReturn.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      feesPaid: Number(feesPaid.toFixed(2)),
      eligibleForPaperReview,
      reviewEligibilityReason,
      equityCurve,
      trades,
    };

    await saveBacktestRun(strategy, result);
    return Response.json(result);
  } catch (error) {
    console.error("Backtest failed:", error);
    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Backtest failed to evaluate the strategy.",
      },
      { status: 502 }
    );
  }
}
