"""Runtime settings, read from environment variables (prefix ``ZEROAI_``) or ``.env``."""

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from zeroai.destinations import DEFAULT_FEED_HOSTS, DEFAULT_MODEL_ORIGINS

# Silence PydanticAI's promotional startup banner in server logs.
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZEROAI_", env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///zeroai.db"
    cors_origins: list[str] = ["http://localhost:5173"]
    # Exact host/origin allow-lists. Add trusted custom feeds and model endpoints here.
    allowed_feed_hosts: list[str] = list(DEFAULT_FEED_HOSTS)
    allowed_model_origins: list[str] = list(DEFAULT_MODEL_ORIGINS)

    # LLM_* / OLLAMA_* / OPENAI_* only seed the database on first start; after that the
    # configuration lives in the DB and is edited in the UI (Settings page).
    llm_provider: Literal["ollama", "openai"] = "ollama"
    ollama_base_url: str = "http://localhost:11434/v1"
    # Ollama cloud model, served through the local Ollama (sign in once; nothing to download).
    ollama_api_key: str | None = None
    ollama_model: str = "gpt-oss:120b-cloud"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"

    # Max simultaneous LLM calls. A local model serves one request well; raise for hosted APIs.
    llm_max_concurrency: int = Field(default=1, ge=1)

    # Logging: pretty console lines while developing, one JSON object per line for machines.
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_format: Literal["console", "json"] = "console"

    # "console" prints PydanticAI's OpenTelemetry spans (needs `uv sync --group tracing`).
    tracing: Literal["off", "console"] = "off"

    news_max_items: int = 15
    news_timeout_seconds: float = 8.0
    news_max_feed_bytes: int = Field(default=1_000_000, ge=1_024, le=20_000_000)
    news_max_sources: int = Field(default=20, ge=1, le=100)
    news_fetch_concurrency: int = Field(default=5, ge=1, le=20)


@lru_cache
def get_settings() -> Settings:
    return Settings()
