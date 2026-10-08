"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "../components/navigation/Header";
import Sidebar from "../components/navigation/Sidebar";
import { useTrading } from "../context/TradingContext";
import type { Strategy } from "../lib/trading-types";
import type { BacktestResult } from "../lib/backtest-types";

export default function BacktestPage() {
  const { approveStrategyForPaper } = useTrading();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [days, setDays] = useState(30);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirmApproval, setConfirmApproval] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadStrategies() {
      try {
        const response = await fetch("/api/strategies");
        const payload = await response.json();

        if (Array.isArray(payload.strategies) && payload.strategies.length > 0) {
          setStrategies(payload.strategies);
          setSelectedId(payload.strategies[0].id);
        }
      } catch {
        setError("Failed to load stored strategies.");
      }
    }

    void loadStrategies();
  }, []);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedId) ?? null,
    [strategies, selectedId]
  );
  const equityCurvePoints = useMemo(() => {
    if (!results || results.equityCurve.length < 2) {
      return "";
    }

    const minimum = Math.min(...results.equityCurve);
    const maximum = Math.max(...results.equityCurve);
    const range = Math.max(maximum - minimum, 1);

    return results.equityCurve
      .map((value, index) => {
        const x = (index / (results.equityCurve.length - 1)) * 100;
        const y = 100 - ((value - minimum) / range) * 90 - 5;
        return `${x},${y}`;
      })
      .join(" ");
  }, [results]);

  async function handleBacktest() {
    if (!selectedStrategy) {
      setError("Select a strategy first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          strategy: selectedStrategy,
          symbol: selectedStrategy.symbol,
          days,
          initialBalance: 100000,
          feeBps,
          slippageBps,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Backtest failed.");
      }

      setResults(payload);
      setConfirmApproval(false);
      setReviewNotes("");
      setReviewMessage("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Backtest failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveForPaper() {
    if (!results || !selectedStrategy || !confirmApproval) {
      return;
    }

    setReviewing(true);
    setError("");
    setReviewMessage("");

    try {
      const approvedStrategy = await approveStrategyForPaper(
        selectedStrategy.id,
        results.runId,
        reviewNotes
      );
      setStrategies((current) =>
        current.map((strategy) =>
          strategy.id === approvedStrategy.id ? approvedStrategy : strategy
        )
      );
      setReviewMessage(
        "Approved for paper trading. This does not enable live exchange orders."
      );
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Unable to approve strategy for paper trading."
      );
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <Sidebar />

      <div className="lg:pl-[245px]">
        <Header />

        <main className="mx-auto max-w-[1400px] px-5 py-6 lg:px-7">
          <div className="mb-7">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
              Strategy testing
            </p>

            <h1 className="text-2xl font-bold tracking-tight">Backtester</h1>

            <p className="mt-1 text-xs text-slate-600">
              Simulate your custom strategy against historical Binance candles at its configured timeframe.
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="trading-panel p-5">
              <div className="mb-5">
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Strategy
                </label>

                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setResults(null);
                    setConfirmApproval(false);
                    setReviewMessage("");
                  }}
                  className="w-full rounded-lg border border-[#1b2330] bg-[#090c11] px-3 py-3 text-sm text-white outline-none focus:border-blue-500/50"
                >
                  {strategies.length === 0 ? (
                    <option value="">No saved strategies</option>
                  ) : (
                    strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>
                        {strategy.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="mb-5">
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Lookback Days
                </label>

                <input
                  type="number"
                  min={7}
                  max={180}
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value) || 30)}
                  className="w-full rounded-lg border border-[#1b2330] bg-[#090c11] px-3 py-3 text-sm text-white outline-none focus:border-blue-500/50"
                />
              </div>

              <div className="mb-5 grid grid-cols-2 gap-3">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Fee (bps / side)
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={feeBps}
                    onChange={(event) => setFeeBps(Number(event.target.value))}
                    className="mt-2 w-full rounded-lg border border-[#1b2330] bg-[#090c11] px-3 py-3 text-sm text-white outline-none focus:border-blue-500/50"
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Slippage (bps / side)
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={slippageBps}
                    onChange={(event) => setSlippageBps(Number(event.target.value))}
                    className="mt-2 w-full rounded-lg border border-[#1b2330] bg-[#090c11] px-3 py-3 text-sm text-white outline-none focus:border-blue-500/50"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={handleBacktest}
                disabled={loading || !selectedStrategy}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Running Backtest..." : "Run Backtest"}
              </button>

              {error && (
                <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              {selectedStrategy && (
                <div className="mt-6 rounded-xl border border-[#1b2330] bg-[#090c11] p-4 text-xs text-slate-400">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Strategy Rule
                  </div>

                  <div className="space-y-1 leading-6">
                    <div>
                      <span className="text-blue-400">Entry:</span> {selectedStrategy.entryCondition}
                    </div>
                    <div>
                      <span className="text-red-400">Exit:</span> {selectedStrategy.exitCondition}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="trading-panel overflow-hidden">
              {!results ? (
                <div className="flex min-h-[400px] items-center justify-center px-6 text-center">
                  <div>
                    <div className="text-sm font-semibold text-slate-400">No backtest run yet</div>
                    <div className="mt-2 text-xs text-slate-600">
                      Select a strategy and run a simulated evaluation.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5">
                  <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">
                        Backtest Summary
                      </div>

                      <h2 className="mt-1 text-xl font-semibold text-white">
                        {results.strategyName}
                      </h2>
                    </div>

                    <div className="text-xs text-slate-500">
                      {results.symbol} • {results.from} → {results.to}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Net Profit" value={`$${results.netProfit.toFixed(2)}`} positive={results.netProfit >= 0} />
                    <Metric label="Total Return" value={`${results.totalReturn.toFixed(2)}%`} positive={results.totalReturn >= 0} />
                    <Metric label="Win Rate" value={`${results.winRate.toFixed(2)}%`} />
                    <Metric label="Trades" value={String(results.totalTrades)} />
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Winning Trades" value={String(results.winningTrades)} />
                    <Metric label="Losing Trades" value={String(results.losingTrades)} />
                    <Metric label="Max Drawdown" value={`${results.maxDrawdown.toFixed(2)}%`} />
                    <Metric label="Fees Paid" value={`$${results.feesPaid.toFixed(2)}`} />
                  </div>

                  <div className={`mt-6 rounded-xl border p-4 ${
                    results.eligibleForPaperReview
                      ? "border-emerald-700/40 bg-emerald-950/20"
                      : "border-amber-700/40 bg-amber-950/20"
                  }`}>
                    <div className="text-sm font-semibold">
                      {results.eligibleForPaperReview
                        ? "Eligible for manual paper review"
                        : "Not eligible for paper approval"}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {results.reviewEligibilityReason}
                    </p>

                    {results.eligibleForPaperReview && selectedStrategy && (
                      <div className="mt-4 space-y-3">
                        {selectedStrategy.paperApprovedBacktestId === results.runId ? (
                          <p className="text-xs text-emerald-300">
                            This exact strategy version is approved for paper trading.
                          </p>
                        ) : (
                          <>
                            <label className="block text-xs text-slate-300">
                              Review notes (optional)
                              <textarea
                                value={reviewNotes}
                                onChange={(event) => setReviewNotes(event.target.value)}
                                maxLength={2000}
                                rows={3}
                                className="mt-2 w-full rounded-lg border border-[#1b2330] bg-[#090c11] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
                              />
                            </label>
                            <label className="flex items-start gap-2 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                checked={confirmApproval}
                                onChange={(event) => setConfirmApproval(event.target.checked)}
                                className="mt-0.5"
                              />
                              I reviewed the assumptions, performance, and drawdown, and approve this saved strategy version for paper trading only.
                            </label>
                            <button
                              type="button"
                              onClick={handleApproveForPaper}
                              disabled={!confirmApproval || reviewing}
                              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {reviewing ? "Recording review..." : "Approve for Paper Trading"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 rounded-xl border border-[#1b2330] bg-[#090c11] p-4">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      Simulation assumptions
                    </div>
                    <ul className="space-y-1 text-xs text-slate-400">
                      {results.executionAssumptions.map((assumption) => (
                        <li key={assumption}>• {assumption}</li>
                      ))}
                    </ul>
                  </div>

                  {reviewMessage && (
                    <div className="mt-4 rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
                      {reviewMessage}
                    </div>
                  )}

                  <div className="mt-8">
                    <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      Equity Curve
                    </div>

                    <div className="h-44 rounded-xl border border-[#1b2330] bg-[#090c11] p-3">
                      <svg viewBox="0 0 100 100" className="h-full w-full">
                        {results.equityCurve.length > 1 && (
                          <polyline
                            fill="none"
                            stroke={results.netProfit >= 0 ? "#34d399" : "#f87171"}
                            strokeWidth="2"
                            points={equityCurvePoints}
                          />
                        )}
                      </svg>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
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
    <div className="rounded-xl border border-[#1b2330] bg-[#090c11] p-4">
      <div className="text-[10px] uppercase tracking-wide text-slate-600">{label}</div>
      <div
        className={`number mt-2 text-xl font-semibold ${
          positive === undefined ? "text-white" : positive ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
