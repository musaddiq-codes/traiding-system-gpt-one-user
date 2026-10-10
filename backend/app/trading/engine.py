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
    is_non_default_plugin = strategy.get("algorithmId") not in (None, "text-rules")
    signature = {}
    for key in keys:
        value = strategy.get(key) if is_non_default_plugin else strategy[key]
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        signature[key] = value
    if is_non_default_plugin:
        signature["algorithmId"] = strategy.get("algorithmId")
        params = strategy.get("params", {})
        signature["params"] = {key: params[key] for key in sorted(params)}
    return json.dumps(signature, separators=(",", ":"), ensure_ascii=False)


def get_strategy_snapshot(strategy: dict) -> dict:
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
    snapshot = {key: strategy[key] for key in keys if key in strategy}
    if strategy.get("algorithmId") not in (None, "text-rules"):
        snapshot["algorithmId"] = strategy.get("algorithmId")
        params = strategy.get("params", {})
        snapshot["params"] = {key: params[key] for key in sorted(params)}
    return snapshot