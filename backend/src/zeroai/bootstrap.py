"""Process-wide configuration used by the ASGI entry point."""

from zeroai.config import Settings
from zeroai.logging import configure_logging
from zeroai.tracing import configure_tracing


def configure_process(settings: Settings) -> None:
    """Configure logging and tracing once for the running process."""
    configure_logging(settings.log_level, settings.log_format)
    configure_tracing(settings.tracing)
