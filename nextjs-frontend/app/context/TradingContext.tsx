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
} from "../lib/trading-types";
import { backendApiUrl } from "../lib/api";
import { subscribeToBackendStream } from "../lib/backend";

type PortfolioStatus = "loading" | "ready" | "unavailable";

interface TradingContextType {
  account: Account | null;
  assets: Asset[];
  positions: Position[];
  trades: Trade[];
  strategies: Strategy[];
  selectedSymbol: string;
  dataStatus: PortfolioStatus;
  backendError: string | null;
  setSelectedSymbol: React.Dispatch<React.SetStateAction<string>>;
  refreshMarketData: () => Promise<void>;
  openPaperPosition: (
    symbol: string,
    side: Side,
    quantity: number,
    strategyId?: string,
  ) => Promise<void>;
  closePosition: (positionId: string) => Promise<void>;
  addStrategy: (strategy: Strategy) => Promise<void>;
  updateStrategyStatus: (
    strategyId: string,
    status: Strategy["status"],
  ) => Promise<void>;
  deleteStrategy: (strategyId: string) => Promise<void>;
  approveStrategyForPaper: (
    strategyId: string,
    backtestRunId: string,
    reviewNotes: string,
  ) => Promise<Strategy>;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

async function responsePayload<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.error === "string"
          ? payload.error
          : `Backend request failed (${response.status}).`;
    throw new Error(detail);
  }
  return payload as T;
}

export function TradingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("BTC/USDT");
  const [dataStatus, setDataStatus] = useState<PortfolioStatus>("loading");
  const [backendError, setBackendError] = useState<string | null>(null);

  const applyPortfolioState = useCallback(
    (snapshot: {
      account: Account;
      positions: Position[];
      trades: Trade[];
    }) => {
      setAccount(snapshot.account);
      setPositions(snapshot.positions);
      setTrades(snapshot.trades);
      setDataStatus("ready");
      setBackendError(null);
    },
    [],
  );

  const refreshMarketData = useCallback(async () => {
    const response = await fetch(backendApiUrl("/api/market"), {
      cache: "no-store",
    });
    const payload = await responsePayload<{
      assets?: Asset[];
      source?: string;
    }>(response);
    if (!Array.isArray(payload.assets)) {
      throw new Error("The backend returned an invalid market response.");
    }
    setAssets(payload.assets);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadInitialData() {
      try {
        const [marketResponse, strategyResponse, stateResponse] =
          await Promise.all([
            fetch(backendApiUrl("/api/market"), {
              cache: "no-store",
              signal: controller.signal,
            }),
            fetch(backendApiUrl("/api/strategies"), {
              cache: "no-store",
              signal: controller.signal,
            }),
            fetch(backendApiUrl("/api/state"), {
              cache: "no-store",
              signal: controller.signal,
            }),
          ]);
        const [market, strategyData, state] = await Promise.all([
          responsePayload<{ assets: Asset[] }>(marketResponse),
          responsePayload<{ strategies: Strategy[] }>(strategyResponse),
          responsePayload<{
            account: Account;
            positions: Position[];
            trades: Trade[];
          }>(stateResponse),
        ]);
        if (controller.signal.aborted) {
          return;
        }
        if (!Array.isArray(market.assets) || !Array.isArray(strategyData.strategies)) {
          throw new Error("The backend returned invalid initial data.");
        }
        setAssets(market.assets);
        setStrategies(strategyData.strategies);
        applyPortfolioState(state);
      } catch (error) {
        if (!controller.signal.aborted) {
          setDataStatus("unavailable");
          setBackendError(
            error instanceof Error
              ? error.message
              : "Unable to load data from the trading backend.",
          );
        }
      }
    }
    void loadInitialData();
    return () => controller.abort();
  }, [applyPortfolioState]);

  useEffect(
    () =>
      subscribeToBackendStream(
        [{ type: "ticker" }, { type: "portfolio" }],
        (event) => {
          if (event.type === "ticker") {
            setAssets((current) => {
              const updated: Asset = {
                symbol: event.symbol,
                name: event.name,
                price: event.price,
                change24h: event.change24h,
                volume24h: event.volume24h,
                high24h: event.high24h,
                low24h: event.low24h,
              };
              const index = current.findIndex(
                (asset) => asset.symbol === event.symbol,
              );
              if (index < 0) {
                return [...current, updated];
              }
              return current.map((asset, itemIndex) =>
                itemIndex === index ? updated : asset,
              );
            });
          } else if (event.type === "portfolio") {
            setAccount(event.account);
            setPositions(event.positions);
            setDataStatus("ready");
            setBackendError(null);
          }
        },
      ),
    [],
  );

  const openPaperPosition = useCallback(
    async (
      symbol: string,
      side: Side,
      quantity: number,
      strategyId = "manual",
    ) => {
      const response = await fetch(backendApiUrl("/api/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side, quantity, strategyId }),
      });
      const payload = await responsePayload<{
        state: { account: Account; positions: Position[]; trades: Trade[] };
      }>(response);
      applyPortfolioState(payload.state);
    },
    [applyPortfolioState],
  );

  const closePosition = useCallback(
    async (positionId: string) => {
      const response = await fetch(
        backendApiUrl(`/api/positions/${encodeURIComponent(positionId)}`),
        { method: "DELETE" },
      );
      const payload = await responsePayload<{
        state: { account: Account; positions: Position[]; trades: Trade[] };
      }>(response);
      applyPortfolioState(payload.state);
    },
    [applyPortfolioState],
  );

  const addStrategy = useCallback(async (strategy: Strategy) => {
    const response = await fetch(backendApiUrl("/api/strategies"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(strategy),
    });
    const payload = await responsePayload<{ strategy: Strategy }>(response);
    setStrategies((current) => [payload.strategy, ...current]);
  }, []);

  const updateStrategyStatus = useCallback(
    async (strategyId: string, status: Strategy["status"]) => {
      const selected = strategies.find((item) => item.id === strategyId);
      if (!selected) {
        throw new Error("Strategy not found.");
      }
      const response = await fetch(
        backendApiUrl(`/api/strategies/${encodeURIComponent(strategyId)}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...selected,
            status,
            updatedAt: new Date().toISOString(),
          }),
        },
      );
      const payload = await responsePayload<{ strategy: Strategy }>(response);
      setStrategies((current) =>
        current.map((item) =>
          item.id === strategyId ? payload.strategy : item,
        ),
      );
    },
    [strategies],
  );

  const deleteStrategy = useCallback(async (strategyId: string) => {
    const response = await fetch(
      backendApiUrl(`/api/strategies?id=${encodeURIComponent(strategyId)}`),
      { method: "DELETE" },
    );
    await responsePayload(response);
    setStrategies((current) =>
      current.filter((item) => item.id !== strategyId),
    );
  }, []);

  const approveStrategyForPaper = useCallback(
    async (
      strategyId: string,
      backtestRunId: string,
      reviewNotes: string,
    ) => {
      const response = await fetch(backendApiUrl("/api/backtests/review"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: backtestRunId,
          confirmPaperApproval: true,
          notes: reviewNotes,
        }),
      });
      const payload = await responsePayload<{ strategy: Strategy }>(response);
      if (payload.strategy.id !== strategyId) {
        throw new Error("Approved strategy did not match the selected strategy.");
      }
      setStrategies((current) =>
        current.map((strategy) =>
          strategy.id === strategyId ? payload.strategy : strategy,
        ),
      );
      return payload.strategy;
    },
    [],
  );

  const value = useMemo(
    () => ({
      account,
      assets,
      positions,
      trades,
      strategies,
      selectedSymbol,
      dataStatus,
      backendError,
      setSelectedSymbol,
      refreshMarketData,
      openPaperPosition,
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
      dataStatus,
      backendError,
      refreshMarketData,
      openPaperPosition,
      closePosition,
      addStrategy,
      updateStrategyStatus,
      deleteStrategy,
      approveStrategyForPaper,
    ],
  );

  return (
    <TradingContext.Provider value={value}>
      {children}
    </TradingContext.Provider>
  );
}

export function useTrading(): TradingContextType {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error("useTrading must be used inside TradingProvider");
  }
  return context;
}
