"""Persist and aggregate per-run token usage."""

import structlog
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlmodel import col, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from zeroai.models import UsageRecord
from zeroai.schemas import ModelUsage, RunStats, UsageRun

log = structlog.get_logger("zeroai.usage")


async def record_run(engine: AsyncEngine, ticker: str, stats: RunStats) -> None:
    """Uses its own session: it runs inside a streaming response, after the request's ended."""
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            session.add(
                UsageRecord(
                    ticker=ticker,
                    provider=stats.provider,
                    model=stats.model,
                    input_tokens=stats.input_tokens,
                    output_tokens=stats.output_tokens,
                    requests=stats.requests,
                    duration_ms=stats.duration_ms,
                )
            )
            await session.commit()
    except SQLAlchemyError:
        # Accounting is best effort: a database failure must not discard a completed answer.
        log.exception("usage_record_failed", ticker=ticker, model=stats.model)
        return
    log.info(
        "usage_recorded",
        ticker=ticker,
        model=stats.model,
        total_tokens=stats.total_tokens,
        requests=stats.requests,
        duration_ms=stats.duration_ms,
    )


async def usage_by_model(session: AsyncSession) -> list[ModelUsage]:
    rows = await session.exec(
        select(  # ty: ignore[no-matching-overload]  # SQLModel types select() for <= 4 columns
            UsageRecord.provider,
            UsageRecord.model,
            func.count(),
            func.sum(UsageRecord.requests),
            func.sum(UsageRecord.input_tokens),
            func.sum(UsageRecord.output_tokens),
            func.avg(UsageRecord.duration_ms),
            func.max(UsageRecord.created_at),
        )
        .group_by(col(UsageRecord.provider), col(UsageRecord.model))
        .order_by(func.max(UsageRecord.created_at).desc())
    )
    return [
        ModelUsage(
            provider=provider,
            model=model,
            runs=runs,
            requests=requests,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            total_tokens=tokens_in + tokens_out,
            avg_duration_ms=round(avg_ms),
            last_used=last_used,
        )
        for provider, model, runs, requests, tokens_in, tokens_out, avg_ms, last_used in rows.all()
    ]


async def recent_runs(session: AsyncSession, limit: int) -> list[UsageRun]:
    rows = await session.exec(select(UsageRecord).order_by(col(UsageRecord.id).desc()).limit(limit))
    return [
        UsageRun(
            id=r.id or 0,
            ticker=r.ticker,
            created_at=r.created_at,
            provider=r.provider,
            model=r.model,
            input_tokens=r.input_tokens,
            output_tokens=r.output_tokens,
            total_tokens=r.input_tokens + r.output_tokens,
            requests=r.requests,
            duration_ms=r.duration_ms,
        )
        for r in rows
    ]
