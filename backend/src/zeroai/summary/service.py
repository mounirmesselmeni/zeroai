"""Orchestrates fetch -> summarise and emits progress as a stream of events."""

import asyncio
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any

import structlog
from pydantic_ai.exceptions import UnexpectedModelBehavior
from structlog.contextvars import get_contextvars

from zeroai.models import NewsSource
from zeroai.news.fetcher import NewsFetcher
from zeroai.schemas import RunStats, StockSummary
from zeroai.summary.agent import LLMRuntime, build_prompt
from zeroai.summary.limiter import LLMGate
from zeroai.summary.stream_parser import ModelStreamParser

log = structlog.get_logger("zeroai.briefing")


@dataclass(frozen=True)
class Event:
    """One server-sent event: ``name`` + JSON-serialisable ``data``."""

    name: str
    data: Any


async def stream_summary(
    *,
    runtime: LLMRuntime,
    gate: LLMGate,
    fetcher: NewsFetcher,
    sources: Sequence[NewsSource],
    ticker: str,
    max_items: int,
) -> AsyncIterator[Event]:
    """Yield ``status``, ``news``, ``thinking``, ``summary`` (partial), then ``done`` or ``error``.

    ``done`` carries ``{"summary": ..., "usage": RunStats}``.
    """
    started = time.perf_counter()

    def elapsed() -> int:
        return round((time.perf_counter() - started) * 1000)

    blog = log.bind(ticker=ticker, provider=runtime.provider, model=runtime.model)
    phase = "fetching_news"
    blog.info("briefing_started", show_thinking=runtime.show_thinking)
    try:
        yield Event("status", {"message": f"Fetching news for {ticker}"})
        news = await fetcher.fetch_news(sources, ticker, max_items)
        yield Event("news", news.model_dump(mode="json"))
        if not news.items:
            blog.warning("no_news", failed_sources=len(news.errors), duration_ms=elapsed())
            yield Event("error", {"message": f"No recent news found for {ticker}."})
            return

        phase = "waiting_for_model"
        if gate.busy:
            blog.info("model_queued", reason="another run holds the model")
            yield Event("status", {"message": "Waiting for the model"})
        wait_started = time.perf_counter()
        async with gate:
            waited_ms = round((time.perf_counter() - wait_started) * 1000)
            phase = "model_running"
            blog.info("model_acquired", waited_ms=waited_ms)
            yield Event("status", {"message": "Summarising"})
            model_started = time.perf_counter()
            blog.info("model_started", news_items=len(news.items))
            parser = ModelStreamParser()
            final = None
            thinking_chars = 0
            seen_first: set[str] = set()

            def first_token(kind: str) -> None:
                if kind not in seen_first:
                    seen_first.add(kind)
                    blog.info(
                        "model_first_token",
                        kind=kind,
                        after_ms=round((time.perf_counter() - model_started) * 1000),
                    )

            async with runtime.agent.run_stream_events(
                build_prompt(ticker, news.items),
                # Shown on the run's span, so a trace can be matched to its log lines.
                metadata={"request_id": get_contextvars().get("request_id"), "ticker": ticker},
            ) as stream:
                async for ev in stream:
                    update = parser.consume(ev)
                    if update.retry:
                        blog.warning("model_retry", reason="the previous answer was unusable")
                    if update.result is not None:
                        final = update.result
                    if update.thinking_chars:
                        thinking_chars += update.thinking_chars
                        first_token("thinking")
                    if update.thinking_delta and runtime.show_thinking:
                        yield Event("thinking", {"delta": update.thinking_delta})
                    if update.answer_started:
                        first_token("answer")
                    if update.partial_summary:
                        yield Event("summary", update.partial_summary)
    except asyncio.CancelledError:
        # The browser went away (reload, Stop, closed tab). The model call is dropped and the gate
        # released as the cancellation unwinds through the ``async with`` blocks above.
        blog.info("client_disconnected", phase=phase, after_ms=elapsed())
        raise
    except UnexpectedModelBehavior as exc:
        blog.warning("model_gave_no_usable_answer", error=str(exc), duration_ms=elapsed())
        yield Event(
            "error",
            {
                "message": (
                    f"{runtime.model} did not return a usable answer ({exc}). Try again, or pick "
                    "a different model in Settings."
                )
            },
        )
        return
    except Exception as exc:  # noqa: BLE001 - surface any model/provider failure to the client
        blog.exception("model_failed", phase=phase, duration_ms=elapsed())
        yield Event("error", {"message": f"Summary failed: {exc}"})
        return
    if final is None:
        blog.error("model_returned_no_result", duration_ms=elapsed())
        yield Event("error", {"message": "The model returned no result."})
        return

    usage = final.usage
    stats = RunStats(
        provider=runtime.provider,
        model=runtime.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        total_tokens=usage.input_tokens + usage.output_tokens,
        requests=usage.requests,
        duration_ms=elapsed(),
    )
    blog.info(
        "model_finished",
        input_tokens=stats.input_tokens,
        output_tokens=stats.output_tokens,
        requests=stats.requests,
        retried=stats.requests > 1,
        thinking_chars=thinking_chars,
        model_ms=round((time.perf_counter() - model_started) * 1000),
    )
    blog.info("briefing_finished", total_ms=stats.duration_ms, sentiment=final.output.sentiment)
    yield Event(
        "done",
        {"summary": final.output.model_dump(mode="json"), "usage": stats.model_dump(mode="json")},
    )


async def summarize(
    *,
    runtime: LLMRuntime,
    gate: LLMGate,
    fetcher: NewsFetcher,
    sources: Sequence[NewsSource],
    ticker: str,
    max_items: int,
) -> tuple[StockSummary | None, RunStats | None, str | None]:
    """Non-streaming convenience: drain the stream and return (summary, stats, error)."""
    summary, stats, error = None, None, None
    async for event in stream_summary(
        runtime=runtime,
        gate=gate,
        fetcher=fetcher,
        sources=sources,
        ticker=ticker,
        max_items=max_items,
    ):
        if event.name == "done":
            summary = StockSummary.model_validate(event.data["summary"])
            stats = RunStats.model_validate(event.data["usage"])
        elif event.name == "error":
            error = event.data["message"]
    return summary, stats, error
