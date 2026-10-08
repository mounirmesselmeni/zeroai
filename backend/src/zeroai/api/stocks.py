"""News + AI summary endpoints. ``/summary/stream`` is Server-Sent Events."""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute
from sqlmodel import col, select
from starlette.exceptions import HTTPException as StarletteHTTPException

from zeroai.api.deps import GateDep, LLMDep, NewsFetcherDep, SessionDep, SettingsDep, TickerDep
from zeroai.models import NewsSource
from zeroai.schemas import NewsResponse, RunStats, StockSummary
from zeroai.summary.service import Event, stream_summary, summarize
from zeroai.summary.usage import record_run

router = APIRouter(prefix="/stocks", tags=["stocks"])


async def enabled_sources(session: SessionDep, max_sources: int) -> list[NewsSource]:
    return list(
        (
            await session.exec(
                select(NewsSource)
                .where(col(NewsSource.enabled))
                .order_by(col(NewsSource.id))
                .limit(max_sources + 1)
            )
        ).all()
    )


def format_sse(event: Event) -> str:
    return f"event: {event.name}\ndata: {json.dumps(event.data)}\n\n"


class SSEErrorRoute(APIRoute):
    """Convert prerequisite HTTP errors on the event stream route into SSE errors."""

    def get_route_handler(self):
        route_handler = super().get_route_handler()

        async def handle_request(request: Request):
            try:
                return await route_handler(request)
            except StarletteHTTPException as exc:
                return StreamingResponse(
                    iter([format_sse(Event("error", {"message": str(exc.detail)}))]),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache"},
                )

        return handle_request


sse_router = APIRouter(prefix="/stocks", tags=["stocks"], route_class=SSEErrorRoute)


@router.get("/{ticker}/news", operation_id="getNews")
async def get_news(
    ticker: TickerDep, session: SessionDep, fetcher: NewsFetcherDep, settings: SettingsDep
) -> NewsResponse:
    sources = await enabled_sources(session, fetcher.max_sources)
    return await fetcher.fetch_news(sources, ticker, settings.news_max_items)


@router.get("/{ticker}/summary", operation_id="getSummary")
async def get_summary(
    request: Request,
    ticker: TickerDep,
    session: SessionDep,
    fetcher: NewsFetcherDep,
    settings: SettingsDep,
    llm: LLMDep,
    gate: GateDep,
) -> StockSummary:
    """Single-shot (non-streaming) summary, handy for scripts and curl."""
    summary, stats, error = await summarize(
        runtime=llm,
        gate=gate,
        fetcher=fetcher,
        sources=await enabled_sources(session, fetcher.max_sources),
        ticker=ticker,
        max_items=settings.news_max_items,
    )
    if summary is None or stats is None:
        raise HTTPException(status_code=502, detail=error or "Summary failed")
    await record_run(request.app.state.engine, ticker, stats)
    return summary


@sse_router.get(
    "/{ticker}/summary/stream",
    operation_id="streamSummary",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "Server-Sent Events",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        }
    },
)
async def stream(
    request: Request,
    ticker: TickerDep,
    session: SessionDep,
    fetcher: NewsFetcherDep,
    settings: SettingsDep,
    llm: LLMDep,
    gate: GateDep,
) -> StreamingResponse:
    """SSE: status, news, thinking, summary (partial), then done or error."""
    sources = await enabled_sources(session, fetcher.max_sources)
    engine = request.app.state.engine

    async def body() -> AsyncIterator[str]:
        # When the browser disconnects (reload, navigation, Stop) Starlette cancels this
        # generator; that unwinds stream_summary, which stops the model call, releases the
        # LLM gate and logs ``client_disconnected``, so an abandoned request never keeps the
        # model busy.
        async for event in stream_summary(
            runtime=llm,
            gate=gate,
            fetcher=fetcher,
            sources=sources,
            ticker=ticker,
            max_items=settings.news_max_items,
        ):
            if event.name == "done":
                await record_run(engine, ticker, RunStats.model_validate(event.data["usage"]))
            yield format_sse(event)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
