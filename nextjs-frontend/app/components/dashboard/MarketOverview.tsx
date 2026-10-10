"use client";

import { formatCurrency, formatNumber } from "../../lib/trading-utils";
import { useTrading } from "../../context/TradingContext";

export default function MarketOverview() {
  const {
    assets,
    selectedSymbol,
    setSelectedSymbol,
  } = useTrading();

  return (
    <section className="trading-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <div>
          <h2 className="font-medium text-white">
            Market Overview
          </h2>

          <p className="mt-1 text-xs text-zinc-500">
            Live simulated market data
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="live-dot" />
          Live
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
              <th className="px-5 py-3 font-medium">
                Asset
              </th>

              <th className="px-5 py-3 text-right font-medium">
                Price
              </th>

              <th className="px-5 py-3 text-right font-medium">
                24h Change
              </th>

              <th className="px-5 py-3 text-right font-medium">
                24h High
              </th>

              <th className="px-5 py-3 text-right font-medium">
                24h Low
              </th>

              <th className="px-5 py-3 text-right font-medium">
                Volume
              </th>
            </tr>
          </thead>

          <tbody>
            {assets.map((asset) => {
              const positive =
                asset.change24h >= 0;

              const selected =
                asset.symbol === selectedSymbol;

              return (
                <tr
                  key={asset.symbol}
                  onClick={() =>
                    setSelectedSymbol(asset.symbol)
                  }
                  className={`cursor-pointer border-b border-zinc-900 transition ${
                    selected
                      ? "bg-zinc-800/60"
                      : "hover:bg-zinc-900/70"
                  }`}
                >
                  {/* Asset */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-white">
                        {asset.symbol
                          .split("/")[0]
                          .slice(0, 3)}
                      </div>

                      <div>
                        <div className="font-medium text-white">
                          {asset.symbol}
                        </div>

                        <div className="mt-0.5 text-xs text-zinc-500">
                          {asset.name}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-5 py-4 text-right">
                    <span className="number text-sm text-zinc-200">
                      ${formatCurrency(
                        asset.price,
                        asset.price < 1
                          ? 4
                          : 2
                      )}
                    </span>
                  </td>

                  {/* Change */}
                  <td className="px-5 py-4 text-right">
                    <span
                      className={`number text-sm ${
                        positive
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {positive ? "+" : ""}
                      {formatNumber(
                        asset.change24h
                      )}
                      %
                    </span>
                  </td>

                  {/* High */}
                  <td className="px-5 py-4 text-right">
                    <span className="number text-sm text-zinc-300">
                      ${formatCurrency(
                        asset.high24h,
                        asset.high24h < 1
                          ? 4
                          : 2
                      )}
                    </span>
                  </td>

                  {/* Low */}
                  <td className="px-5 py-4 text-right">
                    <span className="number text-sm text-zinc-300">
                      ${formatCurrency(
                        asset.low24h,
                        asset.low24h < 1
                          ? 4
                          : 2
                      )}
                    </span>
                  </td>

                  {/* Volume */}
                  <td className="px-5 py-4 text-right">
                    <span className="number text-sm text-zinc-300">
                      $
                      {formatNumber(
                        asset.volume24h >=
                          1_000_000_000
                          ? asset.volume24h /
                              1_000_000_000
                          : asset.volume24h /
                              1_000_000
                      )}
                      {asset.volume24h >=
                      1_000_000_000
                        ? "B"
                        : "M"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {assets.length === 0 && (
        <div className="px-5 py-10 text-center text-sm text-zinc-500">
          No market data available.
        </div>
      )}
    </section>
  );
}