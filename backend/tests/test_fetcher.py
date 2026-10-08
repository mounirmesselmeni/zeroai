import asyncio

import httpx2
import pook
import pytest
from conftest import ATOM, RSS, feed_mock, make_fetcher

from zeroai.models import NewsSource
from zeroai.news.fetcher import NewsFetcher, normalize_ticker, parse_feed


def src(host: str, name: str = "S", enabled: bool = True) -> NewsSource:
    return NewsSource(name=name, url_template=f"https://{host}/feed?s={{ticker}}", enabled=enabled)


@pytest.mark.parametrize("raw", ["", "A B", "../x", "TOOLONGTICKER1", "-A", "A/B", "a;b"])
def test_invalid_tickers(raw):
    with pytest.raises(ValueError):
        normalize_ticker(raw)


def test_ticker_normalised():
    assert normalize_ticker(" brk-b ") == "BRK-B"


def test_parse_rss_cleans_html_and_dates():
    items = parse_feed(RSS, "S")
    assert [i.title for i in items] == ["ACME beats earnings", "ACME faces probe"]
    assert items[0].snippet == "Revenue up 12%"
    assert (published := items[0].published) and published.tzinfo is not None


def test_parse_atom():
    (item,) = parse_feed(ATOM, "S")
    assert item.link == "https://x.test/3" and item.snippet == "Atom summary"


def test_parse_bad_dates_and_missing_fields():
    xml = (
        "<rss><channel>"
        "<item><title>t</title><link>https://x.test/l</link><pubDate>nope</pubDate></item>"
        "<item><title>no link</title></item>"
        "<item><title>naive</title><link>https://x.test/l2</link><pubDate>2026-01-01T00:00:00</pubDate></item>"
        "</channel></rss>"
    )
    items = parse_feed(xml, "S")
    assert [i.title for i in items] == ["t", "naive"]
    assert items[0].published is None
    assert (published := items[1].published) and published.tzinfo is not None


async def test_fetch_merges_dedupes_sorts_and_reports_errors():
    feed_mock("rss.test", RSS)
    feed_mock("atom.test", ATOM)
    feed_mock("down.test", status=500)
    feed_mock("garbage.test", "not xml")
    async with httpx2.AsyncClient() as client:
        result = await make_fetcher(client).fetch_news(
            [
                src("rss.test", "A"),
                src("rss.test", "B"),  # duplicate titles are dropped
                src("atom.test", "C"),
                src("down.test", "D"),
                src("garbage.test", "E"),
                src("rss.test", "off", enabled=False),
            ],
            "ACME",
            max_items=10,
        )
    assert [i.title for i in result.items] == [
        "ACME atom story",
        "ACME beats earnings",
        "ACME faces probe",
    ]
    assert sorted(result.errors) == ["D: HTTP 500", "E: not valid RSS/Atom XML"]


async def test_disabled_sources_are_never_requested():
    live = pook.get("https://rss.test/feed?s=ACME")
    live.reply(200).body(RSS)
    off = pook.get("https://off.test/feed?s=ACME")
    off.reply(200).body(RSS)
    async with httpx2.AsyncClient() as client:
        await make_fetcher(client).fetch_news(
            [src("rss.test"), src("off.test", enabled=False)], "ACME", 10
        )
    assert live.isdone()
    assert not off.isdone()  # never asked


async def test_fetch_respects_max_items_and_asks_for_the_ticker():
    asked = pook.get("https://rss.test/feed?s=BRK.B")
    asked.reply(200).body(RSS)
    async with httpx2.AsyncClient() as client:
        result = await make_fetcher(client).fetch_news([src("rss.test")], "BRK.B", max_items=1)
    assert len(result.items) == 1
    assert asked.isdone()  # the exact URL, ticker included, was requested


async def test_fetch_limits_source_count_and_concurrent_requests():
    class TrackingFetcher(NewsFetcher):
        def __init__(self, client):
            super().__init__(client, allowed_hosts=("rss.test",), max_sources=4, max_concurrency=2)
            self.active = 0
            self.peak = 0
            self.requested = 0

        async def load_feed(self, url, name):
            self.requested += 1
            self.active += 1
            self.peak = max(self.peak, self.active)
            await asyncio.sleep(0)
            self.active -= 1
            return "rss", []

    async with httpx2.AsyncClient() as client:
        fetcher = TrackingFetcher(client)
        result = await fetcher.fetch_news([src("rss.test", str(i)) for i in range(6)], "ACME", 10)

    assert fetcher.requested == 4
    assert fetcher.peak == 2
    assert result.errors == ["Additional enabled sources were skipped; the limit is 4 per request"]


async def test_response_size_limit_is_reported_as_a_feed_error():
    feed_mock("rss.test", RSS)
    async with httpx2.AsyncClient() as client:
        fetcher = make_fetcher(client, max_feed_bytes=100)
        result = await fetcher.fetch_news([src("rss.test", "Large")], "ACME", 10)
    assert result.errors == ["Large: feed exceeds the configured size limit"]


async def test_redirect_to_a_disallowed_host_is_rejected_before_following():
    redirect = pook.get("https://rss.test/feed?s=ACME")
    redirect.reply(302).header("Location", "https://not-allowed.test/private")
    async with httpx2.AsyncClient() as client:
        result = await make_fetcher(client).fetch_news([src("rss.test", "Redirect")], "ACME", 10)
    assert result.errors == [
        "Redirect: Feed host 'not-allowed.test' is not allowed; add it to ZEROAI_ALLOWED_FEED_HOSTS"
    ]
    assert redirect.isdone()


def test_links_that_are_not_http_are_dropped_so_a_feed_cannot_inject_javascript_urls():
    xml = (
        "<rss><channel>"
        "<item><title>good</title><link>https://x.test/ok</link></item>"
        "<item><title>plain http</title><link>HTTP://x.test/also-ok</link></item>"
        "<item><title>evil</title><link>javascript:alert(document.cookie)</link></item>"
        "<item><title>data</title><link>data:text/html,&lt;script&gt;1&lt;/script&gt;</link></item>"
        "<item><title>relative</title><link>/just/a/path</link></item>"
        "</channel></rss>"
    )
    assert [i.title for i in parse_feed(xml, "S")] == ["good", "plain http"]
    atom = (
        '<feed xmlns="http://www.w3.org/2005/Atom">'
        '<entry><title>evil</title><link href="javascript:alert(1)"/></entry>'
        '<entry><title>good</title><link href="https://x.test/a"/></entry></feed>'
    )
    assert [i.title for i in parse_feed(atom, "S")] == ["good"]
