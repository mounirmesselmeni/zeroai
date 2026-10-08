"""Async SQLite engine and session helpers."""

from pathlib import Path

import structlog
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel.ext.asyncio.session import AsyncSession

from zeroai.config import Settings
from zeroai.models import DEFAULT_SOURCES, LLMConfig, NewsSource

log = structlog.get_logger("zeroai.database")


def make_engine(settings: Settings) -> AsyncEngine:
    # In-memory databases need one shared connection, or each connection sees an empty DB.
    pool = {"poolclass": StaticPool} if ":memory:" in settings.database_url else {}
    return create_async_engine(settings.database_url, **pool)


def _seed_llm_config(settings: Settings) -> LLMConfig:
    if settings.llm_provider == "openai":
        return LLMConfig(
            provider="openai", model=settings.openai_model, api_key=settings.openai_api_key
        )
    return LLMConfig(
        provider="ollama",
        model=settings.ollama_model,
        base_url=settings.ollama_base_url,
        api_key=settings.ollama_api_key,
    )


def _upgrade_schema(connection) -> None:
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent / "migrations"))
    config.attributes["connection"] = connection
    command.upgrade(config, "head")


async def init_db(engine: AsyncEngine, settings: Settings) -> None:
    """Create tables and seed the default news sources on first run."""
    async with engine.begin() as conn:
        first_run = not await conn.run_sync(lambda sync: inspect(sync).has_table("newssource"))
        await conn.run_sync(_upgrade_schema)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        if first_run:
            defaults = DEFAULT_SOURCES[: settings.news_max_sources]
            session.add_all(NewsSource(**source) for source in defaults)
            log.info("sources_seeded", count=len(defaults))
        if await session.get(LLMConfig, 1) is None:
            seeded = _seed_llm_config(settings)
            session.add(seeded)
            log.info("llm_config_seeded", provider=seeded.provider, model=seeded.model)
        await session.commit()
