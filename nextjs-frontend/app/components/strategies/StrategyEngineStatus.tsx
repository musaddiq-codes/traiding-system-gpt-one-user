"use client";

import { useCallback, useEffect, useState } from "react";

import { useTrading } from "../../context/TradingContext";
import {
  getEngineStatus,
  getStrategySignals,
  subscribeToBackendStream,
  type EngineStatus,
  type StrategySignal,
} from "../../lib/backend";

function mergeSignals(
  current: StrategySignal[],
  incoming: StrategySignal[],
): StrategySignal[] {
  const byCandle = new Map<string, StrategySignal>();
  for (const signal of [...incoming, ...current]) {
    byCandle.set(`${signal.strategyId}:${signal.candleTs}`, signal);
  }
  return [...byCandle.values()]
    .sort((left, right) => right.candleTs - left.candleTs)
    .slice(0, 50);
}

export default function StrategyEngineStatus() {
  const { strategies } = useTrading();
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [signals, setSignals] = useState<StrategySignal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const active = strategies.filter((strategy) => strategy.status === "ACTIVE");
      const [status, ...signalLists] = await Promise.all([
        getEngineStatus(),
        ...active.map((strategy) => getStrategySignals(strategy.id, 20)),
      ]);
      setEngine(status);
      setSignals((current) =>
        mergeSignals(current, signalLists.flat()),
      );
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load engine status from the backend.",
      );
    }
  }, [strategies]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(
    () =>
      subscribeToBackendStream([], (event) => {
        if (event.type !== "signal") {
          return;
        }
        setSignals((current) =>
          mergeSignals(current, [
            {
              strategyId: event.strategyId,
              symbol: event.symbol,
              candleTs: event.candleTs,
              signal: event.signal,
              reason: event.reason,
              score: event.score,
              actionTaken: event.actionTaken,
            },
          ]),
        );
      }),
    [],
  );

  const activeStrategies = strategies.filter(
    (strategy) => strategy.status === "ACTIVE",
  );
  const running = engine?.enabled === true && engine.running;

  return (
    <section className="trading-panel mb-6 overflow-hidden">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-medium text-white">Strategy Engine</h2>
              <span
                className={`flex items-center gap-2 text-xs ${
                  running ? "text-emerald-400" : "text-zinc-500"
                }`}
              >
                <span className={running ? "live-dot" : "h-2 w-2 rounded-full bg-zinc-600"} />
                Engine {running ? "ON" : "OFF"}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Server-side paper strategy execution
              {engine ? ` · ${engine.tickSeconds}s tick` : ""}
            </p>
          </div>
          <div className="text-right">
            <div className="number text-lg font-semibold text-white">
              {activeStrategies.length}
            </div>
            <div className="text-[10px] text-zinc-600">Active strategies</div>
          </div>
        </div>
        {error && (
          <p className="mt-3 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>

      {activeStrategies.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-zinc-500">
          No active strategies
        </div>
      ) : signals.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-zinc-500">
          No strategy signals recorded yet.
        </div>
      ) : (
        <div className="divide-y divide-zinc-900">
          {signals.slice(0, 10).map((signal) => {
            const strategy = strategies.find(
              (item) => item.id === signal.strategyId,
            );
            const signalClass =
              signal.signal === "BUY"
                ? "text-emerald-400"
                : signal.signal === "SELL"
                  ? "text-red-400"
                  : "text-zinc-400";
            return (
              <div
                key={`${signal.strategyId}:${signal.candleTs}`}
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">
                      {strategy?.name ?? signal.strategyId}
                    </span>
                    <span className="text-xs text-zinc-600">{signal.symbol}</span>
                    <span className={`text-xs font-semibold ${signalClass}`}>
                      {signal.signal}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">{signal.reason}</p>
                  {signal.actionTaken && (
                    <p className="mt-1 text-[10px] text-zinc-600">
                      Action: {signal.actionTaken}
                    </p>
                  )}
                </div>
                <time className="shrink-0 text-[10px] text-zinc-600">
                  {new Date(signal.candleTs).toLocaleString()}
                </time>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
