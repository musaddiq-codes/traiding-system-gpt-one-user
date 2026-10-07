import type {
  Asset,
  Strategy,
} from "./trading-types";

export type OrderType =
  | "MARKET"
  | "LIMIT";

export type OrderStatus =
  | "PENDING"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";

export interface Order {
  id: string;
  strategyId: string;

  symbol: string;

  side: "BUY" | "SELL";

  positionSide: "LONG" | "SHORT";

  type: OrderType;

  quantity: number;

  price: number;

  value: number;

  status: OrderStatus;

  createdAt: string;

  filledAt?: string;
}

export interface CreateOrderInput {
  strategy: Strategy;
  asset: Asset;

  side: "BUY" | "SELL";

  positionSide: "LONG" | "SHORT";

  quantity: number;

  type?: OrderType;

  price?: number;
}

export function createPaperOrder(
  input: CreateOrderInput
): Order {
  const {
    strategy,
    asset,
    side,
    positionSide,
    quantity,
    type = "MARKET",
    price,
  } = input;

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      "Order quantity must be greater than zero."
    );
  }

  if (asset.price <= 0) {
    throw new Error(
      "Asset price must be greater than zero."
    );
  }

  const orderPrice =
    price ?? asset.price;

  if (
    !Number.isFinite(orderPrice) ||
    orderPrice <= 0
  ) {
    throw new Error(
      "Order price must be greater than zero."
    );
  }

  const value =
    quantity * orderPrice;

  const now =
    new Date().toISOString();

  const orderId =
    `order-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  return {
    id: orderId,

    strategyId:
      strategy.id,

    symbol:
      asset.symbol,

    side,

    positionSide,

    type,

    quantity,

    price: orderPrice,

    value,

    status:
      type === "MARKET"
        ? "FILLED"
        : "PENDING",

    createdAt: now,

    ...(type === "MARKET"
      ? {
          filledAt: now,
        }
      : {}),
  };
}