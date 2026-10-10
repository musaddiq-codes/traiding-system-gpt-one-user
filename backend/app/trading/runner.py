import asyncio
import json
import logging
import math
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.database.database import database_connection
from app.market.data import normalize_symbol
from app.market.service import MarketDataService, market_data_service
from app.risk.manager import _approval_is_valid
from app.strategies.base import Decision, PluginContext, PluginPosition
from app.strategies.registry import DEFAULT_PLUGIN_ID, get_plugin, resolve_params
from app.trading.order_manager import PaperTradingError, close_paper_position, open_paper_position
from app.trading.position_manager import enforce_strategy_exits, mark_to_market


logger = logging.getLogger(__name__)
PLUGIN_TIMEOUT_SECONDS = 10
MAX_BACKOFF_SECONDS = 60


def _environment_enabled() -> bool:
    return os.environ.get("ENGINE_ENABLED", "false").strip().lower() == "true"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _timestamp_ms(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


class StrategyRunner:
    def __init__(
        self,
        provider: MarketDataService = market_data_service,
        *,
        tick_seconds: float | None = None,
        enabled: bool | None = None,
        clock_ms: Any | None = None,
        plugin_timeout_seconds: float = PLUGIN_TIMEOUT_SECONDS,
    ) -> None:
        self.provider = provider
        self.tick_seconds = (
            tick_seconds
            if tick_seconds is not None
            else float(os.environ.get("ENGINE_TICK_SECONDS", "15"))
        )
        if not math.isfinite(self.tick_seconds) or self.tick_seconds <= 0:
            raise ValueError("ENGINE_TICK_SECONDS must be a finite positive number.")
        self._enabled_override = enabled
        self._clock_ms = clock_ms or (lambda: int(time.time() * 1000))
        self.plugin_timeout_seconds = plugin_timeout_seconds
        self._task: asyncio.Task | None = None
        self._tick_lock = asyncio.Lock()
        self._failure_counts: dict[str, int] = {}
        self._next_attempt_at: dict[str, float] = {}

    @property
    def enabled(self) -> bool:
        return (
            self._enabled_override
            if self._enabled_override is not None
            else _environment_enabled()
        )

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def status(self) -> dict[str, Any]:
        with database_connection() as connection:
            rows = connection.execute(
                """
                SELECT strategy_id, last_candle_ts, last_error, last_run_at, state
                FROM strategy_runtime ORDER BY strategy_id
                """
            ).fetchall()
        runtime = []
        for row in rows:
            try:
                state = json.loads(row["state"])
            except (TypeError, json.JSONDecodeError):
                state = {}
            runtime.append(
                {
                    "strategyId": row["strategy_id"],
                    "lastCandleTs": row["last_candle_ts"],
                    "lastError": row["last_error"],
                    "lastRunAt": row["last_run_at"],
                    "state": state,
                }
            )
        return {
            "enabled": self.enabled,
            "running": self.running,
            "tickSeconds": self.tick_seconds,
            "strategies": runtime,
        }

    async def start(self) -> dict[str, Any]:
        if not self.enabled:
            return self.status()
        if not self.running:
            self._task = asyncio.create_task(
                self._run_loop(),
                name="paper-strategy-runner",
            )
        return self.status()

    async def stop(self) -> dict[str, Any]:
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        return self.status()

    async def _run_loop(self) -> None:
        while self.enabled:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Strategy runner tick failed.")
            await asyncio.sleep(max(0.1, self.tick_seconds))

    async def tick(self, *, dry_run: bool = False) -> dict[str, Any]:
        if not self.enabled:
            return {"enabled": False, "dryRun": dry_run, "signals": []}
        async with self._tick_lock:
            self._mark_live_positions()
            with database_connection() as connection:
                strategies = connection.execute(
                    """
                    SELECT id, payload FROM strategies
                    ORDER BY id
                    """
                ).fetchall()

            results: list[dict[str, Any]] = []
            for row in strategies:
                try:
                    strategy = json.loads(row["payload"])
                    if strategy.get("status") != "ACTIVE":
                        continue
                    if self._next_attempt_at.get(row["id"], 0) > asyncio.get_running_loop().time():
                        continue
                    result = await self._run_strategy(row["id"], strategy, dry_run)
                    if result is not None:
                        results.append(result)
                    self._failure_counts.pop(row["id"], None)
                    self._next_attempt_at.pop(row["id"], None)
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    self._record_strategy_error(row["id"], str(error))
                    failures = self._failure_counts.get(row["id"], 0) + 1
                    self._failure_counts[row["id"]] = failures
                    backoff = min(2 ** (failures - 1), MAX_BACKOFF_SECONDS)
                    self._next_attempt_at[row["id"]] = (
                        asyncio.get_running_loop().time() + backoff
                    )
                    logger.exception("Strategy %s runner iteration failed.", row["id"])
            return {"enabled": True, "dryRun": dry_run, "signals": results}

    def _mark_live_positions(self) -> None:
        with database_connection() as connection:
            rows = connection.execute(
                "SELECT DISTINCT symbol FROM positions WHERE status = 'OPEN'"
            ).fetchall()
        for row in rows:
            market_price = self.provider.get_price(row["symbol"])
            if market_price.get("is_live") is not True:
                continue
            price = market_price.get("price")
            if not isinstance(price, (int, float)) or not math.isfinite(price):
                continue
            prices = {row["symbol"]: {"price": float(price), "is_live": True}}
            mark_to_market(prices)
            enforce_strategy_exits(row["symbol"], float(price))

    async def _run_strategy(
        self,
        strategy_id: str,
        strategy: dict[str, Any],
        dry_run: bool,
    ) -> dict[str, Any] | None:
        with database_connection() as connection:
            if not _approval_is_valid(connection, strategy):
                self._set_runtime_error(
                    connection,
                    strategy_id,
                    "Strategy has no valid backtest approval for its current version.",
                )
                return None
            runtime = connection.execute(
                "SELECT last_candle_ts FROM strategy_runtime WHERE strategy_id = ?",
                (strategy_id,),
            ).fetchone()

        try:
            symbol = normalize_symbol(strategy["symbol"])
            interval = strategy["timeframe"]
            market_price = self.provider.get_price(symbol)
            if market_price.get("is_live") is not True:
                self._record_strategy_error(
                    strategy_id,
                    "Market data is stale or unavailable; strategy evaluation skipped.",
                )
                return None
            price = market_price.get("price")
            if (
                not isinstance(price, (int, float))
                or isinstance(price, bool)
                or not math.isfinite(price)
                or price <= 0
            ):
                self._record_strategy_error(
                    strategy_id,
                    "Live market price is invalid; strategy evaluation skipped.",
                )
                return None

            candles = await self.provider.load_candles(
                symbol,
                interval,
                500,
                closed_only=True,
            )
            if not candles:
                self._record_strategy_error(
                    strategy_id,
                    "No closed candles are available; strategy evaluation skipped.",
                )
                return None
            candle = max(candles, key=lambda item: int(item["timestamp"]))
            candle_ts = int(candle["timestamp"])
            last_candle_ts = runtime["last_candle_ts"] if runtime else None
            if last_candle_ts is not None and candle_ts <= int(last_candle_ts):
                return None

            with database_connection() as connection:
                position_row = connection.execute(
                    """
                    SELECT * FROM positions
                    WHERE strategy_id = ? AND status = 'OPEN'
                    ORDER BY rowid DESC LIMIT 1
                    """,
                    (strategy_id,),
                ).fetchone()
                position = self._plugin_position(position_row)
                algorithm_id = strategy.get("algorithmId") or DEFAULT_PLUGIN_ID
                plugin = get_plugin(algorithm_id)
                params = resolve_params(algorithm_id, strategy.get("params", {}))

            context = PluginContext(
                strategy=strategy,
                symbol=f"{symbol.removesuffix('USDT')}/USDT",
                price=float(price),
                change24h=self._finite_or_default(market_price.get("change24h")),
                candles=candles,
                position=position,
                params=params,
                timeframe=interval,
                now_ms=int(self._clock_ms()),
                volume24h=self._finite_or_default(market_price.get("volume24h")),
                high24h=self._optional_finite(market_price.get("high24h")),
                low24h=self._optional_finite(market_price.get("low24h")),
            )
            decision = await asyncio.wait_for(
                asyncio.to_thread(plugin.evaluate, context),
                timeout=self.plugin_timeout_seconds,
            )
            self._validate_decision(decision)
            action = self._reserve_signal(
                strategy_id,
                strategy,
                candle_ts,
                decision,
            )
            if action is None:
                return None
            try:
                if dry_run:
                    action_taken = f"dry_run: {action}"
                else:
                    action_taken = self._execute_decision(
                        strategy_id,
                        strategy,
                        decision,
                        float(price),
                    )
            except Exception as error:
                self._complete_signal(
                    strategy_id,
                    candle_ts,
                    f"error: {error}",
                )
                raise
            self._complete_signal(strategy_id, candle_ts, action_taken)
            event = {
                "strategyId": strategy_id,
                "symbol": context.symbol,
                "candleTs": candle_ts,
                "signal": decision.signal,
                "reason": decision.reason,
                "score": decision.score,
                "actionTaken": action_taken,
            }
            self.provider.publish_signal(event)
            self._clear_strategy_error(strategy_id)
            return event
        except asyncio.CancelledError:
            raise

    def _plugin_position(self, row: sqlite3.Row | None) -> PluginPosition | None:
        if row is None:
            return None
        return PluginPosition(
            entry_price=float(row["entry_price"]),
            quantity=float(row["quantity"]),
            value_usdt=float(row["entry_price"]) * float(row["quantity"]),
            opened_at_ms=_timestamp_ms(row["opened_at"]),
        )

    @staticmethod
    def _finite_or_default(value: Any) -> float:
        return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else 0.0

    @staticmethod
    def _optional_finite(value: Any) -> float | None:
        return (
            float(value)
            if isinstance(value, (int, float)) and math.isfinite(value)
            else None
        )

    @staticmethod
    def _validate_decision(decision: Any) -> None:
        if not isinstance(decision, Decision):
            raise ValueError("Strategy plugin returned an invalid decision.")
        if decision.signal not in ("BUY", "SELL", "HOLD"):
            raise ValueError("Strategy plugin returned an invalid signal.")
        if not isinstance(decision.reason, str):
            raise ValueError("Strategy plugin returned an invalid reason.")
        if (
            not isinstance(decision.score, (int, float))
            or isinstance(decision.score, bool)
            or not math.isfinite(decision.score)
        ):
            raise ValueError("Strategy plugin returned an invalid score.")
        if decision.amount_usdt is not None and (
            not isinstance(decision.amount_usdt, (int, float))
            or isinstance(decision.amount_usdt, bool)
            or not math.isfinite(decision.amount_usdt)
            or decision.amount_usdt <= 0
        ):
            raise ValueError("Strategy plugin returned an invalid order amount.")

    def _reserve_signal(
        self,
        strategy_id: str,
        strategy: dict[str, Any],
        candle_ts: int,
        decision: Decision,
    ) -> str | None:
        planned_action = decision.signal.lower()
        with database_connection() as connection:
            try:
                connection.execute(
                    """
                    INSERT INTO strategy_signals (
                        id, strategy_id, symbol, candle_ts, signal, reason,
                        score, action_taken, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        f"signal-{uuid4().hex}",
                        strategy_id,
                        strategy["symbol"],
                        candle_ts,
                        decision.signal,
                        decision.reason,
                        float(decision.score),
                        _iso_now(),
                    ),
                )
            except sqlite3.IntegrityError:
                return None
            self._upsert_runtime(
                connection,
                strategy_id,
                last_candle_ts=candle_ts,
                last_error=None,
                state={"status": "evaluated", "plannedAction": planned_action},
            )
        return planned_action

    def _execute_decision(
        self,
        strategy_id: str,
        strategy: dict[str, Any],
        decision: Decision,
        price: float,
    ) -> str:
        with database_connection() as connection:
            positions = connection.execute(
                """
                SELECT id FROM positions
                WHERE strategy_id = ? AND status = 'OPEN'
                ORDER BY rowid DESC
                """,
                (strategy_id,),
            ).fetchall()
        if decision.signal == "HOLD":
            return "hold"
        if decision.signal == "BUY":
            if len(positions) >= int(strategy["maxPositions"]):
                return "max_positions"
            quantity = round(float(strategy["positionSize"]) / price, 8)
            if quantity <= 0:
                return "rejected: calculated order quantity is zero."
            try:
                open_paper_position(
                    strategy["symbol"],
                    "LONG",
                    quantity,
                    strategy_id,
                    price,
                )
            except PaperTradingError as error:
                return f"rejected: {error}"
            return "opened_long"

        if positions:
            try:
                close_paper_position(positions[0]["id"], price)
            except PaperTradingError as error:
                return f"rejected: {error}"
            return "closed_position"
        plugin = get_plugin(strategy.get("algorithmId") or DEFAULT_PLUGIN_ID)
        if plugin.long_only:
            return "ignored_short_signal"
        quantity = round(float(strategy["positionSize"]) / price, 8)
        if quantity <= 0:
            return "rejected: calculated order quantity is zero."
        try:
            open_paper_position(
                strategy["symbol"],
                "SHORT",
                quantity,
                strategy_id,
                price,
            )
        except PaperTradingError as error:
            return f"rejected: {error}"
        return "opened_short"

    def _complete_signal(
        self,
        strategy_id: str,
        candle_ts: int,
        action_taken: str,
    ) -> None:
        with database_connection() as connection:
            connection.execute(
                """
                UPDATE strategy_signals SET action_taken = ?
                WHERE strategy_id = ? AND candle_ts = ?
                """,
                (action_taken, strategy_id, candle_ts),
            )
            self._upsert_runtime(
                connection,
                strategy_id,
                last_candle_ts=candle_ts,
                last_error=None,
                state={"status": "idle", "lastAction": action_taken},
            )

    def _clear_strategy_error(self, strategy_id: str) -> None:
        with database_connection() as connection:
            row = connection.execute(
                "SELECT last_candle_ts FROM strategy_runtime WHERE strategy_id = ?",
                (strategy_id,),
            ).fetchone()
            self._upsert_runtime(
                connection,
                strategy_id,
                last_candle_ts=row["last_candle_ts"] if row else None,
                last_error=None,
                state={"status": "idle"},
            )

    def _record_strategy_error(self, strategy_id: str, error: str) -> None:
        with database_connection() as connection:
            self._set_runtime_error(connection, strategy_id, error)

    def _set_runtime_error(
        self,
        connection: sqlite3.Connection,
        strategy_id: str,
        error: str,
    ) -> None:
        row = connection.execute(
            "SELECT last_candle_ts FROM strategy_runtime WHERE strategy_id = ?",
            (strategy_id,),
        ).fetchone()
        self._upsert_runtime(
            connection,
            strategy_id,
            last_candle_ts=row["last_candle_ts"] if row else None,
            last_error=error,
            state={"status": "error"},
        )

    @staticmethod
    def _upsert_runtime(
        connection: sqlite3.Connection,
        strategy_id: str,
        *,
        last_candle_ts: int | None,
        last_error: str | None,
        state: dict[str, Any],
    ) -> None:
        connection.execute(
            """
            INSERT INTO strategy_runtime (
                strategy_id, last_candle_ts, last_error, last_run_at, state
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(strategy_id) DO UPDATE SET
                last_candle_ts = excluded.last_candle_ts,
                last_error = excluded.last_error,
                last_run_at = excluded.last_run_at,
                state = excluded.state
            """,
            (
                strategy_id,
                last_candle_ts,
                last_error,
                _iso_now(),
                json.dumps(state),
            ),
        )


strategy_runner = StrategyRunner()
