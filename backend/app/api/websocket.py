import asyncio
import logging
import time
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.routes.positions import get_portfolio_snapshot
from app.market.data import normalize_symbol
from app.market.service import MarketDataService, market_data_service


logger = logging.getLogger(__name__)
router = APIRouter()
MAX_SUBSCRIPTIONS_PER_CONNECTION = 100
CLIENT_QUEUE_SIZE = 100
HEARTBEAT_SECONDS = 20


def _portfolio_event(service: MarketDataService) -> dict[str, Any]:
    snapshot = get_portfolio_snapshot()
    positions = []
    unrealized_total = 0.0
    for position in snapshot["positions"]:
        current = dict(position)
        market_price = service.get_price(position["symbol"])
        if market_price is not None and market_price["is_live"]:
            price = float(market_price["price"])
            direction = 1 if position["side"] == "LONG" else -1
            pnl = (price - float(position["entryPrice"])) * float(
                position["quantity"]
            ) * direction
            entry_value = float(position["entryPrice"]) * float(position["quantity"])
            current.update(
                {
                    "currentPrice": price,
                    "unrealizedPnl": pnl,
                    "unrealizedPnlPercent": (
                        (pnl / entry_value) * 100 if entry_value else 0
                    ),
                }
            )
        unrealized_total += float(current["unrealizedPnl"])
        positions.append(current)
    account = dict(snapshot["account"])
    account["unrealizedPnl"] = round(unrealized_total, 2)
    account["equity"] = round(float(account["balance"]) + unrealized_total, 2)
    account["totalPnl"] = round(
        float(account["realizedPnl"]) + unrealized_total,
        2,
    )
    return {"type": "portfolio", "account": account, "positions": positions}


@router.websocket("/ws/stream")
async def stream_market_data(
    websocket: WebSocket,
) -> None:
    service: MarketDataService = market_data_service
    await websocket.accept()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=CLIENT_QUEUE_SIZE)
    ticker_subscribed = False
    portfolio_subscribed = False
    kline_subscriptions: dict[tuple[str, str], tuple[str, str]] = {}
    seen_subscriptions: set[tuple[str, str, str]] = set()
    overflowed = False

    def enqueue(event: dict[str, Any]) -> None:
        nonlocal overflowed
        if overflowed:
            return
        kind = event.get("type")
        events = []
        if kind == "ticker":
            if ticker_subscribed:
                events.append(event)
            if portfolio_subscribed:
                events.append(_portfolio_event(service))
        elif kind == "kline":
            if (
                normalize_symbol(event.get("symbol", "")),
                event.get("interval", ""),
            ) in kline_subscriptions:
                events.append(event)
        elif (kind == "portfolio" and portfolio_subscribed) or kind == "signal":
            events.append(event)
        for queue_event in events:
            try:
                queue.put_nowait(queue_event)
            except asyncio.QueueFull:
                overflowed = True
                while not queue.empty():
                    with suppress(asyncio.QueueEmpty):
                        queue.get_nowait()
                queue.put_nowait(
                    {
                        "type": "error",
                        "code": "slow_client",
                        "message": "Client is too slow.",
                    }
                )
                return

    unsubscribe = service.subscribe(enqueue)
    receive_task: asyncio.Task | None = None
    event_task: asyncio.Task | None = None
    try:
        request = await websocket.receive_json()
        subscriptions = request.get("subscribe") if isinstance(request, dict) else None
        if not isinstance(subscriptions, list) or len(subscriptions) > MAX_SUBSCRIPTIONS_PER_CONNECTION:
            await websocket.close(code=1008, reason="Invalid or excessive subscriptions.")
            return

        normalized_subscriptions: list[tuple[str, str, str]] = []
        try:
            for subscription in subscriptions:
                if not isinstance(subscription, dict):
                    raise ValueError("Each subscription must be an object.")
                subscription_type = subscription.get("type")
                if subscription_type in ("ticker", "portfolio"):
                    key = (subscription_type, "", "")
                elif subscription_type == "kline":
                    symbol = normalize_symbol(subscription.get("symbol", ""))
                    interval = subscription.get("interval", "")
                    if not isinstance(interval, str):
                        raise ValueError("Unsupported candle interval.")
                    key = ("kline", symbol, interval)
                    service._series_key(symbol, interval)
                else:
                    raise ValueError("Unsupported subscription type.")
                normalized_subscriptions.append(key)
        except (TypeError, ValueError) as error:
            await websocket.send_json({"type": "error", "message": str(error)})
            await websocket.close(code=1008, reason="Invalid subscription.")
            return

        if len(set(normalized_subscriptions)) > MAX_SUBSCRIPTIONS_PER_CONNECTION:
            await websocket.close(code=1008, reason="Too many subscriptions.")
            return

        try:
            for subscription_type, symbol, interval in normalized_subscriptions:
                seen_subscriptions.add((subscription_type, symbol, interval))
                if subscription_type == "ticker":
                    ticker_subscribed = True
                elif subscription_type == "portfolio":
                    portfolio_subscribed = True
                elif (symbol, interval) not in kline_subscriptions:
                    key = await service.add_kline_subscription(symbol, interval)
                    kline_subscriptions[key] = key
        except Exception as error:
            logger.exception("Unable to subscribe websocket client to market data.")
            await websocket.send_json(
                {"type": "error", "message": "Requested market data is unavailable."}
            )
            await websocket.close(code=1011, reason="Market data unavailable.")
            return

        await websocket.send_json(
            {
                "type": "subscribed",
                "subscriptions": [
                    {"type": kind, **({"symbol": symbol, "interval": interval} if kind == "kline" else {})}
                    for kind, symbol, interval in sorted(seen_subscriptions)
                ],
            }
        )
        if portfolio_subscribed:
            await websocket.send_json(_portfolio_event(service))

        receive_task = asyncio.create_task(websocket.receive_json())
        event_task = asyncio.create_task(queue.get())
        while True:
            done, _ = await asyncio.wait(
                {receive_task, event_task},
                timeout=HEARTBEAT_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                await websocket.send_json({"type": "ping", "timestamp": int(time.time() * 1000)})
                continue
            if receive_task in done:
                try:
                    message = receive_task.result()
                except WebSocketDisconnect:
                    break
                if isinstance(message, dict) and message.get("type") == "pong":
                    pass
                receive_task = asyncio.create_task(websocket.receive_json())
            if event_task in done:
                event = event_task.result()
                if event.get("code") == "slow_client":
                    await websocket.send_json(event)
                    await websocket.close(code=1013, reason="Client is too slow.")
                    break
                await websocket.send_json(event)
                event_task = asyncio.create_task(queue.get())
    except WebSocketDisconnect:
        pass
    finally:
        unsubscribe()
        for key in kline_subscriptions.values():
            await service.remove_kline_subscription(key)
        for task in (receive_task, event_task):
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError, WebSocketDisconnect):
                    await task