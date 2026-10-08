"use client";

import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

import { useTrading } from "../../context/TradingContext";
import type { CandlePoint, ChartRange } from "../../lib/market-data";
import { subscribeToKline } from "../../lib/market-data-stream";
import { formatCurrency } from "../../lib/trading-utils";

const TIME_RANGES: {
  value: ChartRange;
  label: string;
}[] = [
  { value: "1s", label: "1s" },
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1d", label: "1d" },
];

export default function TradingChart() {
  const { assets, selectedSymbol, setSelectedSymbol } = useTrading();
  const [timeRange, setTimeRange] = useState<ChartRange>("1m");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const currentPriceLineRef = useRef<IPriceLine | null>(null);

  const selectedAsset = assets.find((asset) => asset.symbol === selectedSymbol);
  const priceDecimals = selectedAsset && selectedAsset.price < 1 ? 4 : 2;
  const positive = selectedAsset ? selectedAsset.change24h >= 0 : true;

  useEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }

    const chart = createChart(chartContainerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#090c11" },
        textColor: "#71717a",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#18181b" },
        horzLines: { color: "#18181b" },
      },
      crosshair: {
        vertLine: { color: "#52525b", labelBackgroundColor: "#27272a" },
        horzLine: { color: "#52525b", labelBackgroundColor: "#27272a" },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        barSpacing: 9,
        minBarSpacing: 4,
      },
      localization: {
        priceFormatter: (price: number) =>
          `$${formatCurrency(price, price < 1 ? 4 : 2)}`,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
      visible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candles;
    volumeSeriesRef.current = volume;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      currentPriceLineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }

    const controller = new AbortController();
    let unsubscribe: (() => void) | null = null;

    async function loadCandles() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `/api/market?symbol=${encodeURIComponent(selectedSymbol)}&interval=${encodeURIComponent(timeRange)}&limit=120`,
          { cache: "no-store", signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error(`Candle request failed: ${response.status}`);
        }

        const payload = await response.json();

        if (controller.signal.aborted) {
          return;
        }

        if (!Array.isArray(payload.candles) || payload.candles.length === 0) {
          throw new Error("The market provider returned no candles.");
        }

        const candles = payload.candles as CandlePoint[];
        candleSeriesRef.current?.setData(
          candles.map((candle) => ({
            time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          }))
        );
        volumeSeriesRef.current?.setData(
          candles.map((candle) => ({
            time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
            value: candle.volume,
            color: candle.close >= candle.open
              ? "rgba(34, 197, 94, 0.35)"
              : "rgba(239, 68, 68, 0.35)",
          }))
        );
        chartRef.current?.timeScale().fitContent();

        unsubscribe = subscribeToKline(
          selectedSymbol,
          timeRange,
          (candle) => {
            candleSeriesRef.current?.update({
              time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
            });
            volumeSeriesRef.current?.update({
              time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
              value: candle.volume,
              color: candle.close >= candle.open
                ? "rgba(34, 197, 94, 0.35)"
                : "rgba(239, 68, 68, 0.35)",
            });
          }
        );
      } catch (cause) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load candle data."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadCandles();

    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [selectedSymbol, timeRange]);

  useEffect(() => {
    if (!candleSeriesRef.current || !selectedAsset) {
      return;
    }

    if (currentPriceLineRef.current) {
      currentPriceLineRef.current.applyOptions({
        price: selectedAsset.price,
        color: positive ? "#22c55e" : "#ef4444",
      });
      return;
    }

    currentPriceLineRef.current =
      candleSeriesRef.current.createPriceLine({
        price: selectedAsset.price,
        color: positive ? "#22c55e" : "#ef4444",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "MARK",
      });
  }, [selectedAsset, positive]);

  const currentPrice = selectedAsset?.price ?? 0;

  return (
    <section className="trading-panel overflow-hidden">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-medium text-white">Price Chart</h2>
              <span className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="live-dot" />
                {isLoading ? "Updating" : "Live"}
              </span>
            </div>

            {selectedAsset && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-medium text-zinc-300">{selectedAsset.symbol}</span>
                <span className="number text-xl font-semibold text-white">
                  ${formatCurrency(currentPrice, priceDecimals)}
                </span>
                <span
                  className={`number text-sm ${
                    positive ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {positive ? "+" : ""}
                  {selectedAsset.change24h.toFixed(2)}%
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {TIME_RANGES.map((rangeOption) => {
                const active = timeRange === rangeOption.value;

                return (
                  <button
                    key={rangeOption.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTimeRange(rangeOption.value)}
                    className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-zinc-700 text-white"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                    }`}
                  >
                    {rangeOption.label}
                  </button>
                );
              })}
            </div>

            <select
              value={selectedSymbol}
              onChange={(event) => setSelectedSymbol(event.target.value)}
              className="min-w-[155px] cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition hover:border-zinc-500 focus:border-zinc-400"
            >
              {assets.map((asset) => (
                <option key={asset.symbol} value={asset.symbol}>
                  {asset.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="relative h-[380px] w-full overflow-hidden rounded-lg border border-zinc-800 bg-[#090c11]">
          <div ref={chartContainerRef} className="h-full w-full" />

          {isLoading && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-zinc-950/80 px-2 py-1 text-xs text-zinc-300">
              Loading candles...
            </div>
          )}

          {!isLoading && error && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 px-4 text-center text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        {selectedAsset && (
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
            <div>
              <div className="text-xs text-zinc-500">Current</div>
              <div className="number mt-1 text-sm text-white">
                ${formatCurrency(currentPrice, priceDecimals)}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">24h High</div>
              <div className="number mt-1 text-sm text-zinc-300">
                ${formatCurrency(selectedAsset.high24h, selectedAsset.high24h < 1 ? 4 : 2)}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">24h Low</div>
              <div className="number mt-1 text-sm text-zinc-300">
                ${formatCurrency(selectedAsset.low24h, selectedAsset.low24h < 1 ? 4 : 2)}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">24h Change</div>
              <div className={`number mt-1 text-sm ${positive ? "text-emerald-400" : "text-red-400"}`}>
                {positive ? "+" : ""}
                {selectedAsset.change24h.toFixed(2)}%
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-500">Range</div>
              <div className="number mt-1 text-sm text-zinc-300">{timeRange}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
