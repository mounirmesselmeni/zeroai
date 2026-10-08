"""Database tables."""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlmodel import Field, SQLModel

from zeroai.destinations import FeedURLTemplate


class NewsSourceBase(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    # RSS/Atom feed URL; ``{ticker}`` is replaced by the (URL-encoded) stock symbol.
    url_template: FeedURLTemplate = Field(min_length=8, max_length=500)
    enabled: bool = True


class NewsSource(NewsSourceBase, table=True):
    id: int | None = Field(default=None, primary_key=True)


DEFAULT_SOURCES: list[dict] = [
    {
        "name": "Yahoo Finance",
        "url_template": "https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US",
    },
    {
        "name": "Google News",
        "url_template": "https://news.google.com/rss/search?q={ticker}+stock&hl=en-US&gl=US&ceid=US:en",
    },
    {
        "name": "Nasdaq",
        "url_template": "https://www.nasdaq.com/feed/rssoutbound?symbol={ticker}",
    },
]


class LLMConfig(SQLModel, table=True):
    """The single active model configuration (row id=1), editable from the UI."""

    id: int = Field(default=1, primary_key=True)
    provider: str = "ollama"  # "ollama" | "openai"
    model: str = "gpt-oss:120b-cloud"
    base_url: str | None = None
    # Reasoning mode for local thinking models (qwen3...). Off = fast and reliable.
    thinking: bool = Field(default=True, sa_column_kwargs={"server_default": text("1")})
    # How much to reason when thinking is on: low, medium or high.
    thinking_effort: str = Field(
        default="high", sa_column_kwargs={"server_default": text("'high'")}
    )
    # Stored in plain text: this is a local, single-user app. Never returned by the API.
    api_key: str | None = None


class UsageRecord(SQLModel, table=True):
    """One finished summary run: tokens as reported by PydanticAI, plus wall-clock time."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC), index=True)
    ticker: str
    provider: str = Field(index=True)
    model: str = Field(index=True)
    input_tokens: int = 0
    output_tokens: int = 0
    requests: int = 1
    duration_ms: int = 0
