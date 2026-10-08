"""FastAPI dependencies. Tests swap these via ``app.dependency_overrides``."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlmodel.ext.asyncio.session import AsyncSession
from structlog.contextvars import bind_contextvars

from zeroai.config import Settings, get_settings
from zeroai.models import LLMConfig
from zeroai.news.fetcher import NewsFetcher, normalize_ticker
from zeroai.summary.agent import LLMRuntime, MissingApiKeyError, build_runtime
from zeroai.summary.limiter import LLMGate

SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(request.app.state.engine, expire_on_commit=False) as session:
        yield session


def get_news_fetcher(request: Request) -> NewsFetcher:
    return request.app.state.news_fetcher


SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_llm(request: Request, session: SessionDep, settings: SettingsDep) -> LLMRuntime:
    config = await session.get(LLMConfig, 1)
    if config is None:  # init_db always seeds it
        raise HTTPException(status_code=500, detail="LLM configuration missing")
    try:
        return build_runtime(
            config,
            allowed_model_origins=settings.allowed_model_origins,
            http_client=request.app.state.model_http_client,
        )
    except MissingApiKeyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=503,
            detail="Configured model destination is not allowed; check the server allow-list.",
        ) from exc


async def get_ticker(ticker: str) -> str:
    # ``async`` on purpose: a sync dependency runs in a worker thread, and whatever it binds to
    # the log context would be lost. Here the ticker rides on every log line of the request.
    try:
        normalized = normalize_ticker(ticker)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    bind_contextvars(ticker=normalized)
    return normalized


def get_gate(request: Request) -> LLMGate:
    return request.app.state.llm_gate


NewsFetcherDep = Annotated[NewsFetcher, Depends(get_news_fetcher)]
GateDep = Annotated[LLMGate, Depends(get_gate)]
LLMDep = Annotated[LLMRuntime, Depends(get_llm)]
TickerDep = Annotated[str, Depends(get_ticker)]
