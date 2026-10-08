"""Structured logging (structlog): one event per pipeline step, correlated by request id.

Console format is for people (``ZEROAI_LOG_FORMAT=console``, the default); ``json`` writes one JSON
object per line for log shippers. Fields are key/value pairs, never interpolated into the message,
so they can be filtered and counted. Secrets (API keys) and prompts are never logged.
"""

import asyncio
import logging
import re
import sys
import time
import uuid
from typing import TextIO

import structlog
from structlog.contextvars import bind_contextvars, clear_contextvars, merge_contextvars
from structlog.typing import Processor

REQUEST_ID_HEADER = "x-request-id"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

log = structlog.get_logger("zeroai.http")


def configure_logging(
    level: str = "INFO", fmt: str = "console", stream: TextIO | None = None
) -> None:
    """(Re)configure structlog. Safe to call more than once; the last call wins."""
    out = stream or sys.stdout
    shared: list[Processor] = [
        merge_contextvars,  # request_id (and anything bound for the request)
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    renderer: list[Processor]
    if fmt == "json":
        renderer = [structlog.processors.format_exc_info, structlog.processors.JSONRenderer()]
    else:
        renderer = [structlog.dev.ConsoleRenderer(colors=out.isatty())]
    structlog.configure(
        processors=[*shared, *renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level.upper()]
        ),
        logger_factory=structlog.PrintLoggerFactory(file=out),
        cache_logger_on_first_use=False,  # tests reconfigure; the cost is negligible
    )


class RequestContextMiddleware:
    """Gives every request an id, returns it as ``X-Request-ID``, and logs one summary line.

    The id is bound into structlog's context variables, so every log line written while handling the
    request, including inside the streaming response, carries it. A valid incoming ``X-Request-ID``
    is honoured (so a caller can correlate), anything else is replaced.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope["headers"]).get(REQUEST_ID_HEADER.encode(), b"").decode("latin-1")
        request_id = incoming if _SAFE_REQUEST_ID.match(incoming) else uuid.uuid4().hex[:12]
        clear_contextvars()
        bind_contextvars(request_id=request_id)

        started = time.perf_counter()
        status = 500
        cancelled = False
        completed = False

        async def receive_watching_disconnect():
            nonlocal cancelled
            message = await receive()
            # Starlette handles a vanished client internally (it does not raise into us), so the
            # ASGI disconnect message is the reliable signal. Only a disconnect *before* the
            # response finished counts: a tidy close after the last byte is not a cancellation.
            if message["type"] == "http.disconnect" and not completed:
                cancelled = True
            return message

        async def send_with_id(message) -> None:
            nonlocal status, completed
            if message["type"] == "http.response.start":
                status = message["status"]
                message["headers"] = [
                    *message.get("headers", []),
                    (b"x-request-id", request_id.encode()),
                ]
            elif message["type"] == "http.response.body" and not message.get("more_body"):
                completed = True
            await send(message)

        try:
            await self.app(scope, receive_watching_disconnect, send_with_id)
        except asyncio.CancelledError:
            cancelled = True  # cancelled from above (server shutdown, or an outer timeout)
            raise
        finally:
            path = scope["path"]
            emit = (
                log.debug
                if path.endswith("/health")
                else log.warning
                if status >= 500
                else log.info
            )
            emit(
                "http_request",
                method=scope["method"],
                path=path,
                status=status,
                duration_ms=round((time.perf_counter() - started) * 1000),
                cancelled=cancelled,
            )
