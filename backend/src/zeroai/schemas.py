"""API data shapes (also the source of the OpenAPI schema consumed by Orval)."""

import json
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field, StringConstraints, field_validator
from sqlmodel import SQLModel

from zeroai.destinations import FeedURLTemplate, OptionalHttpURL
from zeroai.models import NewsSourceBase


class NewsSourceCreate(NewsSourceBase):
    """Source create payload; the shared URL type validates its feed template."""


class NewsSourceRead(NewsSourceBase):
    id: int


class NewsSourceUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    url_template: FeedURLTemplate | None = Field(default=None, min_length=8, max_length=500)
    enabled: bool | None = None

    @field_validator("name", "url_template", "enabled", mode="before")
    @classmethod
    def _not_nullable(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("field cannot be null")
        return value


class NewsItem(BaseModel):
    title: str
    link: str
    source: str
    published: datetime | None = None
    snippet: str = ""


class FeedCheckRequest(BaseModel):
    url_template: FeedURLTemplate = Field(min_length=8, max_length=500)
    ticker: str = "AAPL"


class FeedCheck(BaseModel):
    """Result of trying a source once."""

    ok: bool
    kind: Literal["rss", "atom"] | None = None
    item_count: int = 0
    sample: list[str] = []
    error: str | None = None


class NewsResponse(BaseModel):
    ticker: str
    items: list[NewsItem]
    errors: list[str] = []


_SENTIMENT_ALIASES = {
    "positive": "bullish",
    "negative": "bearish",
    "bull": "bullish",
    "bear": "bearish",
    "uncertain": "mixed",
}


def _lenient_sentiment(value: Any) -> Any:
    """Small models answer 'Bullish ' or 'positive'; normalise instead of burning a retry."""
    if isinstance(value, str):
        value = value.strip().lower()
        return _SENTIMENT_ALIASES.get(value, value)
    return value


def _lenient_list(value: Any) -> Any:
    """Small models sometimes send the string '[]' or a bare sentence instead of an array."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except ValueError:
        return [text]
    return parsed if isinstance(parsed, list) else [text]


class StockSummary(BaseModel):
    """Structured output the LLM must produce."""

    headline: str = Field(description="One sentence, the single most important takeaway.")
    sentiment: Annotated[
        Literal["bullish", "bearish", "neutral", "mixed"], BeforeValidator(_lenient_sentiment)
    ]
    key_points: Annotated[list[str], BeforeValidator(_lenient_list)] = Field(
        description="3-6 short bullet points, most important first."
    )
    risks: Annotated[list[str], BeforeValidator(_lenient_list)] = Field(
        default_factory=list, description="Risks or negatives mentioned in the news; may be empty."
    )
    outlook: str = Field(description="Two sentences max on what traders should watch next.")


class LLMConfigRead(BaseModel):
    provider: Literal["ollama", "openai"]
    model: str
    base_url: str | None
    thinking: bool
    thinking_effort: Literal["low", "medium", "high"]
    api_key_set: bool  # the key itself is never sent back


class LLMConfigUpdate(BaseModel):
    provider: Literal["ollama", "openai"]
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    base_url: OptionalHttpURL = Field(default=None, max_length=300)
    thinking: bool | None = None  # None keeps the stored value
    thinking_effort: Literal["low", "medium", "high"] | None = None  # None keeps it
    # None keeps the stored key, "" clears it, anything else replaces it.
    api_key: str | None = None


class RunStats(BaseModel):
    """Token usage (from PydanticAI) and timing of one finished run."""

    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    requests: int
    duration_ms: int


class UsageRun(RunStats):
    id: int
    ticker: str
    created_at: datetime


class ModelUsage(BaseModel):
    """Aggregated usage for one provider/model pair."""

    provider: str
    model: str
    runs: int
    requests: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    avg_duration_ms: int
    last_used: datetime
