"""CRUD for user-configurable news sources."""

import structlog
from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import insert, literal
from sqlmodel import col, func, select

from zeroai.api.deps import NewsFetcherDep, SessionDep
from zeroai.models import NewsSource
from zeroai.news.fetcher import normalize_ticker
from zeroai.schemas import (
    FeedCheck,
    FeedCheckRequest,
    NewsSourceCreate,
    NewsSourceRead,
    NewsSourceUpdate,
)

router = APIRouter(prefix="/sources", tags=["sources"])
log = structlog.get_logger("zeroai.sources")


async def _get_or_404(session: SessionDep, source_id: int) -> NewsSource:
    source = await session.get(NewsSource, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


@router.get("", operation_id="listSources")
async def list_sources(session: SessionDep) -> list[NewsSourceRead]:
    rows = await session.exec(select(NewsSource).order_by(col(NewsSource.id)))
    return [NewsSourceRead.model_validate(s, from_attributes=True) for s in rows]


@router.post("/check", operation_id="checkSource")
async def check_source(payload: FeedCheckRequest, fetcher: NewsFetcherDep) -> FeedCheck:
    """Try a feed URL once and say what it is (RSS/Atom), how many items, or why it failed."""
    try:
        ticker = normalize_ticker(payload.ticker)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result = await fetcher.check_feed(payload.url_template, ticker)
    log.info(
        "feed_checked",
        ok=result.ok,
        kind=result.kind,
        items=result.item_count,
        error=result.error,
    )
    return result


@router.post("", status_code=status.HTTP_201_CREATED, operation_id="createSource")
async def create_source(
    payload: NewsSourceCreate, session: SessionDep, fetcher: NewsFetcherDep
) -> NewsSourceRead:
    try:
        fetcher.validate_url_template(payload.url_template)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # A single write statement makes the capacity check atomic across SQLite connections.
    count = select(func.count()).select_from(NewsSource).scalar_subquery()
    inserted = await session.exec(
        insert(NewsSource)
        .from_select(
            ["name", "url_template", "enabled"],
            select(
                literal(payload.name), literal(payload.url_template), literal(payload.enabled)
            ).where(count < fetcher.max_sources),
        )
        .returning(col(NewsSource.id))
    )
    source_id = inserted.scalar_one_or_none()
    if source_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"The source limit is {fetcher.max_sources}.",
        )
    await session.commit()
    source = await _get_or_404(session, source_id)
    log.info("source_created", source_id=source.id, name=source.name, enabled=source.enabled)
    return NewsSourceRead.model_validate(source, from_attributes=True)


@router.patch("/{source_id}", operation_id="updateSource")
async def update_source(
    source_id: int, payload: NewsSourceUpdate, session: SessionDep, fetcher: NewsFetcherDep
) -> NewsSourceRead:
    source = await _get_or_404(session, source_id)
    if payload.url_template is not None:
        try:
            fetcher.validate_url_template(payload.url_template)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    source.sqlmodel_update(payload.model_dump(exclude_unset=True))
    session.add(source)
    await session.commit()
    await session.refresh(source)
    log.info(
        "source_updated",
        source_id=source.id,
        changed=sorted(payload.model_dump(exclude_unset=True)),
        enabled=source.enabled,
    )
    return NewsSourceRead.model_validate(source, from_attributes=True)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteSource")
async def delete_source(source_id: int, session: SessionDep) -> Response:
    source = await _get_or_404(session, source_id)
    name = source.name
    await session.delete(source)
    await session.commit()
    log.info("source_deleted", source_id=source_id, name=name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
