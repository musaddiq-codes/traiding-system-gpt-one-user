export type ChartRange =
  | "1s"
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d";

export const CHART_RANGES: ChartRange[] = [
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
];

export interface CandlePoint {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function isChartRange(value: string): value is ChartRange {
  return CHART_RANGES.includes(value as ChartRange);
}

export function normalizeBinanceSymbol(symbol: string): string {
  return symbol.replace(/\s+/g, "").replace(/\//g, "").toUpperCase();
}

export function formatSymbolForDisplay(symbol: string): string {
  const normalized = normalizeBinanceSymbol(symbol);
  return normalized.endsWith("USDT")
    ? `${normalized.slice(0, -4)}/USDT`
    : normalized;
}
