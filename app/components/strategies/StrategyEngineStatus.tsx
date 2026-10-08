"use client";

import { useEffect, useMemo, useState } from "react";

import { useTrading } from "../../context/TradingContext";
import {
  isChartRange,
  mapTimeRangeToInterval,
  type CandlePoint,
  type ChartRange,
} from "../../lib/market-data";
import { subscribeToKline } from "../../lib/market-data-stream";
import {
  evaluateStrategy,
  StrategySignal,
} from "../../lib/trading-utils";

function getCandleKey(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

interface StrategyEvaluationStatus {
  strategyId: string;
  strategyName: string;
  symbol: string;
  signal: StrategySignal;
  reason: string;
  waitingForCandles: boolean;
}

export default function StrategyEngineStatus() {
  const {
    strategies,
    assets,
    executeStrategySignal,
  } = useTrading();

  const [candlesByStrategyMarket, setCandlesByStrategyMarket] =
    useState<Record<string, CandlePoint[]>>({});

  useEffect(() => {
    const activeStrategies = strategies.filter(
      (strategy) => strategy.status === "ACTIVE"
    );
    const uniqueMarkets = new Map<string, { symbol: string; timeframe: string }>();

    for (const strategy of activeStrategies) {
      const timeframe = strategy.timeframe;
      const key = getCandleKey(strategy.symbol, timeframe);
      uniqueMarkets.set(key, {
        symbol: strategy.symbol,
        timeframe,
      });
    }

    const abortController = new AbortController();
    const unsubscribeFunctions: Array<() => void> = [];
    let active = true;

    for (const [key, market] of uniqueMarkets) {
      const timeframe = market.timeframe;

      if (!isChartRange(timeframe)) {
        continue;
      }
      const validTimeframe: ChartRange = timeframe;

      async function loadMarketCandles() {
        try {
          const response = await fetch(
            `/api/market?symbol=${encodeURIComponent(market.symbol)}&interval=${encodeURIComponent(mapTimeRangeToInterval(validTimeframe))}&limit=200`,
            { cache: "no-store", signal: abortController.signal }
          );

          if (!response.ok) {
            throw new Error(`Candle history request failed: ${response.status}`);
          }

          const payload = await response.json();

          if (!Array.isArray(payload.candles) || !active) {
            return;
          }

          const history = payload.candles as CandlePoint[];
          setCandlesByStrategyMarket((current) => ({
            ...current,
            [key]: history,
          }));

          const unsubscribe = subscribeToKline(
            market.symbol,
            validTimeframe,
            (candle) => {
              setCandlesByStrategyMarket((current) => {
                const previous = current[key] ?? [];
                const last = previous[previous.length - 1];
                const updated = last?.timestamp === candle.timestamp
                  ? [...previous.slice(0, -1), candle]
                  : [...previous, candle];

                return {
                  ...current,
                  [key]: updated.slice(-200),
                };
              });
            }
          );

          unsubscribeFunctions.push(unsubscribe);
        } catch (error) {
          if (!abortController.signal.aborted) {
            console.error(`Failed to load strategy candles for ${market.symbol}:`, error);
          }
        }
      }

      void loadMarketCandles();
    }

    return () => {
      active = false;
      abortController.abort();
      unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
    };
  }, [strategies]);

  const evaluations = useMemo<StrategyEvaluationStatus[]>(() => {
    return strategies
      .filter(
        (strategy) =>
          strategy.status === "ACTIVE"
      )
      .map((strategy) => {
        const asset = assets.find(
          (item) =>
            item.symbol === strategy.symbol
        );

        if (!asset) {
          return {
            strategyId: strategy.id,
            strategyName: strategy.name,
            symbol: strategy.symbol,
            signal: "HOLD" as StrategySignal,
            reason: "Market data unavailable.",
            waitingForCandles: true,
          };
        }

        const candleHistory =
          candlesByStrategyMarket[
            getCandleKey(strategy.symbol, strategy.timeframe)
          ];

        if (!candleHistory?.length) {
          return {
            strategyId: strategy.id,
            strategyName: strategy.name,
            symbol: strategy.symbol,
            signal: "HOLD" as StrategySignal,
            reason: "Waiting for historical candles and live stream.",
            waitingForCandles: true,
          };
        }

        const result = evaluateStrategy(
          strategy,
          asset,
          candleHistory
        );

        return {
          ...result,
          strategyName: strategy.name,
          waitingForCandles: false,
        };
      });
  }, [strategies, assets, candlesByStrategyMarket]);

  return (
    <section className="trading-panel mb-6 overflow-hidden">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-medium text-white">
                Strategy Engine
              </h2>

              <span className="flex items-center gap-2 text-xs text-emerald-400">
                <span className="live-dot" />
                {evaluations.some((item) => item.waitingForCandles)
                  ? "Loading candle data"
                  : "Running"}
              </span>
            </div>

            <p className="mt-1 text-xs text-zinc-500">
              Evaluating active strategies against live candles
            </p>
          </div>

          <div className="text-right">
            <div className="number text-lg font-semibold text-white">
              {evaluations.length}
            </div>

            <div className="text-[10px] text-zinc-600">
              Active
            </div>
          </div>
        </div>
      </div>

      {evaluations.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="text-sm text-zinc-400">
            No active strategies
          </div>

          <div className="mt-1 text-xs text-zinc-600">
            Activate a strategy to begin evaluation.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-zinc-900">
          {evaluations.map((evaluation) => {
            const signalClass =
              evaluation.signal === "BUY"
                ? "border-emerald-900 bg-emerald-950/30 text-emerald-400"
                : evaluation.signal === "SELL"
                  ? "border-red-900 bg-red-950/30 text-red-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400";

            const canExecute =
              evaluation.signal === "BUY" ||
              evaluation.signal === "SELL";

            return (
              <div
                key={evaluation.strategyId}
                className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">
                      {evaluation.strategyName}
                    </span>

                    <span className="text-xs text-zinc-600">
                      {evaluation.symbol}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-zinc-500">
                    {evaluation.waitingForCandles
                      ? "Waiting for historical candles and live stream..."
                      : evaluation.reason}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Signal indicator */}
                  <span
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${signalClass}`}
                  >
                    {evaluation.signal}
                  </span>

                  {/* Execution button */}
                  {canExecute && !evaluation.waitingForCandles && (
                    <button
                      type="button"
                      onClick={() => {
                        console.log(
                          "Executing strategy:",
                          evaluation.strategyId
                        );

                        executeStrategySignal(
                          evaluation.strategyId,
                          candlesByStrategyMarket[
                            getCandleKey(
                              evaluation.symbol,
                              strategies.find((strategy) => strategy.id === evaluation.strategyId)?.timeframe ?? ""
                            )
                          ]
                        );
                      }}
                      className={`cursor-pointer rounded-md border px-4 py-1.5 text-xs font-semibold transition ${evaluation.signal === "BUY"
                          ? "border-emerald-800 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/60"
                          : "border-red-800 bg-red-950/40 text-red-400 hover:bg-red-900/60"
                        }`}
                    >
                      Execute
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}