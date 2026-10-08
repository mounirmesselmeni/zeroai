"""FastAPI application factory."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx2
import structlog
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from zeroai.api import settings as llm_settings
from zeroai.api import sources, stocks, usage
from zeroai.config import Settings, get_settings
from zeroai.database import init_db, make_engine
from zeroai.logging import RequestContextMiddleware
from zeroai.news.fetcher import NewsFetcher
from zeroai.summary.limiter import LLMGate

# Some feed hosts (Nasdaq's CDN) stall requests whose User-Agent looks like a bot or library
# (httpx2's default, or one that carries a "+https://..." contact URL), then time out. A plain
# browser-style UA is answered in about 3 s.
USER_AGENT = "Mozilla/5.0 (compatible; ZeroAI/0.1)"
FEED_ACCEPT = (
    "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    log = structlog.get_logger("zeroai.app")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        engine = make_engine(settings)
        try:
            await init_db(engine, settings)
            log.info(
                "app_started",
                database=settings.database_url.split("///")[0],
                llm_max_concurrency=settings.llm_max_concurrency,
                news_timeout_s=settings.news_timeout_seconds,
                log_format=settings.log_format,
            )
            app.state.llm_gate = LLMGate(settings.llm_max_concurrency)
            app.state.engine = engine
            async with (
                httpx2.AsyncClient(
                    timeout=settings.news_timeout_seconds,
                    headers={"User-Agent": USER_AGENT, "Accept": FEED_ACCEPT},
                ) as client,
                httpx2.AsyncClient(
                    follow_redirects=False,
                    timeout=httpx2.Timeout(600, connect=10),
                ) as model_client,
            ):
                app.state.news_fetcher = NewsFetcher(
                    client,
                    allowed_hosts=settings.allowed_feed_hosts,
                    max_feed_bytes=settings.news_max_feed_bytes,
                    max_sources=settings.news_max_sources,
                    max_concurrency=settings.news_fetch_concurrency,
                )
                app.state.model_http_client = model_client
                yield
        finally:
            await engine.dispose()
            log.info("app_stopped")

    app = FastAPI(title="ZeroAI", version="0.1.0", lifespan=lifespan)

    app.dependency_overrides[get_settings] = lambda: settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Added last, so it is the outermost layer: every request, even a rejected one, gets an id.
    app.add_middleware(RequestContextMiddleware)

    api = APIRouter(prefix="/api/v1")
    api.include_router(sources.router)
    api.include_router(stocks.router)
    api.include_router(stocks.sse_router)
    api.include_router(llm_settings.router)
    api.include_router(usage.router)

    @api.get("/health", tags=["meta"], operation_id="health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(api)
    return app
