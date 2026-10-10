from fastapi import APIRouter

from app.strategies.registry import manifest


router = APIRouter(prefix="/api/plugins", tags=["plugins"])


@router.get("")
def list_strategy_plugins() -> list[dict]:
    return manifest()
