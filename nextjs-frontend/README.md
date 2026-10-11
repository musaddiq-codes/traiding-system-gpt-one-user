







cd /d "C:\Users\OMNIX\Desktop\traiding-system\manual-nextjs-gpt\backend"
.venv\Scripts\activate.bat



python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000





# Trading System

This repository uses Next.js for the interactive web interface and FastAPI for
the trading API, market data, and SQLite-backed application state. The order
endpoints are paper-trading only; the backend does not submit orders to an
exchange. Public Binance market data is read without API credentials.

## Run locally

Install the Python requirements once:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Run FastAPI in one terminal from the `backend` directory:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Run the frontend in a second terminal from the repository root:

```powershell
pnpm dev
```

Open `http://localhost:3000`. The API health check is available at
`http://127.0.0.1:8000/health`; interactive API documentation is at
`http://127.0.0.1:8000/docs`.

## Configuration

- `NEXT_PUBLIC_BACKEND_URL` sets the API URL used by browser requests. It
  defaults to `http://127.0.0.1:8000`.
- `BACKEND_URL` sets the API URL used by Next.js server code. It defaults to
  `http://127.0.0.1:8000`.
- `FRONTEND_ORIGINS` is a comma-separated list of allowed browser origins. It
  defaults to `http://localhost:3000,http://127.0.0.1:3000`.
- `DATABASE_PATH` overrides the SQLite database location. By default, the
  database is created at `backend/data/trading.sqlite3`.

On first startup, existing `data/strategies.json` strategies are copied into
SQLite if the strategy table is empty. Paper positions, trades, strategies, and
backtest review records are then managed by FastAPI. The Next.js frontend is a
display client: strategy execution, market streaming, portfolio valuation,
stop-loss/take-profit enforcement, and backtests run in the backend. The
strategy engine is disabled by default and can be enabled with
`ENGINE_ENABLED=true`. `ENGINE_TICK_SECONDS` controls its tick interval
(default `15`), and `PAPER_FEE_BPS` sets paper-trade fees (default `0`).

## Tests

Run the backend tests from the `backend` directory:

```powershell
python -m unittest discover -s tests
```

Run frontend checks from `nextjs-frontend`:

```powershell
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

To exercise a strategy manually, create one using the **DCA Score Strategy**
plugin, run `POST /api/backtests/run` with its `strategyId`, approve the
result for paper trading, then restart the backend with `ENGINE_ENABLED=true`.
Call `POST /api/engine/tick?dry_run=true`, inspect
`GET /api/strategies/{id}/signals`, and connect to `/ws/stream` for live signal
events. Dry-run ticks record decisions without placing paper orders.
