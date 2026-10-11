import type { BacktestResult } from "./backtest-types";
import type { CandlePoint, ChartRange } from "./market-data";
import type { Account, Position } from "./trading-types";
import { backendApiUrl } from "./api";

export interface PluginParam {
  key: string;
  label: string;
  type: "number" | "boolean" | "select";
  default: number | boolean | string;
  min: number | null;
  max: number | null;
  options: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  longOnly: boolean;
  params: PluginParam[];
}

export interface EngineRuntimeStatus {
  strategyId: string;
  lastCandleTs: number | null;
  lastError: string | null;
  lastRunAt: string | null;
  state: Record<string, unknown>;
}

export interface EngineStatus {
  enabled: boolean;
  running: boolean;
  tickSeconds: number;
  strategies: EngineRuntimeStatus[];
}

export interface StrategySignal {
  id?: string;
  strategyId: string;
  symbol: string;
  candleTs: number;
  signal: "BUY" | "SELL" | "HOLD";
  reason: string;
  score: number;
  actionTaken?: string;
  createdAt?: string;
}

export type StreamSubscription =
  | { type: "ticker" }
  | { type: "portfolio" }
  | { type: "kline"; symbol: string; interval: ChartRange };

export type BackendStreamEvent =
  | {
      type: "ticker";
      symbol: string;
      name: string;
      price: number;
      change24h: number;
      volume24h: number;
      high24h: number;
      low24h: number;
      is_live: boolean;
    }
  | {
      type: "kline";
      symbol: string;
      interval: string;
      candle: CandlePoint;
      closed: boolean;
      is_live: boolean;
    }
  | {
      type: "portfolio";
      account: Account;
      positions: Position[];
    }
  | ({ type: "signal" } & StrategySignal)
  | { type: "error"; code?: string; message: string }
  | { type: "subscribed"; subscriptions: StreamSubscription[] }
  | { type: "ping"; timestamp: number };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(backendApiUrl(path), {
    cache: "no-store",
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.error === "string"
          ? payload.error
          : `Backend request failed (${response.status}).`;
    throw new Error(detail);
  }
  return payload as T;
}

export async function getPlugins(): Promise<PluginManifest[]> {
  const payload = await requestJson<PluginManifest[]>("/api/plugins");
  if (!Array.isArray(payload)) {
    throw new Error("The backend returned an invalid plugin manifest.");
  }
  return payload;
}

export async function runBacktest(
  payload: {
    strategyId: string;
    days?: number;
    initialBalance?: number;
    feeBps?: number;
    slippageBps?: number;
  },
): Promise<BacktestResult> {
  return requestJson<BacktestResult>("/api/backtests/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getEngineStatus(): Promise<EngineStatus> {
  return requestJson<EngineStatus>("/api/engine/status");
}

export async function getStrategySignals(
  strategyId: string,
  limit = 50,
): Promise<StrategySignal[]> {
  const payload = await requestJson<{ signals: StrategySignal[] }>(
    `/api/strategies/${encodeURIComponent(strategyId)}/signals?limit=${limit}`,
  );
  if (!Array.isArray(payload.signals)) {
    throw new Error("The backend returned an invalid strategy-signals response.");
  }
  return payload.signals;
}

type StreamListener = (event: BackendStreamEvent) => void;

interface StreamClient {
  subscriptions: StreamSubscription[];
  listener: StreamListener;
}

const streamClients = new Set<StreamClient>();
let streamSocket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectDelayMs = 1_000;

function allSubscriptions(): StreamSubscription[] {
  const unique = new Map<string, StreamSubscription>();
  for (const client of streamClients) {
    for (const subscription of client.subscriptions) {
      unique.set(JSON.stringify(subscription), subscription);
    }
  }
  return [...unique.values()];
}

function stopStreamSocket(): void {
  if (reconnectTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const socket = streamSocket;
  streamSocket = null;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
}

function connectStream(): void {
  if (
    typeof window === "undefined" ||
    typeof WebSocket === "undefined" ||
    streamClients.size === 0 ||
    streamSocket !== null
  ) {
    return;
  }

  const endpoint = new URL(backendApiUrl("/ws/stream"), window.location.href);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(endpoint);
  streamSocket = socket;
  socket.onopen = () => {
    reconnectDelayMs = 1_000;
    socket.send(JSON.stringify({ subscribe: allSubscriptions() }));
  };
  socket.onmessage = (message) => {
    let event: BackendStreamEvent;
    try {
      event = JSON.parse(String(message.data)) as BackendStreamEvent;
    } catch {
      return;
    }
    if (event.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    for (const client of streamClients) {
      try {
        client.listener(event);
      } catch (error) {
        console.error("Backend stream listener failed:", error);
      }
    }
  };
  socket.onclose = () => {
    if (streamSocket === socket) {
      streamSocket = null;
    }
    if (streamClients.size === 0 || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectStream();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  };
  socket.onerror = () => socket.close();
}

export function subscribeToBackendStream(
  subscriptions: StreamSubscription[],
  listener: StreamListener,
): () => void {
  const client: StreamClient = { subscriptions, listener };
  const previousSubscriptions = JSON.stringify(allSubscriptions());
  streamClients.add(client);
  const nextSubscriptions = JSON.stringify(allSubscriptions());
  if (previousSubscriptions !== nextSubscriptions && streamSocket !== null) {
    stopStreamSocket();
  }
  connectStream();

  return () => {
    const previous = JSON.stringify(allSubscriptions());
    streamClients.delete(client);
    const next = JSON.stringify(allSubscriptions());
    if (streamClients.size === 0) {
      stopStreamSocket();
    } else if (previous !== next) {
      stopStreamSocket();
      connectStream();
    }
  };
}
