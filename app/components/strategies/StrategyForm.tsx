"use client";

import { FormEvent, useState } from "react";

import { useTrading } from "../../context/TradingContext";
import type {
  Strategy,
  StrategyType,
} from "../../lib/trading-types";

interface StrategyFormProps {
  initialStrategy?: Strategy;
  onSuccess?: () => void;
}

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

export default function StrategyForm({
  initialStrategy,
  onSuccess,
}: StrategyFormProps) {
  const { assets, addStrategy } =
    useTrading();

  const [name, setName] = useState(
    initialStrategy?.name ?? ""
  );

  const [type, setType] =
    useState<StrategyType>(
      initialStrategy?.type ??
        "Trend Following"
    );

  const [symbol, setSymbol] = useState(
    initialStrategy?.symbol ??
      assets[0]?.symbol ??
      "BTC/USDT"
  );

  const [timeframe, setTimeframe] =
    useState(
      initialStrategy?.timeframe ??
        "15m"
    );

  const [description, setDescription] =
    useState(
      initialStrategy?.description ?? ""
    );

  const [entryCondition, setEntryCondition] =
    useState(
      initialStrategy?.entryCondition ?? ""
    );

  const [exitCondition, setExitCondition] =
    useState(
      initialStrategy?.exitCondition ?? ""
    );

  const [stopLoss, setStopLoss] =
    useState(
      String(
        initialStrategy?.stopLoss ?? 1
      )
    );

  const [takeProfit, setTakeProfit] =
    useState(
      String(
        initialStrategy?.takeProfit ?? 2
      )
    );

  const [positionSize, setPositionSize] =
    useState(
      String(
        initialStrategy?.positionSize ??
          1000
      )
    );

  const [riskPerTrade, setRiskPerTrade] =
    useState(
      String(
        initialStrategy?.riskPerTrade ??
          1
      )
    );

  const [maxPositions, setMaxPositions] =
    useState(
      String(
        initialStrategy?.maxPositions ??
          1
      )
    );

  const [status, setStatus] =
    useState<Strategy["status"]>(
      initialStrategy?.status ??
        "DRAFT"
    );

  const [error, setError] =
    useState("");

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const validate = () => {
    const parsedStopLoss =
      Number(stopLoss);

    const parsedTakeProfit =
      Number(takeProfit);

    const parsedPositionSize =
      Number(positionSize);

    const parsedRisk =
      Number(riskPerTrade);

    const parsedMaxPositions =
      Number(maxPositions);

    if (!name.trim()) {
      return "Strategy name is required.";
    }

    if (!symbol) {
      return "Please select a trading pair.";
    }

    if (!entryCondition.trim()) {
      return "Entry condition is required.";
    }

    if (!exitCondition.trim()) {
      return "Exit condition is required.";
    }

    if (
      !Number.isFinite(parsedStopLoss) ||
      parsedStopLoss <= 0
    ) {
      return "Stop loss must be greater than 0.";
    }

    if (
      !Number.isFinite(parsedTakeProfit) ||
      parsedTakeProfit <= 0
    ) {
      return "Take profit must be greater than 0.";
    }

    if (
      !Number.isFinite(
        parsedPositionSize
      ) ||
      parsedPositionSize <= 0
    ) {
      return "Position size must be greater than 0.";
    }

    if (
      !Number.isFinite(parsedRisk) ||
      parsedRisk <= 0 ||
      parsedRisk > 100
    ) {
      return "Risk per trade must be between 0 and 100.";
    }

    if (
      !Number.isFinite(
        parsedMaxPositions
      ) ||
      parsedMaxPositions < 1 ||
      !Number.isInteger(
        parsedMaxPositions
      )
    ) {
      return "Maximum positions must be a whole number of at least 1.";
    }

    return null;
  };

  const handleSubmit = (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setError("");

    const validationError =
      validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    const now =
      new Date().toISOString();

    const strategy: Strategy = {
      id:
        initialStrategy?.id ??
        `strategy-${Date.now()}`,

      name: name.trim(),

      description:
        description.trim(),

      type,

      symbol,

      timeframe,

      status,

      entryCondition:
        entryCondition.trim(),

      exitCondition:
        exitCondition.trim(),

      stopLoss:
        Number(stopLoss),

      takeProfit:
        Number(takeProfit),

      positionSize:
        Number(positionSize),

      riskPerTrade:
        Number(riskPerTrade),

      maxPositions:
        Number(maxPositions),

      createdAt:
        initialStrategy?.createdAt ??
        now,

      updatedAt: now,
    };

    if (!initialStrategy) {
      addStrategy(strategy);
    }

    setIsSubmitting(false);

    onSuccess?.();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <section className="trading-panel p-5">
        <div className="mb-5">
          <h2 className="font-medium text-white">
            Strategy Information
          </h2>

          <p className="mt-1 text-xs text-zinc-500">
            Define the basic identity and market
            for this strategy.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Strategy Name
            </label>

            <input
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="e.g. BTC Momentum"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Strategy Type
            </label>

            <select
              value={type}
              onChange={(event) =>
                setType(
                  event.target
                    .value as StrategyType
                )
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            >
              {strategyTypes.map(
                (strategyType) => (
                  <option
                    key={strategyType}
                    value={strategyType}
                  >
                    {strategyType}
                  </option>
                )
              )}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Trading Pair
            </label>

            <select
              value={symbol}
              onChange={(event) =>
                setSymbol(
                  event.target.value
                )
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
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
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Timeframe
            </label>

            <select
              value={timeframe}
              onChange={(event) =>
                setTimeframe(
                  event.target.value
                )
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            >
              {timeframes.map(
                (item) => (
                  <option
                    key={item}
                    value={item}
                  >
                    {item}
                  </option>
                )
              )}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-xs text-zinc-500">
              Description
            </label>

            <textarea
              value={description}
              onChange={(event) =>
                setDescription(
                  event.target.value
                )
              }
              rows={3}
              placeholder="Describe what this strategy is designed to do."
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-zinc-600"
            />
          </div>
        </div>
      </section>

      <section className="trading-panel p-5">
        <div className="mb-5">
          <h2 className="font-medium text-white">
            Trading Logic
          </h2>

          <p className="mt-1 text-xs text-zinc-500">
            Describe the conditions that will eventually
            drive the strategy engine.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Entry Condition
            </label>

            <textarea
              value={entryCondition}
              onChange={(event) =>
                setEntryCondition(
                  event.target.value
                )
              }
              rows={4}
              placeholder="Example: EMA 9 crosses above EMA 21 and RSI is above 55."
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Exit Condition
            </label>

            <textarea
              value={exitCondition}
              onChange={(event) =>
                setExitCondition(
                  event.target.value
                )
              }
              rows={4}
              placeholder="Example: EMA 9 crosses below EMA 21."
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-zinc-600"
            />
          </div>
        </div>
      </section>

      <section className="trading-panel p-5">
        <div className="mb-5">
          <h2 className="font-medium text-white">
            Risk Management
          </h2>

          <p className="mt-1 text-xs text-zinc-500">
            Configure the basic risk limits for this strategy.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Stop Loss %
            </label>

            <input
              type="number"
              min="0"
              step="0.1"
              value={stopLoss}
              onChange={(event) =>
                setStopLoss(
                  event.target.value
                )
              }
              className="number w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Take Profit %
            </label>

            <input
              type="number"
              min="0"
              step="0.1"
              value={takeProfit}
              onChange={(event) =>
                setTakeProfit(
                  event.target.value
                )
              }
              className="number w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Position Size
            </label>

            <input
              type="number"
              min="0"
              step="100"
              value={positionSize}
              onChange={(event) =>
                setPositionSize(
                  event.target.value
                )
              }
              className="number w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Risk / Trade %
            </label>

            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={riskPerTrade}
              onChange={(event) =>
                setRiskPerTrade(
                  event.target.value
                )
              }
              className="number w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              Max Positions
            </label>

            <input
              type="number"
              min="1"
              step="1"
              value={maxPositions}
              onChange={(event) =>
                setMaxPositions(
                  event.target.value
                )
              }
              className="number w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            />
          </div>
        </div>
      </section>

      <section className="trading-panel p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-medium text-white">
              Strategy Status
            </h2>

            <p className="mt-1 text-xs text-zinc-500">
              Draft strategies can be activated later.
            </p>
          </div>

          <div className="flex gap-2">
            {(
              [
                "DRAFT",
                "ACTIVE",
                "PAUSED",
              ] as Strategy["status"][]
            ).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() =>
                  setStatus(item)
                }
                className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
                  status === item
                    ? "border-zinc-500 bg-zinc-800 text-white"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() =>
            onSuccess?.()
          }
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-white"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg border border-zinc-600 bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting
            ? "Saving..."
            : initialStrategy
              ? "Save Changes"
              : "Create Strategy"}
        </button>
      </div>
    </form>
  );
}