import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import backtests, engine, market, orders, plugins, positions, strategies
from app.api.websocket import router as websocket_router
from app.database.database import initialize_database
from app.market.service import market_data_service
from app.trading.position_manager import start_market_updates
from app.trading.runner import strategy_runner


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    await market_data_service.start()
    unsubscribe_position_updates = start_market_updates(market_data_service)
    if strategy_runner.enabled:
        await strategy_runner.start()
    try:
        yield
    finally:
        await strategy_runner.stop()
        unsubscribe_position_updates()
        await market_data_service.stop()


app = FastAPI(
    title="Trading System API",
    version="1.0.0",
    description="Single-user paper-trading and market-data API.",
    lifespan=lifespan,
)

allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(market.router)
app.include_router(websocket_router)
app.include_router(plugins.router)
app.include_router(engine.router)
app.include_router(strategies.router)
app.include_router(orders.router)
app.include_router(positions.router)
app.include_router(backtests.router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
