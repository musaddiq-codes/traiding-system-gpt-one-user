import {
  getBacktestRun,
  getStrategySignature,
  markBacktestRunReviewed,
} from "../../../lib/backtest-storage";
import {
  getStoredStrategies,
  saveStoredStrategy,
} from "../../../lib/storage";

interface ReviewRequest {
  runId: string;
  confirmPaperApproval: boolean;
  notes?: string;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ReviewRequest;

    if (!payload.runId || payload.confirmPaperApproval !== true) {
      return Response.json(
        { error: "A backtest run and explicit paper-approval confirmation are required." },
        { status: 400 }
      );
    }

    if (payload.notes && payload.notes.length > 2_000) {
      return Response.json(
        { error: "Review notes cannot exceed 2,000 characters." },
        { status: 400 }
      );
    }

    const run = await getBacktestRun(payload.runId);

    if (!run) {
      return Response.json(
        { error: "Backtest run was not found. Run the backtest again before review." },
        { status: 404 }
      );
    }

    if (!run.result.eligibleForPaperReview) {
      return Response.json(
        { error: run.result.reviewEligibilityReason },
        { status: 422 }
      );
    }

    const strategies = await getStoredStrategies();
    const strategy = strategies.find((item) => item.id === run.strategyId);

    if (!strategy) {
      return Response.json(
        { error: "The strategy associated with this backtest no longer exists." },
        { status: 404 }
      );
    }

    if (getStrategySignature(strategy) !== run.strategySignature) {
      return Response.json(
        { error: "The strategy has changed since this backtest. Run a new backtest before approving it." },
        { status: 409 }
      );
    }

    const approvedAt = new Date().toISOString();
    const approvedStrategy = {
      ...strategy,
      status: "ACTIVE" as const,
      paperApprovedBacktestId: run.id,
      paperApprovedAt: approvedAt,
      updatedAt: approvedAt,
    };

    await saveStoredStrategy(approvedStrategy);
    await markBacktestRunReviewed(run.id, payload.notes?.trim() ?? "");

    return Response.json({
      strategy: approvedStrategy,
      reviewedAt: approvedAt,
    });
  } catch (error) {
    console.error("Backtest review failed:", error);
    return Response.json(
      { error: "Unable to approve this strategy for paper trading." },
      { status: 500 }
    );
  }
}
