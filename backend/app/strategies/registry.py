import math
from typing import Any

from app.strategies.base import ParamDef, StrategyPlugin
from app.strategies.plugins.dca_score import DcaScorePlugin
from app.strategies.plugins.text_rules import TextRulesPlugin


_PLUGINS: tuple[StrategyPlugin, ...] = (
    TextRulesPlugin(),
    DcaScorePlugin(),
)
_PLUGIN_BY_ID = {plugin.id: plugin for plugin in _PLUGINS}
DEFAULT_PLUGIN_ID = "text-rules"


def get_plugin(plugin_id: str) -> StrategyPlugin:
    try:
        return _PLUGIN_BY_ID[plugin_id]
    except KeyError as exc:
        raise ValueError(f"Unknown strategy algorithm: {plugin_id}") from exc


def list_plugins() -> list[StrategyPlugin]:
    return list(_PLUGINS)


def manifest() -> list[dict[str, Any]]:
    return [
        {
            "id": plugin.id,
            "name": plugin.name,
            "version": plugin.version,
            "description": plugin.description,
            "longOnly": plugin.long_only,
            "params": [
                {
                    "key": param.key,
                    "label": param.label,
                    "type": param.type,
                    "default": param.default,
                    "min": param.min,
                    "max": param.max,
                    "options": list(param.options),
                }
                for param in plugin.params
            ],
        }
        for plugin in _PLUGINS
    ]


def resolve_params(
    plugin_id: str | None,
    params: dict[str, Any],
) -> dict[str, Any]:
    plugin = get_plugin(plugin_id or DEFAULT_PLUGIN_ID)
    if not isinstance(params, dict):
        raise ValueError("Strategy params must be an object.")
    if not all(isinstance(key, str) for key in params):
        raise ValueError("Strategy parameter names must be strings.")

    definitions = {param.key: param for param in plugin.params}
    unknown_keys = set(params) - definitions.keys()
    if unknown_keys:
        names = ", ".join(sorted(unknown_keys))
        raise ValueError(f"Unknown parameter(s) for {plugin.id}: {names}.")

    resolved = {param.key: param.default for param in plugin.params}
    for key, value in params.items():
        definition = definitions[key]
        if not _valid_param_value(definition, value):
            raise ValueError(f"Invalid value for strategy parameter: {key}.")
        resolved[key] = value
    return resolved


def _valid_param_value(definition: ParamDef, value: Any) -> bool:
    if definition.type == "number":
        if (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or (isinstance(value, float) and not math.isfinite(value))
        ):
            return False
        if definition.min is not None and value < definition.min:
            return False
        if definition.max is not None and value > definition.max:
            return False
        return True
    if definition.type == "boolean":
        return isinstance(value, bool)
    return isinstance(value, str) and value in definition.options
