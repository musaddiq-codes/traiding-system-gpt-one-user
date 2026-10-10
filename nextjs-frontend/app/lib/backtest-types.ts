export interface BacktestResult {
  runId: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  initialBalance: number;
  feeBps: number;
  slippageBps: number;
  executionAssumptions: string[];
  from: string;
  to: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netProfit: number;
  totalReturn: number;
  maxDrawdown: number;
  feesPaid: number;
  eligibleForPaperReview: boolean;
  reviewEligibilityReason: string;
  equityCurve: number[];
  trades: Array<{
    direction: "LONG" | "SHORT";
    entryTimestamp: string;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    entryFee: number;
    exitFee: number;
    exitReason: "SIGNAL" | "STOP_LOSS" | "TAKE_PROFIT" | "END_OF_TEST";
    timestamp: string;
  }>;
}

export interface StoredBacktestRun {
  id: string;
  strategyId: string;
  strategySignature: string;
  strategySnapshot: {
    id: string;
    name: string;
    description: string;
    type: string;
    symbol: string;
    timeframe: string;
    entryCondition: string;
    exitCondition: string;
    stopLoss: number;
    takeProfit: number;
    positionSize: number;
    riskPerTrade: number;
    maxPositions: number;
  };
  result: BacktestResult;
  createdAt: string;
  reviewedAt?: string;
  reviewNotes?: string;
}
