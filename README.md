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
backtest review records are then managed by FastAPI. The interactive Next.js
pages remain in the frontend; the strategy detail page reads its strategy
record from FastAPI. Backtest computation remains in the existing Next.js
route, while backtest records and paper-approval checks are stored by FastAPI.

## Tests

Run the backend tests from the `backend` directory:

```powershell
python -m unittest discover -s tests
```
