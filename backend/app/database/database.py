import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator


BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = BACKEND_ROOT / "data" / "trading.sqlite3"
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", DEFAULT_DATABASE_PATH))
LEGACY_STRATEGIES_PATH = BACKEND_ROOT.parent / "data" / "strategies.json"


def connect_database() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database_connection() -> Generator[sqlite3.Connection, None, None]:
    connection = connect_database()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _load_legacy_strategies() -> list[dict]:
    try:
        payload = json.loads(LEGACY_STRATEGIES_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []

    if not isinstance(payload, list):
        raise ValueError("data/strategies.json must contain a JSON array.")
    return [item for item in payload if isinstance(item, dict)]


def initialize_database() -> None:
    with database_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS strategies (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS backtest_runs (
                id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                strategy_signature TEXT NOT NULL,
                payload TEXT NOT NULL,
                reviewed_at TEXT,
                review_notes TEXT
            );
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO app_state (id, payload)
            VALUES (1, ?)
            """,
            (json.dumps(default_portfolio_state()),),
        )

        if connection.execute("SELECT 1 FROM strategies LIMIT 1").fetchone() is None:
            for strategy in _load_legacy_strategies():
                strategy_id = strategy.get("id")
                if isinstance(strategy_id, str) and strategy_id:
                    connection.execute(
                        "INSERT OR IGNORE INTO strategies (id, payload) VALUES (?, ?)",
                        (strategy_id, json.dumps(strategy)),
                    )


def default_portfolio_state() -> dict:
    return {
        "account": {
            "balance": 100000,
            "equity": 102847.35,
            "availableBalance": 85420.18,
            "usedMargin": 17132.17,
            "unrealizedPnl": 2847.35,
            "realizedPnl": 4215.8,
            "totalPnl": 7063.15,
        },
        "positions": [
            {
                "id": "pos-001",
                "strategyId": "strategy-001",
                "symbol": "BTC/USDT",
                "name": "Bitcoin",
                "side": "LONG",
                "quantity": 0.42,
                "entryPrice": 65120.5,
                "currentPrice": 67842.5,
                "leverage": 3,
                "margin": 9120.87,
                "unrealizedPnl": 1143.24,
                "unrealizedPnlPercent": 29.97,
                "status": "OPEN",
                "openedAt": "2026-10-05T08:42:00Z",
            },
            {
                "id": "pos-002",
                "strategyId": "strategy-002",
                "symbol": "ETH/USDT",
                "name": "Ethereum",
                "side": "LONG",
                "quantity": 2.8,
                "entryPrice": 3421.2,
                "currentPrice": 3524.82,
                "leverage": 2,
                "margin": 4789.68,
                "unrealizedPnl": 290.14,
                "unrealizedPnlPercent": 12.09,
                "status": "OPEN",
                "openedAt": "2026-10-05T12:18:00Z",
            },
            {
                "id": "pos-003",
                "strategyId": "strategy-003",
                "symbol": "SOL/USDT",
                "name": "Solana",
                "side": "SHORT",
                "quantity": 18,
                "entryPrice": 191.4,
                "currentPrice": 184.62,
                "leverage": 2,
                "margin": 1661.58,
                "unrealizedPnl": 122.04,
                "unrealizedPnlPercent": 14.69,
                "status": "OPEN",
                "openedAt": "2026-10-06T01:25:00Z",
            },
        ],
        "trades": [
            {
                "id": "trade-001",
                "strategyId": "strategy-001",
                "symbol": "BTC/USDT",
                "side": "BUY",
                "quantity": 0.42,
                "price": 65120.5,
                "value": 27350.61,
                "fee": 13.68,
                "realizedPnl": 0,
                "status": "FILLED",
                "executedAt": "2026-10-05T08:42:00Z",
            },
            {
                "id": "trade-002",
                "strategyId": "strategy-002",
                "symbol": "ETH/USDT",
                "side": "BUY",
                "quantity": 2.8,
                "price": 3421.2,
                "value": 9579.36,
                "fee": 4.79,
                "realizedPnl": 0,
                "status": "FILLED",
                "executedAt": "2026-10-05T12:18:00Z",
            },
            {
                "id": "trade-003",
                "strategyId": "strategy-003",
                "symbol": "SOL/USDT",
                "side": "SELL",
                "quantity": 18,
                "price": 191.4,
                "value": 3445.2,
                "fee": 1.72,
                "realizedPnl": 0,
                "status": "FILLED",
                "executedAt": "2026-10-06T01:25:00Z",
            },
            {
                "id": "trade-004",
                "symbol": "BTC/USDT",
                "side": "SELL",
                "quantity": 0.18,
                "price": 64280.4,
                "value": 11570.47,
                "fee": 5.79,
                "realizedPnl": 824.35,
                "status": "FILLED",
                "executedAt": "2026-10-04T16:32:00Z",
            },
        ],
    }