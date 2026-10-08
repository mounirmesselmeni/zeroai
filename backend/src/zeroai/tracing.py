"""Local tracing of model runs, printed to the terminal. Nothing leaves the machine.

PydanticAI already emits OpenTelemetry spans (``agent run`` with a ``chat <model>`` child that
carries the token counts). With ``ZEROAI_TRACING=console`` Logfire's SDK is configured in
local-only mode, so the span tree is printed under the log lines. Prompts and answers are not put
into the spans (``include_content=False``), in line with the logging rules.

Logfire is a backend runtime dependency. Tracing remains off unless
``ZEROAI_TRACING=console`` is set.
"""

import structlog

log = structlog.get_logger("zeroai.tracing")


def configure_tracing(mode: str) -> bool:
    """Turn tracing on for every agent. Returns whether it is active."""
    if mode == "off":
        return False
    try:
        import logfire
    except ImportError:
        log.warning("tracing_unavailable", hint="uv sync")
        return False
    logfire.configure(
        send_to_logfire=False,  # local only: no account, no network
        console=logfire.ConsoleOptions(min_log_level="debug", verbose=True),
    )
    logfire.instrument_pydantic_ai(include_content=False)
    log.info("tracing_enabled", mode=mode)
    return True
