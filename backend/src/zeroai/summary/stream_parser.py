"""Translate PydanticAI stream events into safe, displayable model updates."""

import json
from dataclasses import dataclass
from typing import Any

from pydantic import TypeAdapter, ValidationError
from pydantic_ai.messages import (
    PartDeltaEvent,
    PartStartEvent,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
)
from pydantic_ai.run import AgentRunResultEvent
from pydantic_core import from_json

from zeroai.schemas import StockSummary

_SUMMARY_FIELDS = {
    name: TypeAdapter(field.rebuild_annotation())
    for name, field in StockSummary.model_fields.items()
}


@dataclass(frozen=True)
class ModelUpdate:
    """Display and telemetry data decoded from one PydanticAI event."""

    thinking_delta: str | None = None
    partial_summary: dict[str, Any] | None = None
    result: Any | None = None
    retry: bool = False
    thinking_chars: int = 0
    answer_started: bool = False


def _args_text(args: str | dict[str, Any] | None) -> str:
    """Tool-call args may start out as JSON text, a ready dict, or empty."""
    if args is None:
        return ""
    return args if isinstance(args, str) else json.dumps(args)


def _partial_summary(buffer: str) -> dict[str, Any] | None:
    """Best-effort parse and validate fields from incomplete tool-call JSON."""
    try:
        parsed = from_json(buffer.encode(), allow_partial=True)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    partial = {}
    for name, adapter in _SUMMARY_FIELDS.items():
        if name not in parsed:
            continue
        try:
            partial[name] = adapter.validate_python(parsed[name])
        except ValidationError:
            # Incomplete or invalid fields stay hidden until the model repairs them.
            continue
    return partial


class ModelStreamParser:
    """Accumulate fragmented output arguments and decode model events incrementally."""

    def __init__(self) -> None:
        self._args = ""
        self._last_partial: dict[str, Any] | None = None

    def consume(self, event: Any) -> ModelUpdate:
        thinking = None
        chunk = None
        result = None
        retry = False

        if isinstance(event, PartStartEvent):
            if isinstance(event.part, ThinkingPart):
                thinking = event.part.content
            elif isinstance(event.part, ToolCallPart):
                retry = bool(self._args)
                self._args = ""  # a retry starts a fresh tool call: drop the failed one
                self._last_partial = None
                chunk = _args_text(event.part.args)
        elif isinstance(event, PartDeltaEvent):
            if isinstance(event.delta, ThinkingPartDelta):
                thinking = event.delta.content_delta
            elif isinstance(event.delta, ToolCallPartDelta) and isinstance(
                event.delta.args_delta, str
            ):
                chunk = event.delta.args_delta
        elif isinstance(event, AgentRunResultEvent):
            result = event.result

        partial = None
        if chunk:
            self._args += chunk
            parsed = _partial_summary(self._args)
            if parsed and parsed != self._last_partial:
                partial = parsed
                self._last_partial = parsed

        return ModelUpdate(
            thinking_delta=thinking,
            partial_summary=partial,
            result=result,
            retry=retry,
            thinking_chars=len(thinking) if thinking else 0,
            answer_started=bool(chunk),
        )
