"use client";

import Link from "next/link";
import StrategyEngineStatus from "../components/strategies/StrategyEngineStatus";
import Sidebar from "../components/navigation/Sidebar";
import Header from "../components/navigation/Header";

import { useTrading } from "../context/TradingContext";

export default function StrategiesPage() {
  const {
    strategies,
    updateStrategyStatus,
    deleteStrategy,
  } = useTrading();

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <Sidebar />

      <div className="lg:pl-[245px]">
        <Header />

        <main className="mx-auto max-w-[1500px] px-5 py-6 lg:px-7">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">

            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
                Automation
              </p>

              <h1 className="text-2xl font-bold tracking-tight">
                Trading Strategies
              </h1>

              <p className="mt-1 text-xs text-slate-600">
                Create, configure and monitor automated trading strategies.
              </p>
            </div>

            <Link
              href="/strategies/new"
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-center text-xs font-semibold text-white transition hover:bg-blue-500"
            >
              + Create Strategy
            </Link>
          </div>
<StrategyEngineStatus />
          {strategies.length === 0 ? (
            <div className="trading-panel p-16 text-center">
              <div className="text-sm font-semibold text-slate-400">
                No strategies
              </div>

              <p className="mt-2 text-xs text-slate-600">
                Create your first trading strategy.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {strategies.map((strategy) => (
                <div
                  key={strategy.id}
                  className="trading-panel trading-panel-hover p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {strategy.name}
                      </div>

                      <div className="mt-1 text-[10px] text-slate-600">
                        {strategy.type}
                      </div>
                    </div>

                    <span
                      className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase ${
                        strategy.status === "ACTIVE"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : strategy.status === "PAUSED"
                            ? "bg-yellow-500/10 text-yellow-400"
                            : "bg-slate-500/10 text-slate-500"
                      }`}
                    >
                      {strategy.status}
                    </span>
                  </div>

                  <div className="mt-6">
                    <div className="text-[10px] uppercase tracking-wide text-slate-700">
                      Trading Pair
                    </div>

                    <div className="mt-2 text-sm font-semibold">
                      {strategy.symbol}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-[#090c11] p-3">
                      <div className="text-[9px] text-slate-700">
                        Timeframe
                      </div>

                      <div className="mt-1 text-xs font-semibold">
                        {strategy.timeframe}
                      </div>
                    </div>

                    <div className="rounded-lg bg-[#090c11] p-3">
                      <div className="text-[9px] text-slate-700">
                        Risk / Trade
                      </div>

                      <div className="number mt-1 text-xs font-semibold">
                        {strategy.riskPerTrade}%
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-[#1b2330] pt-4">
                    <div className="flex gap-2">
                      <Link
                        href={`/strategies/${strategy.id}`}
                        className="flex-1 rounded-lg border border-[#27303d] px-3 py-2 text-center text-[10px] font-semibold text-slate-400 transition hover:text-white"
                      >
                        Open
                      </Link>

                      <button
                        onClick={() =>
                          updateStrategyStatus(
                            strategy.id,
                            strategy.status === "ACTIVE"
                              ? "PAUSED"
                              : "ACTIVE"
                          )
                        }
                        className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[10px] font-semibold text-blue-400 transition hover:bg-blue-500/10"
                      >
                        {strategy.status === "ACTIVE"
                          ? "Pause"
                          : "Start"}
                      </button>

                      <button
                        onClick={() =>
                          deleteStrategy(strategy.id)
                        }
                        className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] font-semibold text-red-400 transition hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}