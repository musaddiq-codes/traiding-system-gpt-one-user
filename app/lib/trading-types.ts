export type Side = "LONG" | "SHORT";

export type OrderSide = "BUY" | "SELL";

export type PositionStatus = "OPEN" | "CLOSED";

export type TradeStatus = "FILLED" | "PENDING" | "CANCELLED";

export type StrategyStatus = "ACTIVE" | "PAUSED" | "DRAFT";

export type StrategyType =
  | "Trend Following"
  | "Mean Reversion"
  | "Breakout"
  | "Scalping"
  | "Grid"
  | "Custom";

export interface Asset {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

export interface Position {
  id: string;
  strategyId?: string;
  symbol: string;
  name: string;
  side: Side;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  status: PositionStatus;
  openedAt: string;
}

export interface Trade {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  value: number;
  fee: number;
  realizedPnl: number;
  status: TradeStatus;
  executedAt: string;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  type: StrategyType;
  symbol: string;
  timeframe: string;
  status: StrategyStatus;

  entryCondition: string;
  exitCondition: string;

  stopLoss: number;
  takeProfit: number;

  positionSize: number;
  riskPerTrade: number;
  maxPositions: number;

  createdAt: string;
  updatedAt: string;
}

export interface Account {
  balance: number;
  equity: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
}

export interface TradingState {
  account: Account;
  assets: Asset[];
  positions: Position[];
  trades: Trade[];
  strategies: Strategy[];
}