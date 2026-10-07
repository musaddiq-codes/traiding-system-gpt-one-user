"use client";

import { useState } from "react";

import Sidebar from "../components/navigation/Sidebar";
import Header from "../components/navigation/Header";
import AccountSummary from "../components/dashboard/AccountSummary";
import MarketOverview from "../components/dashboard/MarketOverview";
import TradingChart from "../components/dashboard/TradingChart";
import OpenPositions from "../components/dashboard/OpenPositions";
import RecentTrades from "../components/dashboard/RecentTrades";

import { useTrading } from "../context/TradingContext";
import { formatCurrency } from "../lib/trading-utils";

export default function DashboardPage() {
  const {
    account,
    assets,
    selectedSymbol,
    setSelectedSymbol,
    openPaperPosition,
    refreshMarketData,
  } = useTrading();

  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [amount, setAmount] = useState("");

  const selectedAsset =
    assets.find((asset) => asset.symbol === selectedSymbol) ??
    assets[0];

  function handleTrade() {
    const quantity = Number(amount);

    if (!quantity || quantity <= 0 || !selectedAsset) {
      return;
    }

    openPaperPosition(
      selectedAsset.symbol,
      side,
      quantity
    );

    setAmount("");
  }

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <Sidebar />

      <div className="lg:pl-[245px]">
        <Header />

        <main className="mx-auto max-w-[1500px] px-5 py-6 lg:px-7">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
                Portfolio overview
              </p>

              <h1 className="text-2xl font-bold tracking-tight">
                Trading Dashboard
              </h1>

              <p className="mt-1 text-xs text-slate-600">
                Monitor your portfolio, markets and automated strategies.
              </p>
            </div>

            <button
              onClick={refreshMarketData}
              className="w-fit rounded-lg border border-[#27303d] bg-[#0d1118] px-4 py-2.5 text-xs font-semibold text-slate-400 transition hover:border-blue-500/40 hover:text-white"
            >
              ↻ Refresh Market
            </button>
          </div>

          <div className="space-y-6">
            <AccountSummary />

            <MarketOverview />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <TradingChart />

              <div className="trading-panel p-5">
                <div className="mb-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                      Quick Trade
                    </h2>

                    <span className="rounded-md bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-400">
                      PAPER
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-600">
                    Execute a simulated market order
                  </p>
                </div>

                <div className="mb-5 flex rounded-lg bg-[#080b10] p-1">
                  <button
                    onClick={() => setSide("LONG")}
                    className={`flex-1 rounded-md py-2 text-xs font-bold transition ${
                      side === "LONG"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "text-slate-600 hover:text-white"
                    }`}
                  >
                    BUY
                  </button>

                  <button
                    onClick={() => setSide("SHORT")}
                    className={`flex-1 rounded-md py-2 text-xs font-bold transition ${
                      side === "SHORT"
                        ? "bg-red-500/10 text-red-400"
                        : "text-slate-600 hover:text-white"
                    }`}
                  >
                    SELL
                  </button>
                </div>

                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Trading pair
                </label>

                <select
                  value={selectedSymbol}
                  onChange={(event) =>
                    setSelectedSymbol(event.target.value)
                  }
                  className="mb-4 w-full rounded-lg border border-[#1b2330] bg-[#080b10] px-3 py-3 text-xs font-semibold text-white outline-none focus:border-blue-500/50"
                >
                  {assets.map((asset) => (
                    <option
                      key={asset.symbol}
                      value={asset.symbol}
                    >
                      {asset.symbol}
                    </option>
                  ))}
                </select>

                <div className="mb-4 flex items-center justify-between text-[10px]">
                  <span className="text-slate-600">
                    Market price
                  </span>

                  <span className="number text-slate-300">
                    {formatCurrency(selectedAsset?.price ?? 0)}
                  </span>
                </div>

                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Quantity
                </label>

                <div className="mb-4 flex rounded-lg border border-[#1b2330] bg-[#080b10] px-3 py-3">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amount}
                    onChange={(event) =>
                      setAmount(event.target.value)
                    }
                    placeholder="0.00"
                    className="number w-full bg-transparent text-sm outline-none placeholder:text-slate-700"
                  />

                  <span className="text-xs text-slate-600">
                    {selectedSymbol.split("/")[0]}
                  </span>
                </div>

                <div className="mb-5 flex justify-between text-[10px]">
                  <span className="text-slate-600">
                    Available balance
                  </span>

                  <span className="number text-slate-400">
                    {formatCurrency(
                      account.availableBalance
                    )}
                  </span>
                </div>

                <button
                  onClick={handleTrade}
                  disabled={!amount || Number(amount) <= 0}
                  className={`w-full rounded-lg py-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    side === "LONG"
                      ? "bg-emerald-500 text-[#041008] hover:bg-emerald-400"
                      : "bg-red-500 text-white hover:bg-red-400"
                  }`}
                >
                  {side === "LONG"
                    ? "Place Buy Order"
                    : "Place Sell Order"}
                </button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <OpenPositions />
              <RecentTrades />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}