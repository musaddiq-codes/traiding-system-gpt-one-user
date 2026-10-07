"use client";

import { useTrading } from "../../context/TradingContext";
import {
  formatCurrency,
  formatNumber,
  isPositive,
} from "../../lib/trading-utils";

export default function RecentTrades() {
  const { trades } = useTrading();

  const recentTrades = trades.slice(0, 6);

  return (
    <section className="trading-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <div>
          <h2 className="font-medium text-white">
            Recent Trades
          </h2>

          <p className="mt-1 text-xs text-zinc-500">
            Latest paper-trading executions
          </p>
        </div>

        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400">
          {trades.length}{" "}
          {trades.length === 1
            ? "Trade"
            : "Trades"}
        </span>
      </div>

      {recentTrades.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center px-5 text-center">
          <div>
            <div className="text-sm text-zinc-400">
              No trades yet
            </div>

            <div className="mt-1 text-xs text-zinc-600">
              Your executed paper trades will appear here.
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                <th className="px-5 py-3 font-medium">
                  Market
                </th>

                <th className="px-4 py-3 font-medium">
                  Side
                </th>

                <th className="px-4 py-3 font-medium">
                  Quantity
                </th>

                <th className="px-4 py-3 font-medium">
                  Price
                </th>

                <th className="px-4 py-3 font-medium">
                  Value
                </th>

                <th className="px-4 py-3 font-medium">
                  P&L
                </th>

                <th className="px-5 py-3 text-right font-medium">
                  Status
                </th>
              </tr>
            </thead>

            <tbody>
              {recentTrades.map((trade) => {
                const pnlPositive =
                  isPositive(
                    trade.realizedPnl
                  );

                return (
                  <tr
                    key={trade.id}
                    className="border-b border-zinc-900 transition hover:bg-zinc-900/50"
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium text-white">
                        {trade.symbol}
                      </div>

                      <div className="mt-1 text-xs text-zinc-600">
                        {new Date(
                          trade.executedAt
                        ).toLocaleString()}
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-medium ${
                          trade.side ===
                          "BUY"
                            ? "border-emerald-900 bg-emerald-950/40 text-emerald-400"
                            : "border-red-900 bg-red-950/40 text-red-400"
                        }`}
                      >
                        {trade.side}
                      </span>
                    </td>

                    <td className="number px-4 py-4 text-sm text-zinc-300">
                      {formatNumber(
                        trade.quantity,
                        trade.quantity < 1
                          ? 4
                          : 2
                      )}
                    </td>

                    <td className="number px-4 py-4 text-sm text-zinc-300">
                      $
                      {formatCurrency(
                        trade.price,
                        trade.price < 1
                          ? 4
                          : 2
                      )}
                    </td>

                    <td className="number px-4 py-4 text-sm text-zinc-300">
                      $
                      {formatCurrency(
                        trade.value
                      )}
                    </td>

                    <td className="px-4 py-4">
                      {trade.realizedPnl ===
                      0 ? (
                        <span className="text-sm text-zinc-600">
                          —
                        </span>
                      ) : (
                        <span
                          className={`number text-sm font-medium ${
                            pnlPositive
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {pnlPositive
                            ? "+"
                            : ""}
                          $
                          {formatCurrency(
                            trade.realizedPnl
                          )}
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${
                          trade.status ===
                          "FILLED"
                            ? "border-emerald-900 bg-emerald-950/30 text-emerald-400"
                            : trade.status ===
                                "PENDING"
                              ? "border-amber-900 bg-amber-950/30 text-amber-400"
                              : "border-red-900 bg-red-950/30 text-red-400"
                        }`}
                      >
                        {trade.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}