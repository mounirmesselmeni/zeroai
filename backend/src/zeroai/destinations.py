"""Outbound destination rules for feed and model requests."""

import ipaddress
from collections.abc import Collection
from typing import Annotated, Any

from pydantic import AfterValidator, AnyHttpUrl, BeforeValidator, TypeAdapter, ValidationError

DEFAULT_FEED_HOSTS = (
    "feeds.finance.yahoo.com",
    "news.google.com",
    "www.nasdaq.com",
)

DEFAULT_MODEL_ORIGINS = (
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://[::1]:11434",
    "http://host.docker.internal:11434",
    "https://api.openai.com",
    "https://ollama.com",
)

DEFAULT_OPENAI_URL = "https://api.openai.com/v1"
DEFAULT_OLLAMA_URL = "http://localhost:11434/v1"

_HTTP_URL = TypeAdapter(AnyHttpUrl)


def _parse_http_url(value: str) -> AnyHttpUrl:
    # URL libraries disagree about backslashes in the authority. For example,
    # Pydantic can read ``allowed.example\\@evil.example`` as one host while
    # httpx treats ``evil.example`` as the host. Reject that ambiguous syntax
    # before using Pydantic for the shared HTTP(S) validation.
    if "\\" in value:
        raise ValueError("Backslashes are not allowed in URLs")
    try:
        return _HTTP_URL.validate_python(value)
    except ValidationError as exc:
        raise ValueError("URL must be an absolute HTTP(S) URL") from exc


def _hostname(parsed: AnyHttpUrl) -> str:
    if parsed.host is None:
        raise ValueError("URL must include a host")
    return parsed.host.lower().strip("[]").rstrip(".")


def _validate_feed_template(value: str) -> str:
    _parse_http_url(value.replace("{ticker}", "AAPL"))
    return value


def _empty_to_none(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip() or None
    return value


def _validate_optional_http_url(value: str | None) -> str | None:
    if value is not None:
        _parse_http_url(value)
    return value


FeedURLTemplate = Annotated[str, AfterValidator(_validate_feed_template)]
OptionalHttpURL = Annotated[
    str | None,
    BeforeValidator(_empty_to_none),
    AfterValidator(_validate_optional_http_url),
]


def _host(value: str) -> str:
    host = value.strip().lower().rstrip(".")
    if not host or any(char in host for char in "/\\@?#"):
        raise ValueError(f"Invalid host in allow-list: {value!r}")
    return host


def _origin(parsed: AnyHttpUrl) -> str:
    """Normalize a URL to its origin, rejecting malformed or credentialed values."""
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Credentials are not allowed in an origin")
    if parsed.query or parsed.fragment:
        raise ValueError("Queries and fragments are not allowed in an origin")
    scheme = parsed.scheme
    hostname = _hostname(parsed)
    if ":" in hostname:
        hostname = f"[{hostname}]"
    default_port = 443 if scheme == "https" else 80
    port_suffix = f":{parsed.port}" if parsed.port != default_port else ""
    return f"{scheme}://{hostname}{port_suffix}"


class DestinationPolicy:
    """Validates outbound hosts against explicit operator-managed allow-lists.

    Feed hosts are exact host names, never suffix or wildcard matches. Model destinations are
    restricted by exact origin. This keeps custom endpoints available when the operator adds them
    to configuration while preventing an API caller from redirecting requests to arbitrary hosts.
    """

    def __init__(
        self,
        *,
        feed_hosts: Collection[str] = DEFAULT_FEED_HOSTS,
        model_origins: Collection[str] = DEFAULT_MODEL_ORIGINS,
    ) -> None:
        self.feed_hosts = frozenset(_host(host) for host in feed_hosts)
        self.model_origins = frozenset(
            _origin(_parse_http_url(origin.strip())) for origin in model_origins
        )

    def validate_feed_url(self, url: str) -> str:
        parsed = _parse_http_url(url)
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Credentials are not allowed in feed URLs")
        expected_port = 443 if parsed.scheme == "https" else 80
        if parsed.port != expected_port:
            raise ValueError("Feed URLs may only use the standard HTTP(S) ports")
        normalized_host = _hostname(parsed)
        try:
            address = ipaddress.ip_address(normalized_host)
        except ValueError:
            address = None
        if address is not None and not address.is_global:
            raise ValueError("Feed URL must not point to a private or reserved address")
        if normalized_host not in self.feed_hosts:
            raise ValueError(
                f"Feed host {normalized_host!r} is not allowed; add it to ZEROAI_ALLOWED_FEED_HOSTS"
            )
        return str(parsed)

    def validate_model_url(self, provider: str, base_url: str | None) -> str:
        """Return an explicit allowed base URL, independent of ambient SDK environment variables."""
        url = base_url or (DEFAULT_OPENAI_URL if provider == "openai" else DEFAULT_OLLAMA_URL)
        parsed = _parse_http_url(url)
        normalized_origin = _origin(parsed)
        host = _hostname(parsed)
        is_local = host == "localhost" or (host == "host.docker.internal" and parsed.port == 11434)
        try:
            is_local = is_local or ipaddress.ip_address(host).is_loopback
        except ValueError:
            pass
        if parsed.scheme != "https" and not is_local:
            raise ValueError("Remote model endpoints must use HTTPS")
        if normalized_origin not in self.model_origins:
            raise ValueError(
                f"Model origin {normalized_origin!r} is not allowed; add it to "
                "ZEROAI_ALLOWED_MODEL_ORIGINS"
            )
        return str(parsed)
