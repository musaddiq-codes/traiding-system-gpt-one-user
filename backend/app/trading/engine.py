import json


def get_strategy_signature(strategy: dict) -> str:
    keys = (
        "id",
        "name",
        "description",
        "type",
        "symbol",
        "timeframe",
        "entryCondition",
        "exitCondition",
        "stopLoss",
        "takeProfit",
        "positionSize",
        "riskPerTrade",
        "maxPositions",
    )
    signature = {}
    for key in keys:
        value = strategy[key]
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        signature[key] = value
    return json.dumps(signature, separators=(",", ":"), ensure_ascii=False)