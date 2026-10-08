from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, List
import time
import uuid


# ============================================================
# ENUMS
# ============================================================

class MarketRegime(str, Enum):
    BULLISH = "BULLISH"
    NEUTRAL = "NEUTRAL"
    BEARISH = "BEARISH"


class VolatilityStatus(str, Enum):
    NORMAL = "NORMAL"
    FAST = "FAST"
    EXTREME = "EXTREME"


class StrategyAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"
    WAIT = "WAIT"


# ============================================================
# CONFIGURATION
# ============================================================

@dataclass
class StrategyConfig:
    # Grid
    buy_drop_percent: float = 3.0
    sell_profit_percent: float = 3.0

    # Market score
    bullish_score: float = 70.0
    bearish_score: float = 30.0

    # Movement speed
    normal_movement_minutes: float = 20.0
    fast_movement_minutes: float = 10.0

    # Risk
    max_positions: int = 10
    position_size: float = 100.0

    # Price tolerance
    price_tolerance_percent: float = 0.05


# ============================================================
# DATA MODELS
# ============================================================

@dataclass
class GridPosition:
    id: str
    buy_price: float
    quantity: float
    opened_at: float


@dataclass
class PricePoint:
    price: float
    timestamp: float


@dataclass
class StrategyInput:
    current_price: float
    market_score: float
    price_history: List[PricePoint]
    available_capital: float
    positions: List[GridPosition]


@dataclass
class StrategyDecision:
    action: StrategyAction
    reason: str

    market_regime: MarketRegime
    volatility_status: VolatilityStatus

    current_price: float

    next_buy_price: Optional[float]
    next_sell_price: Optional[float]

    target_position_id: Optional[str]
    target_position_buy_price: Optional[float]

    position_profit_percent: Optional[float]

    movement_percent: Optional[float]
    movement_duration_minutes: Optional[float]


# ============================================================
# UTILITY
# ============================================================

def generate_position_id() -> str:
    return f"grid-{int(time.time() * 1000)}-{uuid.uuid4().hex[:7]}"


# ============================================================
# MARKET REGIME
# ============================================================

def get_market_regime(
    score: float,
    config: StrategyConfig
) -> MarketRegime:

    if score >= config.bullish_score:
        return MarketRegime.BULLISH

    if score < config.bearish_score:
        return MarketRegime.BEARISH

    return MarketRegime.NEUTRAL


# ============================================================
# GRID CALCULATIONS
# ============================================================

def calculate_next_buy_price(
    last_buy_price: float,
    config: StrategyConfig
) -> float:

    return last_buy_price * (
        1 - config.buy_drop_percent / 100
    )


def calculate_sell_price(
    buy_price: float,
    config: StrategyConfig
) -> float:

    return buy_price * (
        1 + config.sell_profit_percent / 100
    )


def calculate_profit_percent(
    buy_price: float,
    current_price: float
) -> float:

    if buy_price <= 0:
        return 0.0

    return (
        (current_price - buy_price)
        / buy_price
    ) * 100


# ============================================================
# PRICE LEVEL CHECKS
# ============================================================

def is_price_at_or_above(
    current_price: float,
    target_price: float,
    tolerance_percent: float
) -> bool:

    tolerance = target_price * (
        tolerance_percent / 100
    )

    return current_price >= (
        target_price - tolerance
    )


def is_price_at_or_below(
    current_price: float,
    target_price: float,
    tolerance_percent: float
) -> bool:

    tolerance = target_price * (
        tolerance_percent / 100
    )

    return current_price <= (
        target_price + tolerance
    )


# ============================================================
# MOVEMENT DURATION
# ============================================================

def calculate_movement_duration(
    current_price: float,
    price_history: List[PricePoint],
    movement_percent: float
):

    if (
        current_price <= 0
        or not price_history
        or movement_percent <= 0
    ):
        return None, None

    threshold = movement_percent / 100

    lower_reference = (
        current_price / (1 - threshold)
    )

    upper_reference = (
        current_price / (1 + threshold)
    )

    now = time.time()

    best_point = None
    best_distance = float("inf")

    for point in price_history:

        if point.timestamp >= now:
            continue

        if point.price <= 0:
            continue

        distance_down = abs(
            point.price - lower_reference
        )

        distance_up = abs(
            point.price - upper_reference
        )

        distance = min(
            distance_down,
            distance_up
        )

        if distance < best_distance:
            best_distance = distance
            best_point = point

    if best_point is None:
        return None, None

    actual_movement = (
        (current_price - best_point.price)
        / best_point.price
    ) * 100

    duration_minutes = (
        (now - best_point.timestamp)
        / 60
    )

    return (
        abs(actual_movement),
        duration_minutes
    )


# ============================================================
# VOLATILITY
# ============================================================

def get_volatility_status(
    duration_minutes: Optional[float],
    config: StrategyConfig
) -> VolatilityStatus:

    if duration_minutes is None:
        return VolatilityStatus.NORMAL

    if duration_minutes < config.fast_movement_minutes:
        return VolatilityStatus.EXTREME

    if duration_minutes < config.normal_movement_minutes:
        return VolatilityStatus.FAST

    return VolatilityStatus.NORMAL


# ============================================================
# POSITION HELPERS
# ============================================================

def get_newest_position(
    positions: List[GridPosition]
) -> Optional[GridPosition]:

    if not positions:
        return None

    # LIFO
    return positions[-1]


def is_profitable_enough_to_sell(
    position: GridPosition,
    current_price: float,
    config: StrategyConfig
) -> bool:

    profit = calculate_profit_percent(
        position.buy_price,
        current_price
    )

    return profit >= config.sell_profit_percent


# ============================================================
# MAIN STRATEGY
# ============================================================

def evaluate_smart_grid_strategy(
    strategy_input: StrategyInput,
    config: StrategyConfig,
    initial_reference_price: Optional[float] = None
) -> StrategyDecision:

    current_price = strategy_input.current_price
    market_score = strategy_input.market_score
    price_history = strategy_input.price_history
    available_capital = strategy_input.available_capital
    positions = strategy_input.positions

    # --------------------------------------------------------
    # MARKET REGIME
    # --------------------------------------------------------

    market_regime = get_market_regime(
        market_score,
        config
    )

    # --------------------------------------------------------
    # MOVEMENT
    # --------------------------------------------------------

    movement_percent, movement_duration = (
        calculate_movement_duration(
            current_price,
            price_history,
            config.buy_drop_percent
        )
    )

    volatility_status = get_volatility_status(
        movement_duration,
        config
    )

    # --------------------------------------------------------
    # BASIC VALIDATION
    # --------------------------------------------------------

    if current_price <= 0:

        return StrategyDecision(
            action=StrategyAction.WAIT,
            reason="Invalid current price.",
            market_regime=market_regime,
            volatility_status=volatility_status,
            current_price=current_price,
            next_buy_price=None,
            next_sell_price=None,
            target_position_id=None,
            target_position_buy_price=None,
            position_profit_percent=None,
            movement_percent=movement_percent,
            movement_duration_minutes=movement_duration
        )

    # --------------------------------------------------------
    # POSITION
    # --------------------------------------------------------

    newest_position = get_newest_position(
        positions
    )

    # --------------------------------------------------------
    # NEXT BUY
    # --------------------------------------------------------

    next_buy_price = None

    if newest_position:

        next_buy_price = calculate_next_buy_price(
            newest_position.buy_price,
            config
        )

    elif initial_reference_price:

        next_buy_price = calculate_next_buy_price(
            initial_reference_price,
            config
        )

    # --------------------------------------------------------
    # SELL INFORMATION
    # --------------------------------------------------------

    next_sell_price = None
    position_profit_percent = None

    if newest_position:

        next_sell_price = calculate_sell_price(
            newest_position.buy_price,
            config
        )

        position_profit_percent = (
            calculate_profit_percent(
                newest_position.buy_price,
                current_price
            )
        )

    # ========================================================
    # SELL LOGIC
    # ========================================================

    if (
        newest_position
        and next_sell_price is not None
    ):

        sell_target_reached = is_price_at_or_above(
            current_price,
            next_sell_price,
            config.price_tolerance_percent
        )

        if sell_target_reached:

            # EXTREME
            if volatility_status == VolatilityStatus.EXTREME:

                return StrategyDecision(
                    action=StrategyAction.WAIT,
                    reason=(
                        "Sell target reached, but price "
                        "movement is extremely fast. "
                        "Waiting for stabilization."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=newest_position.id,
                    target_position_buy_price=newest_position.buy_price,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # BEARISH
            if (
                market_regime == MarketRegime.BEARISH
                and is_profitable_enough_to_sell(
                    newest_position,
                    current_price,
                    config
                )
            ):

                return StrategyDecision(
                    action=StrategyAction.SELL,
                    reason=(
                        "Sell target reached and market "
                        "score is bearish. Close the newest "
                        "profitable position."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=newest_position.id,
                    target_position_buy_price=newest_position.buy_price,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # BULLISH
            if market_regime == MarketRegime.BULLISH:

                return StrategyDecision(
                    action=StrategyAction.HOLD,
                    reason=(
                        "Sell target reached, but market "
                        "is strongly bullish. Hold the "
                        "newest position."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=newest_position.id,
                    target_position_buy_price=newest_position.buy_price,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # NEUTRAL
            if market_regime == MarketRegime.NEUTRAL:

                return StrategyDecision(
                    action=StrategyAction.SELL,
                    reason=(
                        "Sell target reached in a neutral "
                        "market. Close the newest position "
                        "using LIFO."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=newest_position.id,
                    target_position_buy_price=newest_position.buy_price,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

    # ========================================================
    # BUY LOGIC
    # ========================================================

    if next_buy_price is not None:

        buy_level_reached = is_price_at_or_below(
            current_price,
            next_buy_price,
            config.price_tolerance_percent
        )

        if buy_level_reached:

            # EXTREME
            if volatility_status == VolatilityStatus.EXTREME:

                return StrategyDecision(
                    action=StrategyAction.WAIT,
                    reason=(
                        "Buy level reached, but the 3% "
                        "movement happened too quickly."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=None,
                    target_position_buy_price=None,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # CAPITAL
            if available_capital < config.position_size:

                return StrategyDecision(
                    action=StrategyAction.WAIT,
                    reason=(
                        "Buy level reached, but there "
                        "is not enough available capital."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=None,
                    target_position_buy_price=None,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # MAX POSITIONS
            if len(positions) >= config.max_positions:

                return StrategyDecision(
                    action=StrategyAction.WAIT,
                    reason=(
                        "Maximum number of positions "
                        "has been reached."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=None,
                    target_position_buy_price=None,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # BULLISH
            if market_regime == MarketRegime.BULLISH:

                return StrategyDecision(
                    action=StrategyAction.BUY,
                    reason=(
                        "Buy level reached in a bullish "
                        "market with acceptable movement speed."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=None,
                    target_position_buy_price=None,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # NEUTRAL
            if market_regime == MarketRegime.NEUTRAL:

                return StrategyDecision(
                    action=StrategyAction.BUY,
                    reason=(
                        "Buy level reached in a neutral "
                        "market with acceptable movement speed."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=None,
                    target_position_buy_price=None,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

            # BEARISH
            if market_regime == MarketRegime.BEARISH:

                if volatility_status == VolatilityStatus.FAST:

                    return StrategyDecision(
                        action=StrategyAction.WAIT,
                        reason=(
                            "Buy level reached in a bearish "
                            "market, but price is falling "
                            "too quickly."
                        ),
                        market_regime=market_regime,
                        volatility_status=volatility_status,
                        current_price=current_price,
                        next_buy_price=next_buy_price,
                        next_sell_price=next_sell_price,
                        target_position_id=None,
                        target_position_buy_price=None,
                        position_profit_percent=position_profit_percent,
                        movement_percent=movement_percent,
                        movement_duration_minutes=movement_duration
                    )

                return StrategyDecision(
                    action=StrategyAction.BUY,
                    reason=(
                        "Buy level reached in a bearish "
                        "market, but movement speed is normal."
                    ),
                    market_regime=market_regime,
                    volatility_status=volatility_status,
                    current_price=current_price,
                    next_buy_price=next_buy_price,
                    next_sell_price=next_sell_price,
                    target_position_id=None,
                    target_position_buy_price=None,
                    position_profit_percent=position_profit_percent,
                    movement_percent=movement_percent,
                    movement_duration_minutes=movement_duration
                )

    # ========================================================
    # NOTHING TO DO
    # ========================================================

    return StrategyDecision(
        action=StrategyAction.HOLD,
        reason=(
            "No buy or sell condition has been reached. "
            "Continue monitoring."
        ),
        market_regime=market_regime,
        volatility_status=volatility_status,
        current_price=current_price,
        next_buy_price=next_buy_price,
        next_sell_price=next_sell_price,
        target_position_id=(
            newest_position.id
            if newest_position else None
        ),
        target_position_buy_price=(
            newest_position.buy_price
            if newest_position else None
        ),
        position_profit_percent=position_profit_percent,
        movement_percent=movement_percent,
        movement_duration_minutes=movement_duration
    )


# ============================================================
# POSITION CREATION
# ============================================================

def create_grid_position(
    buy_price: float,
    position_size: float
) -> GridPosition:

    if buy_price <= 0:
        raise ValueError(
            "Buy price must be greater than zero."
        )

    quantity = position_size / buy_price

    return GridPosition(
        id=generate_position_id(),
        buy_price=buy_price,
        quantity=quantity,
        opened_at=time.time()
    )


# ============================================================
# LIFO POSITION REMOVAL
# ============================================================

def remove_newest_position(
    positions: List[GridPosition]
) -> Optional[GridPosition]:

    if not positions:
        return None

    return positions.pop()



    