import asyncio

import httpx2
from conftest import RSS, feed_mock, make_fetcher, runtime_for
from pydantic_ai import Agent
from pydantic_ai.models.function import AgentInfo, DeltaThinkingPart, FunctionModel

from zeroai.models import NewsSource
from zeroai.schemas import StockSummary
from zeroai.summary.limiter import LLMGate
from zeroai.summary.service import stream_summary


def _slow_agent(state: dict) -> Agent[None, StockSummary]:
    """A model that thinks forever and records whether it was interrupted."""

    async def forever(messages, info: AgentInfo):
        state["started"].set()
        try:
            yield {0: DeltaThinkingPart(content="hmm")}
            await asyncio.sleep(30)
        finally:
            state["torn_down"].set()  # the model call was interrupted (cancel or aclose)

    return Agent(FunctionModel(stream_function=forever), output_type=StockSummary)


async def test_cancelling_the_stream_aborts_the_model_and_frees_the_gate():
    state = {"started": asyncio.Event(), "torn_down": asyncio.Event()}
    gate = LLMGate(1)
    sources = [NewsSource(name="S", url_template="https://rss.test/f?s={ticker}")]
    events: list[str] = []

    feed_mock("rss.test", RSS)
    async with httpx2.AsyncClient() as client:
        fetcher = make_fetcher(client)

        async def consume() -> None:
            async for event in stream_summary(
                runtime=runtime_for(_slow_agent(state)),
                gate=gate,
                fetcher=fetcher,
                sources=sources,
                ticker="ACME",
                max_items=5,
            ):
                events.append(event.name)

        task = asyncio.create_task(consume())
        await asyncio.wait_for(state["started"].wait(), timeout=5)
        assert gate.busy  # the model holds the only slot
        task.cancel()  # what Starlette does when the browser disconnects
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.wait_for(state["torn_down"].wait(), timeout=2)

    assert task.cancelled()
    assert state["torn_down"].is_set()  # the model call was interrupted
    assert not gate.busy  # slot released, the next request does not queue
    assert "done" not in events and "error" not in events


async def test_a_request_cancelled_while_queued_never_reaches_the_model():
    state = {"started": asyncio.Event(), "torn_down": asyncio.Event()}
    gate = LLMGate(1)
    sources = [NewsSource(name="S", url_template="https://rss.test/f?s={ticker}")]

    feed_mock("rss.test", RSS)
    async with httpx2.AsyncClient() as client:
        fetcher = make_fetcher(client)

        async def consume(agent: Agent[None, StockSummary], out: list[str]) -> None:
            async for event in stream_summary(
                runtime=runtime_for(agent),
                gate=gate,
                fetcher=fetcher,
                sources=sources,
                ticker="ACME",
                max_items=5,
            ):
                out.append(event.name)

        first = asyncio.create_task(consume(_slow_agent(state), []))
        await asyncio.wait_for(state["started"].wait(), timeout=5)

        second_state = {"started": asyncio.Event(), "torn_down": asyncio.Event()}
        second_events: list[str] = []
        second = asyncio.create_task(consume(_slow_agent(second_state), second_events))
        for _ in range(50):  # let it reach the semaphore
            await asyncio.sleep(0.01)
            if "news" in second_events and second_events.count("status") >= 2:
                break
        assert second_events[-1] == "status"  # "Waiting for the model"
        second.cancel()
        await asyncio.gather(second, return_exceptions=True)
        assert not second_state["started"].is_set()  # never ran
        assert gate.busy  # first request still owns the slot

        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
    assert not gate.busy
