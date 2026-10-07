"use client";

import { useTrading } from "../../context/TradingContext";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  isPositive,
} from "../../lib/trading-utils";

export default function OpenPositions() {
  const {
    positions,
    closePosition,
  } = useTrading();

  return (
    <section className="trading-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <div>
          <h2 className="font-medium text-white">
            Open Positions
          </h2>

          <p className="mt-1 text-xs text-zinc-500">
            Active paper-trading positions
          </p>
        </div>

        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400">
          {positions.length}{" "}
          {positions.length === 1
            ? "Position"
            : "Positions"}
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center px-5 text-center">
          <div>
            <div className="text-sm text-zinc-400">
              No open positions
            </div>

            <div className="mt-1 text-xs text-zinc-600">
              Open a paper position from Quick Trade.
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left">
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
                  Entry
                </th>

                <th className="px-4 py-3 font-medium">
                  Current
                </th>

                <th className="px-4 py-3 font-medium">
                  Margin
                </th>

                <th className="px-4 py-3 font-medium">
                  Unrealized P&L
                </th>

                <th className="px-5 py-3 text-right font-medium">
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {positions.map((position) => {
                const positive =
                  isPositive(
                    position.unrealizedPnl
                  );

                return (
                  <tr
                    key={position.id}
                    className="border-b border-zinc-900 transition hover:bg-zinc-900/50"
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium text-white">
                        {position.symbol}
                      </div>

                      <div className="mt-1 text-xs text-zinc-600">
                        {position.name}
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-medium ${
                          position.side ===
                          "LONG"
                            ? "border-emerald-900 bg-emerald-950/40 text-emerald-400"
                            : "border-red-900 bg-red-950/40 text-red-400"
                        }`}
                      >
                        {position.side}
                      </span>
                    </td>

                    <td className="number px-4 py-4 text-sm text-zinc-300">
                      {formatNumber(
                        position.quantity,
                        position.quantity < 1
                          ? 4
                          : 2
                      )}
                    </td>

                    <td className="number px-4 py-4 text-sm text-zinc-300">
                      $
                      {formatCurrency(
                        position.entryPrice,
                        position.entryPrice < 1
                          ? 4
                          : 2
                      )}
                    </td>

                    <td className="number px-4 py-4 text-sm text-white">
                      $
                      {formatCurrency(
                        position.currentPrice,
                        position.currentPrice < 1
                          ? 4
                          : 2
                      )}
                    </td>

                    <td className="number px-4 py-4 text-sm text-zinc-300">
                      $
                      {formatCurrency(
                        position.margin
                      )}
                    </td>

                    <td className="px-4 py-4">
                      <div
                        className={`number text-sm font-medium ${
                          positive
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {positive
                          ? "+"
                          : ""}
                        $
                        {formatCurrency(
                          position.unrealizedPnl
                        )}
                      </div>

                      <div
                        className={`number mt-1 text-xs ${
                          positive
                            ? "text-emerald-500"
                            : "text-red-500"
                        }`}
                      >
                        {formatPercent(
                          position.unrealizedPnlPercent
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          closePosition(
                            position.id
                          )
                        }
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-red-800 hover:bg-red-950/30 hover:text-red-400"
                      >
                        Close
                      </button>
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