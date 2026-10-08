import re

# pookx (the maintained pook fork with httpx2 support) is imported under the module name `pook`.
import httpx2
import pook
import pytest
from fastapi.testclient import TestClient
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from zeroai.api.deps import get_llm
from zeroai.bootstrap import configure_process
from zeroai.config import Settings
from zeroai.destinations import DEFAULT_FEED_HOSTS, DEFAULT_MODEL_ORIGINS
from zeroai.main import create_app
from zeroai.news.fetcher import NewsFetcher
from zeroai.schemas import StockSummary
from zeroai.summary.agent import LLMRuntime

RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel>
<item><title>ACME beats earnings</title><link>https://x.test/1</link>
<pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate>
<description>&lt;p&gt;Revenue up &lt;b&gt;12%&lt;/b&gt;&lt;/p&gt;</description></item>
<item><title>ACME faces probe</title><link>https://x.test/2</link>
<pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""

ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>ACME atom story</title>
<link href="https://x.test/3"/><updated>2026-10-07T08:00:00Z</updated>
<summary>Atom summary</summary></entry></feed>"""

SUMMARY = StockSummary(
    headline="ACME beat earnings.",
    sentiment="bullish",
    key_points=["Revenue up 12%"],
    risks=["Regulatory probe"],
    outlook="Watch the probe.",
)

TEST_FEED_HOSTS = (
    *DEFAULT_FEED_HOSTS,
    "rss.test",
    "atom.test",
    "garbage.test",
    "down.test",
    "x.test",
    "strict.test",
    "off.test",
    "cnn.test",
    "good.test",
    "example.test",
    "malicious.test",
)


def make_fetcher(client: httpx2.AsyncClient, **limits: int) -> NewsFetcher:
    return NewsFetcher(client, allowed_hosts=TEST_FEED_HOSTS, **limits)


@pytest.fixture(autouse=True)
def network():
    """No test can reach the internet. Outgoing httpx2 calls are answered by pookx mocks only;
    an unmocked URL raises ``PookNoMatches`` instead of going out.

    Starlette's TestClient talks to the app through the same machinery, so ``testserver`` is let
    through.
    """
    with pook.use():
        pook.disable_network()
        pook.enable_network("testserver")
        yield pook


def feed_mock(
    host: str,
    body: str = "",
    *,
    status: int = 200,
    content_type: str | None = None,
    persist: bool = True,
):
    """Answer every ``https://<host>/...`` request (any path or query) with ``body``."""
    mock = pook.get(pook.regex(rf"^https://{re.escape(host)}/.*"))
    if persist:
        mock = mock.persist()
    reply = mock.reply(status)
    if content_type:
        reply = reply.header("Content-Type", content_type)
    if body:
        reply = reply.body(body)
    return mock


def default_feeds() -> None:
    """The fake internet used by API tests: two good feeds, one dead host, one that is not XML."""
    feed_mock("rss.test", RSS)
    feed_mock("atom.test", ATOM)
    feed_mock("garbage.test", "not xml")
    feed_mock("down.test", status=500)


@pytest.fixture
def agent() -> Agent[None, StockSummary]:
    return Agent(TestModel(custom_output_args=SUMMARY.model_dump()), output_type=StockSummary)


@pytest.fixture
def client(agent):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        allowed_feed_hosts=list(TEST_FEED_HOSTS),
        allowed_model_origins=[*DEFAULT_MODEL_ORIGINS, "https://x.test"],
    )
    configure_process(settings)
    app = create_app(settings)
    default_feeds()
    # The app keeps its own real httpx2 client; pookx answers whatever it sends out.
    with TestClient(app) as test_client:
        app.dependency_overrides[get_llm] = lambda: LLMRuntime(agent, "test", "test-model")
        yield test_client


def runtime_for(agent: Agent[None, StockSummary]) -> LLMRuntime:
    return LLMRuntime(agent, "test", "test-model")
