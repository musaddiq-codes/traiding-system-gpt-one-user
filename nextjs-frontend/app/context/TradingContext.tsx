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
import { backendApiUrl } from "../lib/api";

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
  ) => Promise<void>;

  executeStrategySignal: (
    strategyId: string,
    candles?: CandlePoint[]
  ) => void;

  closePosition: (
    positionId: string
  ) => Promise<void>;

  addStrategy: (
    strategy: Strategy
  ) => Promise<void>;

  updateStrategyStatus: (
    strategyId: string,
    status: Strategy["status"]
  ) => Promise<void>;

  deleteStrategy: (
    strategyId: string
  ) => Promise<void>;

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

  const applyPortfolioState = useCallback(
    (snapshot: Pick<TradingState, "account" | "positions" | "trades">) => {
      setAccount(snapshot.account);
      setPositions(snapshot.positions);
      setTrades(snapshot.trades);
    },
    []
  );

  const [
    selectedSymbol,
    setSelectedSymbol,
  ] = useState<string>("BTC/USDT");

  const currentPositions = useMemo(
    () =>
      positions.map((position) => {
        const asset = assets.find((item) => item.symbol === position.symbol);
        if (!asset) {
          return position;
        }
        const updatedPosition = {
          ...position,
          currentPrice: asset.price,
        };
        return {
          ...updatedPosition,
          unrealizedPnl: Number(
            calculatePositionPnl(updatedPosition).toFixed(2)
          ),
          unrealizedPnlPercent: Number(
            calculatePositionPnlPercent(updatedPosition).toFixed(2)
          ),
        };
      }),
    [positions, assets]
  );

  const currentAccount = useMemo(() => {
    const unrealizedPnl = calculateTotalUnrealizedPnl(currentPositions);
    return {
      ...account,
      equity: Number((account.balance + unrealizedPnl).toFixed(2)),
      availableBalance: Number(
        Math.max(0, account.balance - account.usedMargin).toFixed(2)
      ),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      totalPnl: Number((account.realizedPnl + unrealizedPnl).toFixed(2)),
    };
  }, [account, currentPositions]);

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
        const response = await fetch(backendApiUrl("/api/market"), {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Market refresh failed (${response.status}).`);
        }

        const payload = await response.json();

        if (Array.isArray(payload.assets) && payload.assets.length > 0) {
          setAssets(payload.assets);
        }
      } catch (error) {
        console.error("Unable to refresh market data:", error);
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
   * AUTOMATIC MARKET TICK
   * =========================================================
   */

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitialData() {
      try {
        const [marketResponse, strategyResponse, stateResponse] = await Promise.all([
          fetch(backendApiUrl("/api/market"), {
            signal: controller.signal,
          }),
          fetch(backendApiUrl("/api/strategies"), {
            signal: controller.signal,
          }),
          fetch(backendApiUrl("/api/state"), {
            signal: controller.signal,
          }),
        ]);

        if (!controller.signal.aborted) {
          const [marketData, strategyData, portfolioState] = await Promise.all([
            marketResponse.ok
              ? marketResponse.json()
              : { assets: mockAssets },
            strategyResponse.ok
              ? strategyResponse.json()
              : { strategies: mockStrategies },
            stateResponse.ok
              ? stateResponse.json()
              : {
                  account: mockAccount,
                  positions: mockPositions,
                  trades: mockTrades,
                },
          ]);

          if (Array.isArray(marketData.assets)) {
            setAssets(marketData.assets);
          }

          if (Array.isArray(strategyData.strategies)) {
            setStrategies(strategyData.strategies);
          }
          if (
            portfolioState &&
            portfolioState.account &&
            Array.isArray(portfolioState.positions) &&
            Array.isArray(portfolioState.trades)
          ) {
            applyPortfolioState(portfolioState);
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          console.error("Unable to load initial data from the trading backend.");
        }
      }
    }

    loadInitialData();

    return () => {
      controller.abort();
    };
  }, [applyPortfolioState]);

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
    async (
      symbol: string,
      side: Side,
      quantity: number,
      strategyId = "manual"
    ) => {
      const response = await fetch(backendApiUrl("/api/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side, quantity, strategyId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.detail ?? payload.error ?? "Unable to place paper order."
        );
      }
      applyPortfolioState(payload.state);
    },
    [applyPortfolioState]
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

      void openPaperPosition(
        asset.symbol,
        side,
        Number(
          quantity.toFixed(8)
        ),
        strategy.id
      ).catch((error: unknown) => {
        console.error("Strategy paper order failed:", error);
      });
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
    async (positionId: string) => {
      const response = await fetch(
        backendApiUrl(`/api/positions/${encodeURIComponent(positionId)}`),
        { method: "DELETE" }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.detail ?? payload.error ?? "Unable to close paper position."
        );
      }
      applyPortfolioState(payload.state);
    },
    [applyPortfolioState]
  );

  /*
   * =========================================================
   * STRATEGY MANAGEMENT
   * =========================================================
   */

  const persistStrategy = useCallback(
    async (strategy: Strategy) => {
      const response = await fetch(backendApiUrl("/api/strategies"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(strategy),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.detail ?? payload.error ?? "Unable to save strategy.");
      }
      const payload = await response.json();
      return payload.strategy as Strategy;
    },
    []
  );

  const addStrategy = useCallback(
    async (strategy: Strategy) => {
      const savedStrategy = await persistStrategy(strategy);
      setStrategies((current) => [
        savedStrategy,
        ...current,
      ]);
    },
    [persistStrategy]
  );

  const updateStrategyStatus =
    useCallback(
      async (
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
          throw new Error(
            "Run and approve an eligible backtest before activating paper trading."
          );
        }
        if (!selectedStrategy) {
          throw new Error("Strategy not found.");
        }
        const updatedStrategy = {
          ...selectedStrategy,
          status,
          updatedAt: new Date().toISOString(),
        };
        const response = await fetch(
          backendApiUrl(`/api/strategies/${encodeURIComponent(strategyId)}`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedStrategy),
          }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.detail ?? payload.error ?? "Unable to update strategy.");
        }
        setStrategies((current) =>
          current.map((strategy) =>
            strategy.id === strategyId ? payload.strategy : strategy
          )
        );
      },
      [strategies]
    );

  const deleteStrategy = useCallback(
    async (strategyId: string) => {
      const response = await fetch(
        backendApiUrl(`/api/strategies?id=${encodeURIComponent(strategyId)}`),
        { method: "DELETE" }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? payload.error ?? "Unable to delete strategy.");
      }
      setStrategies((current) =>
        current.filter(
          (strategy) =>
            strategy.id !== strategyId
        )
      );

    },
    []
  );

  const approveStrategyForPaper = useCallback(
    async (
      strategyId: string,
      backtestRunId: string,
      reviewNotes: string
    ) => {
      const response = await fetch(backendApiUrl("/api/backtests/review"), {
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
        throw new Error(payload.detail ?? payload.error ?? "Strategy review failed.");
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
      account: currentAccount,
      assets,

      positions: currentPositions,

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
      currentAccount,
      assets,
      currentPositions,
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