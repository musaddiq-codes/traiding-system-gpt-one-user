"use client";

import Link from "next/link";

import { useTrading } from "../../context/TradingContext";
import type { Strategy } from "../../lib/trading-types";
import { formatCurrency } from "../../lib/trading-utils";

interface StrategyCardProps {
  strategy: Strategy;
}

export default function StrategyCard({
  strategy,
}: StrategyCardProps) {
  const {
    updateStrategyStatus,
    deleteStrategy,
  } = useTrading();

  const isActive =
    strategy.status === "ACTIVE";

  const isPaused =
    strategy.status === "PAUSED";

  const statusLabel =
    strategy.status === "ACTIVE"
      ? "ACTIVE"
      : strategy.status === "PAUSED"
        ? "PAUSED"
        : "DRAFT";

  const statusClass =
    strategy.status === "ACTIVE"
      ? "border-emerald-900 bg-emerald-950/30 text-emerald-400"
      : strategy.status === "PAUSED"
        ? "border-amber-900 bg-amber-950/30 text-amber-400"
        : "border-zinc-700 bg-zinc-900 text-zinc-400";

  const toggleStrategy = () => {
    updateStrategyStatus(
      strategy.id,
      isActive ? "PAUSED" : "ACTIVE"
    );
  };

  const handleDelete = () => {
    const confirmed =
      window.confirm(
        `Delete "${strategy.name}"?`
      );

    if (!confirmed) {
      return;
    }

    deleteStrategy(strategy.id);
  };

  return (
    <article className="trading-panel trading-panel-hover overflow-hidden">
      <div className="border-b border-zinc-800 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-medium text-white">
                {strategy.name}
              </h2>

              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass}`}
              >
                {statusLabel}
              </span>
            </div>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              {strategy.description ||
                "No strategy description provided."}
            </p>
          </div>

          <div className="shrink-0">
            <span className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-500">
              {strategy.type}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-zinc-800 bg-zinc-800 md:grid-cols-4">
        <div className="bg-zinc-950 p-4">
          <div className="text-[11px] text-zinc-600">
            Market
          </div>

          <div className="mt-1 text-sm font-medium text-zinc-200">
            {strategy.symbol}
          </div>
        </div>

        <div className="bg-zinc-950 p-4">
          <div className="text-[11px] text-zinc-600">
            Timeframe
          </div>

          <div className="number mt-1 text-sm font-medium text-zinc-200">
            {strategy.timeframe}
          </div>
        </div>

        <div className="bg-zinc-950 p-4">
          <div className="text-[11px] text-zinc-600">
            Stop Loss
          </div>

          <div className="number mt-1 text-sm font-medium text-red-400">
            {strategy.stopLoss}%
          </div>
        </div>

        <div className="bg-zinc-950 p-4">
          <div className="text-[11px] text-zinc-600">
            Take Profit
          </div>

          <div className="number mt-1 text-sm font-medium text-emerald-400">
            {strategy.takeProfit}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
        <div>
          <div className="text-xs text-zinc-600">
            Position Size
          </div>

          <div className="number mt-1 text-sm text-zinc-300">
            ${formatCurrency(
              strategy.positionSize
            )}
          </div>
        </div>

        <div>
          <div className="text-xs text-zinc-600">
            Risk / Trade
          </div>

          <div className="number mt-1 text-sm text-zinc-300">
            {strategy.riskPerTrade}%
          </div>
        </div>

        <div>
          <div className="text-xs text-zinc-600">
            Max Positions
          </div>

          <div className="number mt-1 text-sm text-zinc-300">
            {strategy.maxPositions}
          </div>
        </div>

        <div>
          <div className="text-xs text-zinc-600">
            Updated
          </div>

          <div className="mt-1 text-xs text-zinc-400">
            {new Date(
              strategy.updatedAt
            ).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Link
              href={`/strategies/${strategy.id}`}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
            >
              View Details
            </Link>

            <Link
              href={`/strategies/${strategy.id}`}
              className="rounded-md border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
            >
              Edit
            </Link>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleStrategy}
              className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
                isActive
                  ? "border-amber-900 bg-amber-950/20 text-amber-400 hover:bg-amber-950/40"
                  : "border-emerald-900 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-950/40"
              }`}
            >
              {isActive
                ? "Pause"
                : isPaused
                  ? "Start"
                  : "Activate"}
            </button>

            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:border-red-900 hover:bg-red-950/20 hover:text-red-400"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}