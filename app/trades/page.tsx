"use client";

import { useMemo, useState } from "react";

import Sidebar from "../components/navigation/Sidebar";
import Header from "../components/navigation/Header";

import { useTrading } from "../context/TradingContext";
import { formatCurrency, formatNumber } from "../lib/trading-utils";

type Filter = "ALL" | "BUY" | "SELL";

export default function TradesPage() {
  const { trades } = useTrading();

  const [filter, setFilter] =
    useState<Filter>("ALL");

  const filteredTrades = useMemo(() => {
    if (filter === "ALL") {
      return trades;
    }

    return trades.filter(
      (trade) => trade.side === filter
    );
  }, [trades, filter]);

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <Sidebar />

      <div className="lg:pl-[245px]">
        <Header />

        <main className="mx-auto max-w-[1500px] px-5 py-6 lg:px-7">
          <div className="mb-7">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
              Execution history
            </p>

            <h1 className="text-2xl font-bold tracking-tight">
              Trades
            </h1>

            <p className="mt-1 text-xs text-slate-600">
              Complete history of executed paper orders.
            </p>
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {(["ALL", "BUY", "SELL"] as Filter[]).map(
              (item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${
                    filter === item
                      ? "bg-blue-600 text-white"
                      : "border border-[#1b2330] bg-[#0d1118] text-slate-600 hover:text-white"
                  }`}
                >
                  {item === "ALL"
                    ? "All trades"
                    : item}
                </button>
              )
            )}
          </div>

          <div className="trading-panel overflow-x-auto">
            {filteredTrades.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <div className="text-sm font-semibold text-slate-400">
                  No trades found
                </div>
              </div>
            ) : (
              <table className="w-full min-w-[900px] text-left">
                <thead>
                  <tr className="border-b border-[#1b2330] text-[10px] uppercase tracking-wide text-slate-700">
                    <th className="px-5 py-3">Pair</th>
                    <th className="px-5 py-3">Side</th>
                    <th className="px-5 py-3">Quantity</th>
                    <th className="px-5 py-3">Price</th>
                    <th className="px-5 py-3">Value</th>
                    <th className="px-5 py-3">P&L</th>
                    <th className="px-5 py-3">Time</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#151c26]">
                  {filteredTrades.map((trade) => (
                    <tr
                      key={trade.id}
                      className="text-xs transition hover:bg-[#0f141c]"
                    >
                      <td className="px-5 py-4 font-semibold">
                        {trade.symbol}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-md px-2 py-1 text-[9px] font-bold ${
                            trade.side === "BUY"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {trade.side}
                        </span>
                      </td>

                      <td className="number px-5 py-4 text-slate-400">
                        {formatNumber(
                          trade.quantity,
                          4
                        )}
                      </td>

                      <td className="number px-5 py-4 text-slate-400">
                        {formatCurrency(
                          trade.price
                        )}
                      </td>

                      <td className="number px-5 py-4 text-slate-300">
                        {formatCurrency(
                          trade.value
                        )}
                      </td>

                      <td
                        className={`number px-5 py-4 font-semibold ${
                          trade.realizedPnl >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {trade.realizedPnl >= 0
                          ? "+"
                          : ""}
                        {formatCurrency(
                          trade.realizedPnl
                        )}
                      </td>

                      <td className="number px-5 py-4 text-slate-600">
                        {new Date(
                          trade.executedAt
                        ).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}