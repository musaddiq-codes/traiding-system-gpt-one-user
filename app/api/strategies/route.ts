import type { Strategy } from "../../lib/trading-types";
import {
  deleteStoredStrategy,
  getStoredStrategies,
  saveStoredStrategy,
} from "../../lib/storage";
import {
  getBacktestRun,
  getStrategySignature,
} from "../../lib/backtest-storage";

async function hasValidPaperApproval(strategy: Strategy): Promise<boolean> {
  if (!strategy.paperApprovedBacktestId) {
    return false;
  }

  const run = await getBacktestRun(strategy.paperApprovedBacktestId);

  return Boolean(
    run &&
    run.strategyId === strategy.id &&
    run.strategySignature === getStrategySignature(strategy) &&
    run.result.eligibleForPaperReview
  );
}

export async function GET() {
  const strategies = await getStoredStrategies();

  return Response.json({
    strategies,
    updatedAt: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  const strategy = (await request.json()) as Strategy;

  if (!strategy || !strategy.id) {
    return Response.json(
      { error: "A valid strategy payload is required." },
      { status: 400 }
    );
  }

  if (
    strategy.status === "ACTIVE" &&
    !(await hasValidPaperApproval(strategy))
  ) {
    return Response.json(
      { error: "Run and review an eligible backtest before activating a strategy for paper trading." },
      { status: 409 }
    );
  }

  const strategies = await saveStoredStrategy(
    strategy.status === "ACTIVE"
      ? strategy
      : {
          ...strategy,
          paperApprovedBacktestId: undefined,
          paperApprovedAt: undefined,
        }
  );

  return Response.json({
    strategy,
    strategies,
    updatedAt: new Date().toISOString(),
  });
}

export async function PUT(request: Request) {
  const strategy = (await request.json()) as Strategy;

  if (!strategy || !strategy.id) {
    return Response.json(
      { error: "A valid strategy payload is required." },
      { status: 400 }
    );
  }

  const currentStrategies = await getStoredStrategies();
  const previousStrategy = currentStrategies.find(
    (item) => item.id === strategy.id
  );
  const approvalIsCurrent =
    Boolean(strategy.paperApprovedBacktestId) &&
    previousStrategy !== undefined &&
    Boolean(previousStrategy.paperApprovedBacktestId) &&
    getStrategySignature(strategy) === getStrategySignature(previousStrategy) &&
    await hasValidPaperApproval(strategy);

  if (strategy.status === "ACTIVE" && !approvalIsCurrent) {
    return Response.json(
      { error: "Run and review an eligible backtest for this strategy version before activating paper trading." },
      { status: 409 }
    );
  }

  const savedStrategy = approvalIsCurrent
    ? strategy
    : {
        ...strategy,
        status: strategy.status === "ACTIVE" ? "DRAFT" as const : strategy.status,
        paperApprovedBacktestId: undefined,
        paperApprovedAt: undefined,
      };
  const strategies = await saveStoredStrategy(savedStrategy);

  return Response.json({
    strategy: savedStrategy,
    strategies,
    updatedAt: new Date().toISOString(),
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json(
      { error: "Strategy id is required." },
      { status: 400 }
    );
  }

  const strategies = await deleteStoredStrategy(id);

  return Response.json({
    strategies,
    deletedId: id,
    updatedAt: new Date().toISOString(),
  });
}
