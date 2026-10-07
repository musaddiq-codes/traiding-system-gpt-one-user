"use client";

import { useMemo } from "react";

import { useTrading } from "../../context/TradingContext";
import {
  evaluateStrategy,
  StrategySignal,
} from "../../lib/trading-utils";

export default function StrategyEngineStatus() {
  const {
    strategies,
    assets,
    executeStrategySignal,
  } = useTrading();

  const evaluations = useMemo(() => {
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
          };
        }

        const result = evaluateStrategy(
          strategy,
          asset
        );

        return {
          ...result,
          strategyName: strategy.name,
        };
      });
  }, [strategies, assets]);

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
                Running
              </span>
            </div>

            <p className="mt-1 text-xs text-zinc-500">
              Evaluating active strategies against current
              market data
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
                    {evaluation.reason}
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
                  {canExecute && (
                    <button
                      type="button"
                      onClick={() => {
                        console.log(
                          "Executing strategy:",
                          evaluation.strategyId
                        );

                        executeStrategySignal(
                          evaluation.strategyId
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