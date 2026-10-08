import fs from "fs/promises";
import path from "path";

import type {
  BacktestResult,
  StoredBacktestRun,
} from "./backtest-types";
import type { Strategy } from "./trading-types";

const DATA_DIR = path.join(process.cwd(), "data");
const BACKTESTS_FILE = path.join(DATA_DIR, "backtest-runs.json");

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

async function readRuns(): Promise<StoredBacktestRun[]> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(BACKTESTS_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("Stored backtest runs are not a list.");
    }

    return parsed as StoredBacktestRun[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.writeFile(BACKTESTS_FILE, "[]", "utf-8");
      return [];
    }

    throw error;
  }
}

async function writeRuns(runs: StoredBacktestRun[]): Promise<void> {
  await fs.writeFile(
    BACKTESTS_FILE,
    JSON.stringify(runs, null, 2),
    "utf-8"
  );
}

export async function saveBacktestRun(
  strategy: Strategy,
  result: BacktestResult
): Promise<StoredBacktestRun> {
  const runs = await readRuns();
  const run: StoredBacktestRun = {
    id: result.runId,
    strategyId: strategy.id,
    strategySignature: getStrategySignature(strategy),
    strategySnapshot: {
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
    },
    result,
    createdAt: new Date().toISOString(),
  };

  runs.unshift(run);
  await writeRuns(runs.slice(0, 500));
  return run;
}

export async function getBacktestRun(
  runId: string
): Promise<StoredBacktestRun | undefined> {
  const runs = await readRuns();
  return runs.find((run) => run.id === runId);
}

export async function markBacktestRunReviewed(
  runId: string,
  reviewNotes: string
): Promise<StoredBacktestRun | undefined> {
  const runs = await readRuns();
  const index = runs.findIndex((run) => run.id === runId);

  if (index < 0) {
    return undefined;
  }

  const reviewedRun = {
    ...runs[index],
    reviewedAt: new Date().toISOString(),
    reviewNotes,
  };
  runs[index] = reviewedRun;
  await writeRuns(runs);
  return reviewedRun;
}
