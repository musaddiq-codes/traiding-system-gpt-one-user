import type { Asset, Strategy } from "./trading-types";
import type { CandlePoint } from "./market-data";

export type StrategySignal = "BUY" | "SELL" | "HOLD";

export interface StrategyDecision {
  strategyId: string;
  symbol: string;
  signal: StrategySignal;
  reason: string;
  score: number;
}

interface IndicatorSnapshot {
  price: number;
  change24h: number;
  sma20: number;
  sma50: number;
  ema9: number;
  ema21: number;
  rsi: number;
  macd: number;
  signalLine: number;
  volumeRatio: number;
  trendBias: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function normalizeCondition(condition: string): string {
  return condition
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\band\b/g, " and ")
    .replace(/\bor\b/g, " or ")
    .replace(/\bif\b/g, "")
    .trim();
}

function getIndicatorSnapshot(
  asset: Asset,
  candles?: CandlePoint[]
): IndicatorSnapshot {
  if (candles && candles.length > 0) {
    const closes = candles.map((candle) => candle.close);
    const volumes = candles.map((candle) => candle.volume);
    const average = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const emaSeries = (values: number[], period: number) => {
      if (values.length === 0) {
        return [];
      }

      const multiplier = 2 / (period + 1);
      const result = [values[0]];

      for (let index = 1; index < values.length; index += 1) {
        result.push(
          result[index - 1] +
            (values[index] - result[index - 1]) * multiplier
        );
      }

      return result;
    };
    const recentCloses = closes.slice(-15);
    const recentChanges = recentCloses.slice(1).map((close, index) => {
      return close - recentCloses[index];
    });
    const gains = recentChanges.filter((change) => change > 0);
    const losses = recentChanges.filter((change) => change < 0).map(Math.abs);
    const averageGain = gains.length > 0 ? average(gains) : 0;
    const averageLoss = losses.length > 0 ? average(losses) : 0;
    const rsi = averageLoss === 0
      ? (averageGain > 0 ? 100 : 50)
      : 100 - 100 / (1 + averageGain / averageLoss);
    const fastEma = emaSeries(closes, 12);
    const slowEma = emaSeries(closes, 26);
    const macdValues = fastEma.map((value, index) => value - slowEma[index]);
    const averageVolume = average(volumes.slice(-21, -1));
    const price = closes[closes.length - 1];
    const sma20 = average(closes.slice(-20));
    const ema9Values = emaSeries(closes.slice(-9), 9);
    const ema21Values = emaSeries(closes.slice(-21), 21);
    const signalValues = emaSeries(macdValues.slice(-9), 9);

    return {
      price,
      change24h: asset.change24h,
      sma20,
      sma50: average(closes.slice(-50)),
      ema9: ema9Values[ema9Values.length - 1],
      ema21: ema21Values[ema21Values.length - 1],
      rsi,
      macd: macdValues[macdValues.length - 1] ?? 0,
      signalLine: signalValues[signalValues.length - 1] ?? 0,
      volumeRatio: averageVolume > 0
        ? (volumes[volumes.length - 1] ?? 0) / averageVolume
        : 0,
      trendBias: price === 0 ? 0 : ((price - sma20) / price) * 100,
    };
  }

  const momentum = asset.change24h;
  const drift = momentum / 100;

  return {
    price: asset.price,
    change24h: momentum,
    sma20: asset.price * (1 + drift * 0.45),
    sma50: asset.price * (1 + drift * 0.25),
    ema9: asset.price * (1 + drift * 0.72),
    ema21: asset.price * (1 + drift * 0.38),
    rsi: clamp(50 + momentum * 11.5, 0, 100),
    macd: momentum * 1.7,
    signalLine: momentum * 0.9,
    volumeRatio: clamp((asset.volume24h / 1_000_000_000) * 0.9, 0, 10),
    trendBias: clamp(momentum * 3.5 + (asset.high24h - asset.low24h) / asset.price * 100, -100, 100),
  };
}

function lookupValue(name: string, metrics: IndicatorSnapshot): number {
  const normalized = name.replace(/\s+/g, "").toLowerCase();

  switch (normalized) {
    case "price":
      return metrics.price;
    case "change24h":
    case "momentum":
      return metrics.change24h;
    case "sma20":
      return metrics.sma20;
    case "sma50":
      return metrics.sma50;
    case "ema9":
      return metrics.ema9;
    case "ema21":
      return metrics.ema21;
    case "rsi":
      return metrics.rsi;
    case "macd":
      return metrics.macd;
    case "signalline":
    case "signal":
      return metrics.signalLine;
    case "volumeratio":
    case "volume":
      return metrics.volumeRatio;
    case "trendbias":
      return metrics.trendBias;
    default:
      return NaN;
  }
}

function compareValues(
  left: number,
  operator: string,
  right: number
): boolean {
  switch (operator) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case "==":
    case "=":
      return left === right;
    default:
      return false;
  }
}

function evaluateTextCondition(
  condition: string,
  metrics: IndicatorSnapshot
): { matches: boolean; score: number; reason: string } {
  const normalized = normalizeCondition(condition);

  if (!normalized) {
    return {
      matches: false,
      score: 0,
      reason: "No custom condition specified.",
    };
  }

  const exprPatterns = [
    /^(ema9|ema21|price|sma20|sma50|rsi|macd|signalline|signal|change24h|momentum|volumeratio|volume|trendbias)\s*(>=|<=|==|=|>|<)\s*([-+]?\d*\.?\d+)/i,
    /^(?:if\s+)?(ema9|ema21|price|sma20|sma50|rsi|macd|signalline|signal|change24h|momentum|volumeratio|volume|trendbias)\s*(>=|<=|==|=|>|<)\s*([-+]?\d*\.?\d+)/i,
  ];

  for (const pattern of exprPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const [, rawKey, operator, rawValue] = match;
      const left = lookupValue(rawKey, metrics);
      const right = Number(rawValue);

      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        break;
      }

      const matches = compareValues(left, operator, right);
      const score = matches ? 1 : 0;
      return {
        matches,
        score,
        reason: `${rawKey.toUpperCase()} ${operator} ${right} -> ${matches ? "triggered" : "not triggered"}`,
      };
    }
  }

  if (normalized.includes("ema9") && normalized.includes("ema21")) {
    const ema9Above = metrics.ema9 > metrics.ema21;
    return {
      matches: ema9Above,
      score: ema9Above ? 1 : 0,
      reason: ema9Above
        ? "EMA 9 is above EMA 21."
        : "EMA 9 is not above EMA 21.",
    };
  }

  if (normalized.includes("price") && normalized.includes("sma20")) {
    const priceAbove = metrics.price > metrics.sma20;
    return {
      matches: priceAbove,
      score: priceAbove ? 1 : 0,
      reason: priceAbove
        ? "Price is above SMA 20."
        : "Price is below SMA 20.",
    };
  }

  const momentumSignal = metrics.change24h > 1 ? "BUY" : metrics.change24h < -1 ? "SELL" : "HOLD";
  const baseScore = Math.abs(metrics.change24h) * 2;

  if (normalized.includes("buy") || normalized.includes("bullish") || normalized.includes("uptrend")) {
    const matches = momentumSignal === "BUY" || metrics.trendBias > 0;
    return {
      matches,
      score: matches ? baseScore : 0,
      reason: matches
        ? "Market structure is bullish."
        : "Market structure is not bullish.",
    };
  }

  if (normalized.includes("sell") || normalized.includes("bearish") || normalized.includes("downtrend")) {
    const matches = momentumSignal === "SELL" || metrics.trendBias < 0;
    return {
      matches,
      score: matches ? baseScore : 0,
      reason: matches
        ? "Market structure is bearish."
        : "Market structure is not bearish.",
    };
  }

  const defaultMatches = Math.abs(metrics.change24h) > 1;
  return {
    matches: defaultMatches,
    score: defaultMatches ? Math.abs(metrics.change24h) : 0,
    reason: defaultMatches
      ? "Momentum rule matched the market profile."
      : "Momentum rule did not match the market profile.",
  };
}

export function evaluateCustomStrategy(
  strategy: Strategy,
  asset: Asset,
  candles?: CandlePoint[]
): StrategyDecision {
  if (strategy.status !== "ACTIVE") {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "HOLD",
      reason: "Strategy is not active.",
      score: 0,
    };
  }

  if (strategy.symbol !== asset.symbol) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "HOLD",
      reason: "Market symbol does not match the strategy.",
      score: 0,
    };
  }

  const metrics = getIndicatorSnapshot(asset, candles);
  const entry = evaluateTextCondition(strategy.entryCondition, metrics);
  const exit = evaluateTextCondition(strategy.exitCondition, metrics);

  const entryShouldBuy = entry.matches && !exit.matches;
  const entryShouldSell = exit.matches && !entry.matches;

  if (entryShouldSell) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "SELL",
      reason: `Custom exit logic triggered: ${exit.reason}`,
      score: exit.score,
    };
  }

  if (entryShouldBuy) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "BUY",
      reason: `Custom entry logic triggered: ${entry.reason}`,
      score: entry.score,
    };
  }

  if (entry.matches && exit.matches) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: "HOLD",
      reason: "Entry and exit conditions both matched; waiting for a clearer signal.",
      score: Math.max(entry.score, exit.score),
    };
  }

  if (Math.abs(metrics.change24h) > 1 && !entry.matches && !exit.matches) {
    return {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      signal: metrics.change24h > 0 ? "BUY" : "SELL",
      reason:
        metrics.change24h > 0
          ? `Fallback bullish momentum: ${metrics.change24h.toFixed(2)}% 24h.`
          : `Fallback bearish momentum: ${metrics.change24h.toFixed(2)}% 24h.`,
      score: Math.abs(metrics.change24h),
    };
  }

  return {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    signal: "HOLD",
    reason: "Custom strategy did not produce a strong actionable signal.",
    score: Math.max(entry.score, exit.score, Math.abs(metrics.change24h)),
  };
}
