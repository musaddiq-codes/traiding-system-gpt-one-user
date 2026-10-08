import type { Asset } from "./trading-types";

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

export function isChartRange(value: string): value is ChartRange {
  return CHART_RANGES.includes(value as ChartRange);
}

export interface CandlePoint {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const BINANCE_BASE_URL = "https://api.binance.com/api/v3";

const FAVORITE_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
] as const;

const SYMBOL_NAME_MAP: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  BNB: "BNB",
  XRP: "XRP",
};

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function normalizeBinanceSymbol(symbol: string): string {
  return symbol
    .replace(/\s+/g, "")
    .replace(/\//g, "")
    .toUpperCase();
}

export function normalizeBinanceStreamSymbol(symbol: string): string {
  const normalized = normalizeBinanceSymbol(symbol);

  if (normalized.endsWith("USDT")) {
    return `${normalized.slice(0, -4)}/USDT`;
  }

  return normalized;
}

export function formatSymbolForDisplay(symbol: string): string {
  return normalizeBinanceStreamSymbol(symbol);
}

export function mapTimeRangeToInterval(range: ChartRange): string {
  return range;
}

function mapKlines(
  data: BinanceKline[]
): CandlePoint[] {
  return data.map(([timestamp, open, high, low, close, volume]) => ({
    time: new Date(timestamp).toISOString(),
    timestamp,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  }));
}

export async function fetchMarketSnapshot(): Promise<Asset[]> {
  const url = `${BINANCE_BASE_URL}/ticker/24hr?symbols=${encodeURIComponent(
    JSON.stringify([...FAVORITE_SYMBOLS])
  )}`;

  const response = await fetch(url, {
    next: { revalidate: 10 },
  });

  if (!response.ok) {
    throw new Error(`Binance market snapshot request failed: ${response.status}`);
  }

  const payload = (await response.json()) as Array<{
    symbol: string;
    lastPrice: string;
    priceChangePercent: string;
    quoteVolume: string;
    highPrice: string;
    lowPrice: string;
  }>;

  return payload.map((item) => {
    const baseSymbol = item.symbol.replace("USDT", "");

    return {
      symbol: formatSymbolForDisplay(item.symbol),
      name: SYMBOL_NAME_MAP[baseSymbol] ?? baseSymbol,
      price: Number(item.lastPrice),
      change24h: Number(item.priceChangePercent),
      volume24h: Number(item.quoteVolume),
      high24h: Number(item.highPrice),
      low24h: Number(item.lowPrice),
    };
  });
}

export async function fetchCandles(
  symbol: string,
  range: ChartRange = "1m",
  limit = 200
): Promise<CandlePoint[]> {
  const normalizedSymbol = normalizeBinanceSymbol(symbol);
  const interval = mapTimeRangeToInterval(range);
  const url = `${BINANCE_BASE_URL}/klines?symbol=${normalizedSymbol}&interval=${interval}&limit=${limit}`;

  const response = await fetch(url, {
    ...(range === "1s"
      ? { cache: "no-store" as const }
      : { next: { revalidate: 10 } }),
  });

  if (!response.ok) {
    throw new Error(`Binance candles request failed: ${response.status}`);
  }

  const data = (await response.json()) as BinanceKline[];

  return mapKlines(data);
}

export async function fetchHistoricalCandles(
  symbol: string,
  range: ChartRange,
  days: number
): Promise<CandlePoint[]> {
  const normalizedSymbol = normalizeBinanceSymbol(symbol);
  const interval = mapTimeRangeToInterval(range);
  const intervalMilliseconds = interval === "1s"
    ? 1000
    : Number(interval.slice(0, -1)) *
      (interval.endsWith("m")
        ? 60_000
        : interval.endsWith("h")
          ? 3_600_000
          : 86_400_000);
  const endTime = Date.now();
  const startTime = endTime - days * 86_400_000;
  const maxCandles = 20_000;
  const requestedCandles = Math.ceil((endTime - startTime) / intervalMilliseconds);

  if (requestedCandles > maxCandles) {
    throw new Error(
      `This timeframe and lookback require ${requestedCandles} candles; the maximum supported backtest size is ${maxCandles}. Choose a shorter lookback or larger candle interval.`
    );
  }

  const candles: CandlePoint[] = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const params = new URLSearchParams({
      symbol: normalizedSymbol,
      interval,
      startTime: String(cursor),
      endTime: String(endTime),
      limit: "1000",
    });
    const response = await fetch(
      `${BINANCE_BASE_URL}/klines?${params.toString()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`Binance historical candles request failed: ${response.status}`);
    }

    const page = mapKlines(
      (await response.json()) as BinanceKline[]
    );

    if (page.length === 0) {
      break;
    }

    candles.push(...page);
    const nextCursor =
      page[page.length - 1].timestamp + intervalMilliseconds;

    if (nextCursor <= cursor) {
      throw new Error("Historical candle pagination did not advance.");
    }

    cursor = nextCursor;
  }

  return candles.filter((candle) => candle.timestamp < endTime);
}
