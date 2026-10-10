"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Sidebar from "../../components/navigation/Sidebar";
import Header from "../../components/navigation/Header";
import { useTrading } from "../../context/TradingContext";
import {
  Strategy,
  StrategyType,
} from "../../lib/trading-types";

const strategyTypes: StrategyType[] = [
  "Trend Following",
  "Mean Reversion",
  "Breakout",
  "Scalping",
  "Grid",
  "Custom",
];

const timeframes = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
];

const symbols = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "BNB/USDT",
  "XRP/USDT",
];

export default function NewStrategyPage() {
  const router = useRouter();
  const { addStrategy } = useTrading();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] =
    useState<StrategyType>("Trend Following");
  const [symbol, setSymbol] =
    useState("BTC/USDT");
  const [timeframe, setTimeframe] =
    useState("15m");

  const [entryCondition, setEntryCondition] =
    useState("");
  const [exitCondition, setExitCondition] =
    useState("");

  const [stopLoss, setStopLoss] = useState("1.5");
  const [takeProfit, setTakeProfit] = useState("3");
  const [positionSize, setPositionSize] =
    useState("10000");
  const [riskPerTrade, setRiskPerTrade] =
    useState("1");
  const [maxPositions, setMaxPositions] =
    useState("2");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      return;
    }

    setSaving(true);
    setError("");

    const now = new Date().toISOString();

    const strategy: Strategy = {
      id: `strategy-${Date.now()}`,
      name: name.trim(),
      description:
        description.trim() ||
        "Custom trading strategy.",
      type,
      symbol,
      timeframe,
      status: "DRAFT",
      entryCondition:
        entryCondition.trim() ||
        "Custom entry condition.",
      exitCondition:
        exitCondition.trim() ||
        "Custom exit condition.",
      stopLoss: Number(stopLoss) || 0,
      takeProfit: Number(takeProfit) || 0,
      positionSize:
        Number(positionSize) || 0,
      riskPerTrade:
        Number(riskPerTrade) || 0,
      maxPositions:
        Number(maxPositions) || 1,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await addStrategy(strategy);
      router.push("/strategies");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save strategy."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#070b12] text-white">
      <Sidebar />

      <div className="lg:pl-64">
        <Header />

        <main className="p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8">
              <Link
                href="/strategies"
                className="mb-4 inline-flex text-sm text-slate-400 transition hover:text-white"
              >
                ← Back to Strategies
              </Link>

              <h1 className="text-2xl font-semibold">
                Create Strategy
              </h1>

              <p className="mt-1 text-sm text-slate-400">
                Configure a paper-trading strategy.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-6"
            >
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <section className="trading-panel rounded-2xl p-6">
                <h2 className="mb-5 text-lg font-semibold">
                  Strategy Information
                </h2>

                <div className="grid gap-5 md:grid-cols-2">
                  <Field
                    label="Strategy Name"
                    value={name}
                    onChange={setName}
                    placeholder="e.g. BTC Momentum"
                  />

                  <SelectField
                    label="Strategy Type"
                    value={type}
                    options={strategyTypes}
                    onChange={(value) =>
                      setType(
                        value as StrategyType
                      )
                    }
                  />

                  <SelectField
                    label="Trading Pair"
                    value={symbol}
                    options={symbols}
                    onChange={setSymbol}
                  />

                  <SelectField
                    label="Timeframe"
                    value={timeframe}
                    options={timeframes}
                    onChange={setTimeframe}
                  />
                </div>

                <div className="mt-5">
                  <label className="mb-2 block text-sm text-slate-300">
                    Description
                  </label>

                  <textarea
                    value={description}
                    onChange={(event) =>
                      setDescription(
                        event.target.value
                      )
                    }
                    placeholder="Describe what this strategy is designed to do..."
                    rows={4}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-blue-500/50"
                  />
                </div>
              </section>

              <section className="trading-panel rounded-2xl p-6">
                <h2 className="mb-5 text-lg font-semibold">
                  Trading Logic
                </h2>

                <div className="grid gap-5 md:grid-cols-2">
                  <TextAreaField
                    label="Entry Condition"
                    value={entryCondition}
                    onChange={setEntryCondition}
                    placeholder="Example: EMA 9 crosses above EMA 21 and RSI > 55"
                  />

                  <TextAreaField
                    label="Exit Condition"
                    value={exitCondition}
                    onChange={setExitCondition}
                    placeholder="Example: EMA 9 crosses below EMA 21"
                  />
                </div>
              </section>

              <section className="trading-panel rounded-2xl p-6">
                <h2 className="mb-5 text-lg font-semibold">
                  Risk Management
                </h2>

                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <NumberField
                    label="Stop Loss (%)"
                    value={stopLoss}
                    onChange={setStopLoss}
                    step="0.1"
                  />

                  <NumberField
                    label="Take Profit (%)"
                    value={takeProfit}
                    onChange={setTakeProfit}
                    step="0.1"
                  />

                  <NumberField
                    label="Position Size ($)"
                    value={positionSize}
                    onChange={setPositionSize}
                    step="100"
                  />

                  <NumberField
                    label="Risk Per Trade (%)"
                    value={riskPerTrade}
                    onChange={setRiskPerTrade}
                    step="0.1"
                  />

                  <NumberField
                    label="Maximum Positions"
                    value={maxPositions}
                    onChange={setMaxPositions}
                    step="1"
                    min="1"
                  />
                </div>
              </section>

              <section className="trading-panel rounded-2xl p-6">
                <h2 className="font-semibold">Strategy review required</h2>
                <p className="mt-1 text-sm text-slate-400">
                  New strategies are saved as drafts. Run a realistic backtest and
                  manually approve an eligible result before paper trading.
                </p>
              </section>

              <div className="flex justify-end gap-3">
                <Link
                  href="/strategies"
                  className="rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </Link>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-blue-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving Strategy..." : "Create Strategy"}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm text-slate-300">
        {label}
      </label>

      <input
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-blue-500/50"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm text-slate-300">
        {label}
      </label>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="w-full rounded-xl border border-white/10 bg-[#0c121c] px-4 py-3 text-sm outline-none focus:border-blue-500/50"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm text-slate-300">
        {label}
      </label>

      <textarea
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        rows={5}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-blue-500/50"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = "1",
  min = "0",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  min?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm text-slate-300">
        {label}
      </label>

      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none focus:border-blue-500/50"
      />
    </div>
  );
}