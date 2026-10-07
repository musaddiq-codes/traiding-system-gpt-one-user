"use client";

import {
  formatCurrency,
  formatPercent,
  isPositive,
} from "../../lib/trading-utils";

import { useTrading } from "../../context/TradingContext";

export default function AccountSummary() {
  const { account } = useTrading();

  const totalPnlPercent =
    account.balance !== 0
      ? (account.totalPnl / account.balance) * 100
      : 0;

  const unrealizedPositive =
    isPositive(account.unrealizedPnl);

  const realizedPositive =
    isPositive(account.realizedPnl);

  const totalPositive =
    isPositive(account.totalPnl);

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* Equity */}
      <div className="trading-panel trading-panel-hover p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">
            Account Equity
          </span>

          <span className="live-dot" />
        </div>

        <div className="number text-2xl font-semibold text-white">
          ${formatCurrency(account.equity)}
        </div>

        <div className="mt-2 text-xs text-zinc-500">
          Current account value
        </div>
      </div>

      {/* Available Balance */}
      <div className="trading-panel trading-panel-hover p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">
            Available Balance
          </span>
        </div>

        <div className="number text-2xl font-semibold text-white">
          ${formatCurrency(account.availableBalance)}
        </div>

        <div className="mt-2 text-xs text-zinc-500">
          Available for new positions
        </div>
      </div>

      {/* Unrealized P&L */}
      <div className="trading-panel trading-panel-hover p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">
            Unrealized P&L
          </span>
        </div>

        <div
          className={`number text-2xl font-semibold ${
            unrealizedPositive
              ? "text-emerald-400"
              : "text-red-400"
          }`}
        >
          {unrealizedPositive ? "+" : ""}
          ${formatCurrency(account.unrealizedPnl)}
        </div>

        <div className="mt-2 text-xs text-zinc-500">
          Open position profit/loss
        </div>
      </div>

      {/* Total P&L */}
      <div className="trading-panel trading-panel-hover p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">
            Total P&L
          </span>
        </div>

        <div
          className={`number text-2xl font-semibold ${
            totalPositive
              ? "text-emerald-400"
              : "text-red-400"
          }`}
        >
          {totalPositive ? "+" : ""}
          ${formatCurrency(account.totalPnl)}
        </div>

        <div
          className={`mt-2 text-xs ${
            totalPositive
              ? "text-emerald-400"
              : "text-red-400"
          }`}
        >
          {formatPercent(totalPnlPercent)}
        </div>
      </div>

      {/* Detailed Account Information */}
      <div className="trading-panel md:col-span-2 xl:col-span-4 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-medium text-white">
            Account Details
          </h3>

          <span className="text-xs text-zinc-500">
            Paper Trading
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <div className="text-xs text-zinc-500">
              Starting Balance
            </div>

            <div className="number mt-1 text-sm text-zinc-200">
              ${formatCurrency(account.balance)}
            </div>
          </div>

          <div>
            <div className="text-xs text-zinc-500">
              Used Margin
            </div>

            <div className="number mt-1 text-sm text-zinc-200">
              ${formatCurrency(account.usedMargin)}
            </div>
          </div>

          <div>
            <div className="text-xs text-zinc-500">
              Realized P&L
            </div>

            <div
              className={`number mt-1 text-sm ${
                realizedPositive
                  ? "text-emerald-400"
                  : "text-red-400"
              }`}
            >
              {realizedPositive ? "+" : ""}
              ${formatCurrency(account.realizedPnl)}
            </div>
          </div>

          <div>
            <div className="text-xs text-zinc-500">
              Margin Utilization
            </div>

            <div className="number mt-1 text-sm text-zinc-200">
              {account.equity !== 0
                ? formatPercent(
                    (account.usedMargin /
                      account.equity) *
                      100
                  )
                : "0.00%"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}