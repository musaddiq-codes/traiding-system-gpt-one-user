"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import type { CandlePoint } from "../lib/market-data";

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
    strategyId: string,
    candles?: CandlePoint[]
  ) => void;

  closePosition: (
    positionId: string
  ) => void;

  addStrategy: (
    strategy: Strategy
  ) => Promise<void>;

  updateStrategyStatus: (
    strategyId: string,
    status: Strategy["status"]
  ) => void;

  deleteStrategy: (
    strategyId: string
  ) => void;

  approveStrategyForPaper: (
    strategyId: string,
    backtestRunId: string,
    reviewNotes: string
  ) => Promise<Strategy>;
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

  const marketRefreshRef = useRef<Promise<void> | null>(null);

  const refreshMarketData = useCallback(async () => {
    if (marketRefreshRef.current) {
      return marketRefreshRef.current;
    }

    marketRefreshRef.current = (async () => {
      try {
        const response = await fetch("/api/market", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Market refresh failed");
        }

        const payload = await response.json();

        if (Array.isArray(payload.assets) && payload.assets.length > 0) {
          setAssets(payload.assets);
        }
      } catch {
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
      }
    })();

    try {
      await marketRefreshRef.current;
    } finally {
      marketRefreshRef.current = null;
    }
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
    const controller = new AbortController();

    async function loadInitialData() {
      try {
        const [marketResponse, strategyResponse] = await Promise.all([
          fetch("/api/market", {
            signal: controller.signal,
          }),
          fetch("/api/strategies", {
            signal: controller.signal,
          }),
        ]);

        if (!controller.signal.aborted) {
          const [marketData, strategyData] = await Promise.all([
            marketResponse.ok
              ? marketResponse.json()
              : { assets: mockAssets },
            strategyResponse.ok
              ? strategyResponse.json()
              : { strategies: mockStrategies },
          ]);

          if (Array.isArray(marketData.assets) && marketData.assets.length > 0) {
            setAssets(marketData.assets);
          }

          if (Array.isArray(strategyData.strategies) && strategyData.strategies.length > 0) {
            setStrategies(strategyData.strategies);
          }
        }
      } catch {
        // Fall back to mock data when API is unavailable.
      }
    }

    loadInitialData();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const streams = [
      "btcusdt@miniTicker",
      "ethusdt@miniTicker",
      "solusdt@miniTicker",
      "bnbusdt@miniTicker",
      "xrpusdt@miniTicker",
    ];

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const connect = () => {
      try {
        socket = new WebSocket(
          `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`
        );

        socket.onopen = () => {
          console.log("Binance websocket connected");
        };

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as {
              data?: {
                s?: string;
                c?: string;
                P?: string;
                h?: string;
                l?: string;
                q?: string;
              };
            };

            const ticker = payload?.data;
            const symbol = ticker?.s;

            if (!symbol) {
              return;
            }

            const normalizedSymbol = `${symbol.slice(0, -4)}/USDT`;
            const price = Number(ticker.c ?? 0);
            const change24h = Number(ticker.P ?? 0);
            const high24h = Number(ticker.h ?? 0);
            const low24h = Number(ticker.l ?? 0);
            const volume24h = Number(ticker.q ?? 0);

            setAssets((currentAssets) =>
              currentAssets.map((asset) => {
                if (asset.symbol !== normalizedSymbol) {
                  return asset;
                }

                return {
                  ...asset,
                  price: Number(price.toFixed(4)),
                  change24h: Number(change24h.toFixed(2)),
                  high24h: Number(high24h.toFixed(4)),
                  low24h: Number(low24h.toFixed(4)),
                  volume24h: Number(volume24h.toFixed(2)),
                };
              })
            );
          } catch {
            // Ignore malformed websocket payloads.
          }
        };

        socket.onerror = () => {
          if (reconnectTimer) {
            window.clearTimeout(reconnectTimer);
          }

          reconnectTimer = window.setTimeout(() => {
            connect();
          }, 5000);
        };

        socket.onclose = () => {
          if (reconnectTimer) {
            window.clearTimeout(reconnectTimer);
          }

          reconnectTimer = window.setTimeout(() => {
            connect();
          }, 5000);
        };
      } catch {
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
        }

        reconnectTimer = window.setTimeout(() => {
          connect();
        }, 5000);
      }
    };

    connect();

    return () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }

      if (socket) {
        socket.close();
      }
    };
  }, []);

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
    (strategyId: string, candles?: CandlePoint[]) => {
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
          asset,
          candles
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

  const persistStrategy = useCallback(
    async (strategy: Strategy) => {
      const response = await fetch("/api/strategies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(strategy),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "Unable to save strategy.");
      }
    },
    []
  );

  const addStrategy = useCallback(
    async (strategy: Strategy) => {
      await persistStrategy(strategy);
      setStrategies((current) => [
        strategy,
        ...current,
      ]);
    },
    [persistStrategy]
  );

  const updateStrategyStatus =
    useCallback(
      (
        strategyId: string,
        status: Strategy["status"]
      ) => {
        const selectedStrategy = strategies.find(
          (strategy) => strategy.id === strategyId
        );

        if (
          status === "ACTIVE" &&
          !selectedStrategy?.paperApprovedBacktestId
        ) {
          console.warn(
            "Run and approve an eligible backtest before activating paper trading."
          );
          return;
        }

        let updatedStrategy: Strategy | null = null;

        setStrategies((current) =>
          current.map((strategy) => {
            if (strategy.id !== strategyId) {
              return strategy;
            }

            updatedStrategy = {
              ...strategy,
              status,
              updatedAt:
                new Date().toISOString(),
            };

            return updatedStrategy;
          })
        );

        if (updatedStrategy) {
          void fetch("/api/strategies", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(updatedStrategy),
          });
        }
      },
      [strategies]
    );

  const deleteStrategy = useCallback(
    (strategyId: string) => {
      setStrategies((current) =>
        current.filter(
          (strategy) =>
            strategy.id !== strategyId
        )
      );

      void fetch(`/api/strategies?id=${encodeURIComponent(strategyId)}`, {
        method: "DELETE",
      });
    },
    []
  );

  const approveStrategyForPaper = useCallback(
    async (
      strategyId: string,
      backtestRunId: string,
      reviewNotes: string
    ) => {
      const response = await fetch("/api/backtest/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: backtestRunId,
          confirmPaperApproval: true,
          notes: reviewNotes,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Strategy review failed.");
      }

      const approvedStrategy = payload.strategy as Strategy;

      if (approvedStrategy.id !== strategyId) {
        throw new Error("Approved strategy did not match the selected strategy.");
      }

      setStrategies((current) =>
        current.map((strategy) =>
          strategy.id === strategyId
            ? approvedStrategy
            : strategy
        )
      );
      return approvedStrategy;
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

      approveStrategyForPaper,
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

      approveStrategyForPaper,
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