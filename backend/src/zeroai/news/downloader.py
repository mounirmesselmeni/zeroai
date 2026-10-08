"""Download feed documents with destination, redirect, retry, and size checks."""

import asyncio
from collections.abc import Sequence
from urllib.parse import urljoin, urlsplit

import httpx2
import structlog

from zeroai.destinations import DestinationPolicy

MAX_REDIRECTS = 5
RETRY_DELAY_SECONDS = 0.3
log = structlog.get_logger("zeroai.news")


class FeedError(Exception):
    """A feed could not be downloaded or parsed; the message is safe for the UI."""


class FeedDownloader:
    """Fetch bounded feed bodies while validating every outbound destination."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        allowed_hosts: Sequence[str],
        max_feed_bytes: int,
    ) -> None:
        if max_feed_bytes < 1:
            raise ValueError("max_feed_bytes must be positive")
        self.client = client
        self.destinations = DestinationPolicy(feed_hosts=allowed_hosts)
        self.max_feed_bytes = max_feed_bytes
        self.retry_delay_seconds = RETRY_DELAY_SECONDS

    def validate_url_template(self, url_template: str) -> None:
        """Reject disallowed hosts before a source is saved or tested."""
        url = url_template.replace("{ticker}", "AAPL")
        self.destinations.validate_feed_url(url)

    async def _request_once(self, url: str) -> tuple[int, str, str]:
        current_url = url
        for redirect_count in range(MAX_REDIRECTS + 1):
            current_url = self.destinations.validate_feed_url(current_url)
            async with self.client.stream("GET", current_url, follow_redirects=False) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise FeedError("redirect did not include a destination")
                    if redirect_count == MAX_REDIRECTS:
                        raise FeedError("too many redirects")
                    current_url = self.destinations.validate_feed_url(
                        urljoin(current_url, location)
                    )
                    continue

                content_type = response.headers.get("content-type", "")
                if response.status_code >= 400:
                    return response.status_code, content_type, ""

                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > self.max_feed_bytes:
                            raise FeedError("feed exceeds the configured size limit")
                    except ValueError:
                        pass

                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > self.max_feed_bytes:
                        raise FeedError("feed exceeds the configured size limit")
                encoding = response.encoding or "utf-8"
                try:
                    body = bytes(content).decode(encoding, errors="replace")
                except LookupError:
                    body = bytes(content).decode("utf-8", errors="replace")
                return response.status_code, content_type, body

        raise FeedError("too many redirects")  # pragma: no cover

    async def download(self, url: str) -> tuple[str, str]:
        """Return (body, content type), retrying transient failures once."""
        for attempt in (1, 2):
            try:
                status, content_type, body = await self._request_once(url)
            except (httpx2.TimeoutException, httpx2.ConnectError) as exc:
                if attempt == 2:
                    if isinstance(exc, httpx2.TimeoutException):
                        raise FeedError("timed out") from exc
                    raise FeedError("could not connect") from exc
                reason = type(exc).__name__
            except FeedError:
                raise
            except ValueError as exc:
                raise FeedError(str(exc)) from exc
            except httpx2.HTTPError as exc:
                raise FeedError(type(exc).__name__) from exc
            else:
                if status < 500 or attempt == 2:
                    if status >= 400:
                        raise FeedError(f"HTTP {status}")
                    if status >= 300:
                        raise FeedError(f"HTTP {status}")
                    return body, content_type
                reason = f"HTTP {status}"

            log.warning(
                "feed_retry",
                host=urlsplit(url).hostname,
                reason=reason,
                delay_ms=round(self.retry_delay_seconds * 1000),
            )
            await asyncio.sleep(self.retry_delay_seconds)
        raise AssertionError("unreachable")  # pragma: no cover
