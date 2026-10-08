from fastapi import APIRouter

from app.api.routes.positions import get_portfolio_snapshot, open_paper_position
from app.api.routes.schemas import OrderPayload


router = APIRouter(prefix="/api/orders", tags=["paper orders"])


@router.post("")
async def create_paper_order(payload: OrderPayload) -> dict:
    position, trade = await open_paper_position(payload)
    return {
        "position": position,
        "trade": trade,
        "state": get_portfolio_snapshot(),
        "mode": "paper",
    }