"use client";

import {
  normalizeBinanceSymbol,
} from "./market-data";
import type { CandlePoint } from "./market-data";

type CandleListener = (candle: CandlePoint) => void;

interface StreamSubscription {
  listeners: Set<CandleListener>;
  socket: WebSocket | null;
  reconnectTimer: number | null;
  shouldReconnect: boolean;
}

const subscriptions = new Map<string, StreamSubscription>();

export function subscribeToKline(
  symbol: string,
  interval: string,
  listener: CandleListener
): () => void {
  const normalizedSymbol = normalizeBinanceSymbol(symbol).toLowerCase();
  const key = `${normalizedSymbol}@kline_${interval}`;
  let subscription = subscriptions.get(key);

  if (!subscription) {
    subscription = {
      listeners: new Set(),
      socket: null,
      reconnectTimer: null,
      shouldReconnect: true,
    };
    subscriptions.set(key, subscription);
  }

  subscription.listeners.add(listener);

  const connect = () => {
    if (!subscription || !subscription.shouldReconnect || subscription.listeners.size === 0) {
      return;
    }

    const socket = new WebSocket(`wss://stream.binance.com:9443/ws/${key}`);
    subscription.socket = socket;

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          s?: string;
          k?: {
            t?: number;
            o?: string;
            h?: string;
            l?: string;
            c?: string;
            v?: string;
          };
        };
        const kline = payload.k;

        if (
          !payload.s ||
          !kline ||
          typeof kline.t !== "number"
        ) {
          return;
        }

        const candle: CandlePoint = {
          timestamp: kline.t,
          time: new Date(kline.t).toISOString(),
          open: Number(kline.o),
          high: Number(kline.h),
          low: Number(kline.l),
          close: Number(kline.c),
          volume: Number(kline.v),
        };

        if (
          !Number.isFinite(candle.open) ||
          !Number.isFinite(candle.high) ||
          !Number.isFinite(candle.low) ||
          !Number.isFinite(candle.close) ||
          !Number.isFinite(candle.volume)
        ) {
          return;
        }

        for (const subscribedListener of subscription.listeners) {
          subscribedListener(candle);
        }
      } catch {
        // Ignore malformed stream messages without ending the subscription.
      }
    };

    socket.onerror = () => {
      socket.close();
    };

    socket.onclose = () => {
      if (
        !subscription?.shouldReconnect ||
        subscription.listeners.size === 0
      ) {
        return;
      }

      subscription.reconnectTimer = window.setTimeout(() => {
        connect();
      }, 3000);
    };
  };

  if (subscription.listeners.size === 1) {
    connect();
  }

  return () => {
    const current = subscriptions.get(key);

    if (!current) {
      return;
    }

    current.listeners.delete(listener);

    if (current.listeners.size > 0) {
      return;
    }

    current.shouldReconnect = false;

    if (current.reconnectTimer !== null) {
      window.clearTimeout(current.reconnectTimer);
    }

    current.socket?.close();
    subscriptions.delete(key);
  };
}
