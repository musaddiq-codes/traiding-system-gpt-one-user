import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator


BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = BACKEND_ROOT / "data" / "trading.sqlite3"
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", DEFAULT_DATABASE_PATH))
DEFAULT_STARTING_BALANCE = 100000


def _candidate_legacy_strategy_paths() -> list[Path]:
    root = BACKEND_ROOT.parent
    candidates = [
        BACKEND_ROOT / "data" / "strategies.json",
        root / "data" / "strategies.json",
        root / "nextjs-frontend" / "data" / "strategies.json",
        root / "frontend" / "data" / "strategies.json",
    ]
    return [path for path in dict.fromkeys(candidates)]


LEGACY_STRATEGIES_PATH = next(
    (path for path in _candidate_legacy_strategy_paths() if path.exists()),
    BACKEND_ROOT.parent / "data" / "strategies.json",
)


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


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone() is not None


def _import_legacy_portfolio(
    connection: sqlite3.Connection,
    payload: dict,
) -> None:
    account = payload["account"]
    connection.execute(
        "INSERT INTO account (id, balance, realized_pnl) VALUES (1, ?, ?)",
        (account["balance"], account["realizedPnl"]),
    )

    for position in reversed(payload.get("positions", [])):
        connection.execute(
            """
            INSERT INTO positions (
                id, strategy_id, symbol, name, side, quantity, entry_price,
                current_price, leverage, margin, unrealized_pnl,
                unrealized_pnl_percent, status, opened_at, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                position["id"],
                position.get("strategyId"),
                position["symbol"],
                position["name"],
                position["side"],
                position["quantity"],
                position["entryPrice"],
                position["currentPrice"],
                position["leverage"],
                position["margin"],
                position["unrealizedPnl"],
                position["unrealizedPnlPercent"],
                position.get("status", "OPEN"),
                position["openedAt"],
                position.get("closedAt"),
            ),
        )

    for trade in payload.get("trades", []):
        connection.execute(
            """
            INSERT INTO trades (
                id, strategy_id, position_id, symbol, side, quantity, price,
                value, fee, realized_pnl, status, executed_at
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade["id"],
                trade.get("strategyId"),
                trade["symbol"],
                trade["side"],
                trade["quantity"],
                trade["price"],
                trade["value"],
                trade["fee"],
                trade["realizedPnl"],
                trade["status"],
                trade["executedAt"],
            ),
        )


def initialize_database() -> None:
    with database_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS account (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                balance REAL NOT NULL,
                realized_pnl REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS positions (
                id TEXT PRIMARY KEY,
                strategy_id TEXT,
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
                quantity REAL NOT NULL,
                entry_price REAL NOT NULL,
                current_price REAL NOT NULL,
                leverage REAL NOT NULL,
                margin REAL NOT NULL,
                unrealized_pnl REAL NOT NULL,
                unrealized_pnl_percent REAL NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
                opened_at TEXT NOT NULL,
                closed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                strategy_id TEXT,
                position_id TEXT REFERENCES positions(id),
                symbol TEXT NOT NULL,
                side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
                quantity REAL NOT NULL,
                price REAL NOT NULL,
                value REAL NOT NULL,
                fee REAL NOT NULL,
                realized_pnl REAL NOT NULL,
                note TEXT,
                status TEXT NOT NULL CHECK (
                    status IN ('FILLED', 'PENDING', 'CANCELLED')
                ),
                executed_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_positions_strategy_status
                ON positions(strategy_id, status);
            CREATE INDEX IF NOT EXISTS idx_positions_status
                ON positions(status);
            CREATE INDEX IF NOT EXISTS idx_trades_executed_at
                ON trades(executed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_trades_strategy
                ON trades(strategy_id);
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
            CREATE TABLE IF NOT EXISTS strategy_signals (
                id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                candle_ts INTEGER NOT NULL,
                signal TEXT NOT NULL,
                reason TEXT NOT NULL,
                score REAL NOT NULL,
                action_taken TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(strategy_id, candle_ts)
            );
            CREATE INDEX IF NOT EXISTS idx_strategy_signals_created_at
                ON strategy_signals(created_at DESC);
            CREATE TABLE IF NOT EXISTS strategy_runtime (
                strategy_id TEXT PRIMARY KEY,
                last_candle_ts INTEGER,
                last_error TEXT,
                last_run_at TEXT,
                state TEXT NOT NULL DEFAULT '{}'
            );
            """
        )

        trade_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(trades)").fetchall()
        }
        if "note" not in trade_columns:
            connection.execute("ALTER TABLE trades ADD COLUMN note TEXT")

        connection.execute("BEGIN IMMEDIATE")
        user_version = connection.execute("PRAGMA user_version").fetchone()[0]
        if user_version < 1:
            if _table_exists(connection, "app_state"):
                legacy_row = connection.execute(
                    "SELECT payload FROM app_state WHERE id = 1"
                ).fetchone()
                if legacy_row is not None:
                    _import_legacy_portfolio(
                        connection,
                        json.loads(legacy_row["payload"]),
                    )
                else:
                    connection.execute(
                        "INSERT INTO account (id, balance, realized_pnl) "
                        "VALUES (1, ?, 0)",
                        (DEFAULT_STARTING_BALANCE,),
                    )
                if _table_exists(connection, "app_state_legacy"):
                    raise RuntimeError("Legacy portfolio backup table already exists.")
                connection.execute(
                    "ALTER TABLE app_state RENAME TO app_state_legacy"
                )
            else:
                connection.execute(
                    "INSERT INTO account (id, balance, realized_pnl) "
                    "VALUES (1, ?, 0)",
                    (DEFAULT_STARTING_BALANCE,),
                )
            connection.execute("PRAGMA user_version = 1")

        if connection.execute("SELECT 1 FROM strategies LIMIT 1").fetchone() is None:
            for strategy in _load_legacy_strategies():
                strategy_id = strategy.get("id")
                if isinstance(strategy_id, str) and strategy_id:
                    connection.execute(
                        "INSERT OR IGNORE INTO strategies (id, payload) VALUES (?, ?)",
                        (strategy_id, json.dumps(strategy)),
                    )
