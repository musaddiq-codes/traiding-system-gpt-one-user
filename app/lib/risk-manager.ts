import type {
  Account,
  Asset,
  Position,
  Strategy,
} from "./trading-types";

export type RiskCheckStatus =
  | "APPROVED"
  | "REJECTED";

export interface RiskCheckResult {
  status: RiskCheckStatus;
  reason: string;

  quantity: number;
  positionValue: number;
  margin: number;
  riskAmount: number;
}

export function checkStrategyRisk(
  strategy: Strategy,
  asset: Asset,
  account: Account,
  positions: Position[]
): RiskCheckResult {
  /*
   * ---------------------------------------------------------
   * Basic validation
   * ---------------------------------------------------------
   */

  if (strategy.status !== "ACTIVE") {
    return rejected("Strategy is not active.");
  }

  if (strategy.symbol !== asset.symbol) {
    return rejected(
      "Strategy symbol does not match market."
    );
  }

  if (asset.price <= 0) {
    return rejected(
      "Market price is invalid."
    );
  }

  if (strategy.positionSize <= 0) {
    return rejected(
      "Strategy position size must be greater than zero."
    );
  }

  if (strategy.riskPerTrade <= 0) {
    return rejected(
      "Risk per trade must be greater than zero."
    );
  }

  /*
   * ---------------------------------------------------------
   * Maximum positions
   * ---------------------------------------------------------
   */

  const symbolPositions =
    positions.filter(
      (position) =>
        position.symbol === strategy.symbol &&
        position.status === "OPEN"
    );

  if (
    symbolPositions.length >=
    strategy.maxPositions
  ) {
    return rejected(
      `Maximum positions reached for ${strategy.symbol}.`
    );
  }

  /*
   * ---------------------------------------------------------
   * Risk amount
   *
   * Example:
   * Equity = $100,000
   * Risk per trade = 1%
   *
   * Maximum planned loss = $1,000
   * ---------------------------------------------------------
   */

  const riskAmount =
    account.equity *
    (strategy.riskPerTrade / 100);

  /*
   * ---------------------------------------------------------
   * Stop-loss based position sizing
   *
   * Example:
   * Risk = $1,000
   * Stop loss = 2%
   *
   * Position value = $50,000
   *
   * Because:
   * $50,000 × 2% = $1,000
   * ---------------------------------------------------------
   */

  const stopLossPercent =
    strategy.stopLoss / 100;

  let riskBasedPositionValue =
    strategy.positionSize;

  if (stopLossPercent > 0) {
    riskBasedPositionValue =
      riskAmount /
      stopLossPercent;
  }

  /*
   * Never exceed the strategy's configured
   * position size.
   */

  const approvedPositionValue =
    Math.min(
      strategy.positionSize,
      riskBasedPositionValue
    );

  if (approvedPositionValue <= 0) {
    return rejected(
      "Calculated position size is invalid."
    );
  }

  /*
   * ---------------------------------------------------------
   * Available balance check
   * ---------------------------------------------------------
   */

  if (
    account.availableBalance <= 0
  ) {
    return rejected(
      "Insufficient available balance."
    );
  }

  const finalPositionValue =
    Math.min(
      approvedPositionValue,
      account.availableBalance
    );

  if (finalPositionValue <= 0) {
    return rejected(
      "Position value exceeds available balance."
    );
  }

  /*
   * ---------------------------------------------------------
   * Quantity
   * ---------------------------------------------------------
   */

  const quantity =
    finalPositionValue /
    asset.price;

  /*
   * Current paper engine uses 1x leverage,
   * therefore margin equals position value.
   */

  const margin =
    finalPositionValue;

  return {
    status: "APPROVED",
    reason:
      "Trade passed all basic risk checks.",
    quantity: Number(
      quantity.toFixed(8)
    ),
    positionValue:
      finalPositionValue,
    margin,
    riskAmount,
  };
}

function rejected(
  reason: string
): RiskCheckResult {
  return {
    status: "REJECTED",
    reason,
    quantity: 0,
    positionValue: 0,
    margin: 0,
    riskAmount: 0,
  };
}