import asyncio

import httpx2
from conftest import RSS, SUMMARY, feed_mock, make_fetcher, runtime_for
from pydantic_ai import Agent
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel

from zeroai.models import NewsSource
from zeroai.schemas import StockSummary
from zeroai.summary.limiter import LLMGate
from zeroai.summary.service import stream_summary


async def test_gate_reports_busy():
    gate = LLMGate(1)
    assert not gate.busy
    async with gate:
        assert gate.busy
    assert not gate.busy


async def test_model_calls_never_exceed_the_limit():
    """Five concurrent summaries against a gate of 2: the model sees at most 2 at once."""
    active = peak = 0

    async def slow_model(messages, info: AgentInfo):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.02)
            yield {0: DeltaToolCall(name=info.output_tools[0].name)}
            yield {0: DeltaToolCall(json_args=SUMMARY.model_dump_json())}
        finally:
            active -= 1

    agent = Agent(FunctionModel(stream_function=slow_model), output_type=StockSummary)
    gate = LLMGate(2)
    sources = [NewsSource(name="S", url_template="https://rss.test/f?s={ticker}")]

    feed_mock("rss.test", RSS)
    async with httpx2.AsyncClient() as client:
        fetcher = make_fetcher(client)

        async def run() -> list[str]:
            return [
                e.name
                async for e in stream_summary(
                    runtime=runtime_for(agent),
                    gate=gate,
                    fetcher=fetcher,
                    sources=sources,
                    ticker="A",
                    max_items=5,
                )
            ]

        results = await asyncio.gather(*(run() for _ in range(5)))

    assert peak == 2
    assert all(r[-1] == "done" for r in results)
    # Callers that had to queue were told so.
    assert any("status" in r and r.count("status") == 3 for r in results)
