import type {
  BacktestResult,
  StoredBacktestRun,
} from "./backtest-types";
import type { Strategy } from "./trading-types";

const BACKEND_URL = (
  process.env.BACKEND_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

export function getStrategySignature(strategy: Strategy): string {
  return JSON.stringify({
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    type: strategy.type,
    symbol: strategy.symbol,
    timeframe: strategy.timeframe,
    entryCondition: strategy.entryCondition,
    exitCondition: strategy.exitCondition,
    stopLoss: strategy.stopLoss,
    takeProfit: strategy.takeProfit,
    positionSize: strategy.positionSize,
    riskPerTrade: strategy.riskPerTrade,
    maxPositions: strategy.maxPositions,
  });
}

export async function saveBacktestRun(
  strategy: Strategy,
  result: BacktestResult
): Promise<StoredBacktestRun> {
  const response = await fetch(`${BACKEND_URL}/api/backtests/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy, result }),
  });
  if (!response.ok) {
    throw new Error(`Unable to store backtest result (${response.status}).`);
  }
  return response.json() as Promise<StoredBacktestRun>;
}

export async function getBacktestRun(
  runId: string
): Promise<StoredBacktestRun | undefined> {
  const response = await fetch(
    `${BACKEND_URL}/api/backtests/runs/${encodeURIComponent(runId)}`,
    { cache: "no-store" }
  );
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Unable to read backtest result (${response.status}).`);
  }
  return response.json() as Promise<StoredBacktestRun>;
}

export async function markBacktestRunReviewed(
  runId: string,
  reviewNotes: string
): Promise<StoredBacktestRun | undefined> {
  const response = await fetch(
    `${BACKEND_URL}/api/backtests/runs/${encodeURIComponent(runId)}/review?notes=${encodeURIComponent(reviewNotes)}`,
    { method: "PATCH" }
  );
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Unable to mark backtest as reviewed (${response.status}).`);
  }
  return response.json() as Promise<StoredBacktestRun>;
}
