"""Coordinate feed downloads, parsing, concurrency, and news aggregation."""

import asyncio
import re
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from urllib.parse import quote

import httpx2
import structlog
from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from zeroai.models import NewsSource
from zeroai.news.downloader import FeedDownloader, FeedError
from zeroai.news.parser import FeedKind
from zeroai.news.parser import parse_feed as parse_feed_with_kind
from zeroai.news.parser import parse_feed_items as parse_feed
from zeroai.schemas import FeedCheck, NewsItem, NewsResponse

__all__ = ["FeedError", "FeedKind", "NewsFetcher", "normalize_ticker", "parse_feed"]

TICKER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,9}$")
log = structlog.get_logger("zeroai.news")


def normalize_ticker(raw: str) -> str:
    ticker = raw.strip().upper()
    if not TICKER_RE.match(ticker):
        raise ValueError(f"Invalid ticker symbol: {raw!r}")
    return ticker


class NewsFetcher:
    """Fetch selected feeds concurrently and merge their unique news items."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        allowed_hosts: Sequence[str],
        max_feed_bytes: int = 1_000_000,
        max_sources: int = 20,
        max_concurrency: int = 5,
    ) -> None:
        if max_sources < 1 or max_concurrency < 1:
            raise ValueError("Fetcher limits must be positive")
        self.downloader = FeedDownloader(
            client,
            allowed_hosts=allowed_hosts,
            max_feed_bytes=max_feed_bytes,
        )
        self.max_sources = max_sources
        self._semaphore = asyncio.Semaphore(max_concurrency)

    def validate_url_template(self, url_template: str) -> None:
        self.downloader.validate_url_template(url_template)

    @staticmethod
    def _source_url(source: NewsSource, ticker: str) -> str:
        return source.url_template.replace("{ticker}", quote(ticker))

    async def load_feed(self, url: str, name: str) -> tuple[FeedKind, list[NewsItem]]:
        """Download one feed and parse it, translating expected format errors for the UI."""
        text, content_type = await self.downloader.download(url)
        head = text[:600].lstrip().lower()
        if "html" in content_type.lower() or head.startswith(("<!doctype html", "<html")):
            raise FeedError("this is a web page, not an RSS/Atom feed")
        try:
            return parse_feed_with_kind(text, name)
        except DefusedXmlException as exc:
            raise FeedError("feed uses prohibited XML declarations") from exc
        except ElementTree.ParseError as exc:
            raise FeedError("not valid RSS/Atom XML") from exc

    async def check_feed(self, url_template: str, ticker: str) -> FeedCheck:
        """Check one allow-listed source; expected feed errors are returned as data."""
        url = url_template.replace("{ticker}", quote(ticker))
        try:
            self.validate_url_template(url_template)
            async with self._semaphore:
                kind, items = await self.load_feed(url, "test")
        except (FeedError, ValueError) as exc:
            return FeedCheck(ok=False, error=str(exc))
        if not items:
            return FeedCheck(
                ok=False, kind=kind, error=f"valid {kind.upper()}, but no items for {ticker}"
            )
        return FeedCheck(
            ok=True, kind=kind, item_count=len(items), sample=[item.title for item in items[:3]]
        )

    async def _fetch_one(
        self, source: NewsSource, ticker: str
    ) -> tuple[list[NewsItem], str | None]:
        started = time.perf_counter()
        try:
            async with self._semaphore:
                _, items = await self.load_feed(self._source_url(source, ticker), source.name)
        except FeedError as exc:
            log.warning(
                "feed_failed",
                source=source.name,
                reason=str(exc),
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            return [], f"{source.name}: {exc}"
        log.info(
            "feed_fetched",
            source=source.name,
            items=len(items),
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return items, None

    async def fetch_news(
        self, sources: Sequence[NewsSource], ticker: str, max_items: int
    ) -> NewsResponse:
        """Fetch a bounded set of sources concurrently and merge unique headlines."""
        enabled = [source for source in sources if source.enabled]
        selected = enabled[: self.max_sources]
        skipped = enabled[self.max_sources :]
        started = time.perf_counter()
        log.info(
            "news_fetch_started",
            ticker=ticker,
            sources=len(selected),
            skipped_disabled=len(sources) - len(enabled),
            skipped_over_limit=len(skipped),
        )
        results = await asyncio.gather(*(self._fetch_one(source, ticker) for source in selected))
        seen: set[str] = set()
        merged: list[NewsItem] = []
        for items, _ in results:
            for item in items:
                key = item.title.casefold()
                if key not in seen:
                    seen.add(key)
                    merged.append(item)
        merged.sort(
            key=lambda item: item.published or datetime.min.replace(tzinfo=UTC), reverse=True
        )
        errors = [error for _, error in results if error]
        if skipped:
            errors.append(
                "Additional enabled sources were skipped; "
                f"the limit is {self.max_sources} per request"
            )
        log.info(
            "news_ready",
            ticker=ticker,
            items=min(len(merged), max_items),
            unique_items=len(merged),
            failed_sources=len(errors),
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return NewsResponse(ticker=ticker, items=merged[:max_items], errors=errors)
