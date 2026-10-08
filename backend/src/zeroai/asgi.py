"""ASGI entry point with process-wide logging and tracing configured."""

from zeroai.bootstrap import configure_process
from zeroai.config import get_settings
from zeroai.main import create_app

settings = get_settings()
configure_process(settings)
app = create_app(settings)
