import type {
  Asset,
  Position,
  Side,
  Strategy,
} from "./trading-types";
import type { CandlePoint } from "./market-data";

import {
  evaluateCustomStrategy,
} from "./strategy-engine";

export type StrategySignal =
  | "BUY"
  | "SELL"
  | "HOLD";

export interface StrategyEvaluation {
  strategyId: string;
  symbol: string;
  signal: StrategySignal;
  reason: string;
}

export function calculatePositionPnl(
  position: Position
): number {
  const priceDifference =
    position.currentPrice -
    position.entryPrice;

  if (position.side === "LONG") {
    return (
      priceDifference *
      position.quantity
    );
  }

  return (
    -priceDifference *
    position.quantity
  );
}

export function calculatePositionPnlPercent(
  position: Position
): number {
  if (position.entryPrice === 0) {
    return 0;
  }

  const pnl =
    calculatePositionPnl(position);

  return (
    (pnl /
      (position.entryPrice *
        position.quantity)) *
    100
  );
}

export function calculatePositionValue(
  position: Position
): number {
  return (
    position.currentPrice *
    position.quantity
  );
}

export function calculateTotalUnrealizedPnl(
  positions: Position[]
): number {
  return positions.reduce(
    (total, position) =>
      total +
      calculatePositionPnl(position),
    0
  );
}

export function findAsset(
  assets: Asset[],
  symbol: string
): Asset | undefined {
  return assets.find(
    (asset) =>
      asset.symbol === symbol
  );
}

export function formatCurrency(
  value: number,
  decimals = 2
): string {
  return new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits:
        decimals,
      maximumFractionDigits:
        decimals,
    }
  ).format(value);
}

export function formatNumber(
  value: number,
  decimals = 2
): string {
  return new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits:
        decimals,
      maximumFractionDigits:
        decimals,
    }
  ).format(value);
}

export function formatPercent(
  value: number,
  decimals = 2
): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(
    decimals
  )}%`;
}

export function isPositive(
  value: number
): boolean {
  return value >= 0;
}

/*
 * ---------------------------------------------------------
 * Strategy Engine Foundation
 * ---------------------------------------------------------
 *
 * This is intentionally a simple first version.
 *
 * It does NOT place orders.
 * It only evaluates the strategy against current
 * market information and produces a signal.
 *
 * Later this function will be replaced/extended with
 * real technical indicators and candle data.
 */

export function evaluateStrategy(
  strategy: Strategy,
  asset: Asset,
  candles?: CandlePoint[]
): StrategyEvaluation {
  const customDecision = evaluateCustomStrategy(
    strategy,
    asset,
    candles
  );

  if (customDecision.signal !== "HOLD") {
    return {
      strategyId: customDecision.strategyId,
      symbol: customDecision.symbol,
      signal: customDecision.signal,
      reason: customDecision.reason,
    };
  }

  if (strategy.status !== "ACTIVE") {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "HOLD",
      reason:
        "Strategy is not active.",
    };
  }

  if (
    strategy.symbol !==
    asset.symbol
  ) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "HOLD",
      reason:
        "Market does not match strategy.",
    };
  }

  if (asset.change24h > 1) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "BUY",
      reason:
        `Positive market momentum: ${asset.change24h.toFixed(
          2
        )}% over 24h.`,
    };
  }

  if (asset.change24h < -1) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "SELL",
      reason:
        `Negative market momentum: ${asset.change24h.toFixed(
          2
        )}% over 24h.`,
    };
  }

  return {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    signal: "HOLD",
    reason:
      "Market momentum is not strong enough.",
  };
}