"use client";

import Sidebar from "../components/navigation/Sidebar";
import Header from "../components/navigation/Header";

import { useTrading } from "../context/TradingContext";
import {
  calculatePositionPnl,
  calculatePositionPnlPercent,
  calculatePositionValue,
  formatCurrency,
  formatNumber,
} from "../lib/trading-utils";

export default function PositionsPage() {
  const {
    account,
    positions,
    refreshMarketData,
  } = useTrading();

  const totalExposure = positions.reduce(
    (total, position) =>
      total + calculatePositionValue(position),
    0
  );

  const totalPnl = positions.reduce(
    (total, position) =>
      total + calculatePositionPnl(position),
    0
  );

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <Sidebar />

      <div className="lg:pl-[245px]">
        <Header />

        <main className="mx-auto max-w-[1500px] px-5 py-6 lg:px-7">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
                Portfolio
              </p>

              <h1 className="text-2xl font-bold tracking-tight">
                Open Positions
              </h1>

              <p className="mt-1 text-xs text-slate-600">
                Monitor and manage your active market exposure.
              </p>
            </div>

            <button
              onClick={refreshMarketData}
              className="rounded-lg border border-[#27303d] bg-[#0d1118] px-4 py-2.5 text-xs font-semibold text-slate-400 transition hover:text-white"
            >
              ↻ Refresh
            </button>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Metric
              label="Total Exposure"
              value={formatCurrency(totalExposure)}
            />

            <Metric
              label="Unrealized P&L"
              value={formatCurrency(totalPnl)}
              positive={totalPnl >= 0}
            />

            <Metric
              label="Open Positions"
              value={String(positions.length)}
            />
          </div>

          <div className="trading-panel overflow-x-auto">
            <div className="border-b border-[#1b2330] px-5 py-4">
              <h2 className="text-sm font-semibold">
                Active Positions
              </h2>
            </div>

            {positions.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <div className="text-sm font-semibold text-slate-400">
                  No open positions
                </div>

                <p className="mt-2 text-xs text-slate-600">
                  Use Quick Trade to open a paper position.
                </p>
              </div>
            ) : (
              <table className="w-full min-w-[1000px] text-left">
                <thead>
                  <tr className="border-b border-[#1b2330] text-[10px] uppercase tracking-wide text-slate-700">
                    <th className="px-5 py-3">Pair</th>
                    <th className="px-5 py-3">Side</th>
                    <th className="px-5 py-3">Size</th>
                    <th className="px-5 py-3">Entry</th>
                    <th className="px-5 py-3">Mark Price</th>
                    <th className="px-5 py-3">Value</th>
                    <th className="px-5 py-3">P&L</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#151c26]">
                  {positions.map((position) => {
                    const pnl =
                      calculatePositionPnl(position);

                    const pnlPercent =
                      calculatePositionPnlPercent(
                        position
                      );

                    return (
                      <PositionRow
                        key={position.id}
                        position={position}
                        pnl={pnl}
                        pnlPercent={pnlPercent}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-5 text-right text-[10px] text-slate-700">
            Available balance:{" "}
            <span className="number text-slate-500">
              {formatCurrency(
                account.availableBalance
              )}
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}

function PositionRow({
  position,
  pnl,
  pnlPercent,
}: {
  position: any;
  pnl: number;
  pnlPercent: number;
}) {
  const { closePosition } = useTrading();

  return (
    <tr className="text-xs transition hover:bg-[#0f141c]">
      <td className="px-5 py-4 font-semibold">
        {position.symbol}
      </td>

      <td className="px-5 py-4">
        <span
          className={`rounded-md px-2 py-1 text-[9px] font-bold ${
            position.side === "LONG"
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {position.side}
        </span>
      </td>

      <td className="number px-5 py-4 text-slate-400">
        {formatNumber(position.quantity, 4)}
      </td>

      <td className="number px-5 py-4 text-slate-500">
        {formatCurrency(position.entryPrice)}
      </td>

      <td className="number px-5 py-4 text-slate-400">
        {formatCurrency(position.currentPrice)}
      </td>

      <td className="number px-5 py-4 text-slate-300">
        {formatCurrency(
          calculatePositionValue(position)
        )}
      </td>

      <td className="px-5 py-4">
        <div
          className={`number font-semibold ${
            pnl >= 0
              ? "text-emerald-400"
              : "text-red-400"
          }`}
        >
          {pnl >= 0 ? "+" : ""}
          {formatCurrency(pnl)}
        </div>

        <div
          className={`number mt-1 text-[10px] ${
            pnlPercent >= 0
              ? "text-emerald-400"
              : "text-red-400"
          }`}
        >
          {pnlPercent >= 0 ? "+" : ""}
          {pnlPercent.toFixed(2)}%
        </div>
      </td>

      <td className="px-5 py-4">
        <button
          onClick={() =>
            closePosition(position.id)
          }
          className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-semibold text-red-400 transition hover:bg-red-500/10"
        >
          Close
        </button>
      </td>
    </tr>
  );
}

function Metric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="trading-panel p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </div>

      <div
        className={`number mt-3 text-xl font-bold ${
          positive === true
            ? "text-emerald-400"
            : positive === false
              ? "text-red-400"
              : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}