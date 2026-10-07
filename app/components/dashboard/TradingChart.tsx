"use client";

import { useEffect, useMemo, useState } from "react";

import { useTrading } from "../../context/TradingContext";
import { formatCurrency } from "../../lib/trading-utils";

interface PricePoint {
  time: string;
  timestamp: number;
  price: number;
}

type TimeRange = "1H" | "4H" | "1D" | "7D";

const TIME_RANGES: {
  value: TimeRange;
  label: string;
}[] = [
  {
    value: "1H",
    label: "1H",
  },
  {
    value: "4H",
    label: "4H",
  },
  {
    value: "1D",
    label: "1D",
  },
  {
    value: "7D",
    label: "7D",
  },
];

export default function TradingChart() {
  const {
    assets,
    selectedSymbol,
    setSelectedSymbol,
  } = useTrading();

  const [timeRange, setTimeRange] =
    useState<TimeRange>("1H");

  const [history, setHistory] = useState<
    Record<string, PricePoint[]>
  >({});

  const selectedAsset = assets.find(
    (asset) =>
      asset.symbol === selectedSymbol
  );

  /*
   * Store simulated price history separately
   * for every coin.
   */
  useEffect(() => {
    if (!selectedAsset) {
      return;
    }

    const symbol = selectedAsset.symbol;

    const point: PricePoint = {
      time: new Date().toLocaleTimeString(
        [],
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }
      ),
      timestamp: Date.now(),
      price: selectedAsset.price,
    };

    setHistory((current) => {
      const previous =
        current[symbol] ?? [];

      const updated = [
        ...previous,
        point,
      ];

      /*
       * Keep a larger history so the
       * time-range selector can filter it.
       */
      return {
        ...current,
        [symbol]: updated.slice(-500),
      };
    });
  }, [selectedAsset?.price]);

  /*
   * Convert the selected time range into
   * a maximum number of simulated points.
   *
   * Current market simulator updates every
   * 3 seconds.
   */
  const maxPoints = useMemo(() => {
    switch (timeRange) {
      case "1H":
        return 60;

      case "4H":
        return 120;

      case "1D":
        return 240;

      case "7D":
        return 500;

      default:
        return 60;
    }
  }, [timeRange]);

  /*
   * Get history belonging only to the
   * currently selected coin.
   */
  const priceHistory = useMemo(() => {
    if (!selectedAsset) {
      return [];
    }

    const symbolHistory =
      history[selectedAsset.symbol] ?? [];

    return symbolHistory.slice(
      -maxPoints
    );
  }, [
    history,
    selectedAsset,
    maxPoints,
  ]);

  /*
   * Always show the current price even
   * before enough simulated points exist.
   */
  const chartData = useMemo(() => {
    if (!selectedAsset) {
      return [];
    }

    if (priceHistory.length === 0) {
      return [
        {
          time: "Now",
          timestamp: Date.now(),
          price: selectedAsset.price,
        },
      ];
    }

    return priceHistory;
  }, [
    priceHistory,
    selectedAsset,
  ]);

  const prices = chartData.map(
    (point) => point.price
  );

  const minPrice =
    prices.length > 0
      ? Math.min(...prices)
      : 0;

  const maxPrice =
    prices.length > 0
      ? Math.max(...prices)
      : 0;

  /*
   * Give the chart some vertical breathing room.
   */
  const range =
    maxPrice - minPrice;

  const padding =
    range === 0
      ? maxPrice * 0.002
      : range * 0.15;

  const chartMin = Math.max(
    0,
    minPrice - padding
  );

  const chartMax =
    maxPrice + padding;

  const chartRange =
    chartMax - chartMin;

  const getX = (index: number) => {
    if (chartData.length <= 1) {
      return 50;
    }

    return (
      5 +
      (index /
        (chartData.length - 1)) *
        90
    );
  };

  const getY = (price: number) => {
    if (chartRange === 0) {
      return 50;
    }

    return (
      90 -
      ((price - chartMin) /
        chartRange) *
        80
    );
  };

  const points = chartData
    .map(
      (point, index) =>
        `${getX(index)},${getY(
          point.price
        )}`
    )
    .join(" ");

  const positive =
    selectedAsset
      ? selectedAsset.change24h >= 0
      : true;

  const priceDecimals =
    selectedAsset &&
    selectedAsset.price < 1
      ? 4
      : 2;

  return (
    <section className="trading-panel overflow-hidden">
      {/* ============================= */}
      {/* HEADER                         */}
      {/* ============================= */}

      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Title */}
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-medium text-white">
                Price Chart
              </h2>

              <span className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="live-dot" />
                Live
              </span>
            </div>

            {selectedAsset && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-medium text-zinc-300">
                  {selectedAsset.symbol}
                </span>

                <span className="number text-xl font-semibold text-white">
                  $
                  {formatCurrency(
                    selectedAsset.price,
                    priceDecimals
                  )}
                </span>

                <span
                  className={`number text-sm ${
                    positive
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {positive ? "+" : ""}
                  {selectedAsset.change24h.toFixed(
                    2
                  )}
                  %
                </span>
              </div>
            )}
          </div>

          {/* ============================= */}
          {/* CONTROLS                      */}
          {/* ============================= */}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* Time Range */}
            <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {TIME_RANGES.map(
                (rangeOption) => {
                  const active =
                    timeRange ===
                    rangeOption.value;

                  return (
                    <button
                      key={
                        rangeOption.value
                      }
                      type="button"
                      onClick={() =>
                        setTimeRange(
                          rangeOption.value
                        )
                      }
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? "bg-zinc-700 text-white"
                          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                      }`}
                    >
                      {rangeOption.label}
                    </button>
                  );
                }
              )}
            </div>

            {/* Coin Selection */}
            <select
              value={selectedSymbol}
              onChange={(event) =>
                setSelectedSymbol(
                  event.target.value
                )
              }
              className="min-w-[155px] cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition hover:border-zinc-500 focus:border-zinc-400"
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
        </div>
      </div>

      {/* ============================= */}
      {/* CHART                          */}
      {/* ============================= */}

      <div className="p-5">
        <div className="relative h-[340px] w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          {/* Grid */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-0 right-0 top-[20%] border-t border-zinc-900" />

            <div className="absolute left-0 right-0 top-[40%] border-t border-zinc-900" />

            <div className="absolute left-0 right-0 top-[60%] border-t border-zinc-900" />

            <div className="absolute left-0 right-0 top-[80%] border-t border-zinc-900" />
          </div>

          {/* Y Axis */}
          {selectedAsset && (
            <div className="pointer-events-none absolute right-3 top-3 bottom-8 flex flex-col justify-between text-[10px] text-zinc-600">
              <span>
                $
                {formatCurrency(
                  chartMax,
                  priceDecimals
                )}
              </span>

              <span>
                $
                {formatCurrency(
                  (chartMax +
                    chartMin) /
                    2,
                  priceDecimals
                )}
              </span>

              <span>
                $
                {formatCurrency(
                  chartMin,
                  priceDecimals
                )}
              </span>
            </div>
          )}

          {/* Chart */}
          {selectedAsset && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              {/* Area */}
              {chartData.length > 1 && (
                <polygon
                  points={`5,90 ${points} 95,90`}
                  fill="currentColor"
                  opacity="0.06"
                  className={
                    positive
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                />
              )}

              {/* Line */}
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={
                  positive
                    ? "text-emerald-400"
                    : "text-red-400"
                }
              />

              {/* Current Price */}
              {chartData.length > 0 && (
                <circle
                  cx={getX(
                    chartData.length - 1
                  )}
                  cy={getY(
                    chartData[
                      chartData.length - 1
                    ].price
                  )}
                  r="1.2"
                  fill="currentColor"
                  className={
                    positive
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                />
              )}
            </svg>
          )}

          {!selectedAsset && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
              Select a market.
            </div>
          )}

          {/* Time labels */}
          {chartData.length > 0 && (
            <div className="absolute bottom-2 left-3 right-3 flex justify-between text-[10px] text-zinc-600">
              <span>
                {chartData[0].time}
              </span>

              <span>
                {
                  chartData[
                    chartData.length - 1
                  ].time
                }
              </span>
            </div>
          )}
        </div>

        {/* ============================= */}
        {/* STATISTICS                     */}
        {/* ============================= */}

        {selectedAsset && (
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
            <div>
              <div className="text-xs text-zinc-500">
                Current
              </div>

              <div className="number mt-1 text-sm text-white">
                $
                {formatCurrency(
                  selectedAsset.price,
                  priceDecimals
                )}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">
                24h High
              </div>

              <div className="number mt-1 text-sm text-zinc-300">
                $
                {formatCurrency(
                  selectedAsset.high24h,
                  selectedAsset.high24h <
                    1
                    ? 4
                    : 2
                )}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">
                24h Low
              </div>

              <div className="number mt-1 text-sm text-zinc-300">
                $
                {formatCurrency(
                  selectedAsset.low24h,
                  selectedAsset.low24h <
                    1
                    ? 4
                    : 2
                )}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">
                24h Change
              </div>

              <div
                className={`number mt-1 text-sm ${
                  positive
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                {positive ? "+" : ""}
                {selectedAsset.change24h.toFixed(
                  2
                )}
                %
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">
                Range
              </div>

              <div className="number mt-1 text-sm text-zinc-300">
                {timeRange}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}