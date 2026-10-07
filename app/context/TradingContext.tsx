"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  Account,
  Asset,
  Position,
  Side,
  Strategy,
  Trade,
  TradingState,
} from "../lib/trading-types";

import {
  calculatePositionPnl,
  calculatePositionPnlPercent,
  calculateTotalUnrealizedPnl,
  evaluateStrategy,
} from "../lib/trading-utils";

import {
  mockAccount,
  mockAssets,
  mockPositions,
  mockStrategies,
  mockTrades,
} from "../lib/mock-data";

interface TradingContextType extends TradingState {
  selectedSymbol: string;

  setSelectedSymbol: React.Dispatch<
    React.SetStateAction<string>
  >;

  refreshMarketData: () => void;

  openPaperPosition: (
    symbol: string,
    side: Side,
    quantity: number,
    strategyId?: string
  ) => void;

  executeStrategySignal: (
    strategyId: string
  ) => void;

  closePosition: (
    positionId: string
  ) => void;

  addStrategy: (
    strategy: Strategy
  ) => void;

  updateStrategyStatus: (
    strategyId: string,
    status: Strategy["status"]
  ) => void;

  deleteStrategy: (
    strategyId: string
  ) => void;
}

const TradingContext =
  createContext<TradingContextType | undefined>(
    undefined
  );

export function TradingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [account, setAccount] =
    useState<Account>(mockAccount);

  const [assets, setAssets] =
    useState<Asset[]>(mockAssets);

  const [positions, setPositions] =
    useState<Position[]>(mockPositions);

  const [trades, setTrades] =
    useState<Trade[]>(mockTrades);

  const [strategies, setStrategies] =
    useState<Strategy[]>(mockStrategies);

  const [
    selectedSymbol,
    setSelectedSymbol,
  ] = useState<string>("BTC/USDT");

  /*
   * =========================================================
   * MARKET SIMULATION
   * =========================================================
   */

  const refreshMarketData = useCallback(() => {
    setAssets((currentAssets) =>
      currentAssets.map((asset) => {
        let volatility = 0.005;

        if (asset.symbol === "BTC/USDT") {
          volatility = 0.002;
        } else if (
          asset.symbol === "ETH/USDT"
        ) {
          volatility = 0.003;
        }

        const movement =
          (Math.random() - 0.5) *
          volatility *
          2;

        const newPrice =
          asset.price * (1 + movement);

        const newChange =
          asset.change24h +
          movement * 100;

        return {
          ...asset,
          price: Number(
            newPrice.toFixed(4)
          ),
          change24h: Number(
            newChange.toFixed(2)
          ),
        };
      })
    );
  }, []);

  /*
   * =========================================================
   * UPDATE OPEN POSITIONS FROM MARKET PRICES
   * =========================================================
   */

  useEffect(() => {
    if (assets.length === 0) {
      return;
    }

    setPositions((currentPositions) =>
      currentPositions.map((position) => {
        const asset = assets.find(
          (item) =>
            item.symbol === position.symbol
        );

        if (!asset) {
          return position;
        }

        const updatedPosition: Position = {
          ...position,
          currentPrice: asset.price,
        };

        const unrealizedPnl =
          calculatePositionPnl(
            updatedPosition
          );

        const unrealizedPnlPercent =
          calculatePositionPnlPercent(
            updatedPosition
          );

        return {
          ...updatedPosition,
          unrealizedPnl: Number(
            unrealizedPnl.toFixed(2)
          ),
          unrealizedPnlPercent: Number(
            unrealizedPnlPercent.toFixed(2)
          ),
        };
      })
    );
  }, [assets]);

  /*
   * =========================================================
   * ACCOUNT CALCULATIONS
   * =========================================================
   *
   * balance:
   *   Cash balance after realized P&L.
   *
   * equity:
   *   Balance + unrealized P&L.
   *
   * availableBalance:
   *   Balance - used margin.
   */

  useEffect(() => {
    const totalUnrealizedPnl =
      calculateTotalUnrealizedPnl(
        positions
      );

    setAccount((currentAccount) => {
      const equity =
        currentAccount.balance +
        totalUnrealizedPnl;

      const availableBalance =
        currentAccount.balance -
        currentAccount.usedMargin;

      const totalPnl =
        currentAccount.realizedPnl +
        totalUnrealizedPnl;

      return {
        ...currentAccount,

        equity: Number(
          equity.toFixed(2)
        ),

        availableBalance: Number(
          Math.max(
            0,
            availableBalance
          ).toFixed(2)
        ),

        unrealizedPnl: Number(
          totalUnrealizedPnl.toFixed(2)
        ),

        totalPnl: Number(
          totalPnl.toFixed(2)
        ),
      };
    });
  }, [positions]);

  /*
   * =========================================================
   * AUTOMATIC MARKET TICK
   * =========================================================
   */

  useEffect(() => {
    const interval = setInterval(() => {
      refreshMarketData();
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [refreshMarketData]);

  /*
   * =========================================================
   * OPEN PAPER POSITION
   * =========================================================
   */

  const openPaperPosition = useCallback(
    (
      symbol: string,
      side: Side,
      quantity: number,
      strategyId = "manual"
    ) => {
      if (
        !symbol ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        console.log(
          "Invalid paper order quantity."
        );

        return;
      }

      const asset = assets.find(
        (item) =>
          item.symbol === symbol
      );

      if (!asset) {
        console.log(
          "Asset not found:",
          symbol
        );

        return;
      }

      /*
       * Current paper-trading version uses
       * 1x leverage.
       *
       * We can add configurable leverage
       * later when the risk engine is built.
       */

      const leverage = 1;

      const positionValue =
        asset.price * quantity;

      const margin =
        positionValue / leverage;

      if (
        margin >
        account.availableBalance
      ) {
        console.log(
          "Insufficient available balance."
        );

        return;
      }

      const now =
        new Date().toISOString();

      const timestamp =
        Date.now();

      const positionId =
        `position-${timestamp}`;

      const tradeId =
        `trade-${timestamp}`;

      const newPosition: Position = {
        id: positionId,

        strategyId,

        symbol: asset.symbol,

        name: asset.name,

        side,

        quantity,

        entryPrice: asset.price,

        currentPrice: asset.price,

        leverage,

        margin,

        unrealizedPnl: 0,

        unrealizedPnlPercent: 0,

        status: "OPEN",

        openedAt: now,
      };

      const orderSide =
        side === "LONG"
          ? "BUY"
          : "SELL";

      const newTrade: Trade = {
        id: tradeId,

        strategyId:
          strategyId === "manual"
            ? undefined
            : strategyId,

        symbol: asset.symbol,

        side: orderSide,

        quantity,

        price: asset.price,

        value: positionValue,

        fee: 0,

        realizedPnl: 0,

        status: "FILLED",

        executedAt: now,
      };

      setPositions((current) => [
        newPosition,
        ...current,
      ]);

      setTrades((current) => [
        newTrade,
        ...current,
      ]);

      setAccount((current) => ({
        ...current,

        availableBalance: Number(
          (
            current.availableBalance -
            margin
          ).toFixed(2)
        ),

        usedMargin: Number(
          (
            current.usedMargin +
            margin
          ).toFixed(2)
        ),
      }));

      console.log(
        "Paper position opened:",
        newPosition
      );
    },
    [account.availableBalance, assets]
  );

  /*
   * =========================================================
   * EXECUTE STRATEGY SIGNAL
   * =========================================================
   */

  const executeStrategySignal = useCallback(
    (strategyId: string) => {
      console.log(
        "Executing strategy:",
        strategyId
      );

      const strategy =
        strategies.find(
          (item) =>
            item.id === strategyId
        );

      if (!strategy) {
        console.log(
          "Strategy not found:",
          strategyId
        );

        return;
      }

      if (
        strategy.status !== "ACTIVE"
      ) {
        console.log(
          "Strategy is not active."
        );

        return;
      }

      const asset = assets.find(
        (item) =>
          item.symbol ===
          strategy.symbol
      );

      if (!asset) {
        console.log(
          "Asset not found:",
          strategy.symbol
        );

        return;
      }

      const evaluation =
        evaluateStrategy(
          strategy,
          asset
        );

      console.log(
        "Strategy evaluation:",
        evaluation
      );

      if (
        evaluation.signal === "HOLD"
      ) {
        console.log(
          "Signal is HOLD. No order executed."
        );

        return;
      }

      const existingStrategyPositions =
        positions.filter(
          (position) =>
            position.strategyId ===
              strategy.id &&
            position.status === "OPEN"
        );

      if (
        existingStrategyPositions.length >=
        strategy.maxPositions
      ) {
        console.log(
          "Maximum positions reached for strategy:",
          strategy.name
        );

        return;
      }

      const quantity =
        strategy.positionSize /
        asset.price;

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        console.log(
          "Invalid quantity:",
          quantity
        );

        return;
      }

      const side: Side =
        evaluation.signal === "BUY"
          ? "LONG"
          : "SHORT";

      console.log(
        "Opening paper position:",
        {
          strategyId: strategy.id,
          strategyName:
            strategy.name,
          symbol: asset.symbol,
          side,
          quantity,
          signal:
            evaluation.signal,
          reason:
            evaluation.reason,
        }
      );

      openPaperPosition(
        asset.symbol,
        side,
        Number(
          quantity.toFixed(8)
        ),
        strategy.id
      );
    },
    [
      strategies,
      assets,
      positions,
      openPaperPosition,
    ]
  );

  /*
   * =========================================================
   * CLOSE PAPER POSITION
   * =========================================================
   */

  const closePosition = useCallback(
    (positionId: string) => {
      const position =
        positions.find(
          (item) =>
            item.id === positionId
        );

      if (!position) {
        console.log(
          "Position not found:",
          positionId
        );

        return;
      }

      if (position.status !== "OPEN") {
        console.log(
          "Position is already closed."
        );

        return;
      }

      const realizedPnl =
        calculatePositionPnl(
          position
        );

      const positionValue =
        position.currentPrice *
        position.quantity;

      const closingSide =
        position.side === "LONG"
          ? "SELL"
          : "BUY";

      const now =
        new Date().toISOString();

      const closingTrade: Trade = {
        id:
          `trade-${Date.now()}`,

        strategyId:
          position.strategyId ===
          "manual"
            ? undefined
            : position.strategyId,

        symbol:
          position.symbol,

        side:
          closingSide,

        quantity:
          position.quantity,

        price:
          position.currentPrice,

        value:
          positionValue,

        fee:
          0,

        realizedPnl:
          Number(
            realizedPnl.toFixed(2)
          ),

        status:
          "FILLED",

        executedAt:
          now,
      };

      setTrades((current) => [
        closingTrade,
        ...current,
      ]);

      setPositions((current) =>
        current.filter(
          (item) =>
            item.id !== positionId
        )
      );

      setAccount((current) => {
        const newBalance =
          current.balance +
          realizedPnl;

        const newUsedMargin =
          Math.max(
            0,
            current.usedMargin -
              position.margin
          );

        const newAvailableBalance =
          newBalance -
          newUsedMargin;

        const newRealizedPnl =
          current.realizedPnl +
          realizedPnl;

        return {
          ...current,

          balance: Number(
            newBalance.toFixed(2)
          ),

          availableBalance:
            Number(
              Math.max(
                0,
                newAvailableBalance
              ).toFixed(2)
            ),

          usedMargin:
            Number(
              newUsedMargin.toFixed(2)
            ),

          realizedPnl:
            Number(
              newRealizedPnl.toFixed(2)
            ),
        };
      });

      console.log(
        "Paper position closed:",
        positionId,
        "Realized P&L:",
        realizedPnl
      );
    },
    [positions]
  );

  /*
   * =========================================================
   * STRATEGY MANAGEMENT
   * =========================================================
   */

  const addStrategy = useCallback(
    (strategy: Strategy) => {
      setStrategies((current) => [
        strategy,
        ...current,
      ]);
    },
    []
  );

  const updateStrategyStatus =
    useCallback(
      (
        strategyId: string,
        status: Strategy["status"]
      ) => {
        setStrategies((current) =>
          current.map((strategy) =>
            strategy.id === strategyId
              ? {
                  ...strategy,
                  status,
                  updatedAt:
                    new Date().toISOString(),
                }
              : strategy
          )
        );
      },
      []
    );

  const deleteStrategy = useCallback(
    (strategyId: string) => {
      setStrategies((current) =>
        current.filter(
          (strategy) =>
            strategy.id !== strategyId
        )
      );
    },
    []
  );

  /*
   * =========================================================
   * CONTEXT VALUE
   * =========================================================
   */

  const value = useMemo(
    () => ({
      account,

      assets,

      positions,

      trades,

      strategies,

      selectedSymbol,

      setSelectedSymbol,

      refreshMarketData,

      openPaperPosition,

      executeStrategySignal,

      closePosition,

      addStrategy,

      updateStrategyStatus,

      deleteStrategy,
    }),
    [
      account,
      assets,
      positions,
      trades,
      strategies,
      selectedSymbol,
      refreshMarketData,
      openPaperPosition,
      executeStrategySignal,
      closePosition,
      addStrategy,
      updateStrategyStatus,
      deleteStrategy,
    ]
  );

  return (
    <TradingContext.Provider
      value={value}
    >
      {children}
    </TradingContext.Provider>
  );
}

/*
 * =========================================================
 * useTrading HOOK
 * =========================================================
 */

export function useTrading() {
  const context =
    useContext(TradingContext);

  if (!context) {
    throw new Error(
      "useTrading must be used inside TradingProvider"
    );
  }

  return context;
}